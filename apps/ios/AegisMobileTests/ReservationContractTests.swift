import Foundation
import Testing
@testable import AegisMobile

/// Reservation mutations and the locker status read as requested and decoded
/// by `APIClient` (doc 09 §6.2, §7, §8.6, §14.1, §14.4, §16.1 and §20).
struct ReservationContractTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    private func json(_ body: Data?) throws -> [String: String] {
        let data = try #require(body)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
    }

    @Test func createsAReservationWithTheKeyAndAUTCInstant() async throws {
        let (client, transport) = client(.response(status: 201, contentType: "application/json",
                                                   body: ActivityFixtures.reservation(),
                                                   headers: ["Location": "/api/v1/reservations/\(ActivityFixtures.reservationId)"]))
        let key = IdempotencyKey()
        let until = try Date("2026-09-16T20:30:00Z", strategy: .iso8601)

        let reservation = try await client.createReservation(assetId: CatalogFixtures.id(1), reservedUntil: until,
                                                             key: key, bearer: "token-1")

        #expect(reservation.status == .known(.active))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/reservations")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key.value)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json; charset=utf-8")
        #expect(try json(request.httpBody) == [
            "assetId": CatalogFixtures.id(1).uuidString.lowercased(),
            "reservedUntil": "2026-09-16T20:30:00Z",
        ])
    }

    @Test func cancelsWithTheKeyAndAnEmptyObject() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: ActivityFixtures.reservation(status: "CANCELLED", actions: [])))
        let key = IdempotencyKey()

        let reservation = try await client.cancelReservation(
            id: try #require(UUID(uuidString: ActivityFixtures.reservationId)), key: key, bearer: "token-1")

        #expect(reservation.status == .known(.cancelled))
        #expect(reservation.actions.isEmpty)
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString
                == "http://localhost:8080/api/v1/reservations/\(ActivityFixtures.reservationId)/cancel")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key.value)
        #expect(try json(request.httpBody) == [:])
    }

    @Test func eachIntentDrawsADistinctKey() {
        let keys = Set((0..<50).map { _ in IdempotencyKey().value })

        #expect(keys.count == 50)
        #expect(keys.allSatisfy { $0.count == 36 && $0 == $0.lowercased() })
    }

    /// §7: `reasons` explains `422 ASSET_NOT_READY`; it is optional elsewhere.
    @Test func decodesTheRefusalReasons() async {
        let (client, _) = client(.response(
            status: 422, contentType: "application/problem+json",
            body: #"{"type":"https://aegis.local/problems/asset-not-ready","title":"t","status":422,"code":"ASSET_NOT_READY","detail":"d","instance":"/api/v1/reservations","traceId":"5f4bc22e-66a4-48ef-8bf3-6e7184d71c30","timestamp":"2026-09-16T14:30:00Z","reasons":["UNKNOWN_PHYSICAL_STATE"],"violations":[]}"#))
        let error = await #expect(throws: APIError.self) {
            _ = try await client.createReservation(assetId: CatalogFixtures.id(1), reservedUntil: .now + 3600,
                                                   key: IdempotencyKey(), bearer: "t")
        }
        guard case let .http(422, problem?, _) = error else {
            Issue.record("Expected a 422 problem, got \(String(describing: error))")
            return
        }
        #expect(problem.code == "ASSET_NOT_READY")
        #expect(problem.reasons == ["UNKNOWN_PHYSICAL_STATE"])
    }

    @Test func readsTheLockerWindow() async throws {
        let locker = "d46a74ae-39dc-460b-8af0-38fc791b376a"
        let (client, transport) = client(.response(status: 200, contentType: "application/json", body: Self.lockerStatus(
            window: #"{"timeZone":"America/Toronto","open":true,"closesAt":"2026-09-16T21:00:00Z","nextOpensAt":null}"#)))

        let status = try await client.lockerStatus(id: try #require(UUID(uuidString: locker)), bearer: "t")

        #expect(transport.requests.first?.url?.absoluteString == "http://localhost:8080/api/v1/lockers/\(locker)/status")
        #expect(status.currentWindow.open)
        #expect(status.currentWindow.zone?.identifier == "America/Toronto")
        #expect(status.currentWindow.closesAt == (try Date("2026-09-16T21:00:00Z", strategy: .iso8601)))
        #expect(status.currentWindow.nextOpensAt == nil)
    }

    @Test func readsAWindowWithoutSchedule() throws {
        let status = CatalogFixtures.decode(Self.lockerStatus(
            window: #"{"timeZone":null,"open":false,"closesAt":null,"nextOpensAt":null}"#),
            as: LockerStatus.self)

        #expect(status.currentWindow.zone == nil)
        #expect(!status.currentWindow.open)
        #expect(status.currentWindow.closesAt == nil)
        #expect(status.currentWindow.nextOpensAt == nil)
    }

    static func lockerStatus(window: String) -> String {
        #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","code":"AEGIS-DEMO-01","name":"Casier démo","topology":"HUB_CELL","connectionStatus":"ONLINE","lastSeenAt":"2026-09-16T18:00:00Z","evaluatedAt":"2026-09-16T18:00:01Z","currentWindow":\#(window),"compartments":[]}"#
    }
}
