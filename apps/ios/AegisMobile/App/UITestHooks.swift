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
/// - `AEGIS_START_TAB=account`: opens the Account tab once signed in.
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
        if environment["AEGIS_START_TAB"] == "account" {
            tab = .account
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
    /// The first list read succeeds, the second is offline, later ones succeed.
    case catalogOffline = "catalog-offline"
    /// List reads succeed; every asset read is offline.
    case catalogDetailOffline = "catalog-detail-offline"
    /// List reads succeed; every asset read answers 404 ASSET_NOT_FOUND.
    case catalogDetailGone = "catalog-detail-gone"

    var storedSession: StoredSession? {
        switch self {
        case .resumeSlow, .resumeOffline, .resumeRecovers, .resumeInvalid, .signedIn,
             .catalog, .catalogEmpty, .catalogOffline, .catalogDetailOffline, .catalogDetailGone:
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

    init(scenario: UITestScenario) {
        self.scenario = scenario
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
        case .signedIn, .loginSuccess, .catalog, .catalogEmpty, .catalogOffline, .catalogDetailOffline,
             .catalogDetailGone:
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
        return response(request, 200, UITestCatalogFixtures.page(for: request.url!, empty: scenario == .catalogEmpty))
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

    private func problem(_ request: URLRequest, _ status: Int, _ code: String,
                         headers: [String: String] = [:]) -> (Data, URLResponse) {
        // Distinctive server text, which the app must never display.
        let body = #"{"type":"https://aegis.local/problems/scenario","title":"SERVER TITLE NOT SHOWN","status":\#(status),"code":"\#(code)","detail":"SERVER DETAIL NOT SHOWN","instance":"/","traceId":"5f4bc22e-66a4-48ef-8bf3-6e7184d71c30","timestamp":"2026-10-21T12:00:00Z"}"#
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
