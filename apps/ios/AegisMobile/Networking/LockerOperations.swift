import Foundation

// Locker operations, doc 09 §8.5, §15.1, §15.4 and §15.5. The server decides
// every state: the client prepares one intent, submits one local proof, then
// reads the operation until it is terminal. A success here is never a physical
// confirmation; only CONFIRMED is.

enum LockerOperationType: String, Hashable, Sendable {
    case checkout = "CHECKOUT"
    case `return` = "RETURN"
}

/// `LockerOperationStatus` (§8.5).
enum LockerOperationStatus: String, Hashable, Sendable, CaseIterable {
    case requested = "REQUESTED"
    case awaitingLocalProof = "AWAITING_LOCAL_PROOF"
    case authorized = "AUTHORIZED"
    case commandSent = "COMMAND_SENT"
    case commandAcknowledged = "COMMAND_ACKNOWLEDGED"
    case doorOpened = "DOOR_OPENED"
    case observationReceived = "OBSERVATION_RECEIVED"
    case confirmed = "CONFIRMED"
    case failed = "FAILED"
    case expired = "EXPIRED"
    case anomaly = "ANOMALY"

    var isTerminal: Bool {
        switch self {
        case .confirmed, .failed, .expired, .anomaly: true
        default: false
        }
    }
}

/// `requiredAction` of §8.5 and §15.4.
enum OperationRequiredAction: String, Hashable, Sendable {
    case scanHubQR = "SCAN_HUB_QR"
    case wait = "WAIT"
    case none = "NONE"
}

/// §8.5. It carries no secret of the challenge: the token reaches the app
/// only through the hub QR.
struct LockerOperationView: Decodable, Hashable, Sendable, Identifiable {
    let id: UUID
    let type: ContractValue<LockerOperationType>
    let status: ContractValue<LockerOperationStatus>
    let userId: UUID
    let assetId: UUID
    let lockerId: UUID
    let compartmentId: UUID
    let reservationId: UUID?
    let loanId: UUID?
    let createdAt: Date
    let authorizedAt: Date?
    let localAccessChallengeId: UUID?
    let localProofExpiresAt: Date?
    let localProofDisplayedAt: Date?
    let localProofValidatedAt: Date?
    let requiredAction: ContractValue<OperationRequiredAction>
    let expiresAt: Date?
    let commandSentAt: Date?
    let acknowledgedAt: Date?
    let doorOpenedAt: Date?
    let observationReceivedAt: Date?
    let confirmedAt: Date?
    let terminalAt: Date?
    /// Public and open-ended (§8.5): kept raw, an unknown value is a generic
    /// failure with no physical meaning.
    let failureReason: String?
    let anomalyId: UUID?

    /// Following stops here. An unrecognized status is terminal only when the
    /// server stamped `terminalAt`; otherwise it is followed like any other.
    var isTerminal: Bool {
        if let status = status.known { return status.isTerminal }
        return terminalAt != nil
    }

    /// The only state in which a scanned code may be submitted. Any
    /// unrecognized status or action enables nothing.
    var awaitsLocalProof: Bool {
        status.known == .awaitingLocalProof && requiredAction.known == .scanHubQR
    }

    /// The only success. Nothing else, known or not, means the asset moved.
    var isConfirmed: Bool { status.known == .confirmed }
}

/// The body of `authorize-local` (§15.5). It holds the one-time secret of the
/// hub QR: it lives in memory only, until the server answered, and is never
/// logged, persisted or shown.
struct LocalProof: Encodable, Hashable, Sendable {
    let challengeId: UUID
    let token: String

    private enum CodingKeys: String, CodingKey { case challengeId, token }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(challengeId.uuidString.lowercased(), forKey: .challengeId)
        try container.encode(token, forKey: .token)
    }
}

extension LocalProof: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    var description: String { "LocalProof(challengeId: \(challengeId.uuidString.lowercased()), token: <redacted>)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["challengeId": challengeId], displayStyle: .struct) }
}

extension Endpoint where Response == LockerOperationView {
    /// §15.1: an empty body; the answer is 202 with the operation.
    static func prepareCheckout(reservationId: UUID, key: IdempotencyKey) -> Endpoint {
        Endpoint(method: "POST", path: "reservations/\(reservationId.uuidString.lowercased())/checkout",
                 headers: key.header)
    }

    static func lockerOperation(id: UUID) -> Endpoint {
        Endpoint(method: "GET", path: "locker-operations/\(id.uuidString.lowercased())")
    }

    static func authorizeLocal(operationId: UUID, proof: LocalProof, key: IdempotencyKey) -> Endpoint {
        .json(method: "POST", path: "locker-operations/\(operationId.uuidString.lowercased())/authorize-local",
              body: proof, headers: key.header)
    }
}

protocol LockerOperationService: Sendable {
    func prepareCheckout(reservationId: UUID, key: IdempotencyKey,
                         bearer token: String) async throws(APIError) -> LockerOperationView
    /// One read, with the delay the server asked before the next one.
    func lockerOperation(id: UUID, bearer token: String) async throws(APIError) -> Received<LockerOperationView>
    func authorizeLocal(operationId: UUID, proof: LocalProof, key: IdempotencyKey,
                        bearer token: String) async throws(APIError) -> LockerOperationView
}

extension APIClient: LockerOperationService {
    func prepareCheckout(reservationId: UUID, key: IdempotencyKey,
                         bearer token: String) async throws(APIError) -> LockerOperationView {
        try await send(.prepareCheckout(reservationId: reservationId, key: key), bearer: token)
    }

    func lockerOperation(id: UUID, bearer token: String) async throws(APIError) -> Received<LockerOperationView> {
        try await receive(.lockerOperation(id: id), bearer: token)
    }

    func authorizeLocal(operationId: UUID, proof: LocalProof, key: IdempotencyKey,
                        bearer token: String) async throws(APIError) -> LockerOperationView {
        try await send(.authorizeLocal(operationId: operationId, proof: proof, key: key), bearer: token)
    }
}
