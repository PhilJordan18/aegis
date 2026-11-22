import Foundation
import Testing
@testable import AegisMobile

/// Locker operations as requested and decoded by `APIClient` (doc 09 §6.2,
/// §8.5, §15.1, §15.4 and §15.5).
struct LockerOperationContractTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    private static let base = "http://localhost:8080/api/v1"

    @Test func decodesEveryFieldOfTheView() throws {
        let view = OperationFixtures.awaiting
        let proofDeadline = try Date("2026-09-16T14:32:00Z", strategy: .iso8601)

        #expect(view.id == OperationFixtures.id)
        #expect(view.type == .known(.checkout))
        #expect(view.status == .known(.awaitingLocalProof))
        #expect(view.requiredAction == .known(.scanHubQR))
        #expect(view.lockerId == UUID(uuidString: OperationFixtures.lockerId))
        #expect(view.compartmentId == UUID(uuidString: OperationFixtures.compartmentId))
        #expect(view.reservationId == UUID(uuidString: ActivityFixtures.reservationId))
        #expect(view.loanId == nil)
        #expect(view.localAccessChallengeId == UUID(uuidString: OperationFixtures.challengeId))
        #expect(view.localProofExpiresAt == proofDeadline)
        #expect(view.localProofDisplayedAt != nil)
        #expect(view.terminalAt == nil)
        #expect(view.failureReason == nil)
        #expect(view.awaitsLocalProof)
        #expect(!view.isTerminal)
        #expect(!view.isConfirmed)
    }

    @Test func onlyTheFourEndStatesAreTerminal() {
        let terminal = LockerOperationStatus.allCases.filter(\.isTerminal)
        #expect(Set(terminal) == [.confirmed, .failed, .expired, .anomaly])
    }

    @Test(arguments: ["FAILED", "EXPIRED", "ANOMALY"])
    func anEndOtherThanConfirmedIsNeverASuccess(status: String) {
        let view = OperationFixtures.view(status: status, requiredAction: "NONE", terminalAt: "2026-09-16T14:33:00Z",
                                          failureReason: "SOMETHING_NEW")

        #expect(view.isTerminal)
        #expect(!view.isConfirmed)
        #expect(!view.awaitsLocalProof)
        #expect(view.failureReason == "SOMETHING_NEW")
    }

    /// §8.5: an unknown value decodes, but never implies a success, an
    /// authorization or a physical action.
    @Test func anUnknownStatusEnablesNothingAndIsFollowedUntilStamped() {
        let running = OperationFixtures.view(status: "QUARANTINED", requiredAction: "SCAN_HUB_QR")
        let stamped = OperationFixtures.view(status: "QUARANTINED", requiredAction: "NONE",
                                             terminalAt: "2026-09-16T14:33:00Z")

        #expect(running.status == .unrecognized("QUARANTINED"))
        #expect(!running.awaitsLocalProof)
        #expect(!running.isConfirmed)
        #expect(!running.isTerminal)
        #expect(stamped.isTerminal)
        #expect(!stamped.isConfirmed)
    }

    @Test func anUnknownRequiredActionOrTypeEnablesNothing() {
        let view: LockerOperationView = CatalogFixtures.decode(
            OperationFixtures.json(requiredAction: "TAP_NFC", type: "INSPECTION"))

        #expect(view.requiredAction == .unrecognized("TAP_NFC"))
        #expect(view.type == .unrecognized("INSPECTION"))
        #expect(!view.awaitsLocalProof)
    }

    @Test func preparesACheckoutWithTheKeyAndNoBody() async throws {
        let (client, transport) = client(.response(
            status: 202, contentType: "application/json", body: OperationFixtures.json(),
            headers: ["Location": "/api/v1/locker-operations/\(OperationFixtures.operationId)", "Retry-After": "1",
                      "Cache-Control": "no-store"]))
        let key = IdempotencyKey()
        let reservationId = try #require(UUID(uuidString: ActivityFixtures.reservationId))

        let view = try await client.prepareCheckout(reservationId: reservationId, key: key, bearer: "token-1")

        #expect(view.awaitsLocalProof)
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "\(Self.base)/reservations/\(ActivityFixtures.reservationId)/checkout")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key.value)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
        #expect(request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
    }

    /// §15.2: the holder's loan, the same key header and no body.
    @Test func preparesAReturnWithTheKeyAndNoBody() async throws {
        let (client, transport) = client(.response(
            status: 202, contentType: "application/json", body: OperationFixtures.json(type: "RETURN"),
            headers: ["Location": "/api/v1/locker-operations/\(OperationFixtures.operationId)", "Retry-After": "1",
                      "Cache-Control": "no-store"]))
        let key = IdempotencyKey()
        let loanId = try #require(UUID(uuidString: ActivityFixtures.loanId))

        let view = try await client.prepareReturn(loanId: loanId, key: key, bearer: "token-1")

        #expect(view.awaitsLocalProof)
        #expect(view.type == .known(.return))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "\(Self.base)/loans/\(ActivityFixtures.loanId)/return")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key.value)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
        #expect(request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
    }

    @Test func readsAnOperationWithTheServerPace() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: OperationFixtures.json(), headers: ["Retry-After": "3"]))

        let received = try await client.lockerOperation(id: OperationFixtures.id, bearer: "token-1")

        #expect(received.value == OperationFixtures.awaiting)
        #expect(received.retryAfter == .seconds(3))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "\(Self.base)/locker-operations/\(OperationFixtures.operationId)")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    /// A terminal read carries no `Retry-After`.
    @Test func aReadWithoutRetryAfterHasNoPace() async throws {
        let (client, _) = client(.response(status: 200, contentType: "application/json", body: OperationFixtures.json(
            status: "CONFIRMED", requiredAction: "NONE", terminalAt: "2026-09-16T14:31:40Z")))

        let received = try await client.lockerOperation(id: OperationFixtures.id, bearer: "token-1")

        #expect(received.value.isConfirmed)
        #expect(received.retryAfter == nil)
    }

    @Test func authorizesWithExactlyTheChallengeAndTheToken() async throws {
        let (client, transport) = client(.response(status: 202, contentType: "application/json",
                                                   body: OperationFixtures.json(status: "AUTHORIZED", requiredAction: "WAIT")))
        let key = IdempotencyKey()
        let proof = try LocalAccessCode.parse(OperationFixtures.uri()).get().proof

        let view = try await client.authorizeLocal(operationId: OperationFixtures.id, proof: proof, key: key,
                                                   bearer: "token-1")

        #expect(view.status == .known(.authorized))
        #expect(view.requiredAction == .known(.wait))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString
                == "\(Self.base)/locker-operations/\(OperationFixtures.operationId)/authorize-local")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key.value)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json; charset=utf-8")
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(body == ["challengeId": OperationFixtures.challengeId, "token": OperationFixtures.token])
    }

    @Test func aRefusalKeepsItsStableCode() async throws {
        let (client, _) = client(.response(
            status: 403, contentType: "application/problem+json",
            body: #"{"status":403,"code":"LOCAL_PROOF_INVALID","title":"t","detail":"d","traceId":"abc123"}"#))
        let proof = try LocalAccessCode.parse(OperationFixtures.uri()).get().proof

        await #expect(throws: APIError.http(status: 403, problem: SessionFixtures.problem(403, "LOCAL_PROOF_INVALID",
                                                                                          traceId: "abc123"))) {
            try await client.authorizeLocal(operationId: OperationFixtures.id, proof: proof, key: IdempotencyKey(),
                                            bearer: "token-1")
        }
    }

    @Test func theProofNeverDescribesItsToken() throws {
        let proof = try LocalAccessCode.parse(OperationFixtures.uri()).get().proof
        var dumped = ""
        dump(proof, to: &dumped)

        for text in [String(describing: proof), String(reflecting: proof), "\(proof)", dumped] {
            #expect(!text.contains(OperationFixtures.token))
        }
        #expect(String(describing: proof).contains(OperationFixtures.challengeId))
    }
}
