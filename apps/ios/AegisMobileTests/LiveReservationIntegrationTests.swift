import Foundation
import Testing
@testable import AegisMobile

/// Reservation and « Mon activité » against the real Aegis Control (doc 09
/// §14.1, §14.2, §14.4, §15.3). Live recipe only. Two servers are expected:
/// - `dev` today: no presence is confirmed (PHY-02) and `GET /me/loan` has no
///   controller, so a creation is refused and the loan read fails 404;
/// - an integration API with the reservation lifecycle (#114) and PHY-02:
///   a ready asset is reserved, read, cancelled, or expired by the server.
/// These tests never leave a reservation behind.
@MainActor
struct LiveReservationIntegrationTests {
    private static var session: Task<(APIClient, String), any Error>?

    /// One sign-in shared by these tests. The server accepts five sign-ins
    /// per minute per account (doc 09 §23.4) and the live recipe signs in more
    /// often than that, so a 429 is waited out for its Retry-After, once, as
    /// the app asks the technician to do.
    private static func signIn() async throws -> (APIClient, String) {
        if let session { return try await session.value }
        let task = Task { @MainActor in
            let client = APIClient(configuration: try APIConfiguration(string: LiveAuthIntegrationTests.address))
            return (client, try await login(client, password: try #require(LiveAuthIntegrationTests.technicianPassword)))
        }
        session = task
        return try await task.value
    }

    private static func login(_ client: APIClient, password: String) async throws -> String {
        let retryAfter: Duration
        do throws(APIError) {
            return try await client.login(email: LiveAuthIntegrationTests.technicianEmail, password: password).accessToken
        } catch {
            guard case let .http(429, _, wait?) = error else { throw error }
            retryAfter = wait
        }
        try await Task.sleep(for: retryAfter + .seconds(1))
        return try await client.login(email: LiveAuthIntegrationTests.technicianEmail, password: password).accessToken
    }

    /// The first ready asset, or the first asset when none is ready.
    private static func candidate(_ client: APIClient, _ token: String) async throws -> TechnicianAsset {
        var ready = AssetQuery()
        ready.readiness = .ready
        if let asset = try await client.assets(ready, bearer: token).items.first { return asset }
        return try #require(try await client.assets(AssetQuery(), bearer: token).items.first)
    }

    /// A refusal by a business rule, after validation accepted the request.
    private static func expectRuleRefusal(_ error: APIError) {
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

    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(2)))
    func technicianReadsTheActivity() async throws {
        let (client, token) = try await Self.signIn()

        // No reservation is "404 ACTIVE_RESERVATION_NOT_FOUND", read as nil.
        _ = try await client.currentReservation(bearer: token)
        do {
            _ = try await client.currentLoan(bearer: token)
        } catch let .http(status, problem, _) {
            // Until the loan controller exists: an error, never "no loan".
            #expect(status == 404)
            #expect(problem?.code == "RESOURCE_NOT_FOUND")
        }
    }

    /// Created → read in « Mon activité » with CANCEL → cancelled with the
    /// same key semantics as the app; or refused by a rule on `dev`.
    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(2)))
    func aReservationIsCreatedReadAndCancelledOrRefused() async throws {
        let (client, token) = try await Self.signIn()
        #expect(try await client.currentReservation(bearer: token) == nil, "the technician must start without a reservation")
        let asset = try await Self.candidate(client, token)
        let until = ReservationSheetViewModel.choices(after: .now, until: nil, zone: AegisTime.laboratoryZone).first
            ?? .now + 3600

        let created: ReservationView
        do {
            created = try await client.createReservation(assetId: asset.id, reservedUntil: until,
                                                         key: IdempotencyKey(), bearer: token)
        } catch {
            Self.expectRuleRefusal(error)
            #expect(try await client.currentReservation(bearer: token) == nil)
            return
        }
        let current = try #require(try await client.currentReservation(bearer: token))
        #expect(current.id == created.id)
        #expect(current.asset.id == asset.id)
        #expect(current.availableActions.contains(.known(.cancel)))

        let key = IdempotencyKey()
        let cancelled = try await client.cancelReservation(id: created.id, key: key, bearer: token)
        #expect(cancelled.status == .known(.cancelled))
        #expect(!cancelled.availableActions.contains(.known(.cancel)))
        // The same intent replays (§20): the same key gives the same answer.
        #expect(try await client.cancelReservation(id: created.id, key: key, bearer: token).id == created.id)
        #expect(try await client.currentReservation(bearer: token) == nil)
    }

    /// Expiry is the server's: the app never ends a reservation on its own
    /// clock. A short reservation disappears from `GET /me/reservation`
    /// once the server's sweep (every 15 s) has run.
    @Test(.enabled(if: LiveAuthIntegrationTests.configured, "live API variables are not set"), .timeLimit(.minutes(3)))
    func anExpiredReservationIsEndedByTheServer() async throws {
        let (client, token) = try await Self.signIn()
        #expect(try await client.currentReservation(bearer: token) == nil, "the technician must start without a reservation")
        let asset = try await Self.candidate(client, token)
        let until = Date.now + 60

        let created: ReservationView
        do {
            created = try await client.createReservation(assetId: asset.id, reservedUntil: until,
                                                         key: IdempotencyKey(), bearer: token)
        } catch {
            Self.expectRuleRefusal(error)
            return
        }
        #expect(try await client.currentReservation(bearer: token)?.id == created.id)

        try await Task.sleep(until: .now + .seconds(max(0, created.reservedUntil.timeIntervalSinceNow)),
                             clock: .continuous)
        var remaining: ReservationView? = created
        for _ in 0..<12 where remaining != nil {
            try await Task.sleep(for: .seconds(5))
            remaining = try await client.currentReservation(bearer: token)
        }
        #expect(remaining == nil, "the server did not expire the reservation within 60 s of its end")
    }
}
