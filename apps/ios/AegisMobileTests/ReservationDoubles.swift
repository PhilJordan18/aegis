import Foundation
@testable import AegisMobile

/// Activity and reservation double: scripted answers in order (the last one
/// repeats), recorded keys and times, and an optional gate on mutations.
final class ScriptedReservationService: ActivityService, ReservationService, @unchecked Sendable {
    private let lock = NSLock()
    private var reservations: [Result<ReservationView?, APIError>]
    private var loans: [Result<LoanView?, APIError>]
    private var creations: [Result<ReservationView, APIError>]
    private var cancellations: [Result<ReservationView, APIError>]
    private var status: Result<LockerStatus, APIError>
    private var _createKeys: [IdempotencyKey] = []
    private var _createTimes: [Date] = []
    private var _cancelKeys: [IdempotencyKey] = []
    private var _statusCalls = 0
    private var _reads = 0
    var gate: Gate?

    init(reservations: [Result<ReservationView?, APIError>] = [.success(nil)],
         loans: [Result<LoanView?, APIError>] = [.success(nil)],
         creations: [Result<ReservationView, APIError>] = [.failure(.invalidResponse)],
         cancellations: [Result<ReservationView, APIError>] = [.failure(.invalidResponse)],
         status: Result<LockerStatus, APIError> = .failure(ActivityDoubles.routeMissing)) {
        self.reservations = reservations
        self.loans = loans
        self.creations = creations
        self.cancellations = cancellations
        self.status = status
    }

    func setReservations(_ results: [Result<ReservationView?, APIError>]) { lock.withLock { reservations = results } }
    func setLoans(_ results: [Result<LoanView?, APIError>]) { lock.withLock { loans = results } }

    var createKeys: [IdempotencyKey] { lock.withLock { _createKeys } }
    var createTimes: [Date] { lock.withLock { _createTimes } }
    var cancelKeys: [IdempotencyKey] { lock.withLock { _cancelKeys } }
    var statusCalls: Int { lock.withLock { _statusCalls } }
    var reads: Int { lock.withLock { _reads } }

    private static func next<T>(_ list: inout [T]) -> T {
        list.count > 1 ? list.removeFirst() : list[0]
    }

    func currentReservation(bearer token: String) async throws(APIError) -> ReservationView? {
        try lock.withLock { _reads += 1; return Self.next(&reservations) }.get()
    }

    func currentLoan(bearer token: String) async throws(APIError) -> LoanView? {
        try lock.withLock { Self.next(&loans) }.get()
    }

    func createReservation(assetId: UUID, reservedUntil: Date, key: IdempotencyKey,
                           bearer token: String) async throws(APIError) -> ReservationView {
        let result = lock.withLock {
            _createKeys.append(key)
            _createTimes.append(reservedUntil)
            return Self.next(&creations)
        }
        if let gate { await gate.wait() }
        return try result.get()
    }

    func cancelReservation(id: UUID, key: IdempotencyKey, bearer token: String) async throws(APIError) -> ReservationView {
        let result = lock.withLock {
            _cancelKeys.append(key)
            return Self.next(&cancellations)
        }
        if let gate { await gate.wait() }
        return try result.get()
    }

    func lockerStatus(id: UUID, bearer token: String) async throws(APIError) -> LockerStatus {
        try lock.withLock { _statusCalls += 1; return status }.get()
    }
}

enum ActivityDoubles {
    static let routeMissing = APIError.http(status: 404, problem: SessionFixtures.problem(404, "RESOURCE_NOT_FOUND"))

    static func reservation(status: String = "ACTIVE", actions: [String] = ["CHECKOUT", "CANCEL"]) -> ReservationView {
        CatalogFixtures.decode(ActivityFixtures.reservation(status: status, actions: actions))
    }

    static func loan(overdue: Bool = true) -> LoanView {
        CatalogFixtures.decode(ActivityFixtures.loan(overdue: overdue))
    }

    static func refusal(_ status: Int, _ code: String, reasons: [String]? = nil,
                        violations: [APIProblem.Violation]? = nil) -> APIError {
        var problem = SessionFixtures.problem(status, code, violations: violations)
        problem.reasons = reasons
        return .http(status: status, problem: problem)
    }

    static func window(open: Bool, closesAt: String? = nil, nextOpensAt: String? = nil) -> LockerStatus {
        func instant(_ text: String?) -> String { text.map { "\"\($0)\"" } ?? "null" }
        return CatalogFixtures.decode(ReservationContractTests.lockerStatus(
            window: #"{"timeZone":"America/Toronto","open":\#(open),"closesAt":\#(instant(closesAt)),"nextOpensAt":\#(instant(nextOpensAt))}"#))
    }
}
