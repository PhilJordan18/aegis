import Foundation
import Testing
@testable import AegisMobile

/// Personal history (doc 09 §29, #228) as requested and decoded by
/// `APIClient`, and paged by `HistoryList`.
struct HistoryContractTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    @Test func requestsTheFirstReservationPageWithTheBearer() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: HistoryFixtures.page([], totalItems: 0, totalPages: 0)))

        let page = try await client.reservationHistory(HistoryQuery(), bearer: "technician-token")

        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/me/reservations?page=0&size=20")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer technician-token")
        #expect(page.items.isEmpty)
        #expect(page.totalItems == 0)
        #expect(page.totalPages == 0)
    }

    /// No status filter, owner or sort is ever sent: the server derives the
    /// holder from the token and keeps its own order.
    @Test func requestsALaterLoanPageWithNoOtherParameter() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: HistoryFixtures.page([], page: 2, totalItems: 41, totalPages: 3)))

        _ = try await client.loanHistory(HistoryQuery(page: 2), bearer: "t")

        let url = try #require(transport.requests.first?.url)
        #expect(url.path() == "/api/v1/me/loans")
        let names = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name)
        #expect(names == ["page", "size"])
        #expect(url.query() == "page=2&size=20")
    }

    @Test func decodesHistoryRecordsWithoutActions() throws {
        let page = CatalogFixtures.decode(
            HistoryFixtures.page([ActivityFixtures.reservation(status: "CANCELLED", actions: [])], totalItems: 1,
                                 totalPages: 1),
            as: HistoryPage<ReservationView>.self)
        let loans = CatalogFixtures.decode(
            HistoryFixtures.page([ActivityFixtures.loan(status: "COMPLETED", overdue: false, actions: [])],
                                 totalItems: 1, totalPages: 1),
            as: HistoryPage<LoanView>.self)

        #expect(page.items.first?.status == .known(.cancelled))
        #expect(page.items.first?.actions.isEmpty == true)
        #expect(page.items.first?.currentOperationId == nil)
        #expect(loans.items.first?.status == .known(.completed))
        #expect(loans.items.first?.actions.isEmpty == true)
    }

    /// §29: a placement may be null, the asset no longer being placed.
    @Test func decodesARecordWhoseAssetHasNoCurrentPlacement() {
        let record = ActivityFixtures.reservation(status: "EXPIRED", actions: [])
            .replacing(#/"placement":\{[^}]*\}/#, with: #""placement":null"#)
        let page = CatalogFixtures.decode(HistoryFixtures.page([record], totalItems: 1, totalPages: 1),
                                          as: HistoryPage<ReservationView>.self)

        #expect(page.items.first?.asset.placement == nil)
    }

    @Test func aRejectedPageStaysAnError() async {
        let (client, _) = client(.response(status: 400, contentType: "application/problem+json",
                                           body: #"{"status":400,"code":"VALIDATION_ERROR","title":"t","detail":"d","traceId":null}"#))

        let error = await #expect(throws: APIError.self) {
            _ = try await client.reservationHistory(HistoryQuery(), bearer: "t")
        }
        guard case .http(status: 400, problem: let problem?, retryAfter: _) = error else {
            Issue.record("Expected a 400 problem, got \(String(describing: error))")
            return
        }
        #expect(problem.code == "VALIDATION_ERROR")
    }
}

@MainActor
struct HistoryListTests {
    let session = StubSessionAccess()
    let clock = TestClock()
    let service = ScriptedHistoryService()

    private func model() -> HistoryViewModel {
        HistoryViewModel(service: service, session: session, now: { [clock] in clock.now })
    }

    @Test func showsLoadingThenTheFirstPage() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<3, page: 0, totalItems: 3))]
        let model = model()
        #expect(model.reservations.display == .loading)

        await model.loadIfNeeded()

        guard case let .content(items, receivedAt, stale) = model.reservations.display else {
            Issue.record("\(model.reservations.display)")
            return
        }
        #expect(items.count == 3)
        #expect(receivedAt == clock.now)
        #expect(stale == nil)
        #expect(service.queries == [.init(kind: .reservations, query: HistoryQuery())])
        #expect(service.tokens == ["technician-token"])
    }

    @Test func readsEachListOnlyWhenFirstShown() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<1, page: 0, totalItems: 1))]
        service.loans = [.success(HistoryFixtures.loans(0..<2, page: 0, totalItems: 2))]
        let model = model()

        await model.loadIfNeeded()
        model.kind = .loans
        await model.loadIfNeeded()
        model.kind = .reservations
        await model.loadIfNeeded()

        #expect(service.queries.map(\.kind) == [.reservations, .loans])
        #expect(model.loans.items.count == 2)
    }

    @Test func anEmptyHistoryIsContentNotAFailure() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<0, page: 0, totalItems: 0))]
        let model = model()

        await model.loadIfNeeded()

        guard case let .content(items, _, stale) = model.reservations.display else {
            Issue.record("\(model.reservations.display)")
            return
        }
        #expect(items.isEmpty)
        #expect(stale == nil)
        #expect(model.reservations.nextPage == nil)
    }

    @Test func pagesUntilTheLastAndNeverRepeatsAnItem() async {
        service.reservations = [
            .success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 25)),
            // A new reservation shifted the offsets: the first item of page 1
            // is the last one of page 0.
            .success(HistoryFixtures.reservations(19..<25, page: 1, totalItems: 26)),
        ]
        let model = model()

        await model.loadIfNeeded()
        #expect(model.reservations.nextPage == 1)
        await model.reservations.loadMore()

        #expect(model.reservations.items.count == 25)
        #expect(Set(model.reservations.items.map(\.id)).count == 25)
        #expect(model.reservations.nextPage == nil)
        #expect(service.queries.map(\.query.page) == [0, 1])
    }

    @Test func anEmptyPageEndsTheList() async {
        service.reservations = [
            .success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 40)),
            .success(HistoryFixtures.reservations(0..<0, page: 1, totalItems: 40)),
        ]
        let model = model()
        await model.loadIfNeeded()
        await model.reservations.loadMore()

        #expect(model.reservations.nextPage == nil)
        await model.reservations.loadMore()
        #expect(service.queries.count == 2)
    }

    @Test func aFirstReadOfflineOffersRetryThenRecovers() async {
        service.reservations = [.failure(.unreachable(.notConnectedToInternet)),
                                .success(HistoryFixtures.reservations(0..<1, page: 0, totalItems: 1))]
        let model = model()

        await model.loadIfNeeded()
        #expect(model.reservations.display == .failed(.unreachable))
        await model.loadIfNeeded()
        #expect(service.queries.count == 1)

        await model.reload()
        guard case .content = model.reservations.display else {
            Issue.record("\(model.reservations.display)")
            return
        }
    }

    @Test func aFailedRefreshKeepsTheListAsLastKnownAndStopsPaging() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 30)),
                                .failure(.http(status: 503, problem: nil, retryAfter: nil))]
        let model = model()
        await model.loadIfNeeded()
        let received = clock.now
        clock.advance(by: 300)

        await model.reload()
        await model.reservations.loadMore()

        guard case let .content(items, receivedAt, stale) = model.reservations.display else {
            Issue.record("\(model.reservations.display)")
            return
        }
        #expect(items.count == 20)
        #expect(receivedAt == received)
        #expect(stale == .service(traceId: nil))
        #expect(service.queries.count == 2)
    }

    @Test func aRefreshStartsAgainFromTheFirstPage() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 25)),
                                .success(HistoryFixtures.reservations(20..<25, page: 1, totalItems: 25)),
                                .success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 25))]
        let model = model()
        await model.loadIfNeeded()
        await model.reservations.loadMore()

        await model.reload()

        #expect(model.reservations.items.count == 20)
        #expect(model.reservations.nextPage == 1)
        #expect(service.queries.map(\.query.page) == [0, 1, 0])
    }

    @Test func aFailedNextPageKeepsTheItemsAndOffersRetry() async {
        service.reservations = [.success(HistoryFixtures.reservations(0..<20, page: 0, totalItems: 25)),
                                .failure(.unreachable(.timedOut)),
                                .success(HistoryFixtures.reservations(20..<25, page: 1, totalItems: 25))]
        let model = model()
        await model.loadIfNeeded()

        await model.reservations.loadMore()
        #expect(model.reservations.loadMoreFailure == .unreachable)
        #expect(model.reservations.items.count == 20)

        await model.reservations.loadMore()
        #expect(model.reservations.loadMoreFailure == nil)
        #expect(model.reservations.items.count == 25)
    }

    @Test(.timeLimit(.minutes(1)))
    func aSecondRefreshWhileOneIsInFlightSendsNothing() async {
        let gate = Gate()
        service.gate = gate
        service.reservations = [.success(HistoryFixtures.reservations(0..<1, page: 0, totalItems: 1))]
        let model = model()

        let first = Task { await model.reload() }
        while service.queries.isEmpty { await Task.yield() }
        await model.reload()
        await gate.open()
        await first.value

        #expect(service.queries.count == 1)
        #expect(!model.reservations.isLoading)
    }

    @Test func anExpiredSessionEndsTheSessionWithoutAFailure() async {
        service.reservations = [.failure(.http(status: 401, problem: CatalogFixtures.decode(
            CatalogFixtures.problem(401, "AUTH_TOKEN_EXPIRED"), as: APIProblem.self), retryAfter: nil))]
        let model = model()

        await model.loadIfNeeded()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(model.reservations.failure == nil)
    }

    @Test func noTokenSendsNothing() async {
        session.token = nil
        let model = model()

        await model.loadIfNeeded()

        #expect(service.queries.isEmpty)
        #expect(session.missingTokenCalls == 1)
    }

    @Test func aRefusedReadIsForbiddenNotAnExpiredSession() async {
        service.loans = [.failure(.http(status: 403, problem: nil, retryAfter: nil))]
        let model = model()
        model.kind = .loans

        await model.loadIfNeeded()

        #expect(model.loans.display == .failed(.forbidden))
        #expect(session.unauthorizedCodes.isEmpty)
    }
}

/// History double: answers each read of a list from its script, in order;
/// the last answer repeats. It can hold a read until the test opens the gate.
final class ScriptedHistoryService: HistoryService, @unchecked Sendable {
    struct Call: Equatable {
        let kind: HistoryViewModel.Kind
        let query: HistoryQuery
    }

    private let lock = NSLock()
    private var _reservations: [Result<HistoryPage<ReservationView>, APIError>] = []
    private var _loans: [Result<HistoryPage<LoanView>, APIError>] = []
    private var _queries: [Call] = []
    private var _tokens: [String] = []
    var gate: Gate?

    var reservations: [Result<HistoryPage<ReservationView>, APIError>] {
        get { lock.withLock { _reservations } }
        set { lock.withLock { _reservations = newValue } }
    }

    var loans: [Result<HistoryPage<LoanView>, APIError>] {
        get { lock.withLock { _loans } }
        set { lock.withLock { _loans = newValue } }
    }

    var queries: [Call] { lock.withLock { _queries } }
    var tokens: [String] { lock.withLock { _tokens } }

    func reservationHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError)
        -> HistoryPage<ReservationView> {
        let result = lock.withLock {
            record(.reservations, query, token)
            return Self.next(&_reservations)
        }
        if let gate { await gate.wait() }
        return try result.get()
    }

    func loanHistory(_ query: HistoryQuery, bearer token: String) async throws(APIError) -> HistoryPage<LoanView> {
        let result = lock.withLock {
            record(.loans, query, token)
            return Self.next(&_loans)
        }
        if let gate { await gate.wait() }
        return try result.get()
    }

    private func record(_ kind: HistoryViewModel.Kind, _ query: HistoryQuery, _ token: String) {
        _queries.append(Call(kind: kind, query: query))
        _tokens.append(token)
    }

    private static func next<T>(_ list: inout [Result<T, APIError>]) -> Result<T, APIError> {
        list.count > 1 ? list.removeFirst() : list.first ?? .failure(.invalidResponse)
    }
}

enum HistoryFixtures {
    static func page(_ items: [String], page: Int = 0, size: Int = 20, totalItems: Int, totalPages: Int) -> String {
        #"{"items":[\#(items.joined(separator: ","))],"page":\#(page),"size":\#(size),"totalItems":\#(totalItems),"totalPages":\#(totalPages)}"#
    }

    static func id(_ index: Int) -> String { String(format: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b%04d", index) }

    static func reservations(_ range: Range<Int>, page: Int, totalItems: Int) -> HistoryPage<ReservationView> {
        let items = range.map { index in
            ActivityFixtures.reservation(status: "FULFILLED", actions: [])
                .replacingOccurrences(of: ActivityFixtures.reservationId, with: id(index))
        }
        return CatalogFixtures.decode(self.page(items, page: page, totalItems: totalItems,
                                                totalPages: (totalItems + 19) / 20),
                                      as: HistoryPage<ReservationView>.self)
    }

    static func loans(_ range: Range<Int>, page: Int, totalItems: Int) -> HistoryPage<LoanView> {
        let items = range.map { index in
            ActivityFixtures.loan(status: "COMPLETED", overdue: false, actions: [])
                .replacingOccurrences(of: ActivityFixtures.loanId, with: id(index))
        }
        return CatalogFixtures.decode(self.page(items, page: page, totalItems: totalItems,
                                                totalPages: (totalItems + 19) / 20),
                                      as: HistoryPage<LoanView>.self)
    }
}
