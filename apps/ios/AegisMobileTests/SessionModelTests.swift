import Foundation
import Testing
@testable import AegisMobile

@MainActor
struct SessionModelTests {
    let clock = TestClock()

    /// Timers never fire unless a test releases them.
    func makeModel(auth: StubAuthentication, store: any SessionStore = InMemorySessionStore(),
                   timerGate: Gate = Gate()) -> SessionModel {
        let clock = clock
        return SessionModel(auth: auth, store: store, now: { clock.now }, sleep: { _ in await timerGate.wait() })
    }

    func stored(expiringIn seconds: TimeInterval) -> StoredSession {
        StoredSession(accessToken: "stored-token", expiresAt: clock.now.addingTimeInterval(seconds),
                      email: SessionFixtures.technician.email)
    }

    // MARK: Launch

    @Test func launchWithoutSessionShowsTheForm() async {
        let model = makeModel(auth: StubAuthentication())

        await model.start()

        #expect(model.phase == .signIn)
        #expect(model.notice == nil)
    }

    @Test func expiredStoredSessionIsDiscardedWithoutACall() async throws {
        let auth = StubAuthentication()
        let store = InMemorySessionStore(stored(expiringIn: -1))
        let model = makeModel(auth: auth, store: store)

        await model.start()

        #expect(model.phase == .signIn)
        #expect(model.notice == .expired)
        #expect(model.email == SessionFixtures.technician.email)
        #expect(try store.load() == nil)
        #expect(auth.profileTokens.isEmpty)
    }

    @Test func validStoredSessionIsCheckedByTheServer() async {
        let auth = StubAuthentication(profile: .success(SessionFixtures.technician))
        let model = makeModel(auth: auth, store: InMemorySessionStore(stored(expiringIn: 600)))

        await model.start()

        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(auth.profileTokens == ["stored-token"])
    }

    @Test(arguments: [
        ("AUTH_TOKEN_EXPIRED", SignInNotice.expired),
        ("AUTH_TOKEN_INVALID", .invalidSession),
    ])
    func refusedStoredTokenEndsTheSession(_ code: String, _ notice: SignInNotice) async throws {
        let store = InMemorySessionStore(stored(expiringIn: 600))
        let auth = StubAuthentication(profile: .failure(.http(status: 401, problem: SessionFixtures.problem(401, code))))
        let model = makeModel(auth: auth, store: store)

        await model.start()

        #expect(model.phase == .signIn)
        #expect(model.notice == notice)
        #expect(try store.load() == nil)
    }

    @Test(arguments: [APIError.unreachable(.notConnectedToInternet), .http(status: 503, problem: nil), .invalidResponse])
    func unverifiableResumeKeepsTheTokenWithoutSigningIn(_ error: APIError) async throws {
        let store = InMemorySessionStore(stored(expiringIn: 600))
        let model = makeModel(auth: StubAuthentication(profile: .failure(error)), store: store)

        await model.start()

        #expect(model.phase == .resumeOffline)
        #expect(try store.load() != nil)
    }

    @Test func offlineResumeCanBeRetried() async {
        let auth = StubAuthentication(profile: .failure(.unreachable(.timedOut)))
        let model = makeModel(auth: auth, store: InMemorySessionStore(stored(expiringIn: 600)))
        await model.start()

        auth.setProfile(.success(SessionFixtures.technician))
        await model.retryResume()

        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(auth.profileTokens.count == 2)
    }

    @Test func offlineResumeTokenExpiringMeanwhileIsNotRetried() async {
        let auth = StubAuthentication(profile: .failure(.unreachable(.timedOut)))
        let model = makeModel(auth: auth, store: InMemorySessionStore(stored(expiringIn: 60)))
        await model.start()

        clock.advance(by: 61)
        await model.retryResume()

        #expect(model.phase == .signIn)
        #expect(model.notice == .expired)
        #expect(auth.profileTokens.count == 1)
    }

    @Test func signingOutFromOfflineResumeDeletesTheToken() async throws {
        let store = InMemorySessionStore(stored(expiringIn: 600))
        let model = makeModel(auth: StubAuthentication(profile: .failure(.unreachable(.timedOut))), store: store)
        await model.start()

        model.signOut()

        #expect(model.phase == .signIn)
        #expect(model.notice == .signedOut)
        #expect(try store.load() == nil)
    }

    @Test func storedAdministratorSessionIsRefused() async throws {
        let store = InMemorySessionStore(stored(expiringIn: 600))
        let model = makeModel(auth: StubAuthentication(profile: .success(SessionFixtures.admin)), store: store)

        await model.start()

        #expect(model.phase == .wrongRole(email: SessionFixtures.admin.email, isAdministrator: true))
        #expect(try store.load() == nil)
    }

    // MARK: Sign-in

    @Test func emptyFieldsAreReportedWithoutARequest() async {
        let auth = StubAuthentication()
        let model = makeModel(auth: auth)

        await model.signIn()

        #expect(model.emailError == .emailMissing)
        #expect(model.passwordError == .passwordMissing)
        #expect(auth.loginCalls == 0)
    }

    @Test(arguments: [
        ("", FieldError.emailMissing as FieldError?),
        ("technicien.aegis.demo", .emailInvalid),
        ("a@b", .emailInvalid),
        ("a b@aegis.demo", .emailInvalid),
        ("@aegis.demo", .emailInvalid),
        (String(repeating: "a", count: 310) + "@aegis.demo", .emailTooLong),
        ("technician@aegis.demo", nil),
    ])
    func validatesTheAddressLocally(_ address: String, _ expected: FieldError?) {
        #expect(SessionModel.validate(email: address) == expected)
    }

    @Test func editingAFieldWithdrawsItsError() async {
        let model = makeModel(auth: StubAuthentication())
        await model.signIn()

        model.edited(.email)

        #expect(model.emailError == nil)
        #expect(model.passwordError == .passwordMissing)
    }

    @Test func technicianSignInStoresTheSession() async throws {
        let expiry = clock.now.addingTimeInterval(3600)
        let store = InMemorySessionStore()
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: expiry)))
        let model = makeModel(auth: auth, store: store)
        model.email = "  technician@aegis.demo "
        model.password = "secret"

        await model.signIn()

        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(model.password.isEmpty)
        #expect(model.expiresAt == expiry)
        #expect(try store.load() == StoredSession(accessToken: "token-\(SessionFixtures.technician.id)",
                                                 expiresAt: expiry, email: "technician@aegis.demo"))
    }

    @Test func administratorSignInIsRefusedAndNotStored() async throws {
        let store = InMemorySessionStore()
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.admin, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, store: store)
        model.email = SessionFixtures.admin.email
        model.password = "secret"

        await model.signIn()

        #expect(model.phase == .wrongRole(email: SessionFixtures.admin.email, isAdministrator: true))
        #expect(try store.load() == nil)
        #expect(model.password.isEmpty)

        model.useAnotherAccount()
        #expect(model.phase == .signIn)
        #expect(model.email.isEmpty)
    }

    @Test func rejectedCredentialsClearOnlyThePassword() async {
        let auth = StubAuthentication(login: .failure(.http(status: 401, problem: SessionFixtures.problem(401, "AUTH_INVALID_CREDENTIALS"))))
        let model = makeModel(auth: auth)
        await model.start()
        model.email = "technician@aegis.demo"
        model.password = "wrong"

        await model.signIn()

        #expect(model.notice == .rejected)
        #expect(model.email == "technician@aegis.demo")
        #expect(model.password.isEmpty)
        #expect(model.phase == .signIn)
    }

    @Test(.timeLimit(.minutes(1)))
    func rateLimitLocksSignInUntilTheServerDelay() async {
        let timer = Gate()
        let auth = StubAuthentication(login: .failure(.http(
            status: 429, problem: SessionFixtures.problem(429, "RATE_LIMITED"), retryAfter: .seconds(55))))
        let model = makeModel(auth: auth, timerGate: timer)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()
        #expect(model.notice == .rateLimited(retryAfter: .seconds(55)))
        #expect(model.isRateLimited)
        #expect(!model.canSubmit)

        await model.signIn()
        #expect(auth.loginCalls == 1)

        await timer.open()
        while model.retryAvailableAt != nil { await Task.yield() }
        #expect(model.notice == nil)
        #expect(model.canSubmit)
    }

    @Test func rateLimitWithoutAValidDelayDoesNotLock() async {
        let auth = StubAuthentication(login: .failure(.http(status: 429, problem: nil, retryAfter: nil)))
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.notice == .rateLimited(retryAfter: nil))
        #expect(model.canSubmit)
    }

    @Test func serverViolationsTargetTheirField() async {
        let auth = StubAuthentication(login: .failure(.http(status: 400, problem: SessionFixtures.problem(
            400, "VALIDATION_ERROR", violations: [.init(field: "password", code: "SIZE")]))))
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.passwordError == .passwordRejected)
        #expect(model.notice == nil)
    }

    @Test func unknownViolationsUseTheGenericNotice() async {
        let auth = StubAuthentication(login: .failure(.http(status: 400, problem: SessionFixtures.problem(
            400, "VALIDATION_ERROR", violations: [.init(field: "other", code: "X")]))))
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.notice == .invalidFields)
    }

    @Test func networkFailureKeepsBothValues() async {
        let model = makeModel(auth: StubAuthentication(login: .failure(.unreachable(.cannotConnectToHost))))
        model.email = "technician@aegis.demo"
        model.password = "kept"

        await model.signIn()

        #expect(model.notice == .unreachable)
        #expect(model.password == "kept")
    }

    @Test func serverErrorExposesOnlyTheTraceId() async {
        let auth = StubAuthentication(login: .failure(.http(status: 503, problem: SessionFixtures.problem(503, "INTERNAL_ERROR", traceId: "abc"))))
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.notice == .serviceError(traceId: "abc"))
    }

    @Test(.timeLimit(.minutes(1)))
    func secondSubmissionWhileInFlightIsIgnored() async {
        let gate = Gate()
        let auth = StubAuthentication(
            login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)),
            loginGate: gate)
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        let first = Task { await model.signIn() }
        while await gate.waiting == 0 { await Task.yield() }
        #expect(model.isSubmitting)
        await model.signIn()
        #expect(auth.loginCalls == 1)

        await gate.open()
        await first.value
        #expect(!model.isSubmitting)
        #expect(model.phase == .signedIn(SessionFixtures.technician))
    }

    @Test func keychainFailureDoesNotSignIn() async {
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, store: FailingSessionStore())
        await model.start()
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.notice == .storageFailed)
        #expect(model.phase == .signIn)
    }

    // MARK: Signed-in session

    func signedInModel(store: InMemorySessionStore, timerGate: Gate = Gate()) async -> SessionModel {
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, store: store, timerGate: timerGate)
        model.email = "technician@aegis.demo"
        model.password = "x"
        await model.signIn()
        return model
    }

    @Test func expiryReturnsToSignInWithThePrefilledAddress() async throws {
        let store = InMemorySessionStore()
        let model = await signedInModel(store: store)

        model.checkExpiry()
        #expect(model.phase == .signedIn(SessionFixtures.technician))

        clock.advance(by: 3600)
        model.checkExpiry()

        #expect(model.phase == .signIn)
        #expect(model.notice == .expired)
        #expect(model.email == "technician@aegis.demo")
        #expect(try store.load() == nil)
    }

    @Test(.timeLimit(.minutes(1)))
    func scheduledExpiryFiresWithoutUserAction() async {
        let timer = Gate()
        let model = await signedInModel(store: InMemorySessionStore(), timerGate: timer)

        clock.advance(by: 3600)
        await timer.open()
        while model.phase != .signIn { await Task.yield() }

        #expect(model.notice == .expired)
    }

    @Test(arguments: [("AUTH_TOKEN_EXPIRED", SignInNotice.expired), ("AUTH_TOKEN_INVALID", .invalidSession)])
    func unauthorizedResponsesEndTheSession(_ code: String, _ notice: SignInNotice) async throws {
        let store = InMemorySessionStore()
        let model = await signedInModel(store: store)

        model.handleUnauthorized(code: code)

        #expect(model.phase == .signIn)
        #expect(model.notice == notice)
        #expect(try store.load() == nil)
    }

    @Test func signOutDeletesTheTokenAndClearsTheForm() async throws {
        let store = InMemorySessionStore()
        let model = await signedInModel(store: store)

        model.signOut()

        #expect(model.phase == .signIn)
        #expect(model.notice == .signedOut)
        #expect(model.email.isEmpty)
        #expect(try store.load() == nil)
    }

    // MARK: Review findings (late answers, clock, Keychain, roles, trace IDs)

    @Test(.timeLimit(.minutes(1)), arguments: [
        Result<UserProfile, APIError>.success(SessionFixtures.technician),
        .failure(.unreachable(.timedOut)),
        .failure(.http(status: 401, problem: SessionFixtures.problem(401, "AUTH_TOKEN_INVALID"))),
    ])
    func lateResumeAnswerCannotUndoASignOut(_ answer: Result<UserProfile, APIError>) async throws {
        let gate = Gate()
        let store = InMemorySessionStore(stored(expiringIn: 600))

        // The user taps Sign out while the token check is still pending.
        let gatedAuth = StubAuthentication(profile: answer, profileGate: gate)
        let gatedModel = makeModel(auth: gatedAuth, store: store)
        let resume = Task { await gatedModel.start() }
        while await gate.waiting == 0 { await Task.yield() }
        gatedModel.signOut()
        await gate.open()
        await resume.value

        #expect(gatedModel.phase == .signIn)
        #expect(gatedModel.notice == .signedOut)
        #expect(try store.load() == nil)
    }

    @Test(.timeLimit(.minutes(1)))
    func lateResumeAnswerCannotReplaceANewSession() async {
        let gate = Gate()
        let auth = StubAuthentication(
            login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)),
            profile: .failure(.unreachable(.timedOut)), profileGate: gate)
        let model = makeModel(auth: auth, store: InMemorySessionStore(stored(expiringIn: 600)))
        let resume = Task { await model.start() }
        while await gate.waiting == 0 { await Task.yield() }

        model.signOut()
        model.email = "technician@aegis.demo"
        model.password = "x"
        await model.signIn()
        await gate.open()
        await resume.value

        #expect(model.phase == .signedIn(SessionFixtures.technician))
    }

    @Test(.timeLimit(.minutes(1)))
    func previousSessionTimerDoesNotEndANewSession() async {
        let timer = Gate()
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, timerGate: timer)
        model.email = "technician@aegis.demo"
        model.password = "x"
        await model.signIn()
        model.signOut()

        clock.advance(by: 1800)
        model.email = "technician@aegis.demo"
        model.password = "x"
        await model.signIn()
        let secondDeadline = clock.now + 3600

        // Past the first deadline, before the second one.
        clock.advance(by: 1801)
        await timer.open()
        for _ in 0..<50 { await Task.yield() }
        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(model.expiresAt == secondDeadline)

        clock.advance(by: 1800)
        while model.phase != .signIn { await Task.yield() }
        #expect(model.notice == .expired)
    }

    @Test func expiryFollowsExpiresInWhenTheDeviceClockIsAhead() async throws {
        // The device clock is two hours ahead of the server.
        let serverExpiry = clock.now.addingTimeInterval(3600 - 7200)
        let store = InMemorySessionStore()
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: serverExpiry)))
        let model = makeModel(auth: auth, store: store)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()
        model.checkExpiry()

        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(model.expiresAt == clock.now + 3600)
        #expect(try store.load()?.expiresAt == clock.now + 3600)
    }

    @Test func unknownRoleIsRefusedWithANeutralMessage() async throws {
        let auditor = UserProfile(id: "x", displayName: "A", email: "auditor@aegis.demo",
                                  role: .other("AUDITOR"), maximumAccessLevel: .standard)
        let store = InMemorySessionStore()
        let auth = StubAuthentication(login: .success(SessionFixtures.login(auditor, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, store: store)
        model.email = auditor.email
        model.password = "x"

        await model.signIn()

        #expect(model.phase == .wrongRole(email: auditor.email, isAdministrator: false))
        #expect(try store.load() == nil)
    }

    @Test func transientKeychainErrorAtLaunchKeepsTheItem() async {
        let store = FaultySessionStore(stored(expiringIn: 600), loadError: .keychain(-25308))
        let model = makeModel(auth: StubAuthentication(), store: store)

        await model.start()

        #expect(model.phase == .signIn)
        #expect(store.deleteCalls == 0)
    }

    @Test func corruptedKeychainItemIsRemoved() async {
        let store = FaultySessionStore(stored(expiringIn: 600), loadError: .corrupted)
        let model = makeModel(auth: StubAuthentication(), store: store)

        await model.start()

        #expect(model.phase == .signIn)
        #expect(store.deleteCalls == 1)
    }

    @Test func undeletableTokenIsOverwrittenAtSignOut() async {
        let store = FaultySessionStore(nil, deleteFails: true)
        let auth = StubAuthentication(login: .success(SessionFixtures.login(SessionFixtures.technician, expiresAt: clock.now + 3600)))
        let model = makeModel(auth: auth, store: store)
        model.email = "technician@aegis.demo"
        model.password = "x"
        await model.signIn()

        model.signOut()

        #expect(store.current?.accessToken == "")
        #expect(store.current?.expiresAt == .distantPast)

        // The next launch treats the tombstone as no session.
        let relaunched = makeModel(auth: StubAuthentication(), store: store)
        await relaunched.start()
        #expect(relaunched.phase == .signIn)
        #expect(relaunched.notice == nil)
    }

    @Test(arguments: [
        ("5f4bc22e-66a4-48ef-8bf3-6e7184d71c30", "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30" as String?),
        ("abc-123", "abc-123"),
        ("", nil),
        ("<script>", nil),
        ("trace id", nil),
        ("é1", nil),
        (String(repeating: "a", count: 65), nil),
    ])
    func displaysOnlyPlainTraceIds(_ value: String, _ expected: String?) {
        #expect(SessionModel.displayableTraceId(value) == expected)
    }

    @Test func unusableTraceIdIsDropped() async {
        let auth = StubAuthentication(login: .failure(.http(status: 503, problem: SessionFixtures.problem(503, "X", traceId: "<b>proxy</b>"))))
        let model = makeModel(auth: auth)
        model.email = "technician@aegis.demo"
        model.password = "x"

        await model.signIn()

        #expect(model.notice == .serviceError(traceId: nil))
    }

    @Test func secretsAreHiddenFromReflection() {
        var session = ""
        dump(StoredSession(accessToken: "secret-token", expiresAt: .distantPast, email: "a@aegis.demo"), to: &session)
        var request = ""
        dump(LoginRequest(email: "a@aegis.demo", password: "secret-password"), to: &request)

        #expect(!session.contains("secret-token"))
        #expect(!request.contains("secret-password"))
    }
}
