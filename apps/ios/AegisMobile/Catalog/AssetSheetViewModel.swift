import Foundation
import Observation

/// Asset sheet (`GET /assets/{assetId}`). Opens with the catalogue item it
/// was chosen from, then reads the asset again.
@MainActor
@Observable
final class AssetSheetViewModel {
    struct Content: Equatable, Sendable {
        let asset: TechnicianAsset
        let receivedAt: Date
        /// Set when the last read failed: the asset is the last known state.
        var refreshFailure: CatalogFailure?

        var isStale: Bool { refreshFailure != nil }
    }

    enum Display: Equatable {
        case loading
        case failed(CatalogFailure)
        /// 404: the asset no longer exists or is no longer visible.
        case notFound
        case content(Content)
    }

    let assetId: UUID
    private(set) var content: Content?
    private(set) var failure: CatalogFailure?
    private(set) var isNotFound = false
    private(set) var isLoading = false

    private let service: any AssetCatalogService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date

    init(assetId: UUID, initial: Content?, service: any AssetCatalogService, session: any SessionAccess,
         now: @escaping @Sendable () -> Date = Date.init) {
        self.assetId = assetId
        content = initial
        self.service = service
        self.session = session
        self.now = now
    }

    var display: Display {
        if isNotFound { return .notFound }
        if let content { return .content(content) }
        if !isLoading, let failure { return .failed(failure) }
        return .loading
    }

    /// Reads the asset; a call made while a read is in flight is ignored.
    func load() async {
        guard !isLoading, !isNotFound else { return }
        isLoading = true
        defer { isLoading = false }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let asset = try await service.asset(id: assetId, bearer: token)
            content = Content(asset: asset, receivedAt: now())
            failure = nil
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            session?.handleUnauthorized(code: problem?.code)
        } catch .http(404, _, _) {
            // 09 §11.2 names ASSET_NOT_FOUND; the API also answers
            // RESOURCE_NOT_FOUND (§21). Both mean the asset is gone for us.
            isNotFound = true
        } catch {
            let failure = CatalogFailure(error)
            if content != nil {
                content?.refreshFailure = failure
            } else {
                self.failure = failure
            }
        }
    }
}
