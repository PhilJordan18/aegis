import Foundation
import Testing
@testable import AegisMobile

/// The guided operation (handoff `mobile-parcours` §7): it opens the scan
/// sheet only while the server asks for the code, submits what was read, and
/// shows nothing it did not receive. Pauses are recorded, never waited for.
@MainActor
struct GuidedOperationTests {
    let session = StubSessionAccess()
    let clock = TestClock()

    private func guided(_ service: ScriptedOperationService,
                        sleeper: RecordingSleeper = RecordingSleeper(immediate: 0)) -> GuidedOperation {
        GuidedOperation(kind: .checkout, context: GuidedOperation.Context(ActivityDoubles.reservation().asset),
                        service: service, session: session, now: { [clock] in clock.now },
                        sleep: { [sleeper] in try await sleeper.sleep($0) })
    }

    private static func refused(_ status: Int, _ code: String) -> Result<LockerOperationView, APIError> {
        .failure(.http(status: status, problem: SessionFixtures.problem(status, code)))
    }

    @Test func theSheetOpensOnItsOwnOnceTheCodeIsDisplayed() {
        let guided = guided(ScriptedOperationService())
        guided.start(OperationFixtures.view(displayedAt: nil))
        #expect(!guided.isScanPresented)

        guided.start(OperationFixtures.awaiting)
        #expect(guided.isScanPresented)
        #expect(guided.context.compartment == "A1")
    }

    /// Closed by hand, the sheet comes back only on « Scanner le code ».
    @Test func aClosedSheetDoesNotReopenOnItsOwn() {
        let guided = guided(ScriptedOperationService())
        guided.start(OperationFixtures.awaiting)
        guided.isScanPresented = false
        guided.operationChanged()
        #expect(!guided.isScanPresented)

        guided.isScanPresented = true
        #expect(guided.isScanPresented)
    }

    /// 202 from `authorize-local`: the sheet closes and the authorized state
    /// is shown, which is not a success.
    @Test func anAuthorizedCodeClosesTheSheetAndShowsTheServerState() async {
        let service = ScriptedOperationService(authorizations: [.success(OperationFixtures.authorized)])
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)

        await guided.submit(scanned: OperationFixtures.uri())

        #expect(service.authorizations.count == 1)
        #expect(service.authorizations.first?.proof.token == OperationFixtures.token)
        #expect(!guided.isScanPresented)
        #expect(guided.operation == OperationFixtures.authorized)
        #expect(guided.step.phase == 3)
        #expect(guided.step.ending == nil)
    }

    /// A code of another operation is never sent.
    @Test func aCodeOfAnotherOperationIsNotSent() async {
        let service = ScriptedOperationService()
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)

        await guided.submit(scanned: OperationFixtures.uri(operationId: OperationFixtures.otherOperationId))

        #expect(service.authorizations.isEmpty)
        #expect(guided.isScanPresented)
        #expect(guided.submission.outcome != nil)
    }

    /// Expired, invalidated, already used or unknown: the server state moved,
    /// so it is read at once rather than at the next interval.
    @Test(arguments: [(410, "LOCAL_PROOF_EXPIRED"), (409, "LOCAL_PROOF_INVALIDATED"),
                      (409, "LOCAL_PROOF_ALREADY_USED"), (404, "OPERATION_NOT_FOUND")])
    func aRefusalThatEndsTheProofReadsTheOperationAgain(status: Int, code: String) async {
        let expired = OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                             terminalAt: "2026-09-16T14:32:00Z")
        let service = ScriptedOperationService(reads: [OperationFixtures.read(expired, retryAfter: nil)],
                                               authorizations: [Self.refused(status, code)])
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)

        await guided.submit(scanned: OperationFixtures.uri())
        await guided.follower.waitUntilIdle()

        #expect(service.reads == 1)
        #expect(guided.step.ending == .expired)
        #expect(!guided.isScanPresented)
        #expect(!guided.submission.canRetry)
    }

    /// A refused code is dropped: a new reading is needed and nothing is read
    /// again before it.
    @Test func anInvalidCodeAsksForANewScan() async {
        let service = ScriptedOperationService(authorizations: [Self.refused(403, "LOCAL_PROOF_INVALID")])
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)

        await guided.submit(scanned: OperationFixtures.uri())

        #expect(guided.submission.awaitsNewScan)
        #expect(!guided.submission.canRetry)
        #expect(guided.isScanPresented)
        #expect(service.reads == 0)
        #expect(ScanSheet.message(guided.submission.outcome!)
                == String(localized: "Code refusé. Scannez à nouveau l’écran du casier."))
    }

    /// « Fermer » hides the tracking: following stops, the secret is dropped,
    /// and nothing more is sent to the server.
    @Test func hidingStopsFollowingAndForgetsTheCode() async {
        let service = ScriptedOperationService(authorizations: [.failure(.unreachable(.notConnectedToInternet))])
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)
        await guided.submit(scanned: OperationFixtures.uri())
        #expect(guided.submission.canRetry)
        #expect(guided.follower.isFollowing)

        guided.hide()
        await guided.follower.waitUntilIdle()

        #expect(!guided.submission.canRetry)
        #expect(!guided.isScanPresented)
        #expect(!guided.follower.isFollowing)
        #expect(service.authorizations.count == 1)
    }

    /// A state that no longer awaits the code, received while the sheet was
    /// open, closes the sheet and drops the code kept for « Réessayer ».
    @Test func aStateThatNoLongerAwaitsTheCodeClosesTheSheet() async {
        let service = ScriptedOperationService(authorizations: [.failure(.unreachable(.notConnectedToInternet))])
        let guided = guided(service)
        guided.start(OperationFixtures.awaiting)
        await guided.submit(scanned: OperationFixtures.uri())
        #expect(guided.submission.canRetry)

        guided.start(OperationFixtures.commandSent)

        #expect(!guided.isScanPresented)
        #expect(!guided.submission.canRetry)
        guided.hide()
    }
}
