import Foundation
import Testing
@testable import AegisMobile

/// Reservation and « Mon activité » against the real Aegis Control (doc 09
/// §14.1, §14.2, §15.3). Live recipe only. On `dev` today no presence is
/// confirmed (PHY-02) and `GET /me/loan` has no controller: a creation is
/// refused and the loan read fails 404 RESOURCE_NOT_FOUND. These tests never
/// leave a reservation behind.
@MainActor
struct LiveReservationIntegrationTests {
    private static func signIn() async throws -> (APIClient, String) {
        let client = APIClient(configuration: try APIConfiguration(string: LiveAuthIntegrationTests.address))
        let login = try await client.login(email: LiveAuthIntegrationTests.technicianEmail,
                                           password: try #require(LiveAuthIntegrationTests.technicianPassword))
        return (client, login.accessToken)
    }

    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func technicianReadsTheActivity() async throws {
        let (client, token) = try await Self.signIn()

        // No reservation is "404 ACTIVE_RESERVATION_NOT_FOUND", read as nil.
        _ = try await client.currentReservation(bearer: token)
        do {
            _ = try await client.currentLoan(bearer: token)
        } catch let .http(status, problem, _) {
            // The route is not served yet: an error, never "no loan".
            #expect(status == 404)
            #expect(problem?.code == "RESOURCE_NOT_FOUND")
        }
    }

    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(1)))
    func aCreationIsRefusedAsARefusal() async throws {
        let (client, token) = try await Self.signIn()
        #expect(try await client.currentReservation(bearer: token) == nil, "the technician must start without a reservation")
        let asset = try #require(try await client.assets(AssetQuery(), bearer: token).items.first)
        let until = ReservationSheetViewModel.choices(after: .now, until: nil, zone: AegisTime.laboratoryZone).first
            ?? .now + 3600

        do {
            let created = try await client.createReservation(assetId: asset.id, reservedUntil: until,
                                                             key: IdempotencyKey(), bearer: token)
            Issue.record("Reservation \(created.id) was created; cancel it (RES-02) and update this test")
        } catch {
            // Accepted by validation, then refused by a rule: not ready
            // (UNKNOWN_PHYSICAL_STATE until PHY-02) or outside the hours,
            // depending on when the recipe runs.
            guard case let .refused(refusal) = ReservationProblem(error, mutation: .create) else {
                Issue.record("Expected a refusal, got \(error)")
                return
            }
            let expected: Bool
            switch refusal {
            case .notReady, .lockerClosed, .endAfterClosing, .accessDenied: expected = true
            default: expected = false
            }
            #expect(expected, "unexpected refusal \(refusal)")
        }
        #expect(try await client.currentReservation(bearer: token) == nil)
    }
}
