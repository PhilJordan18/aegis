import Foundation
import Observation

/// One paged history list (doc 09 §29), read from page 0. Pages are offsets:
/// a new activity between two reads can shift them, so an item already shown
/// is not repeated, and a refresh always starts again from page 0.
@MainActor
@Observable
final class HistoryList<Item: Identifiable & Equatable & Decodable & Sendable> where Item.ID == UUID {
    typealias Fetch = @Sendable (HistoryQuery, String) async throws(APIError) -> HistoryPage<Item>

    enum Display: Equatable {
        case loading
        case failed(CatalogFailure)
        /// `stale` is set when re-reading page 0 failed: the items are the
        /// last list received, not a current one.
        case content(items: [Item], receivedAt: Date, stale: CatalogFailure?)
    }

    private(set) var items: [Item] = []
    private(set) var receivedAt: Date?
    private(set) var nextPage: Int?
    private(set) var failure: CatalogFailure?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreFailure: CatalogFailure?

    private let fetch: Fetch
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date
    /// Bumped by each page-0 read, so a page of an older list is dropped.
    private var generation = 0

    init(fetch: @escaping Fetch, session: any SessionAccess, now: @escaping @Sendable () -> Date = Date.init) {
        self.fetch = fetch
        self.session = session
        self.now = now
    }

    var display: Display {
        if let receivedAt { return .content(items: items, receivedAt: receivedAt, stale: failure) }
        if !isLoading, let failure { return .failed(failure) }
        return .loading
    }

    /// Reads page 0 once, when the list is first shown.
    func loadIfNeeded() async {
        guard receivedAt == nil, failure == nil else { return }
        await reload()
    }

    /// Pull to refresh and Try again. A call while page 0 is being read
    /// sends nothing more.
    func reload() async {
        if isLoading { return }
        generation += 1
        let request = generation
        isLoading = true
        loadMoreFailure = nil
        defer { if request == generation { isLoading = false } }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let page = try await fetch(HistoryQuery(), token)
            guard request == generation else { return }
            items = Self.unique(page.items)
            nextPage = Self.next(after: page)
            receivedAt = now()
            failure = nil
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            guard request == generation else { return }
            failure = CatalogFailure(error)
        }
    }

    /// Reads the next page of a current list. Not offered on a stale list,
    /// where pages read at different moments would be mixed.
    func loadMore() async {
        guard failure == nil, receivedAt != nil, let page = nextPage, !isLoading, !isLoadingMore else { return }
        let request = generation
        isLoadingMore = true
        loadMoreFailure = nil
        defer { isLoadingMore = false }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let result = try await fetch(HistoryQuery(page: page), token)
            guard request == generation else { return }
            let known = Set(items.map(\.id))
            items += Self.unique(result.items).filter { !known.contains($0.id) }
            nextPage = Self.next(after: result)
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            guard request == generation else { return }
            loadMoreFailure = CatalogFailure(error)
        }
    }

    func item(_ id: UUID) -> Item? { items.first { $0.id == id } }

    /// An empty page ends the list even when `totalPages` says more: the
    /// items it counted have shifted to earlier pages.
    private static func next(after page: HistoryPage<Item>) -> Int? {
        page.page + 1 < page.totalPages && !page.items.isEmpty ? page.page + 1 : nil
    }

    private static func unique(_ items: [Item]) -> [Item] {
        var seen = Set<UUID>()
        return items.filter { seen.insert($0.id).inserted }
    }
}

/// « Historique », reached from Mon activité: the technician's reservations
/// and loans, each list read when first shown.
@MainActor
@Observable
final class HistoryViewModel {
    enum Kind: String, CaseIterable, Hashable {
        case reservations
        case loans
    }

    var kind = Kind.reservations
    let reservations: HistoryList<ReservationView>
    let loans: HistoryList<LoanView>

    init(service: any HistoryService, session: any SessionAccess, now: @escaping @Sendable () -> Date = Date.init) {
        reservations = HistoryList(fetch: { (query: HistoryQuery, token: String) async throws(APIError) in
            try await service.reservationHistory(query, bearer: token)
        }, session: session, now: now)
        loans = HistoryList(fetch: { (query: HistoryQuery, token: String) async throws(APIError) in
            try await service.loanHistory(query, bearer: token)
        }, session: session, now: now)
    }

    func loadIfNeeded() async {
        switch kind {
        case .reservations: await reservations.loadIfNeeded()
        case .loans: await loans.loadIfNeeded()
        }
    }

    func reload() async {
        switch kind {
        case .reservations: await reservations.reload()
        case .loans: await loans.reload()
        }
    }
}
