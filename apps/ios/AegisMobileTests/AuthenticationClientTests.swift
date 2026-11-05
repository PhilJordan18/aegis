import Foundation
import Testing
@testable import AegisMobile

struct AuthenticationClientTests {
    static let loginJSON = """
        {"accessToken":"opaque.jwt.value","tokenType":"Bearer","expiresIn":3600,
         "expiresAt":"2026-09-16T15:30:00Z",
         "user":{"id":"75acc15f-fc23-45d9-857d-b543694e4fc2","displayName":"Technicien Démo",
                 "email":"technician@aegis.demo","role":"TECHNICIAN","maximumAccessLevel":"STANDARD"}}
        """

    static func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    @Test func loginPostsOnlyTheContractFields() async throws {
        let (client, transport) = Self.client(.response(status: 200, contentType: "application/json", body: Self.loginJSON))

        let response = try await client.login(email: "technician@aegis.demo", password: "secret-value")

        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/auth/login")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json; charset=utf-8")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(request.httpBody)
        let fields = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(fields == ["email": "technician@aegis.demo", "password": "secret-value"])

        #expect(response.accessToken == "opaque.jwt.value")
        #expect(response.expiresAt == (try Date("2026-09-16T15:30:00Z", strategy: .iso8601)))
        #expect(response.user.role == .technician)
        #expect(response.user.maximumAccessLevel == .standard)
    }

    @Test func debugDescriptionNeverContainsTheToken() async throws {
        let (client, _) = Self.client(.response(status: 200, contentType: "application/json", body: Self.loginJSON))
        let response = try await client.login(email: "technician@aegis.demo", password: "x")

        #expect(!String(reflecting: response).contains("opaque.jwt.value"))
    }

    @Test func currentProfileSendsTheBearerToken() async throws {
        let body = #"{"id":"1","displayName":"A","email":"a@aegis.demo","role":"ADMIN","maximumAccessLevel":"RESTRICTED"}"#
        let (client, transport) = Self.client(.response(status: 200, contentType: "application/json", body: body))

        let profile = try await client.currentProfile(bearer: "token-123")

        let request = try #require(transport.requests.first)
        #expect(request.url?.path() == "/api/v1/auth/me")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-123")
        #expect(profile.role == .admin)
        #expect(profile.maximumAccessLevel == .restricted)
    }

    @Test func keepsUnknownRolesDistinctFromTechnician() async throws {
        let body = #"{"id":"1","displayName":"A","email":"a@aegis.demo","role":"AUDITOR","maximumAccessLevel":"STANDARD"}"#
        let (client, _) = Self.client(.response(status: 200, contentType: "application/json", body: body))

        #expect(try await client.currentProfile(bearer: "t").role == .other("AUDITOR"))
    }

    @Test func decodesTheRejectedCredentialsProblem() async {
        let body = """
            {"type":"https://aegis.local/problems/auth-invalid-credentials","title":"Connexion refusée","status":401,
             "code":"AUTH_INVALID_CREDENTIALS","detail":"x","instance":"/api/v1/auth/login",
             "traceId":"02573322-0c15-4674-ace8-a5198156f4ac","timestamp":"2026-10-14T19:18:29Z"}
            """
        let (client, _) = Self.client(.response(status: 401, contentType: "application/problem+json", body: body))

        do {
            _ = try await client.login(email: "a@aegis.demo", password: "x")
            Issue.record("Expected a rejection")
        } catch {
            guard case let .http(401, problem?, nil) = error else {
                Issue.record("Unexpected \(error)")
                return
            }
            #expect(problem.code == "AUTH_INVALID_CREDENTIALS")
        }
    }

    @Test func decodesFieldViolations() async {
        let body = """
            {"type":"t","title":"t","status":400,"code":"VALIDATION_ERROR","detail":"d","instance":"/api/v1/auth/login",
             "traceId":"t1","timestamp":"2026-10-14T19:18:29Z",
             "violations":[{"field":"email","code":"INVALID_FORMAT","message":"never shown"}]}
            """
        let (client, _) = Self.client(.response(status: 400, contentType: "application/problem+json", body: body))

        await #expect(throws: APIError.http(status: 400, problem: APIProblem(
            status: 400, code: "VALIDATION_ERROR", title: "t", detail: "d", traceId: "t1",
            violations: [.init(field: "email", code: "INVALID_FORMAT")]))) {
            try await client.login(email: "bad", password: "x")
        }
    }

    @Test(arguments: [
        ("55", Duration.seconds(55) as Duration?),
        ("1", .seconds(1)),
        (" 60 ", .seconds(60)),
        ("0", nil),
        ("-5", nil),
        ("3601", nil),
        ("1.5", nil),
        ("Wed, 21 Oct 2026 07:28:00 GMT", nil),
    ])
    func readsOnlyValidRetryAfterSeconds(_ header: String, _ expected: Duration?) async {
        let (client, _) = Self.client(.response(
            status: 429, contentType: "application/problem+json",
            body: #"{"type":"t","title":"t","status":429,"code":"RATE_LIMITED","detail":"d","traceId":null}"#,
            headers: ["Retry-After": header]))

        do {
            _ = try await client.login(email: "a@aegis.demo", password: "x")
            Issue.record("Expected a rate limit")
        } catch {
            guard case let .http(429, _, retryAfter) = error else {
                Issue.record("Unexpected \(error)")
                return
            }
            #expect(retryAfter == expected)
        }
    }
}
