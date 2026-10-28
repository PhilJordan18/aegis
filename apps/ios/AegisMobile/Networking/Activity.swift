import Foundation

// Current activity of the technician, doc 09 §8.3, §8.4, §8.8, §8.10, §14.2
// and §15.3. The client never derives an action from a status, a readiness or
// the locker state: it only offers what the last successful read listed.

enum ReservationStatus: String, Hashable, Sendable {
    case active = "ACTIVE"
    case fulfilled = "FULFILLED"
    case cancelled = "CANCELLED"
    case expired = "EXPIRED"
}

enum LoanStatus: String, Hashable, Sendable {
    case active = "ACTIVE"
    case returnPending = "RETURN_PENDING"
    case completed = "COMPLETED"
}

/// `availableActions` of a reservation (§8.10). A value of another view, such
/// as `RETURN`, is not a reservation action and decodes as unrecognized.
enum ReservationAction: String, Hashable, Sendable {
    case checkout = "CHECKOUT"
    case cancel = "CANCEL"
}

/// `availableActions` of a loan (§8.10).
enum LoanAction: String, Hashable, Sendable {
    case `return` = "RETURN"
}

/// §8.8: identity only, with no RFID identifier and no readiness.
struct AssetSummary: Decodable, Hashable, Sendable {
    let id: UUID
    let assetCode: String
    let model: AssetModelSummary
    let placement: PlacementSummary?
}

/// §8.3.
struct ReservationView: Decodable, Hashable, Sendable, Identifiable {
    let id: UUID
    let asset: AssetSummary
    let userId: UUID
    let status: ContractValue<ReservationStatus>
    let reservedFrom: Date
    let reservedUntil: Date
    let createdAt: Date
    let cancelledAt: Date?
    let fulfilledAt: Date?
    let expiredAt: Date?
    let currentOperationId: UUID?
    let availableActions: [ContractValue<ReservationAction>]

    /// The actions to offer: unknown values were logged while decoding and
    /// are ignored (§8.10, rule 2).
    var actions: Set<ReservationAction> { Set(availableActions.compactMap(\.known)) }
}

/// §8.4. `dueAt` is the server's copy of `reservedUntil`; the client never
/// computes it, nor `overdue`.
struct LoanView: Decodable, Hashable, Sendable, Identifiable {
    let id: UUID
    let asset: AssetSummary
    let holderUserId: UUID
    let status: ContractValue<LoanStatus>
    let checkedOutAt: Date
    let dueAt: Date
    let overdue: Bool
    let returnRequestedAt: Date?
    let returnedAt: Date?
    let checkoutOperationId: UUID
    let returnOperationId: UUID?
    let currentOperationId: UUID?
    let availableActions: [ContractValue<LoanAction>]

    var actions: Set<LoanAction> { Set(availableActions.compactMap(\.known)) }
}

extension Endpoint where Response == ReservationView {
    static var currentReservation: Endpoint { Endpoint(method: "GET", path: "me/reservation") }
}

extension Endpoint where Response == LoanView {
    static var currentLoan: Endpoint { Endpoint(method: "GET", path: "me/loan") }
}

protocol ActivityService: Sendable {
    /// The technician's ACTIVE reservation, nil when there is none.
    func currentReservation(bearer token: String) async throws(APIError) -> ReservationView?
    /// The technician's open loan, nil when there is none.
    func currentLoan(bearer token: String) async throws(APIError) -> LoanView?
}

extension APIClient: ActivityService {
    func currentReservation(bearer token: String) async throws(APIError) -> ReservationView? {
        try await sendAbsentOn404(.currentReservation, code: "ACTIVE_RESERVATION_NOT_FOUND", bearer: token)
    }

    func currentLoan(bearer token: String) async throws(APIError) -> LoanView? {
        try await sendAbsentOn404(.currentLoan, code: "ACTIVE_LOAN_NOT_FOUND", bearer: token)
    }

    /// Only the documented code means "none". Any other 404, such as a route
    /// the server does not have yet, stays an error rather than an empty
    /// activity.
    private func sendAbsentOn404<Response>(_ endpoint: Endpoint<Response>, code: String,
                                           bearer token: String) async throws(APIError) -> Response? {
        do {
            return try await send(endpoint, bearer: token)
        } catch {
            if case let .http(status: 404, problem: problem?, retryAfter: _) = error, problem.code == code {
                return nil
            }
            throw error
        }
    }
}
