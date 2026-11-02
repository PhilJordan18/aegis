import Foundation
import Observation

/// Access to the verified session for authenticated reads. `SessionModel`
/// conforms; tests replace it.
@MainActor
protocol SessionAccess: AnyObject {
    /// The stored token while the session is verified, nil otherwise.
    func accessToken() -> String?
    /// A 401 ends the session (#36 flow).
    func handleUnauthorized(code: String?)
    /// No token could be provided: the session ends as expired or invalid.
    func handleMissingToken()
}

/// Why catalogue data could not be read. A 401 is not one: it ends the session.
enum CatalogFailure: Equatable, Sendable {
    /// No HTTP response: offline, refused, timed out.
    case unreachable
    /// 5xx, unexpected status or unreadable body; only a clean trace id is kept.
    case service(traceId: String?)
    /// 403: the server refused the read; the session stays.
    case forbidden

    init(_ error: APIError) {
        switch error {
        case .unreachable, .cancelled:
            self = .unreachable
        case .http(403, _, _):
            self = .forbidden
        case let .http(_, problem, _):
            self = .service(traceId: problem?.traceId.flatMap(SessionModel.displayableTraceId))
        case .invalidResponse:
            self = .service(traceId: nil)
        }
    }
}

/// What the catalogue shows for the current search and filter.
struct CatalogCriteria: Hashable, Sendable {
    var search: String?
    var readiness: ReadinessFilter = .all

    var isFiltered: Bool { search != nil || readiness != .all }
}

/// The last list received for one set of criteria, with its reception time.
struct CatalogSnapshot: Equatable, Sendable {
    let criteria: CatalogCriteria
    var items: [TechnicianAsset]
    var nextPage: Int?
    let receivedAt: Date
    /// Set when re-reading these criteria failed: the items are the last
    /// known state, not a current one.
    var refreshFailure: CatalogFailure?

    var isStale: Bool { refreshFailure != nil }
}

/// Technician catalogue (`GET /assets`). Readiness is displayed as received;
/// nothing here decides an action from it.
@MainActor
@Observable
final class CatalogViewModel {
    enum Display: Equatable {
        case loading
        case failed(CatalogFailure)
        case content(CatalogSnapshot)
    }

    /// Text of the search field; applied on submission, cleared immediately.
    var searchText = ""
    private(set) var appliedSearch: String?
    private(set) var filter = ReadinessFilter.all
    private(set) var snapshot: CatalogSnapshot?
    /// Failure of the current criteria when no list exists for them.
    private(set) var failure: (criteria: CatalogCriteria, failure: CatalogFailure)?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreFailure: CatalogFailure?

    private let service: any AssetCatalogService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date
    /// Bumped by each first-page read, so a superseded answer is dropped.
    private var generation = 0

    init(service: any AssetCatalogService, session: any SessionAccess,
         now: @escaping @Sendable () -> Date = Date.init) {
        self.service = service
        self.session = session
        self.now = now
    }

    var criteria: CatalogCriteria { CatalogCriteria(search: appliedSearch, readiness: filter) }

    var display: Display {
        if let snapshot, snapshot.criteria == criteria { return .content(snapshot) }
        if !isLoading, let failure, failure.criteria == criteria { return .failed(failure.failure) }
        return .loading
    }

    /// Item of the current list, used as the asset sheet's initial content.
    func item(_ id: UUID) -> (asset: TechnicianAsset, snapshot: CatalogSnapshot)? {
        guard let snapshot, let asset = snapshot.items.first(where: { $0.id == id }) else { return nil }
        return (asset, snapshot)
    }

    // MARK: Criteria

    func submitSearch() {
        appliedSearch = AssetQuery.normalizedSearch(searchText)
    }

    /// Keeps the field within the contract limit; an emptied field shows the
    /// whole catalogue again without waiting for a submission.
    func searchTextChanged() {
        let limited = AssetQuery.limited(searchText)
        if limited != searchText { searchText = limited }
        if AssetQuery.normalizedSearch(searchText) == nil { appliedSearch = nil }
    }

    func select(_ filter: ReadinessFilter) {
        self.filter = filter
    }

    func clearCriteria() {
        searchText = ""
        appliedSearch = nil
        filter = .all
    }

    // MARK: Loading

    /// Reads the first page unless a current list exists for the criteria.
    /// Called when the screen appears and whenever the criteria change.
    func loadIfNeeded() async {
        if let snapshot, snapshot.criteria == criteria, !snapshot.isStale { return }
        await reload()
    }

    /// Pull to refresh and Try again: reads the first page again. A call made
    /// while the same read is in flight is ignored.
    func reload() async {
        let criteria = criteria
        if isLoading, inFlight == criteria { return }
        generation += 1
        let request = generation
        inFlight = criteria
        isLoading = true
        loadMoreFailure = nil
        defer {
            if request == generation {
                isLoading = false
                inFlight = nil
            }
        }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let page = try await service.assets(AssetQuery(search: criteria.search, readiness: criteria.readiness),
                                                bearer: token)
            guard request == generation else { return }
            snapshot = CatalogSnapshot(criteria: criteria, items: Self.unique(page.items),
                                       nextPage: Self.next(after: page), receivedAt: now())
            failure = nil
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            guard request == generation else { return }
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            guard request == generation else { return }
            let failure = CatalogFailure(error)
            if var snapshot, snapshot.criteria == criteria {
                // The last list stays visible above which its age is stated.
                snapshot.refreshFailure = failure
                self.snapshot = snapshot
                self.failure = nil
            } else {
                self.failure = (criteria, failure)
            }
        }
    }

    private var inFlight: CatalogCriteria?

    /// Reads the next page of a current list. Not offered on a stale list:
    /// pages read at different moments would be mixed with an old state.
    func loadMore() async {
        guard let snapshot, snapshot.criteria == criteria, !snapshot.isStale,
              let page = snapshot.nextPage, !isLoading, !isLoadingMore else { return }
        let request = generation
        isLoadingMore = true
        loadMoreFailure = nil
        defer { isLoadingMore = false }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let result = try await service.assets(
                AssetQuery(search: snapshot.criteria.search, readiness: snapshot.criteria.readiness, page: page),
                bearer: token)
            guard request == generation, var current = self.snapshot, current.criteria == snapshot.criteria else { return }
            let known = Set(current.items.map(\.id))
            current.items += Self.unique(result.items).filter { !known.contains($0.id) }
            current.nextPage = Self.next(after: result)
            self.snapshot = current
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            guard request == generation else { return }
            loadMoreFailure = CatalogFailure(error)
        }
    }

    private static func next(after page: AssetPage) -> Int? {
        page.page + 1 < page.totalPages && !page.items.isEmpty ? page.page + 1 : nil
    }

    private static func unique(_ items: [TechnicianAsset]) -> [TechnicianAsset] {
        var seen = Set<UUID>()
        return items.filter { seen.insert($0.id).inserted }
    }
}
