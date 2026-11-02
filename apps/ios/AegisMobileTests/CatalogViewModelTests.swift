import Foundation
import Testing
@testable import AegisMobile

@MainActor
struct CatalogViewModelTests {
    let service = ScriptedCatalogService()
    let session = StubSessionAccess()
    let clock = TestClock()

    private func model() -> CatalogViewModel {
        CatalogViewModel(service: service, session: session, now: { [clock] in clock.now })
    }

    @Test func firstLoadShowsSkeletonsThenTheList() async {
        service.setPages([.success(CatalogFixtures.page(1...3))])
        let model = model()
        #expect(model.display == .loading)

        await model.loadIfNeeded()

        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.items.map(\.assetCode) == ["MM-001", "MM-002", "MM-003"])
        #expect(snapshot.receivedAt == clock.now)
        #expect(!snapshot.isStale)
        #expect(service.tokens == ["technician-token"])
        #expect(service.queries == [AssetQuery()])
    }

    @Test func doesNotReloadAFreshList() async {
        service.setPages([.success(CatalogFixtures.page(1...1))])
        let model = model()
        await model.loadIfNeeded()
        await model.loadIfNeeded()
        #expect(service.queries.count == 1)
    }

    @Test func firstLoadFailureOffersRetry() async {
        service.setPages([.failure(.unreachable(.notConnectedToInternet)), .success(CatalogFixtures.page(1...1))])
        let model = model()

        await model.loadIfNeeded()
        #expect(model.display == .failed(.unreachable))

        await model.reload()
        guard case .content = model.display else { Issue.record("\(model.display)"); return }
    }

    @Test func offlineRefreshKeepsTheLastListAsLastKnown() async {
        service.setPages([.success(CatalogFixtures.page(1...2)), .failure(.unreachable(.notConnectedToInternet))])
        let model = model()
        await model.loadIfNeeded()
        let received = clock.now
        clock.advance(by: 600)

        await model.reload()

        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.items.count == 2)
        #expect(snapshot.isStale)
        #expect(snapshot.refreshFailure == .unreachable)
        #expect(snapshot.receivedAt == received)
    }

    @Test func successfulRefreshClearsTheStaleState() async {
        service.setPages([
            .success(CatalogFixtures.page(1...2)),
            .failure(.http(status: 503, problem: nil)),
            .success(CatalogFixtures.page(1...3)),
        ])
        let model = model()
        await model.loadIfNeeded()
        await model.reload()
        clock.advance(by: 60)

        // A stale list is read again when the screen comes back.
        await model.loadIfNeeded()

        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(!snapshot.isStale)
        #expect(snapshot.items.count == 3)
        #expect(snapshot.receivedAt == clock.now)
    }

    @Test func unauthorizedEndsTheSession() async {
        let problem = APIProblem(status: 401, code: "AUTH_TOKEN_EXPIRED", title: "t", detail: "d", traceId: nil)
        service.setPages([.failure(.http(status: 401, problem: problem))])
        let model = model()

        await model.loadIfNeeded()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(model.display == .loading)
    }

    @Test func badRequestShowsTheGenericFailureAndKeepsTheSession() async {
        let problem = APIProblem(status: 400, code: "UNHEARD_OF", title: "t", detail: "d",
                                 traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30",
                                 violations: [.init(field: "q", code: "SOMETHING_NEW")])
        service.setPages([.failure(.http(status: 400, problem: problem))])
        let model = model()
        model.searchText = "MM"
        model.submitSearch()

        await model.loadIfNeeded()

        #expect(model.display == .failed(.service(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")))
        #expect(session.unauthorizedCodes.isEmpty)
        #expect(session.missingTokenCalls == 0)
    }

    @Test func missingTokenEndsTheSessionWithoutARequest() async {
        session.token = nil
        let model = model()

        await model.loadIfNeeded()

        #expect(session.missingTokenCalls == 1)
        #expect(service.queries.isEmpty)
    }

    @Test func filterAndSearchBuildTheQuery() async {
        service.setPages([.success(CatalogFixtures.page(1...1))])
        let model = model()
        model.select(.blocked)
        model.searchText = "  fluke  "
        model.submitSearch()

        await model.loadIfNeeded()

        #expect(service.queries.last == AssetQuery(search: "fluke", readiness: .blocked))
        #expect(model.criteria.isFiltered)
    }

    @Test func emptySearchIsNeverSent() async {
        service.setPages([.success(CatalogFixtures.page(1...1))])
        let model = model()
        model.searchText = "   "
        model.submitSearch()
        #expect(model.appliedSearch == nil)

        model.searchText = "MM"
        model.submitSearch()
        model.searchText = ""
        model.searchTextChanged()
        #expect(model.appliedSearch == nil)

        await model.loadIfNeeded()
        #expect(service.queries.allSatisfy { $0.search == nil })
    }

    @Test func searchFieldIsCappedAtTheContractLimit() {
        let model = model()
        model.searchText = String(repeating: "x", count: 130)
        model.searchTextChanged()
        #expect(model.searchText.count == 100)
    }

    @Test func clearingCriteriaShowsEverythingAgain() async {
        service.setPages([.success(CatalogFixtures.empty), .success(CatalogFixtures.page(1...2))])
        let model = model()
        model.select(.ready)
        await model.loadIfNeeded()
        guard case let .content(empty) = model.display else { Issue.record("\(model.display)"); return }
        #expect(empty.items.isEmpty)
        #expect(empty.criteria.isFiltered)

        model.clearCriteria()
        #expect(model.display == .loading)
        await model.loadIfNeeded()

        #expect(service.queries.last == AssetQuery())
        guard case let .content(all) = model.display else { Issue.record("\(model.display)"); return }
        #expect(all.items.count == 2)
    }

    @Test func aFailureForOtherCriteriaDoesNotReplaceTheirList() async {
        service.setPages([.success(CatalogFixtures.page(1...2)), .failure(.unreachable(.timedOut))])
        let model = model()
        await model.loadIfNeeded()
        model.select(.ready)

        await model.loadIfNeeded()

        #expect(model.display == .failed(.unreachable))
        model.select(.all)
        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.items.count == 2)
    }

    @Test func loadsTheNextPageAndDropsDuplicates() async {
        service.setPages([
            .success(CatalogFixtures.page(1...20, page: 0, totalPages: 2)),
            .success(CatalogFixtures.page(20...25, page: 1, totalPages: 2)),
        ])
        let model = model()
        await model.loadIfNeeded()
        await model.loadMore()

        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.items.count == 25)
        #expect(Set(snapshot.items.map(\.id)).count == 25)
        #expect(snapshot.nextPage == nil)
        #expect(service.queries.map(\.page) == [0, 1])
        #expect(service.queries.allSatisfy { $0.size == 20 })

        await model.loadMore()
        #expect(service.queries.count == 2)
    }

    @Test func doesNotLoadMorePagesOnAStaleList() async {
        service.setPages([
            .success(CatalogFixtures.page(1...20, page: 0, totalPages: 2)),
            .failure(.unreachable(.notConnectedToInternet)),
        ])
        let model = model()
        await model.loadIfNeeded()
        await model.reload()
        await model.loadMore()
        #expect(service.queries.count == 2)
    }

    @Test func nextPageFailureKeepsTheList() async {
        service.setPages([
            .success(CatalogFixtures.page(1...20, page: 0, totalPages: 2)),
            .failure(.unreachable(.timedOut)),
        ])
        let model = model()
        await model.loadIfNeeded()
        await model.loadMore()

        #expect(model.loadMoreFailure == .unreachable)
        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.items.count == 20)
        #expect(!snapshot.isStale)
    }

    @Test(.timeLimit(.minutes(1)))
    func ignoresADuplicateRefreshWhileOneIsInFlight() async {
        let gate = Gate()
        service.gate = gate
        service.setPages([.success(CatalogFixtures.page(1...1))])
        let model = model()

        let first = Task { await model.reload() }
        while service.queries.isEmpty { await Task.yield() }
        await model.reload()
        #expect(model.isLoading)
        await gate.open()
        await first.value

        #expect(service.queries.count == 1)
        #expect(!model.isLoading)
    }

    @Test(.timeLimit(.minutes(1)))
    func dropsAnAnswerSupersededByNewCriteria() async {
        let gate = Gate()
        service.gate = gate
        service.setPages([.success(CatalogFixtures.page(1...3)), .success(CatalogFixtures.page(1...1))])
        let model = model()

        let first = Task { await model.reload() }
        while service.queries.isEmpty { await Task.yield() }
        model.select(.ready)
        let second = Task { await model.reload() }
        while service.queries.count < 2 { await Task.yield() }
        await gate.open()
        await first.value
        await second.value

        guard case let .content(snapshot) = model.display else { Issue.record("\(model.display)"); return }
        #expect(snapshot.criteria.readiness == .ready)
        #expect(snapshot.items.count == 1)
    }
}

@MainActor
struct AssetSheetViewModelTests {
    let service = ScriptedCatalogService()
    let session = StubSessionAccess()
    let clock = TestClock()

    private func model(initial: AssetSheetViewModel.Content? = nil) -> AssetSheetViewModel {
        AssetSheetViewModel(assetId: CatalogFixtures.id(2), initial: initial, service: service, session: session,
                            now: { [clock] in clock.now })
    }

    private var initial: AssetSheetViewModel.Content {
        AssetSheetViewModel.Content(asset: CatalogFixtures.asset(2), receivedAt: Date(timeIntervalSince1970: 1_700_000_000))
    }

    @Test func opensWithTheListItemThenReadsTheAssetAgain() async {
        let updated = CatalogFixtures.asset(2, result: "BLOCKED", reasons: ["DAMAGED"])
        service.setAsset(.success(updated))
        let model = model(initial: initial)
        #expect(model.display == .content(initial))

        await model.load()

        #expect(model.display == .content(.init(asset: updated, receivedAt: clock.now)))
        #expect(service.assetCalls == 1)
    }

    @Test(arguments: ["ASSET_NOT_FOUND", "RESOURCE_NOT_FOUND"])
    func notFoundReplacesTheSheet(_ code: String) async {
        let problem = APIProblem(status: 404, code: code, title: "t", detail: "d", traceId: nil)
        service.setAsset(.failure(.http(status: 404, problem: problem)))
        let model = model(initial: initial)

        await model.load()
        await model.load()

        #expect(model.display == .notFound)
        #expect(service.assetCalls == 1)
    }

    @Test func offlineKeepsTheLastSheetAsLastKnown() async {
        service.setAsset(.failure(.unreachable(.notConnectedToInternet)))
        let model = model(initial: initial)

        await model.load()

        guard case let .content(content) = model.display else { Issue.record("\(model.display)"); return }
        #expect(content.isStale)
        #expect(content.receivedAt == initial.receivedAt)

        service.setAsset(.success(CatalogFixtures.asset(2)))
        await model.load()
        guard case let .content(fresh) = model.display else { Issue.record("\(model.display)"); return }
        #expect(!fresh.isStale)
    }

    @Test func failureWithoutContentOffersRetry() async {
        service.setAsset(.failure(.http(status: 500, problem: nil)))
        let model = model()

        await model.load()

        #expect(model.display == .failed(.service(traceId: nil)))
    }

    @Test func unauthorizedEndsTheSession() async {
        service.setAsset(.failure(.http(status: 401, problem: nil)))
        let model = model(initial: initial)

        await model.load()

        #expect(session.unauthorizedCodes == [nil])
    }

    @Test func missingTokenEndsTheSessionWithoutARequest() async {
        session.token = nil
        let model = model()
        await model.load()
        #expect(session.missingTokenCalls == 1)
        #expect(service.assetCalls == 0)
    }
}
