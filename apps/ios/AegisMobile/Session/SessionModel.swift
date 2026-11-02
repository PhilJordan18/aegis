import Foundation
import Observation

/// Message shown on the sign-in form. Each maps to one short localized sentence.
enum SignInNotice: Equatable, Sendable {
    /// 401 AUTH_INVALID_CREDENTIALS: same answer for unknown, disabled or wrong.
    case rejected
    /// 429 RATE_LIMITED; the delay is present only when the server sent a valid one.
    case rateLimited(retryAfter: Duration?)
    case unreachable
    case serviceError(traceId: String?)
    /// 400 VALIDATION_ERROR whose violations name no known field.
    case invalidFields
    /// The token could not be written to the Keychain.
    case storageFailed
    case expired
    case invalidSession
    case signedOut
}

enum FieldError: Equatable, Sendable {
    case emailMissing
    case emailInvalid
    case emailTooLong
    case passwordMissing
    case passwordRejected
}

/// Session state of the technician app. The backend stays the authority: a
/// stored token is only a candidate until `GET /auth/me` accepts it, and the
/// app never reads the token's content (doc 09 §4).
@MainActor
@Observable
final class SessionModel {
    enum Phase: Equatable {
        case restoring
        case signIn
        /// The stored token is not expired but could not be checked: it is kept,
        /// the session is not presented as verified and nothing else is offered.
        case resumeOffline
        case signedIn(UserProfile)
        /// A non-technician account signed in; its token was discarded (U6).
        /// Unknown roles are refused too, with a neutral message.
        case wrongRole(email: String, isAdministrator: Bool)
    }

    static let maximumEmailLength = 320

    private(set) var phase: Phase = .restoring
    var email = ""
    var password = ""
    private(set) var notice: SignInNotice?
    private(set) var emailError: FieldError?
    private(set) var passwordError: FieldError?
    private(set) var isSubmitting = false
    private(set) var isResuming = false
    /// While set and in the future, sign-in is locked by a server `Retry-After`.
    private(set) var retryAvailableAt: Date?
    private(set) var expiresAt: Date?

    private let auth: any AuthenticationService
    private let store: any SessionStore
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void
    private var expiryTask: Task<Void, Never>?
    private var unlockTask: Task<Void, Never>?
    /// Bumped by every transition that supersedes an in-flight request, so a
    /// late answer (a resume after sign-out, for example) is dropped.
    private var generation = 0

    init(auth: any AuthenticationService,
         store: any SessionStore,
         now: @escaping @Sendable () -> Date = Date.init,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.auth = auth
        self.store = store
        self.now = now
        self.sleep = sleep
    }

    var isRateLimited: Bool {
        guard let retryAvailableAt else { return false }
        return retryAvailableAt > now()
    }

    var canSubmit: Bool { !isSubmitting && !isRateLimited }

    // MARK: Launch and resume

    /// Restores a stored session at launch.
    func start() async {
        phase = .restoring
        await resumeStoredSession()
    }

    func retryResume() async {
        guard phase == .resumeOffline, !isResuming else { return }
        isResuming = true
        defer { isResuming = false }
        await resumeStoredSession()
    }

    private func resumeStoredSession() async {
        let stored: StoredSession?
        do throws(SessionStoreError) {
            stored = try store.load()
        } catch .corrupted {
            // An unreadable item is useless; start over without a session.
            removeStoredSession()
            showSignIn(notice: nil)
            return
        } catch {
            // A Keychain refusal can be transient (device locked): keep the item;
            // a new sign-in replaces it.
            showSignIn(notice: nil)
            return
        }
        // An empty token is the tombstone written when a sign-out could not
        // delete the item: there is no session.
        guard let stored, !stored.accessToken.isEmpty else {
            if stored != nil { removeStoredSession() }
            showSignIn(notice: nil)
            return
        }
        guard stored.expiresAt > now() else {
            discardSession(prefill: stored.email, notice: .expired)
            return
        }
        let request = advanceGeneration()
        do throws(APIError) {
            let profile = try await auth.currentProfile(bearer: stored.accessToken)
            guard request == generation else { return }
            accept(profile, deadline: stored.expiresAt)
        } catch let .http(status, problem, _) where status == 401 || status == 403 {
            guard request == generation else { return }
            // `/auth/me` only checks the caller's own account: a 403 there means
            // the account may not use the app (doc 09 leaves disabled accounts
            // open between 401 and 403), unlike a business 403.
            discardSession(prefill: stored.email, notice: Self.notice(forUnauthorized: problem?.code))
        } catch {
            guard request == generation else { return }
            phase = .resumeOffline
        }
    }

    // MARK: Sign-in

    func signIn() async {
        guard canSubmit else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        email = address
        emailError = Self.validate(email: address)
        passwordError = password.isEmpty ? .passwordMissing : nil
        guard emailError == nil, passwordError == nil else {
            notice = nil
            return
        }

        isSubmitting = true
        notice = nil
        defer { isSubmitting = false }
        let request = advanceGeneration()
        do throws(APIError) {
            let response = try await auth.login(email: address, password: password)
            guard request == generation else { return }
            password = ""
            guard response.user.role == .technician else {
                // U6: no data is loaded and the token is not kept.
                showWrongRole(response.user)
                return
            }
            // The deadline follows the device clock from `expiresIn`, so a
            // skewed device clock neither expires nor extends the session early.
            let deadline = now().addingTimeInterval(TimeInterval(response.expiresIn))
            let session = StoredSession(accessToken: response.accessToken,
                                        expiresAt: deadline, email: response.user.email)
            do {
                try store.save(session)
            } catch {
                notice = .storageFailed
                return
            }
            accept(response.user, deadline: deadline)
        } catch .cancelled {
            return
        } catch let .http(status, problem, retryAfter) {
            guard request == generation else { return }
            handleSignInFailure(status: status, problem: problem, retryAfter: retryAfter)
        } catch .unreachable {
            guard request == generation else { return }
            notice = .unreachable
        } catch {
            guard request == generation else { return }
            notice = .serviceError(traceId: nil)
        }
    }

    enum Field { case email, password }

    /// Editing a field withdraws its error until the next submission.
    func edited(_ field: Field) {
        switch field {
        case .email: emailError = nil
        case .password: passwordError = nil
        }
    }

    private func handleSignInFailure(status: Int, problem: APIProblem?, retryAfter: Duration?) {
        switch status {
        case 401:
            password = ""
            notice = .rejected
        case 429:
            notice = .rateLimited(retryAfter: retryAfter)
            if let retryAfter { lockSignIn(for: retryAfter) }
        case 400 where problem?.code == "VALIDATION_ERROR":
            let fields = Set(problem?.violations?.map(\.field) ?? [])
            if fields.contains("email") { emailError = .emailInvalid }
            if fields.contains("password") { passwordError = .passwordRejected }
            if emailError == nil, passwordError == nil { notice = .invalidFields }
        default:
            notice = .serviceError(traceId: problem?.traceId.flatMap(Self.displayableTraceId))
        }
    }

    private func lockSignIn(for delay: Duration) {
        retryAvailableAt = now().addingTimeInterval(TimeInterval(delay.components.seconds))
        unlockTask?.cancel()
        unlockTask = Task { [weak self, sleep] in
            try? await sleep(delay)
            guard !Task.isCancelled else { return }
            self?.unlockSignIn()
        }
    }

    private func unlockSignIn() {
        retryAvailableAt = nil
        if case .rateLimited = notice { notice = nil }
    }

    // MARK: Signed-in session

    /// Ends the session locally; no server route exists (doc 09 §4.2).
    func signOut() {
        advanceGeneration()
        removeStoredSession()
        expiryTask?.cancel()
        expiresAt = nil
        email = ""
        password = ""
        showSignIn(notice: .signedOut)
    }

    func useAnotherAccount() {
        advanceGeneration()
        email = ""
        password = ""
        showSignIn(notice: nil)
    }

    /// Called by an authenticated request that receives 401. A 403 is a
    /// refusal of that action (doc 09 §4.3) and keeps the session.
    func handleUnauthorized(code: String?) {
        guard case let .signedIn(profile) = phase else { return }
        discardSession(prefill: profile.email, notice: Self.notice(forUnauthorized: code))
    }

    /// Token for an authenticated read, only while the session is verified and
    /// not locally expired. Read from the store for each request; never cached.
    func accessToken() -> String? {
        guard case .signedIn = phase, let expiresAt, expiresAt > now(),
              let stored = try? store.load(), !stored.accessToken.isEmpty else { return nil }
        return stored.accessToken
    }

    /// No usable token while signed in: the local expiry passed, or the
    /// stored item disappeared. Either way the session ends.
    func handleMissingToken() {
        if let expiresAt, expiresAt <= now() {
            checkExpiry()
        } else {
            handleUnauthorized(code: nil)
        }
    }

    /// Checks the local expiry, for example when the app returns to the foreground.
    func checkExpiry() {
        guard case let .signedIn(profile) = phase, let expiresAt, expiresAt <= now() else { return }
        discardSession(prefill: profile.email, notice: .expired)
    }

    private func accept(_ profile: UserProfile, deadline: Date) {
        guard profile.role == .technician else {
            showWrongRole(profile)
            return
        }
        advanceGeneration()
        expiresAt = deadline
        email = ""
        password = ""
        notice = nil
        phase = .signedIn(profile)
        scheduleExpiry(at: deadline)
    }

    /// Sleeps until the deadline, re-checking after each wake: the wall clock
    /// may have moved while the app slept.
    private func scheduleExpiry(at deadline: Date) {
        expiryTask?.cancel()
        expiryTask = Task { [weak self, sleep, now] in
            while !Task.isCancelled {
                let remaining = deadline.timeIntervalSince(now())
                if remaining <= 0 {
                    self?.checkExpiry()
                    return
                }
                try? await sleep(.seconds(remaining))
            }
        }
    }

    private func showWrongRole(_ profile: UserProfile) {
        advanceGeneration()
        removeStoredSession()
        password = ""
        phase = .wrongRole(email: profile.email, isAdministrator: profile.role == .admin)
    }

    private func discardSession(prefill email: String, notice: SignInNotice) {
        advanceGeneration()
        removeStoredSession()
        expiryTask?.cancel()
        expiresAt = nil
        self.email = email
        password = ""
        showSignIn(notice: notice)
    }

    private func showSignIn(notice: SignInNotice?) {
        self.notice = notice
        emailError = nil
        passwordError = nil
        phase = .signIn
    }

    @discardableResult
    private func advanceGeneration() -> Int {
        generation += 1
        return generation
    }

    /// The token must not survive a sign-out (doc 09 §4.2): if the item cannot
    /// be deleted, it is overwritten with an expired, empty session.
    private func removeStoredSession() {
        do {
            try store.delete()
        } catch {
            try? store.save(StoredSession(accessToken: "", expiresAt: .distantPast, email: ""))
        }
    }

    // MARK: Rules

    /// Trace identifiers are shown verbatim; anything else a proxy might send
    /// is dropped rather than displayed.
    nonisolated static func displayableTraceId(_ value: String) -> String? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-"))
        guard (1...64).contains(value.count), value.unicodeScalars.allSatisfy(allowed.contains),
              value.allSatisfy(\.isASCII) else { return nil }
        return value
    }

    private static func notice(forUnauthorized code: String?) -> SignInNotice {
        code == "AUTH_TOKEN_EXPIRED" ? .expired : .invalidSession
    }

    /// Local checks only spare a round trip; the server validates again.
    static func validate(email: String) -> FieldError? {
        if email.isEmpty { return .emailMissing }
        if email.count > maximumEmailLength { return .emailTooLong }
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."),
              !parts[1].hasPrefix("."), !parts[1].hasSuffix("."),
              !email.contains(where: \.isWhitespace) else { return .emailInvalid }
        return nil
    }
}

extension SessionModel: SessionAccess {}
