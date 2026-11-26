import Foundation
import Testing
@testable import AegisMobile

/// `POST /auth/password` (doc 09 §10.7, ADR-020) as sent by `APIClient`.
/// The passwords below are FICTIONAL test values.
struct PasswordChangeContractTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    @Test func sendsExactlyBothPasswordsUntrimmedWithTheBearerAndNoKey() async throws {
        let (client, transport) = client(.response(status: 204, contentType: nil, body: ""))

        try await client.changePassword(current: " current pass ", new: "new-pass-éé-12", bearer: "technician-token")

        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/auth/password")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer technician-token")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
        let body = try #require(request.httpBody)
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(object == ["currentPassword": " current pass ", "newPassword": "new-pass-éé-12"])
    }

    /// Only 204 is the success of §10.7: a body is not taken for it.
    @Test func aSuccessWithABodyIsNotAConfirmedChange() async {
        let (client, _) = client(.response(status: 200, contentType: "application/json", body: "{}"))

        let error = await #expect(throws: APIError.self) {
            try await client.changePassword(current: "a", new: "b", bearer: "t")
        }
        #expect(error == .invalidResponse)
    }

    @Test func keepsTheRetryAfterOfARateLimit() async {
        let (client, _) = client(.response(
            status: 429, contentType: "application/problem+json",
            body: #"{"status":429,"code":"RATE_LIMITED","title":"t","detail":"d","traceId":null}"#,
            headers: ["Retry-After": "42"]))

        let error = await #expect(throws: APIError.self) {
            try await client.changePassword(current: "a", new: "b", bearer: "t")
        }
        guard case .http(status: 429, problem: let problem?, retryAfter: .seconds(42)?) = error else {
            Issue.record("\(String(describing: error))")
            return
        }
        #expect(problem.code == "RATE_LIMITED")
    }

    @Test func neverDescribesThePasswords() {
        let request = PasswordChangeRequest(currentPassword: "secret-one", newPassword: "secret-two-long")
        let described = [String(describing: request), String(reflecting: request), "\(request)"]
            + Mirror(reflecting: request).children.map { "\($0.value)" }
        #expect(described.allSatisfy { !$0.contains("secret") })
    }
}

/// The session side: what ends it, what keeps it, and what is never replayed.
@MainActor
struct PasswordChangeSessionTests {
    let clock = TestClock()

    private func signedIn(_ auth: StubAuthentication, store: InMemorySessionStore) async -> SessionModel {
        auth.setProfile(.success(SessionFixtures.technician))
        let clock = clock
        let gate = Gate()
        let model = SessionModel(auth: auth, store: store, now: { clock.now }, sleep: { _ in await gate.wait() })
        await model.start()
        return model
    }

    private func store() -> InMemorySessionStore {
        InMemorySessionStore(StoredSession(accessToken: "stored-token", expiresAt: clock.now.addingTimeInterval(600),
                                           email: SessionFixtures.technician.email))
    }

    private func problem(_ status: Int, _ code: String, retryAfter: Duration? = nil) -> APIError {
        .http(status: status, problem: CatalogFixtures.decode(CatalogFixtures.problem(status, code), as: APIProblem.self),
              retryAfter: retryAfter)
    }

    @Test func aChangeEndsTheSessionAndAsksForTheNewPassword() async throws {
        let auth = StubAuthentication()
        auth.setPassword(.success(()))
        let store = store()
        let model = await signedIn(auth, store: store)

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .changed)
        #expect(auth.passwordCalls.count == 1)
        #expect(auth.passwordCalls.first?.token == "stored-token")
        #expect(model.phase == .signIn)
        #expect(model.notice == .passwordChanged)
        #expect(model.email == SessionFixtures.technician.email)
        #expect(model.password.isEmpty)
        #expect(try store.load() == nil)
    }

    @Test(arguments: [
        (400, "PASSWORD_CURRENT_INVALID", PasswordChangeResult.currentRejected),
        (409, "PASSWORD_REUSED", .reused),
        (400, "VALIDATION_ERROR", .invalid),
        (503, "PASSWORD_CHANGE_UNAVAILABLE", .unavailable),
        (403, "FORBIDDEN", .refused),
        (500, "INTERNAL_ERROR", .serviceError(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")),
    ])
    func aRefusalKeepsTheSession(_ status: Int, _ code: String, _ expected: PasswordChangeResult) async throws {
        let auth = StubAuthentication()
        auth.setPassword(.failure(problem(status, code)))
        let store = store()
        let model = await signedIn(auth, store: store)

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == expected)
        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(try store.load()?.accessToken == "stored-token")
        #expect(auth.passwordCalls.count == 1)
    }

    @Test func aRateLimitCarriesTheServerDelay() async {
        let auth = StubAuthentication()
        auth.setPassword(.failure(problem(429, "RATE_LIMITED", retryAfter: .seconds(42))))
        let model = await signedIn(auth, store: store())

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .rateLimited(retryAfter: .seconds(42)))
        #expect(model.phase == .signedIn(SessionFixtures.technician))
    }

    @Test(arguments: ["AUTH_TOKEN_EXPIRED", "AUTH_TOKEN_INVALID"])
    func anExpiredSessionEndsIt(_ code: String) async {
        let auth = StubAuthentication()
        auth.setPassword(.failure(problem(401, code)))
        let model = await signedIn(auth, store: store())

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .sessionEnded)
        #expect(model.phase == .signIn)
        #expect(model.notice == (code == "AUTH_TOKEN_EXPIRED" ? .expired : .invalidSession))
    }

    /// Sent, then no answer: the change may have been applied, which has
    /// already revoked this token. Nothing is replayed; the session ends.
    @Test(arguments: [URLError.Code.timedOut, .networkConnectionLost, .secureConnectionFailed])
    func aLostAnswerEndsTheSessionWithoutClaimingOrReplaying(_ code: URLError.Code) async throws {
        let auth = StubAuthentication()
        auth.setPassword(.failure(.unreachable(code)))
        let store = store()
        let model = await signedIn(auth, store: store)

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .sessionEnded)
        #expect(auth.passwordCalls.count == 1)
        #expect(model.notice == .passwordChangeUncertain)
        #expect(model.phase == .signIn)
        #expect(try store.load() == nil)
    }

    @Test func aGatewayFailureWithoutAProblemIsUncertain() async {
        let auth = StubAuthentication()
        auth.setPassword(.failure(.http(status: 502, problem: nil)))
        let model = await signedIn(auth, store: store())

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .sessionEnded)
        #expect(model.notice == .passwordChangeUncertain)
    }

    @Test func anUnreadableSuccessIsUncertain() async {
        let auth = StubAuthentication()
        auth.setPassword(.failure(.invalidResponse))
        let model = await signedIn(auth, store: store())

        #expect(await model.changePassword(current: "old-password", new: "new-password-12") == .sessionEnded)
        #expect(model.notice == .passwordChangeUncertain)
    }

    @Test func noConnectionMeansNothingWasSent() async throws {
        let auth = StubAuthentication()
        auth.setPassword(.failure(.unreachable(.notConnectedToInternet)))
        let store = store()
        let model = await signedIn(auth, store: store)

        let result = await model.changePassword(current: "old-password", new: "new-password-12")

        #expect(result == .notSent)
        #expect(model.phase == .signedIn(SessionFixtures.technician))
        #expect(try store.load()?.accessToken == "stored-token")
    }

    @Test func signedOutSendsNothing() async {
        let auth = StubAuthentication()
        let model = SessionModel(auth: auth, store: InMemorySessionStore())

        #expect(await model.changePassword(current: "a", new: "b") == .sessionEnded)
        #expect(auth.passwordCalls.isEmpty)
    }
}

/// The form: local checks, one send, and what each answer does to the fields.
@MainActor
struct PasswordChangeModelTests {
    final class StubChanger: PasswordChanging {
        var results: [PasswordChangeResult] = []
        private(set) var calls: [(current: String, new: String)] = []
        var gate: Gate?

        func changePassword(current: String, new: String) async -> PasswordChangeResult {
            calls.append((current, new))
            if let gate { await gate.wait() }
            return results.isEmpty ? .changed : results.removeFirst()
        }
    }

    let changer = StubChanger()
    let clock = TestClock()

    private func model(sleep: @escaping @Sendable (Duration) async throws -> Void = { _ in
        try await Task.sleep(for: .seconds(3600))
    }) -> PasswordChangeModel {
        let clock = clock
        return PasswordChangeModel(session: changer, now: { clock.now }, sleep: sleep)
    }

    private func filled(_ model: PasswordChangeModel, current: String = "old-password",
                        new: String = "new-password-12", confirmation: String? = nil) {
        model.current = current
        model.proceed()
        model.new = new
        model.confirmation = confirmation ?? new
    }

    @Test func theFirstStepChecksTheCurrentPasswordLocallyAndSendsNothing() {
        let model = model()
        #expect(model.step == .current)

        model.proceed()
        #expect(model.currentError == .currentMissing)
        #expect(model.step == .current)

        model.current = String(repeating: "a", count: 73)
        model.proceed()
        #expect(model.currentError == .currentTooLong)
        #expect(model.step == .current)

        model.current = "old-password"
        model.proceed()
        #expect(model.currentError == nil)
        #expect(model.step == .new)
        #expect(changer.calls.isEmpty)
    }

    @Test func closingTheFormWipesBothStepsAndStartsOver() {
        let model = model()
        filled(model)

        model.clearNew()
        #expect(model.current == "old-password")
        #expect(model.new.isEmpty && model.confirmation.isEmpty)

        model.clear()
        #expect(model.current.isEmpty)
        #expect(model.step == .current)
    }

    @Test func sendsBothPasswordsOnceAndClearsThemAfterAChange() async {
        let model = model()
        filled(model)

        await model.submit()

        #expect(changer.calls.count == 1)
        #expect(changer.calls.first?.current == "old-password")
        #expect(changer.calls.first?.new == "new-password-12")
        #expect(model.current.isEmpty && model.new.isEmpty && model.confirmation.isEmpty)
    }

    @Test(arguments: [
        ("", "new-password-12", "new-password-12", PasswordChangeModel.FieldError?.some(.currentMissing),
         PasswordChangeModel.FieldError?.none, PasswordChangeModel.FieldError?.none),
        ("old", "short-11-ch", "short-11-ch", nil, .newTooShort, nil),
        ("old", String(repeating: "a", count: 73), String(repeating: "a", count: 73), nil, .newTooLong, nil),
        ("same-password-1", "same-password-1", "same-password-1", nil, .sameAsCurrent, nil),
        ("old", "new-password-12", "new-password-13", nil, nil, .confirmationMismatch),
        (String(repeating: "a", count: 73), "new-password-12", "new-password-12", .currentTooLong, nil, nil),
    ])
    func localChecksSendNothing(_ current: String, _ new: String, _ confirmation: String,
                                _ currentError: PasswordChangeModel.FieldError?,
                                _ newError: PasswordChangeModel.FieldError?,
                                _ confirmationError: PasswordChangeModel.FieldError?) async {
        let model = model()
        filled(model, current: current, new: new, confirmation: confirmation)

        await model.submit()

        #expect(changer.calls.isEmpty)
        #expect(model.currentError == currentError)
        #expect(model.newError == newError)
        #expect(model.confirmationError == confirmationError)
        #expect(model.step == (currentError == nil ? .new : .current))
    }

    /// §10.7 counts UTF-8 bytes: six accented letters are twelve bytes.
    @Test func lengthsAreCountedInUTF8Bytes() {
        #expect(PasswordChangeModel.validateNew("éééééé", current: "x") == nil)
        #expect(PasswordChangeModel.validateNew(String(repeating: "é", count: 37), current: "x") == .newTooLong)
        #expect(PasswordChangeModel.validateNew(String(repeating: "a", count: 72), current: "x") == nil)
    }

    @Test func aRejectedCurrentPasswordIsClearedAndNamed() async {
        changer.results = [.currentRejected]
        let model = model()
        filled(model)

        await model.submit()

        #expect(model.currentError == .currentRejected)
        #expect(model.current.isEmpty)
        #expect(model.step == .current)
        #expect(model.new == "new-password-12")
        model.edited(.current)
        #expect(model.currentError == nil)
    }

    @Test func aReusedPasswordIsNamedOnTheNewField() async {
        changer.results = [.reused]
        let model = model()
        filled(model)

        await model.submit()

        #expect(model.newError == .sameAsCurrent)
    }

    @Test(.timeLimit(.minutes(1)))
    func aSecondSubmitWhileOneIsInFlightSendsNothing() async {
        let gate = Gate()
        changer.gate = gate
        let model = model()
        filled(model)

        let first = Task { await model.submit() }
        while changer.calls.isEmpty { await Task.yield() }
        #expect(model.isSubmitting)
        #expect(!model.canSubmit)
        await model.submit()
        await gate.open()
        await first.value

        #expect(changer.calls.count == 1)
        #expect(!model.isSubmitting)
    }

    @Test func aRateLimitBlocksSendingUntilTheServerDelay() async {
        changer.results = [.rateLimited(retryAfter: .seconds(30)), .changed]
        let model = model()
        filled(model)

        await model.submit()
        #expect(model.message == .rateLimited(retryAfter: .seconds(30)))
        #expect(model.isRateLimited)
        await model.submit()
        #expect(changer.calls.count == 1)

        clock.advance(by: 31)
        #expect(model.canSubmit)
        await model.submit()
        #expect(changer.calls.count == 2)
    }

    @Test(arguments: [
        (PasswordChangeResult.unavailable, PasswordChangeModel.Message.unavailable),
        (.refused, .refused),
        (.notSent, .notSent),
        (.invalid, .invalid),
        (.serviceError(traceId: nil), .serviceError(traceId: nil)),
    ])
    func aRefusalKeepsTheFieldsForAManualRetry(_ result: PasswordChangeResult,
                                               _ message: PasswordChangeModel.Message) async {
        changer.results = [result]
        let model = model()
        filled(model)

        await model.submit()

        #expect(model.message == message)
        #expect(model.new == "new-password-12")
        #expect(changer.calls.count == 1)
    }

    @Test func anEndedSessionClearsTheFields() async {
        changer.results = [.sessionEnded]
        let model = model()
        filled(model)

        await model.submit()

        #expect(model.current.isEmpty && model.new.isEmpty && model.confirmation.isEmpty)
        #expect(model.message == nil)
    }
}
