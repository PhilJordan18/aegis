import Foundation
import Testing
@testable import AegisMobile

/// Signs in against the real Aegis Control with the local demo accounts.
/// Disabled unless the runner receives the address and both demo passwords;
/// `scripts/ios-test.sh live` supplies them and fails if these tests are skipped.
struct LiveAuthIntegrationTests {
    static let environment = ProcessInfo.processInfo.environment
    static let address = environment["AEGIS_LIVE_API_BASE_URL"]
    static let technicianEmail = environment["AEGIS_LIVE_TECHNICIAN_EMAIL"] ?? "technician@aegis.demo"
    static let technicianPassword = environment["AEGIS_LIVE_TECHNICIAN_PASSWORD"]
    static let adminEmail = environment["AEGIS_LIVE_ADMIN_EMAIL"] ?? "admin@aegis.demo"
    static let adminPassword = environment["AEGIS_LIVE_ADMIN_PASSWORD"]
    static let configured = address != nil && technicianPassword != nil && adminPassword != nil

    func client() throws -> APIClient {
        APIClient(configuration: try APIConfiguration(string: Self.address))
    }

    @Test(.enabled(if: configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func technicianSignsInAndReadsTheirProfile() async throws {
        let client = try client()

        let response = try await client.login(email: Self.technicianEmail, password: try #require(Self.technicianPassword))
        let profile = try await client.currentProfile(bearer: response.accessToken)

        #expect(response.tokenType == "Bearer")
        #expect(response.user.role == .technician)
        #expect(profile == response.user)
        // Doc 09 §4.1: 60-minute token, no refresh token.
        #expect(abs(response.expiresAt.timeIntervalSinceNow - 3600) < 120)
    }

    @Test(.enabled(if: configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func wrongPasswordIsRefusedWithTheContractCode() async throws {
        do {
            _ = try await client().login(email: Self.technicianEmail, password: "not-the-demo-password")
            Issue.record("Expected AUTH_INVALID_CREDENTIALS")
        } catch let error as APIError {
            guard case let .http(401, problem?, _) = error else {
                Issue.record("Unexpected \(error)")
                return
            }
            #expect(problem.code == "AUTH_INVALID_CREDENTIALS")
        }
    }

    @Test(.enabled(if: configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func unknownTokenIsRefused() async throws {
        do {
            _ = try await client().currentProfile(bearer: "not-a-token")
            Issue.record("Expected AUTH_TOKEN_INVALID")
        } catch let error as APIError {
            guard case let .http(401, problem?, _) = error else {
                Issue.record("Unexpected \(error)")
                return
            }
            #expect(problem.code == "AUTH_TOKEN_INVALID")
        }
    }

    @Test(.enabled(if: configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func administratorIsIdentifiedAsAdministrator() async throws {
        let response = try await client().login(email: Self.adminEmail, password: try #require(Self.adminPassword))

        #expect(response.user.role == .admin)
    }
}
