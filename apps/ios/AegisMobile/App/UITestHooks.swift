#if DEBUG
import Foundation

/// Debug-only launch hooks for UI tests and captures; compiled out of Release.
///
/// - `AEGIS_UI_SCENARIO`: scripted API answers and an in-memory session store,
///   so every sign-in state can be shown without a backend.
/// - `AEGIS_RESET_SESSION=1`: without a scenario, deletes the Keychain session
///   before launch.
/// - `AEGIS_START_SCREEN=health`: opens the diagnostic screen directly.
/// - `AEGIS_UI_FOCUS=email|password`: focuses a field (keyboard captures).
/// - `AEGIS_START_TAB=account|activity`: opens that tab once signed in.
///
/// Catalogue answers come from `UITestCatalogFixtures`: fictional data for UI
/// tests and captures only, never a fallback of the real app.
struct UITestHooks {
    let environment: [String: String]

    @MainActor
    func apply(transport: inout any HTTPTransport, store: inout any SessionStore,
               startScreen: inout AppDependencies.StartScreen, focus: inout SessionModel.Field?,
               tab: inout SignedInView.Tab) {
        if let name = environment["AEGIS_UI_SCENARIO"], let scenario = UITestScenario(rawValue: name) {
            transport = ScenarioTransport(scenario: scenario)
            store = InMemorySessionStore(scenario.storedSession)
        } else if environment["AEGIS_RESET_SESSION"] == "1" {
            try? store.delete()
        }
        if environment["AEGIS_START_SCREEN"] == "health" {
            startScreen = .health
        }
        switch environment["AEGIS_START_TAB"] {
        case "account": tab = .account
        case "activity": tab = .activity
        default: break
        }
        switch environment["AEGIS_UI_FOCUS"] {
        case "email": focus = .email
        case "password": focus = .password
        default: break
        }
    }
}

enum UITestScenario: String {
    case loginSuccess = "login-success"
    case loginRejected = "login-rejected"
    case loginRateLimited = "login-rate-limited"
    case loginRateLimitedNoDelay = "login-rate-limited-no-delay"
    case loginAdmin = "login-admin"
    case loginServerError = "login-server-error"
    case loginSlow = "login-slow"
    case resumeSlow = "resume-slow"
    case resumeOffline = "resume-offline"
    /// Unreachable on the first check, accepted on Try again.
    case resumeRecovers = "resume-recovers"
    case resumeExpired = "resume-expired"
    case resumeInvalid = "resume-invalid"
    case signedIn = "signed-in"
    /// Signed in on the catalogue fixtures; detail reads succeed.
    case catalog = "catalog"
    /// Signed in on an empty catalogue.
    case catalogEmpty = "catalog-empty"
    /// Signed in on 25 ready assets: two pages of 20.
    case catalogPages = "catalog-pages"
    /// The first list read succeeds, the second is offline, later ones succeed.
    case catalogOffline = "catalog-offline"
    /// List reads succeed; every asset read is offline.
    case catalogDetailOffline = "catalog-detail-offline"
    /// List reads succeed; every asset read answers 404 ASSET_NOT_FOUND.
    case catalogDetailGone = "catalog-detail-gone"
    /// Every signed-in scenario answers like `dev` today unless it says
    /// otherwise: no reservation, `GET /me/loan` and the locker status route
    /// missing (404 RESOURCE_NOT_FOUND), and every reservation refused 422
    /// ASSET_NOT_READY with UNKNOWN_PHYSICAL_STATE until PHY-02.
    /// Reservations are created, then cancelled.
    case reservation = "reservation"
    /// The production refusal, named for the tests.
    case reservationRefused = "reservation-refused"
    /// The first creation is lost on the network; a retry with the same key
    /// creates it, a new key is refused 409 ASSET_ALREADY_RESERVED.
    case reservationOffline = "reservation-offline"
    /// The locker status says closed until tomorrow.
    case reservationClosed = "reservation-closed"
    /// An active reservation listing CHECKOUT and CANCEL; no loan.
    case activityReserved = "activity-reserved"
    /// As above, but cancelling is refused 409 RESERVATION_NOT_CANCELLABLE
    /// and the reservation is then read without actions.
    case activityNotCancellable = "activity-not-cancellable"
    /// No reservation; an overdue loan.
    case activityLoan = "activity-loan"
    /// An active reservation; the first loan read fails 503, later ones
    /// answer 404 ACTIVE_LOAN_NOT_FOUND.
    case activityLoanUnavailable = "activity-loan-unavailable"

    var storedSession: StoredSession? {
        switch self {
        case .resumeSlow, .resumeOffline, .resumeRecovers, .resumeInvalid, .signedIn,
             .catalog, .catalogEmpty, .catalogPages, .catalogOffline, .catalogDetailOffline, .catalogDetailGone,
             .reservation, .reservationRefused, .reservationOffline, .reservationClosed,
             .activityReserved, .activityNotCancellable, .activityLoan, .activityLoanUnavailable:
            StoredSession(accessToken: "scenario-token", expiresAt: .now + 3600, email: Self.technicianEmail)
        case .resumeExpired:
            StoredSession(accessToken: "scenario-token", expiresAt: .now - 60, email: Self.technicianEmail)
        default:
            nil
        }
    }

    static let technicianEmail = "technician@aegis.demo"
    static let technician = #"{"id":"75acc15f-fc23-45d9-857d-b543694e4fc2","displayName":"Technicien Démo","email":"technician@aegis.demo","role":"TECHNICIAN","maximumAccessLevel":"STANDARD"}"#
    static let admin = #"{"id":"0d6f7f6e-2d3c-4a59-9a0b-4b3c2f1e0a11","displayName":"Admin Démo","email":"admin@aegis.demo","role":"ADMIN","maximumAccessLevel":"RESTRICTED"}"#
}

/// Scripted answers by route; any other route is unreachable.
struct ScenarioTransport: HTTPTransport {
    let scenario: UITestScenario
    private let profileChecks = Counter()
    private let listReads = Counter()
    private let loanReads = Counter()
    private let activity: ActivityState

    init(scenario: UITestScenario) {
        self.scenario = scenario
        let seeded = [UITestScenario.activityReserved, .activityNotCancellable, .activityLoanUnavailable]
            .contains(scenario)
        activity = ActivityState(seeded ? UITestActivityFixtures.reservation(
            until: UITestActivityFixtures.instant(.now + 2 * 3600)) : nil)
    }

    /// The reservation the fake server holds, and the keys it received.
    private final class ActivityState: @unchecked Sendable {
        private let lock = NSLock()
        private var reservation: String?
        private var keys: [String?] = []

        init(_ reservation: String?) {
            self.reservation = reservation
        }

        var current: String? {
            get { lock.withLock { reservation } }
            set { lock.withLock { reservation = newValue } }
        }

        /// Records a creation key; returns the attempt number and whether
        /// the key repeats the first one.
        func attempt(_ key: String?) -> (number: Int, repeatsFirst: Bool) {
            lock.withLock {
                keys.append(key)
                return (keys.count, keys.count > 1 && key != nil && key == keys[0])
            }
        }
    }

    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func next() -> Int { lock.withLock { value += 1; return value } }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path() ?? ""
        if path.hasSuffix("/auth/login") { return try await login(request) }
        if path.hasSuffix("/auth/me") { return try await me(request) }
        if path.hasSuffix("/assets") { return try assets(request) }
        if path.contains("/assets/") { return try asset(request) }
        guard [.reservation, .reservationRefused, .reservationOffline, .reservationClosed, .activityReserved,
               .activityNotCancellable, .activityLoan, .activityLoanUnavailable, .catalog, .catalogEmpty,
               .catalogPages, .catalogOffline, .catalogDetailOffline, .catalogDetailGone].contains(scenario) else {
            throw URLError(.cannotConnectToHost)
        }
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer scenario-token" else {
            return problem(request, 401, "AUTH_TOKEN_INVALID")
        }
        if path.hasSuffix("/me/reservation") { return currentReservation(request) }
        if path.hasSuffix("/me/loan") { return currentLoan(request) }
        if path.hasSuffix("/cancel") { return cancel(request) }
        if path.hasSuffix("/reservations") { return try reserve(request) }
        if path.hasSuffix("/status"), path.contains("/lockers/") { return lockerStatus(request) }
        throw URLError(.cannotConnectToHost)
    }

    private func login(_ request: URLRequest) async throws -> (Data, URLResponse) {
        let expiresAt = (Date.now + 3600).formatted(.iso8601)
        func success(_ user: String) -> String {
            #"{"accessToken":"scenario-token","tokenType":"Bearer","expiresIn":3600,"expiresAt":"\#(expiresAt)","user":\#(user)}"#
        }
        switch scenario {
        case .loginSuccess:
            return response(request, 200, success(UITestScenario.technician))
        case .loginAdmin:
            return response(request, 200, success(UITestScenario.admin))
        case .loginRejected:
            return problem(request, 401, "AUTH_INVALID_CREDENTIALS")
        case .loginRateLimited:
            return problem(request, 429, "RATE_LIMITED", headers: ["Retry-After": "55"])
        case .loginRateLimitedNoDelay:
            return problem(request, 429, "RATE_LIMITED")
        case .loginServerError:
            return problem(request, 503, "INTERNAL_ERROR")
        case .loginSlow:
            try await Task.sleep(for: .seconds(3600))
            throw URLError(.timedOut)
        default:
            throw URLError(.cannotConnectToHost)
        }
    }

    private func me(_ request: URLRequest) async throws -> (Data, URLResponse) {
        switch scenario {
        case .resumeSlow:
            try await Task.sleep(for: .seconds(3600))
            throw URLError(.timedOut)
        case .signedIn, .loginSuccess, .catalog, .catalogEmpty, .catalogPages, .catalogOffline, .catalogDetailOffline,
             .catalogDetailGone, .reservation, .reservationRefused, .reservationOffline, .reservationClosed,
             .activityReserved, .activityNotCancellable, .activityLoan, .activityLoanUnavailable:
            return response(request, 200, UITestScenario.technician)
        case .resumeRecovers where profileChecks.next() > 1:
            return response(request, 200, UITestScenario.technician)
        case .resumeInvalid:
            return problem(request, 401, "AUTH_TOKEN_INVALID")
        default:
            throw URLError(.notConnectedToInternet)
        }
    }

    private func assets(_ request: URLRequest) throws -> (Data, URLResponse) {
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer scenario-token" else {
            return problem(request, 401, "AUTH_TOKEN_INVALID")
        }
        if scenario == .catalogOffline, listReads.next() == 2 {
            throw URLError(.notConnectedToInternet)
        }
        let items = switch scenario {
        case .catalogEmpty: [UITestCatalogFixtures.Item]()
        case .catalogPages: UITestCatalogFixtures.paged
        default: UITestCatalogFixtures.items
        }
        return response(request, 200, UITestCatalogFixtures.page(for: request.url!, items: items))
    }

    private func asset(_ request: URLRequest) throws -> (Data, URLResponse) {
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer scenario-token" else {
            return problem(request, 401, "AUTH_TOKEN_INVALID")
        }
        switch scenario {
        case .catalogDetailOffline:
            throw URLError(.notConnectedToInternet)
        case .catalogDetailGone:
            return problem(request, 404, "ASSET_NOT_FOUND")
        default:
            guard let body = UITestCatalogFixtures.item(id: request.url!.lastPathComponent) else {
                return problem(request, 404, "ASSET_NOT_FOUND")
            }
            return response(request, 200, body)
        }
    }

    private func currentReservation(_ request: URLRequest) -> (Data, URLResponse) {
        guard let reservation = activity.current else { return problem(request, 404, "ACTIVE_RESERVATION_NOT_FOUND") }
        return response(request, 200, reservation)
    }

    private func currentLoan(_ request: URLRequest) -> (Data, URLResponse) {
        switch scenario {
        case .activityLoan: response(request, 200, UITestActivityFixtures.overdueLoan())
        case .activityLoanUnavailable where loanReads.next() == 1: problem(request, 503, "INTERNAL_ERROR")
        case .activityLoanUnavailable: problem(request, 404, "ACTIVE_LOAN_NOT_FOUND")
        case .activityReserved, .activityNotCancellable: problem(request, 404, "ACTIVE_LOAN_NOT_FOUND")
        default: problem(request, 404, "RESOURCE_NOT_FOUND")
        }
    }

    private func reserve(_ request: URLRequest) throws -> (Data, URLResponse) {
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
        let until = body?["reservedUntil"] ?? UITestActivityFixtures.instant(.now + 3600)
        switch scenario {
        case .reservation:
            break
        case .reservationOffline:
            let attempt = activity.attempt(request.value(forHTTPHeaderField: "Idempotency-Key"))
            if attempt.number == 1 { throw URLError(.networkConnectionLost) }
            guard attempt.repeatsFirst else { return problem(request, 409, "ASSET_ALREADY_RESERVED") }
        default:
            return problem(request, 422, "ASSET_NOT_READY", extra: #","reasons":["UNKNOWN_PHYSICAL_STATE"]"#)
        }
        let reservation = UITestActivityFixtures.reservation(until: until)
        activity.current = reservation
        return response(request, 201, reservation,
                        headers: ["Location": "/api/v1/reservations/\(UITestActivityFixtures.reservationId)"])
    }

    private func cancel(_ request: URLRequest) -> (Data, URLResponse) {
        guard let reservation = activity.current else { return problem(request, 404, "RESOURCE_NOT_FOUND") }
        if scenario == .activityNotCancellable {
            activity.current = reservation.replacingOccurrences(
                of: #""availableActions":["CHECKOUT","CANCEL"]"#, with: #""availableActions":[]"#)
            return problem(request, 409, "RESERVATION_NOT_CANCELLABLE")
        }
        activity.current = nil
        let cancelled = reservation
            .replacingOccurrences(of: #""status":"ACTIVE""#, with: #""status":"CANCELLED""#)
            .replacingOccurrences(of: #""availableActions":["CHECKOUT","CANCEL"]"#, with: #""availableActions":[]"#)
        return response(request, 200, cancelled)
    }

    private func lockerStatus(_ request: URLRequest) -> (Data, URLResponse) {
        guard scenario == .reservationClosed else { return problem(request, 404, "RESOURCE_NOT_FOUND") }
        return response(request, 200, UITestActivityFixtures.closedLocker(nextOpensAt: .now + 15 * 3600))
    }

    private func problem(_ request: URLRequest, _ status: Int, _ code: String,
                         headers: [String: String] = [:], extra: String = "") -> (Data, URLResponse) {
        // Distinctive server text, which the app must never display.
        let body = #"{"type":"https://aegis.local/problems/scenario","title":"SERVER TITLE NOT SHOWN","status":\#(status),"code":"\#(code)","detail":"SERVER DETAIL NOT SHOWN","instance":"/","traceId":"5f4bc22e-66a4-48ef-8bf3-6e7184d71c30","timestamp":"2026-10-21T12:00:00Z"\#(extra)}"#
        return response(request, status, body, contentType: "application/problem+json", headers: headers)
    }

    private func response(_ request: URLRequest, _ status: Int, _ body: String,
                          contentType: String = "application/json",
                          headers: [String: String] = [:]) -> (Data, URLResponse) {
        var fields = headers
        fields["Content-Type"] = contentType
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: fields)!
        return (Data(body.utf8), response)
    }
}
#endif
