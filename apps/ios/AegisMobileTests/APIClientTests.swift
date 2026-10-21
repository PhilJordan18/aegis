import Foundation
import Testing
@testable import AegisMobile

struct APIClientTests {
    @Test func requestsTheVersionedHealthRoute() async throws {
        let transport = StubTransport(.response(status: 200, contentType: "application/json", body: Fixtures.healthJSON))
        let client = APIClient(configuration: Fixtures.configuration(), transport: transport)

        _ = try await client.fetchHealth()

        let request = try #require(transport.requests.first)
        #expect(transport.requests.count == 1)
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/system/health")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func decodesTheContractHealthWithFractionalSeconds() async throws {
        let transport = StubTransport(.response(
            status: 200, contentType: "application/json; charset=utf-8", body: Fixtures.healthJSON))
        let health = try await APIClient(configuration: Fixtures.configuration(), transport: transport).fetchHealth()

        #expect(health.status == .up)
        #expect(health.service == "aegis-control")
        #expect(health.version == "0.1.0")
        let expected = try Date("2026-10-14T18:43:28Z", strategy: .iso8601)
        #expect(abs(health.timestamp.timeIntervalSince(expected) - 0.524852) < 0.001)
    }

    @Test func decodesInstantsWithoutFractionalSecondsAndUnknownFields() async throws {
        let body = #"{"status":"UP","service":"aegis-control","version":"0.1.0","timestamp":"2026-09-16T14:30:00Z","extra":1}"#
        let transport = StubTransport(.response(status: 200, contentType: "application/json", body: body))
        let health = try await APIClient(configuration: Fixtures.configuration(), transport: transport).fetchHealth()

        #expect(health.timestamp == (try Date("2026-09-16T14:30:00Z", strategy: .iso8601)))
    }

    @Test func keepsAnUnknownStatusInsteadOfAssumingHealthy() async throws {
        let body = #"{"status":"DEGRADED","service":"aegis-control","version":"0.1.0","timestamp":"2026-09-16T14:30:00Z"}"#
        let transport = StubTransport(.response(status: 200, contentType: "application/json", body: body))
        let health = try await APIClient(configuration: Fixtures.configuration(), transport: transport).fetchHealth()

        #expect(health.status == .other("DEGRADED"))
    }

    @Test(arguments: [URLError.Code.notConnectedToInternet, .cannotConnectToHost, .timedOut,
                      .appTransportSecurityRequiresSecureConnection, .serverCertificateUntrusted])
    func mapsTransportFailuresToUnreachable(_ code: URLError.Code) async {
        let client = APIClient(configuration: Fixtures.configuration(), transport: StubTransport(.failure(URLError(code))))

        await #expect(throws: APIError.unreachable(code)) {
            try await client.fetchHealth()
        }
    }

    @Test func mapsCancellationSeparately() async {
        let client = APIClient(configuration: Fixtures.configuration(), transport: StubTransport(.failure(URLError(.cancelled))))

        await #expect(throws: APIError.cancelled) {
            try await client.fetchHealth()
        }
    }

    @Test func decodesProblemDetailsOnErrorStatus() async {
        let body = """
            {"type":"https://aegis.local/problems/unavailable","title":"Service indisponible","status":503,
             "code":"SERVICE_UNAVAILABLE","detail":"Réessayez.","instance":"/api/v1/system/health",
             "traceId":"5f4bc22e-66a4-48ef-8bf3-6e7184d71c30","timestamp":"2026-09-16T14:30:00Z"}
            """
        let transport = StubTransport(.response(status: 503, contentType: "application/problem+json", body: body))
        let client = APIClient(configuration: Fixtures.configuration(), transport: transport)

        let expected = APIProblem(status: 503, code: "SERVICE_UNAVAILABLE", title: "Service indisponible",
                                  detail: "Réessayez.", traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")
        await #expect(throws: APIError.http(status: 503, problem: expected)) {
            try await client.fetchHealth()
        }
    }

    @Test func keepsTheStatusWhenAnErrorBodyIsNotAProblem() async {
        let transport = StubTransport(.response(status: 502, contentType: "text/html", body: "<html>Bad gateway</html>"))
        let client = APIClient(configuration: Fixtures.configuration(), transport: transport)

        await #expect(throws: APIError.http(status: 502, problem: nil)) {
            try await client.fetchHealth()
        }
    }

    @Test(arguments: [
        ("text/html", "<html></html>"),
        ("application/json", "{\"status\":\"UP\"}"),
        (nil, Fixtures.healthJSON),
    ] as [(String?, String)])
    func rejectsUnexpectedSuccessBodies(_ contentType: String?, _ body: String) async {
        let transport = StubTransport(.response(status: 200, contentType: contentType, body: body))
        let client = APIClient(configuration: Fixtures.configuration(), transport: transport)

        await #expect(throws: APIError.invalidResponse) {
            try await client.fetchHealth()
        }
    }
}
