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
        case wrongRole(email: String)
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
        do {
            stored = try store.load()
        } catch {
            // An unreadable item is useless; start over without a session.
            try? store.delete()
            showSignIn(notice: nil)
            return
        }
        guard let stored else {
            showSignIn(notice: nil)
            return
        }
        guard stored.expiresAt > now() else {
            discardSession(prefill: stored.email, notice: .expired)
            return
        }
        do throws(APIError) {
            let profile = try await auth.currentProfile(bearer: stored.accessToken)
            accept(profile, expiresAt: stored.expiresAt)
        } catch let .http(status, problem, _) where status == 401 || status == 403 {
            discardSession(prefill: stored.email, notice: Self.notice(forUnauthorized: problem?.code))
        } catch {
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
        do throws(APIError) {
            let response = try await auth.login(email: address, password: password)
            password = ""
            guard response.user.role == .technician else {
                // U6: no data is loaded and the token is not kept.
                showWrongRole(email: response.user.email)
                return
            }
            let session = StoredSession(accessToken: response.accessToken,
                                        expiresAt: response.expiresAt, email: response.user.email)
            do {
                try store.save(session)
            } catch {
                notice = .storageFailed
                return
            }
            accept(response.user, expiresAt: response.expiresAt)
        } catch .cancelled {
            return
        } catch let .http(status, problem, retryAfter) {
            handleSignInFailure(status: status, problem: problem, retryAfter: retryAfter)
        } catch .unreachable {
            notice = .unreachable
        } catch {
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
            notice = .serviceError(traceId: problem?.traceId)
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
        try? store.delete()
        expiryTask?.cancel()
        expiresAt = nil
        email = ""
        password = ""
        showSignIn(notice: .signedOut)
    }

    func useAnotherAccount() {
        email = ""
        password = ""
        showSignIn(notice: nil)
    }

    /// Called by any authenticated request that receives 401 or 403.
    func handleUnauthorized(code: String?) {
        guard case let .signedIn(profile) = phase else { return }
        discardSession(prefill: profile.email, notice: Self.notice(forUnauthorized: code))
    }

    /// Checks the local expiry, for example when the app returns to the foreground.
    func checkExpiry() {
        guard case let .signedIn(profile) = phase, let expiresAt, expiresAt <= now() else { return }
        discardSession(prefill: profile.email, notice: .expired)
    }

    private func accept(_ profile: UserProfile, expiresAt: Date) {
        guard profile.role == .technician else {
            showWrongRole(email: profile.email)
            return
        }
        self.expiresAt = expiresAt
        email = ""
        password = ""
        notice = nil
        phase = .signedIn(profile)
        scheduleExpiry(at: expiresAt)
    }

    private func scheduleExpiry(at date: Date) {
        expiryTask?.cancel()
        let delay = Duration.seconds(max(0, date.timeIntervalSince(now())))
        expiryTask = Task { [weak self, sleep] in
            try? await sleep(delay)
            guard !Task.isCancelled else { return }
            self?.checkExpiry()
        }
    }

    private func showWrongRole(email: String) {
        try? store.delete()
        password = ""
        phase = .wrongRole(email: email)
    }

    private func discardSession(prefill email: String, notice: SignInNotice) {
        try? store.delete()
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

    // MARK: Rules

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
