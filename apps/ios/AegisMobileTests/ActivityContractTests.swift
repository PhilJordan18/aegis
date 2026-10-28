import Foundation
import Testing
@testable import AegisMobile

/// Contract of the technician's current activity (doc 09 §8.3, §8.4, §8.8,
/// §8.10, §14.2 and §15.3) as decoded and requested by `APIClient`.
struct ActivityContractTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    private func problem(_ status: Int, _ code: String) -> StubTransport.Outcome {
        .response(status: status, contentType: "application/problem+json",
                  body: #"{"status":\#(status),"code":"\#(code)","title":"t","detail":"d","traceId":null}"#)
    }

    // MARK: Decoding

    @Test func decodesAnActiveReservation() throws {
        let reservation = CatalogFixtures.decode(ActivityFixtures.reservation(), as: ReservationView.self)

        #expect(reservation.id == UUID(uuidString: ActivityFixtures.reservationId))
        #expect(reservation.status == .known(.active))
        #expect(reservation.userId == UUID(uuidString: CatalogFixtures.technicianId))
        #expect(reservation.asset.assetCode == "MM-001")
        #expect(reservation.asset.model.name == "Multimètre 1")
        #expect(reservation.asset.placement?.compartmentCode == "A1")
        #expect(reservation.reservedUntil == (try Date("2026-09-16T20:30:00Z", strategy: .iso8601)))
        #expect(reservation.cancelledAt == nil)
        #expect(reservation.fulfilledAt == nil)
        #expect(reservation.expiredAt == nil)
        #expect(reservation.currentOperationId == nil)
        #expect(reservation.actions == [.checkout, .cancel])
    }

    @Test func decodesAnOverdueLoan() throws {
        let loan = CatalogFixtures.decode(ActivityFixtures.loan(), as: LoanView.self)

        #expect(loan.status == .known(.active))
        #expect(loan.holderUserId == UUID(uuidString: CatalogFixtures.technicianId))
        #expect(loan.dueAt == (try Date("2026-09-16T20:30:00Z", strategy: .iso8601)))
        #expect(loan.overdue)
        #expect(loan.returnRequestedAt == nil)
        #expect(loan.returnOperationId == nil)
        #expect(loan.actions == [.return])
    }

    @Test func decodesAReturnPendingLoanWithoutActions() {
        let loan = CatalogFixtures.decode(
            ActivityFixtures.loan(status: "RETURN_PENDING", overdue: false, actions: [],
                                  returnRequestedAt: #""2026-09-16T20:10:00.123456Z""#),
            as: LoanView.self)

        #expect(loan.status == .known(.returnPending))
        #expect(loan.returnRequestedAt != nil)
        #expect(loan.actions.isEmpty)
    }

    /// §8.10 rule 2: an unknown value is logged and offers nothing. `RETURN`
    /// belongs to a loan, so a reservation never offers it.
    @Test func ignoresUnknownAndMisplacedActions() {
        let reservation = CatalogFixtures.decode(
            ActivityFixtures.reservation(status: "ON_HOLD", actions: ["CANCEL", "RETURN", "TELEPORT"]),
            as: ReservationView.self)
        let loan = CatalogFixtures.decode(ActivityFixtures.loan(actions: ["RETURN", "CANCEL"]), as: LoanView.self)

        #expect(reservation.status == .unrecognized("ON_HOLD"))
        #expect(reservation.availableActions == [.known(.cancel), .unrecognized("RETURN"), .unrecognized("TELEPORT")])
        #expect(reservation.actions == [.cancel])
        #expect(loan.actions == [.return])
    }

    @Test func dropsTheRFIDIdentifierFromTheSummary() {
        let secret = "E28011606000020FAKE0RFID"
        let reservation = CatalogFixtures.decode(
            ActivityFixtures.reservation(assetExtra: #","identifierValue":"\#(secret)""#), as: ReservationView.self)

        #expect(!String(reflecting: reservation).contains(secret))
    }

    // MARK: Requests

    @Test func readsTheCurrentReservationWithTheBearer() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: ActivityFixtures.reservation()))
        let reservation = try await client.currentReservation(bearer: "token-1")

        #expect(reservation?.status == .known(.active))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/me/reservation")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
    }

    @Test func readsTheCurrentLoan() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: ActivityFixtures.loan()))
        let loan = try await client.currentLoan(bearer: "token-1")

        #expect(loan?.overdue == true)
        #expect(transport.requests.first?.url?.absoluteString == "http://localhost:8080/api/v1/me/loan")
    }

    @Test func theDocumentedNotFoundCodeMeansNone() async throws {
        #expect(try await client(problem(404, "ACTIVE_RESERVATION_NOT_FOUND")).0.currentReservation(bearer: "t") == nil)
        #expect(try await client(problem(404, "ACTIVE_LOAN_NOT_FOUND")).0.currentLoan(bearer: "t") == nil)
    }

    /// A missing route must not read as "no activity": only the documented
    /// code of each view means none.
    @Test(arguments: [
        ("RESOURCE_NOT_FOUND", true),
        ("ACTIVE_LOAN_NOT_FOUND", true),
        ("ACTIVE_RESERVATION_NOT_FOUND", false),
    ])
    func anyOtherNotFoundStaysAnError(_ code: String, _ onReservation: Bool) async {
        let (client, _) = client(problem(404, code))
        let error: APIError? = if onReservation {
            await #expect(throws: APIError.self) { _ = try await client.currentReservation(bearer: "t") }
        } else {
            await #expect(throws: APIError.self) { _ = try await client.currentLoan(bearer: "t") }
        }
        guard case .http(status: 404, problem: let problem?, retryAfter: _) = error else {
            Issue.record("Expected a 404 problem, got \(String(describing: error))")
            return
        }
        #expect(problem.code == code)
    }

    @Test func aNotFoundWithoutProblemStaysAnError() async {
        let (client, _) = client(.response(status: 404, contentType: "text/html", body: "<h1>Not Found</h1>"))
        await #expect(throws: APIError.http(status: 404, problem: nil)) {
            _ = try await client.currentReservation(bearer: "t")
        }
    }

    @Test func anExpiredSessionIsReported() async {
        let (client, _) = client(problem(401, "TOKEN_EXPIRED"))
        let error = await #expect(throws: APIError.self) { _ = try await client.currentLoan(bearer: "t") }
        guard case .http(status: 401, problem: _, retryAfter: _) = error else {
            Issue.record("Expected a 401, got \(String(describing: error))")
            return
        }
    }
}

enum ActivityFixtures {
    static let reservationId = "7b726e56-2a19-44de-887b-d3e2bfc8bf28"
    static let loanId = "c0d1e2f3-0415-4c6d-9e8f-a0b1c2d3e4f5"

    static func asset(extra: String = "") -> String {
        let asset = CatalogFixtures.id(1).uuidString.lowercased()
        return #"{"id":"\#(asset)","assetCode":"MM-001","model":{"id":"a09aa622-fba1-4457-8f67-7f123284e132","name":"Multimètre 1","manufacturer":"Fluke","modelNumber":"117"},"placement":{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","lockerCode":"AEGIS-DEMO-01","compartmentId":"1ae77ae3-8490-4f09-9412-a7816b77bff9","compartmentCode":"A1"}\#(extra)}"#
    }

    static func reservation(status: String = "ACTIVE", actions: [String] = ["CHECKOUT", "CANCEL"],
                            assetExtra: String = "") -> String {
        #"{"id":"\#(reservationId)","asset":\#(asset(extra: assetExtra)),"userId":"\#(CatalogFixtures.technicianId)","status":"\#(status)","reservedFrom":"2026-09-16T18:00:00Z","reservedUntil":"2026-09-16T20:30:00Z","createdAt":"2026-09-16T18:00:00.123456Z","cancelledAt":null,"fulfilledAt":null,"expiredAt":null,"currentOperationId":null,"availableActions":\#(list(actions))}"#
    }

    static func loan(status: String = "ACTIVE", overdue: Bool = true, actions: [String] = ["RETURN"],
                     returnRequestedAt: String = "null") -> String {
        #"{"id":"\#(loanId)","asset":\#(asset()),"holderUserId":"\#(CatalogFixtures.technicianId)","status":"\#(status)","checkedOutAt":"2026-09-16T18:05:00Z","dueAt":"2026-09-16T20:30:00Z","overdue":\#(overdue),"returnRequestedAt":\#(returnRequestedAt),"returnedAt":null,"checkoutOperationId":"5f0e2b8c-3a4d-4e6f-8a9b-0c1d2e3f4a5b","returnOperationId":null,"currentOperationId":null,"availableActions":\#(list(actions))}"#
    }

    private static func list(_ values: [String]) -> String {
        "[" + values.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    }
}
