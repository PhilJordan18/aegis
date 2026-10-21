import Foundation
import Testing
@testable import AegisMobile

/// Calls the real Aegis Control instance. Disabled unless the runner receives
/// the address, so the standalone suite never depends on a running backend.
/// `scripts/ios-test.sh live` supplies it and fails if this test is skipped.
struct LiveAPIIntegrationTests {
    static let address = ProcessInfo.processInfo.environment["AEGIS_LIVE_API_BASE_URL"]

    @Test(.enabled(if: address != nil, "AEGIS_LIVE_API_BASE_URL is not set"), .timeLimit(.minutes(1)))
    func realHealthMatchesTheContract() async throws {
        let client = APIClient(configuration: try APIConfiguration(string: Self.address))

        let health = try await client.fetchHealth()

        #expect(health.status == .up)
        #expect(health.service == "aegis-control")
        #expect(!health.version.isEmpty)
        #expect(abs(health.timestamp.timeIntervalSinceNow) < 300)
    }
}
