import Foundation
import Testing
@testable import AegisMobile

/// Reads the technician catalogue (`GET /assets`, doc 09 §11.1) from the real
/// Aegis Control. Live recipe only; it needs the RDY API, which `dev` does
/// not provide yet (the route is declared without a handler there).
struct LiveCatalogIntegrationTests {
    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func technicianReadsTheFirstCataloguePage() async throws {
        let client = APIClient(configuration: try APIConfiguration(string: LiveAuthIntegrationTests.address))
        let login = try await client.login(email: LiveAuthIntegrationTests.technicianEmail,
                                           password: try #require(LiveAuthIntegrationTests.technicianPassword))

        let page = try await client.assets(AssetQuery(), bearer: login.accessToken)

        #expect(page.page == 0)
        #expect(page.size == AssetQuery.pageSize)
        #expect(page.items.count <= AssetQuery.pageSize)
        #expect(page.totalItems >= page.items.count)
        for asset in page.items {
            // Evaluated for the signed-in technician (§11.1), READY without reasons (§8.1).
            #expect(asset.readiness.evaluatedForUserId.uuidString.lowercased() == login.user.id.lowercased())
            #expect(asset.readiness.assetId == asset.id)
            if asset.readiness.result == .known(.ready) { #expect(asset.readiness.reasons.isEmpty) }
        }
        if let first = page.items.first {
            #expect(try await client.asset(id: first.id, bearer: login.accessToken).id == first.id)
        }
    }
}
