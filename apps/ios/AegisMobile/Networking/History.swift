import Foundation

// Personal history of the technician, doc 09 §29 (#228). These lists are
// read-only: `availableActions` is always empty and `currentOperationId`
// always null in them, so nothing here offers an action or follows an
// operation. The placement is the asset's current one, not a snapshot.

/// §29 envelope, the same as §11.1; `page` is zero-based.
struct HistoryPage<Item: Decodable & Sendable>: Decodable, Sendable {
    let items: [Item]
    let page: Int
    let size: Int
    let totalItems: Int
    let totalPages: Int
}

extension HistoryPage: Equatable where Item: Equatable {}

/// `page` and `size` of §29. No status filter is sent: every state is listed.
struct HistoryQuery: Hashable, Sendable {
    static let pageSize = 20

    var page = 0
    var size = pageSize

    var queryItems: [URLQueryItem] {
        [URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "size", value: String(size))]
    }
}

extension Endpoint where Response == HistoryPage<ReservationView> {
    static func reservationHistory(_ query: HistoryQuery) -> Endpoint {
        Endpoint(method: "GET", path: "me/reservations", query: query.queryItems)
    }
}

extension Endpoint where Response == HistoryPage<LoanView> {
    static func loanHistory(_ query: HistoryQuery) -> Endpoint {
        Endpoint(method: "GET", path: "me/loans", query: query.queryItems)
    }
}

protocol HistoryService: Sendable {
    func reservationHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError)
        -> HistoryPage<ReservationView>
    func loanHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError) -> HistoryPage<LoanView>
}

extension APIClient: HistoryService {
    func reservationHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError)
        -> HistoryPage<ReservationView> {
        try await send(.reservationHistory(query), bearer: token)
    }

    func loanHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError) -> HistoryPage<LoanView> {
        try await send(.loanHistory(query), bearer: token)
    }
}
