import Foundation
@testable import AegisMobile

/// FICTIONAL operation, challenge and QR values (doc 09 §8.5, doc 10 §27.1).
/// The tokens encode fixed byte runs (base64url, no padding), never a real secret.
enum OperationFixtures {
    static let operationId = "2f38d3b6-c18f-4a74-aa9a-2d574286013f"
    static let otherOperationId = "5a1f3c2e-7b4d-4e8f-9a0b-1c2d3e4f5a6b"
    static let lockerId = "d46a74ae-39dc-460b-8af0-38fc791b376a"
    static let otherLockerId = "e57b85bf-4aed-4c9f-8b1c-2d3e4f5a6b7c"
    static let compartmentId = "1ae77ae3-8490-4f09-9412-a7816b77bff9"
    static let challengeId = "9d65cbae-4610-4e40-a314-3b93af07be9c"
    static let otherChallengeId = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
    static let token = fixtureToken(0..<32)
    static let otherToken = fixtureToken(32..<64)

    /// 43 base64url characters; these byte runs encode without `+`, `/` or padding beyond the one dropped `=`.
    private static func fixtureToken(_ bytes: Range<UInt8>) -> String {
        String(Data(bytes).base64EncodedString().dropLast())
    }

    static var id: UUID { UUID(uuidString: operationId)! }

    /// The form built by the hub simulator (`qrUriFor`).
    static func uri(v: String = "1", challengeId: String = challengeId, operationId: String = operationId,
                    lockerId: String = lockerId, token: String = token) -> String {
        "aegis://local-access?v=\(v)&challengeId=\(challengeId)&operationId=\(operationId)&lockerId=\(lockerId)&token=\(token)"
    }

    static func json(id: String = operationId, status: String = "AWAITING_LOCAL_PROOF",
                     requiredAction: String = "SCAN_HUB_QR", type: String = "CHECKOUT",
                     lockerId: String = lockerId, challengeId: String? = challengeId,
                     terminalAt: String? = nil, failureReason: String? = nil,
                     displayedAt: String? = "2026-09-16T14:31:02.250Z", authorizedAt: String? = nil,
                     expiresAt: String? = nil, commandSentAt: String? = nil,
                     acknowledgedAt: String? = nil) -> String {
        func text(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        return #"{"id":"\#(id)","type":"\#(type)","status":"\#(status)","userId":"\#(CatalogFixtures.technicianId)","assetId":"\#(CatalogFixtures.id(1).uuidString.lowercased())","lockerId":"\#(lockerId)","compartmentId":"\#(compartmentId)","reservationId":"\#(ActivityFixtures.reservationId)","loanId":null,"createdAt":"2026-09-16T14:31:00Z","authorizedAt":\#(text(authorizedAt)),"localAccessChallengeId":\#(text(challengeId)),"localProofExpiresAt":"2026-09-16T14:32:00Z","localProofDisplayedAt":\#(text(displayedAt)),"localProofValidatedAt":null,"requiredAction":"\#(requiredAction)","expiresAt":\#(text(expiresAt)),"commandSentAt":\#(text(commandSentAt)),"acknowledgedAt":\#(text(acknowledgedAt)),"doorOpenedAt":null,"observationReceivedAt":null,"confirmedAt":null,"terminalAt":\#(text(terminalAt)),"failureReason":\#(text(failureReason)),"anomalyId":null}"#
    }

    static func view(id: String = operationId, status: String = "AWAITING_LOCAL_PROOF",
                     requiredAction: String = "SCAN_HUB_QR", challengeId: String? = challengeId,
                     terminalAt: String? = nil, failureReason: String? = nil,
                     displayedAt: String? = "2026-09-16T14:31:02.250Z", authorizedAt: String? = nil,
                     expiresAt: String? = nil, commandSentAt: String? = nil,
                     acknowledgedAt: String? = nil) -> LockerOperationView {
        CatalogFixtures.decode(json(id: id, status: status, requiredAction: requiredAction, challengeId: challengeId,
                                    terminalAt: terminalAt, failureReason: failureReason, displayedAt: displayedAt,
                                    authorizedAt: authorizedAt, expiresAt: expiresAt, commandSentAt: commandSentAt,
                                    acknowledgedAt: acknowledgedAt))
    }

    static var awaiting: LockerOperationView { view() }
    static var authorized: LockerOperationView { view(status: "AUTHORIZED", requiredAction: "WAIT") }
    static var commandSent: LockerOperationView { view(status: "COMMAND_SENT", requiredAction: "WAIT") }
    static var confirmed: LockerOperationView {
        view(status: "CONFIRMED", requiredAction: "NONE", terminalAt: "2026-09-16T14:31:40Z")
    }

    static func read(_ view: LockerOperationView, retryAfter: Duration? = .seconds(1))
        -> Result<Received<LockerOperationView>, APIError> {
        .success(Received(value: view, retryAfter: retryAfter))
    }
}

/// Operation double: scripted answers in order (the last one repeats),
/// recorded submissions, and optional gates that hold an answer until the
/// test opens them.
final class ScriptedOperationService: LockerOperationService, @unchecked Sendable {
    struct Authorization: Equatable {
        let operationId: UUID
        let proof: LocalProof
        let key: IdempotencyKey
    }

    private let lock = NSLock()
    private var readResults: [Result<Received<LockerOperationView>, APIError>]
    private var authorizeResults: [Result<LockerOperationView, APIError>]
    private var prepareResults: [Result<LockerOperationView, APIError>]
    private var _prepareKeys: [IdempotencyKey] = []
    private var _reads = 0
    private var _inFlight = 0
    private var _maxInFlight = 0
    private var _authorizations: [Authorization] = []
    private var _tokens: [String] = []
    var readGate: Gate?
    var authorizeGate: Gate?

    init(reads: [Result<Received<LockerOperationView>, APIError>] = [.failure(.invalidResponse)],
         authorizations: [Result<LockerOperationView, APIError>] = [.failure(.invalidResponse)],
         preparations: [Result<LockerOperationView, APIError>] = [.failure(.invalidResponse)]) {
        readResults = reads
        authorizeResults = authorizations
        prepareResults = preparations
    }

    /// The keys of every `POST /reservations/{id}/checkout`, in order.
    var prepareKeys: [IdempotencyKey] { lock.withLock { _prepareKeys } }
    var prepareGate: Gate?

    var reads: Int { lock.withLock { _reads } }
    var maxInFlight: Int { lock.withLock { _maxInFlight } }
    var authorizations: [Authorization] { lock.withLock { _authorizations } }
    var tokens: [String] { lock.withLock { _tokens } }

    private static func next<T>(_ list: inout [T]) -> T {
        list.count > 1 ? list.removeFirst() : list[0]
    }

    func prepareCheckout(reservationId: UUID, key: IdempotencyKey,
                         bearer token: String) async throws(APIError) -> LockerOperationView {
        let result = lock.withLock {
            _prepareKeys.append(key)
            return Self.next(&prepareResults)
        }
        if let prepareGate { await prepareGate.wait() }
        return try result.get()
    }

    func lockerOperation(id: UUID, bearer token: String) async throws(APIError) -> Received<LockerOperationView> {
        let result = lock.withLock {
            _reads += 1
            _inFlight += 1
            _maxInFlight = max(_maxInFlight, _inFlight)
            _tokens.append(token)
            return Self.next(&readResults)
        }
        if let readGate { await readGate.wait() }
        lock.withLock { _inFlight -= 1 }
        return try result.get()
    }

    func authorizeLocal(operationId: UUID, proof: LocalProof, key: IdempotencyKey,
                        bearer token: String) async throws(APIError) -> LockerOperationView {
        let result = lock.withLock {
            _authorizations.append(Authorization(operationId: operationId, proof: proof, key: key))
            return Self.next(&authorizeResults)
        }
        if let authorizeGate { await authorizeGate.wait() }
        return try result.get()
    }
}

/// Records every requested pause. The first `immediate` pauses return at
/// once; later ones wait until the loop is cancelled, which freezes the
/// follower between two reads without any real delay in the test.
final class RecordingSleeper: @unchecked Sendable {
    private let lock = NSLock()
    private var _durations: [Duration] = []
    private let immediate: Int

    init(immediate: Int = .max) {
        self.immediate = immediate
    }

    var durations: [Duration] { lock.withLock { _durations } }

    func sleep(_ duration: Duration) async throws {
        let count = lock.withLock {
            _durations.append(duration)
            return _durations.count
        }
        if count > immediate {
            // Ends only through cancellation (suspend, stop or a newer loop).
            try await Task.sleep(for: .seconds(3600))
        }
        try Task.checkCancellation()
    }
}

/// Yields until the condition holds, without a fixed delay; fails the wait
/// rather than hanging when it never does.
@MainActor
func waitUntil(_ condition: () -> Bool, maximumYields: Int = 10_000) async -> Bool {
    for _ in 0..<maximumYields {
        if condition() { return true }
        await Task.yield()
    }
    return condition()
}
