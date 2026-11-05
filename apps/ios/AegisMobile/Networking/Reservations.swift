import Foundation

// Reservation mutations and the locker status read, doc 09 §6.2, §8.6, §14.1,
// §14.4, §16.1 and §20. The server checks every guard again: the client sends
// one intent and reports the server's answer.

/// One key per user intent (§6.2). A retry of the same intent reuses it, so a
/// lost answer can never create a second reservation; a new intent draws a
/// new key.
struct IdempotencyKey: Hashable, Sendable {
    let value: String

    init() {
        value = UUID().uuidString.lowercased()
    }

    var header: [String: String] { ["Idempotency-Key": value] }
}

private struct CreateReservationBody: Encodable {
    let assetId: String
    let reservedUntil: Date
}

private struct EmptyBody: Encodable {}

extension Endpoint where Response == ReservationView {
    static func createReservation(assetId: UUID, reservedUntil: Date, key: IdempotencyKey) -> Endpoint {
        .json(method: "POST", path: "reservations",
              body: CreateReservationBody(assetId: assetId.uuidString.lowercased(), reservedUntil: reservedUntil),
              headers: key.header)
    }

    static func cancelReservation(id: UUID, key: IdempotencyKey) -> Endpoint {
        .json(method: "POST", path: "reservations/\(id.uuidString.lowercased())/cancel", body: EmptyBody(),
              headers: key.header)
    }
}

/// `OperatingWindowView` (§8.6), computed by the server at `evaluatedAt`.
/// It helps choose an end time; it never authorizes anything.
struct OperatingWindow: Decodable, Hashable, Sendable {
    /// Null when the locker has no schedule (then closed, without instants).
    let timeZone: String?
    let open: Bool
    let closesAt: Date?
    let nextOpensAt: Date?

    var zone: TimeZone? { timeZone.flatMap(TimeZone.init(identifier:)) }
}

/// The part of `LockerStatusView` (§8.6) the reservation sheet uses. The
/// connection and compartment states are deliberately not decoded: they
/// never decide whether Reserve is offered (§8.10).
struct LockerStatus: Decodable, Hashable, Sendable {
    let lockerId: UUID
    let evaluatedAt: Date
    let currentWindow: OperatingWindow
}

extension Endpoint where Response == LockerStatus {
    static func lockerStatus(id: UUID) -> Endpoint {
        Endpoint(method: "GET", path: "lockers/\(id.uuidString.lowercased())/status")
    }
}

protocol ReservationService: Sendable {
    func createReservation(assetId: UUID, reservedUntil: Date, key: IdempotencyKey,
                           bearer token: String) async throws(APIError) -> ReservationView
    func cancelReservation(id: UUID, key: IdempotencyKey, bearer token: String) async throws(APIError) -> ReservationView
    func lockerStatus(id: UUID, bearer token: String) async throws(APIError) -> LockerStatus
}

extension APIClient: ReservationService {
    func createReservation(assetId: UUID, reservedUntil: Date, key: IdempotencyKey,
                           bearer token: String) async throws(APIError) -> ReservationView {
        try await send(.createReservation(assetId: assetId, reservedUntil: reservedUntil, key: key), bearer: token)
    }

    func cancelReservation(id: UUID, key: IdempotencyKey, bearer token: String) async throws(APIError) -> ReservationView {
        try await send(.cancelReservation(id: id, key: key), bearer: token)
    }

    func lockerStatus(id: UUID, bearer token: String) async throws(APIError) -> LockerStatus {
        try await send(.lockerStatus(id: id), bearer: token)
    }
}
