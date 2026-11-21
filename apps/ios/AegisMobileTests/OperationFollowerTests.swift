import Foundation
import Testing
@testable import AegisMobile

/// Following an operation as accepted in ADR-006 and doc 09 §15.4. Pauses are
/// recorded, never waited for: a test never depends on the wall clock.
@MainActor
struct OperationFollowerTests {
    let session = StubSessionAccess()
    let clock = TestClock()

    private func follower(_ service: ScriptedOperationService,
                          sleeper: RecordingSleeper = RecordingSleeper()) -> OperationFollower {
        OperationFollower(service: service, session: session, now: { [clock] in clock.now },
                          sleep: { [sleeper] in try await sleeper.sleep($0) })
    }

    private static let unreachable = APIError.unreachable(.notConnectedToInternet)

    @Test func followsAPreparedOperationUntilItIsConfirmed() async {
        let service = ScriptedOperationService(reads: [
            OperationFixtures.read(OperationFixtures.awaiting),
            OperationFixtures.read(OperationFixtures.authorized),
            OperationFixtures.read(OperationFixtures.commandSent),
            OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        #expect(follower.operation == OperationFixtures.awaiting)
        #expect(follower.isFollowing)
        await follower.waitUntilIdle()

        #expect(follower.operation?.isConfirmed == true)
        #expect(!follower.isFollowing)
        #expect(follower.interruption == nil)
        #expect(service.reads == 4)
        #expect(service.tokens.allSatisfy { $0 == "technician-token" })
        // The answer of the preparation already carried `Retry-After: 1`.
        #expect(sleeper.durations == Array(repeating: .seconds(1), count: 4))
    }

    @Test func aTerminalOperationIsNeverRead() async {
        let service = ScriptedOperationService()
        let follower = follower(service)

        follower.follow(OperationFixtures.confirmed)
        await follower.waitUntilIdle()

        #expect(service.reads == 0)
        #expect(!follower.isFollowing)
        #expect(follower.operation?.isConfirmed == true)
    }

    /// After a relaunch the operation is known by `currentOperationId` only.
    @Test func anOperationKnownByItsIdentifierIsReadAtOnce() async {
        let service = ScriptedOperationService(reads: [OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil)])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(id: OperationFixtures.id)
        #expect(follower.operation == nil)
        await follower.waitUntilIdle()

        #expect(service.reads == 1)
        #expect(sleeper.durations.isEmpty)
        #expect(follower.operation?.isConfirmed == true)
        #expect(follower.receivedAt == clock.now)
    }

    @Test func aLongerRetryAfterSlowsTheNextRead() async {
        let service = ScriptedOperationService(reads: [
            OperationFixtures.read(OperationFixtures.awaiting, retryAfter: .seconds(5)),
            OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        await follower.waitUntilIdle()

        #expect(sleeper.durations == [.seconds(1), .seconds(5)])
    }

    @Test func failuresSlowTheReadsDownThenASuccessRestoresThePace() async {
        let failures: [Result<Received<LockerOperationView>, APIError>] =
            Array(repeating: .failure(Self.unreachable), count: 5)
        let service = ScriptedOperationService(reads: failures + [
            OperationFixtures.read(OperationFixtures.authorized),
            OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        await follower.waitUntilIdle()

        #expect(sleeper.durations == [1, 2, 4, 8, 15, 15, 1].map { Duration.seconds($0) })
        #expect(follower.interruption == nil)
        #expect(follower.operation?.isConfirmed == true)
    }

    @Test func aFailingReadIsReportedWhileTheLastOperationStaysShown() async {
        let service = ScriptedOperationService(reads: [.failure(Self.unreachable)])
        let sleeper = RecordingSleeper(immediate: 1)
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        #expect(await waitUntil { sleeper.durations.count == 2 })

        #expect(follower.interruption == .readFailing(.unreachable))
        #expect(follower.operation == OperationFixtures.awaiting)
        #expect(follower.isFollowing)
        follower.stop()
        await follower.waitUntilIdle()
    }

    @Test func aServerDelayLongerThanTheBackoffIsHonoured() async {
        let busy = APIError.http(status: 503, problem: SessionFixtures.problem(503, "SERVICE_UNAVAILABLE"),
                                 retryAfter: .seconds(30))
        let service = ScriptedOperationService(reads: [
            .failure(busy), OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        await follower.waitUntilIdle()

        #expect(sleeper.durations == [.seconds(1), .seconds(30)])
    }

    @Test func theBackoffDoublesUpToTheSlowestPace() {
        #expect((1...6).map { OperationFollower.backoff(after: $0, retryAfter: nil) }
                == [2, 4, 8, 15, 15, 15].map { Duration.seconds($0) })
        #expect(OperationFollower.backoff(after: 1, retryAfter: .seconds(60)) == .seconds(60))
        #expect(OperationFollower.backoff(after: 3, retryAfter: .seconds(1)) == .seconds(8))
    }

    /// A 401 stops following and ends the session; the operation is not
    /// cancelled and stays shown as last received.
    @Test func anExpiredSessionStopsFollowingWithoutForgettingTheOperation() async {
        let service = ScriptedOperationService(reads: [
            .failure(.http(status: 401, problem: SessionFixtures.problem(401, "AUTH_TOKEN_EXPIRED"))),
        ])
        let follower = follower(service)

        follower.follow(OperationFixtures.authorized)
        await follower.waitUntilIdle()

        #expect(follower.interruption == .sessionEnded)
        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(follower.operation == OperationFixtures.authorized)
        #expect(!follower.isFollowing)
        #expect(service.reads == 1)

        follower.suspend()
        follower.resume()
        await follower.waitUntilIdle()
        #expect(service.reads == 1)
    }

    @Test func withoutATokenNothingIsRead() async {
        session.token = nil
        let service = ScriptedOperationService()
        let follower = follower(service)

        follower.follow(id: OperationFixtures.id)
        await follower.waitUntilIdle()

        #expect(service.reads == 0)
        #expect(session.missingTokenCalls == 1)
        #expect(follower.interruption == .sessionEnded)
    }

    /// §15.4: a 404 may mean the journey ended; the owner reads the activity
    /// again and nothing is recreated.
    @Test func aMissingOperationStopsFollowing() async {
        let service = ScriptedOperationService(reads: [
            .failure(.http(status: 404, problem: SessionFixtures.problem(404, "RESOURCE_NOT_FOUND"))),
        ])
        let follower = follower(service)

        follower.follow(id: OperationFixtures.id)
        await follower.waitUntilIdle()

        #expect(follower.interruption == .notFound)
        #expect(!follower.isFollowing)
        #expect(service.reads == 1)
    }

    @Test func anUnknownStatusIsFollowedUntilTheServerEndsIt() async {
        let service = ScriptedOperationService(reads: [
            OperationFixtures.read(OperationFixtures.view(status: "QUARANTINED", requiredAction: "WAIT")),
            OperationFixtures.read(OperationFixtures.view(status: "QUARANTINED", requiredAction: "NONE",
                                                          terminalAt: "2026-09-16T14:33:00Z"), retryAfter: nil),
        ])
        let follower = follower(service)

        follower.follow(OperationFixtures.authorized)
        await follower.waitUntilIdle()

        #expect(service.reads == 2)
        #expect(follower.operation?.isTerminal == true)
        #expect(follower.operation?.isConfirmed == false)
    }

    @Test func aReadOfAnotherOperationIsNeverShown() async {
        let other = OperationFixtures.view(id: OperationFixtures.otherOperationId, status: "CONFIRMED",
                                           requiredAction: "NONE", terminalAt: "2026-09-16T14:33:00Z")
        let service = ScriptedOperationService(reads: [
            OperationFixtures.read(other), OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let sleeper = RecordingSleeper()
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        await follower.waitUntilIdle()

        #expect(follower.operation == OperationFixtures.confirmed)
        #expect(sleeper.durations == [.seconds(1), .seconds(2)])
    }

    /// ADR-006: nothing is read in the background; the return to the
    /// foreground reads at once.
    @Test func theBackgroundSuspendsReadsAndTheForegroundReadsAtOnce() async {
        let service = ScriptedOperationService(reads: [OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil)])
        let sleeper = RecordingSleeper(immediate: 0)
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        #expect(await waitUntil { sleeper.durations.count == 1 })
        follower.suspend()
        await follower.waitUntilIdle()

        #expect(follower.isSuspended)
        #expect(!follower.isFollowing)
        #expect(service.reads == 0)

        follower.resume()
        await follower.waitUntilIdle()

        #expect(service.reads == 1)
        #expect(sleeper.durations.count == 1)
        #expect(follower.operation?.isConfirmed == true)
    }

    @Test func neverTwoReadsInFlight() async {
        let service = ScriptedOperationService(reads: [
            OperationFixtures.read(OperationFixtures.awaiting),
            OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil),
        ])
        let gate = Gate()
        service.readGate = gate
        let follower = follower(service)

        follower.follow(id: OperationFixtures.id)
        #expect(await waitUntil { service.reads == 1 })
        // Background then foreground while the first read is still pending.
        follower.suspend()
        follower.resume()
        _ = await waitUntil({ service.reads > 1 }, maximumYields: 200)
        #expect(service.reads == 1)

        await gate.open()
        await follower.waitUntilIdle()

        #expect(service.reads == 2)
        #expect(service.maxInFlight == 1)
        #expect(follower.operation?.isConfirmed == true)
    }

    /// A read that started before the authorization answer must not bring
    /// the screen back to « scan the QR ».
    @Test func aLateOlderReadNeverReplacesANewerView() async {
        let service = ScriptedOperationService(reads: [OperationFixtures.read(OperationFixtures.awaiting)])
        let gate = Gate()
        service.readGate = gate
        let sleeper = RecordingSleeper(immediate: 1)
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        #expect(await waitUntil { service.reads == 1 })
        follower.follow(OperationFixtures.authorized)
        await gate.open()
        #expect(await waitUntil { sleeper.durations.count == 2 })

        #expect(follower.operation == OperationFixtures.authorized)
        #expect(service.reads == 1)
        follower.stop()
        await follower.waitUntilIdle()
    }

    @Test func stoppingNeitherReadsNorCancelsAnything() async {
        let service = ScriptedOperationService(reads: [OperationFixtures.read(OperationFixtures.authorized)])
        let sleeper = RecordingSleeper(immediate: 0)
        let follower = follower(service, sleeper: sleeper)

        follower.follow(OperationFixtures.awaiting)
        follower.stop()
        await follower.waitUntilIdle()

        #expect(service.reads == 0)
        #expect(service.authorizations.isEmpty)
        #expect(!follower.isFollowing)
    }
}
