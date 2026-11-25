import Foundation
import Testing
@testable import AegisMobile

/// « Préparer le retrait » from Mon activité (doc 09 §15.1, handoff
/// `mobile-parcours` §6 and §7.1): one key per intent, refusals read the card
/// again, and no loan or success appears before the server confirms it.
@MainActor
struct CheckoutPreparationTests {
    let session = StubSessionAccess()
    let clock = TestClock()

    private func model(_ service: ScriptedReservationService, operations: ScriptedOperationService,
                       sleeper: RecordingSleeper = RecordingSleeper(immediate: 0)) -> ActivityViewModel {
        ActivityViewModel(service: service, operations: operations, session: session, now: { [clock] in clock.now },
                          sleep: { [sleeper] in try await sleeper.sleep($0) })
    }

    private nonisolated static func refusal(_ status: Int, _ code: String,
                                retryAfter: Duration? = nil) -> APIError {
        .http(status: status, problem: SessionFixtures.problem(status, code), retryAfter: retryAfter)
    }

    private nonisolated static let offline = APIError.unreachable(.notConnectedToInternet)

    // MARK: Refusals

    @Test(arguments: [
        (409, "LOCKER_OPERATION_IN_PROGRESS", PreparationProblem.Refusal.lockerBusy),
        (503, "LOCKER_OFFLINE", .lockerOffline), (503, "DEVICE_UNAVAILABLE", .compartmentUnavailable),
        (409, "COMPARTMENT_STATE_UNSAFE", .compartmentUnsafe), (422, "PHYSICAL_STATE_UNKNOWN", .presenceUnknown),
        (422, "OUTSIDE_OPERATING_HOURS", .lockerClosed), (403, "ASSET_ACCESS_DENIED", .accessDenied),
        (404, "ACTIVE_RESERVATION_NOT_FOUND", .noLongerPossible), (409, "ASSET_HAS_OPEN_LOAN", .noLongerPossible),
        (422, "ASSET_NOT_READY", .other(traceId: SessionModel.displayableTraceId("trace-1"))),
    ])
    func eachDocumentedRefusalHasItsMeaning(status: Int, code: String, refusal: PreparationProblem.Refusal) {
        let problem = PreparationProblem(Self.refusal(status, code))
        #expect(problem == .refused(refusal))
        #expect(!problem.keepsKey)
    }

    /// No answer, a 5xx or the same key still in progress: the outcome is
    /// unknown, so the next tap is the same intent with the same key.
    @Test(arguments: [CheckoutPreparationTests.offline, .invalidResponse,
                      CheckoutPreparationTests.refusal(500, "INTERNAL_ERROR"),
                      CheckoutPreparationTests.refusal(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS")])
    func anUnknownOutcomeKeepsTheKey(_ error: APIError) {
        #expect(PreparationProblem(error).keepsKey)
    }

    @Test func aRateLimitShowsTheServerDelayOnlyWhenPlausible() {
        let short = PreparationProblem.Refusal.rateLimited(retryAfter: .seconds(42))
        let absurd = PreparationProblem.Refusal.rateLimited(retryAfter: .seconds(90_000))
        #expect(short.message(compartment: "A1") != absurd.message(compartment: "A1"))
        #expect(absurd.message(compartment: "A1") == String(localized: "Trop de tentatives. Réessayez plus tard."))
        #expect(PreparationProblem(Self.refusal(429, "RATE_LIMITED", retryAfter: .seconds(42))) == .refused(short))
    }

    @Test func aCompartmentFactNamesTheCompartment() {
        #expect(PreparationProblem.refused(.compartmentUnsafe).message(compartment: "B3").contains("B3"))
    }

    // MARK: Preparation

    /// 202: the guided operation opens on the state received. It is not a
    /// success and no loan exists until the server says so.
    @Test func aPreparedCheckoutOpensTheGuidedOperationWithoutALoan() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.success(OperationFixtures.awaiting)])
        let model = model(service, operations: operations)
        await model.load()
        #expect(model.canPrepareCheckout)

        await model.prepareCheckout()

        #expect(operations.prepareKeys.count == 1)
        #expect(model.guided?.operation == OperationFixtures.awaiting)
        #expect(model.guided?.step.ending == nil)
        #expect(model.guided?.isScanPresented == true)
        #expect(model.loan.value == nil)
        #expect(model.feedback == nil)
        await model.hideOperation()
    }

    /// The loan comes only from `GET /me/loan` after `CONFIRMED` was read.
    @Test func theLoanAppearsOnlyAfterTheServerConfirmed() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(
            reads: [OperationFixtures.read(OperationFixtures.commandSent),
                    OperationFixtures.read(OperationFixtures.confirmed, retryAfter: nil)],
            preparations: [.success(OperationFixtures.authorized)])
        let model = model(service, operations: operations, sleeper: RecordingSleeper())
        await model.load()

        await model.prepareCheckout()
        #expect(model.loan.value == nil)
        await model.guided?.follower.waitUntilIdle()
        #expect(model.guided?.step.ending == .confirmed)
        #expect(model.loan.value == nil, "Nothing is inferred locally from CONFIRMED.")

        service.setReservations([.success(nil)])
        service.setLoans([.success(ActivityDoubles.loan(overdue: false))])
        await model.hideOperation()

        #expect(model.guided == nil)
        #expect(model.loan.value == ActivityDoubles.loan(overdue: false))
        #expect(model.reservation.value == nil)
    }

    @Test func aSecondTapWhilePreparingIsIgnored() async {
        let gate = Gate()
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.success(OperationFixtures.awaiting)])
        operations.prepareGate = gate
        let model = model(service, operations: operations)
        await model.load()

        let first = Task { await model.prepareCheckout() }
        while operations.prepareKeys.isEmpty { await Task.yield() }
        #expect(model.isPreparing)
        #expect(!model.canPrepareCheckout)
        #expect(!model.canCancel)
        await model.prepareCheckout()
        await gate.open()
        await first.value

        #expect(operations.prepareKeys.count == 1)
        await model.hideOperation()
    }

    /// An unknown outcome then a new tap: the same intent, the same key. The
    /// server's idempotency, not the app, prevents a second operation.
    @Test func aRetryAfterAnUnknownOutcomeReusesTheKey() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.failure(Self.offline),
                                                                 .success(OperationFixtures.awaiting)])
        let model = model(service, operations: operations)
        await model.load()

        await model.prepareCheckout()
        #expect(model.feedback == .preparationFailed(.unreachable, compartment: "A1"))
        #expect(model.guided == nil)
        await model.prepareCheckout()

        #expect(operations.prepareKeys.count == 2)
        #expect(operations.prepareKeys[0] == operations.prepareKeys[1])
        #expect(model.guided != nil)
        await model.hideOperation()
    }

    /// A refusal is definitive: Mon activité is read again and a new tap is a
    /// new intent with a new key.
    @Test func aRefusalReadsTheCardAgainAndChangesTheKey() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.failure(Self.refusal(409, "LOCKER_OPERATION_IN_PROGRESS")),
                                                                 .success(OperationFixtures.awaiting)])
        let model = model(service, operations: operations)
        await model.load()
        let readsBefore = service.reads

        await model.prepareCheckout()
        #expect(model.feedback == .preparationFailed(.refused(.lockerBusy), compartment: "A1"))
        #expect(model.announcement == PreparationProblem.Refusal.lockerBusy.message(compartment: "A1"))
        #expect(service.reads == readsBefore + 1)
        #expect(model.guided == nil)
        await model.prepareCheckout()

        #expect(operations.prepareKeys.count == 2)
        #expect(operations.prepareKeys[0] != operations.prepareKeys[1])
        await model.hideOperation()
    }

    /// `503 LOCKER_OFFLINE` (§6 variant A): the time of the attempt is kept in
    /// memory to name it; the button still follows the server's actions.
    @Test func anOfflineLockerRecordsTheAttemptWithoutDecidingTheButton() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.failure(Self.refusal(503, "LOCKER_OFFLINE"))])
        let model = model(service, operations: operations)
        await model.load()

        await model.prepareCheckout()

        #expect(model.offlineAttemptAt == clock.now)
        #expect(model.canPrepareCheckout)
        #expect(model.guided == nil)
    }

    /// A read that drops `CHECKOUT` disables the button, whatever the device
    /// remembers.
    @Test func checkoutIsOfferedOnlyWhenListed() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation(actions: ["CANCEL"]))])
        let operations = ScriptedOperationService(preparations: [.success(OperationFixtures.awaiting)])
        let model = model(service, operations: operations)
        await model.load()

        #expect(!model.canPrepareCheckout)
        await model.prepareCheckout()
        #expect(operations.prepareKeys.isEmpty)
    }

    /// 401 ends the session and opens nothing.
    @Test func anExpiredSessionEndsTheSessionWithoutFeedback() async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation())])
        let operations = ScriptedOperationService(preparations: [.failure(Self.refusal(401, "AUTH_TOKEN_EXPIRED"))])
        let model = model(service, operations: operations)
        await model.load()

        await model.prepareCheckout()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(model.feedback == nil)
        #expect(model.guided == nil)
    }

    // MARK: Interruption and resumption

    /// After a relaunch, `currentOperationId` is read once: an operation in
    /// progress offers « Reprendre » and blocks a second preparation.
    @Test func anOperationInProgressAfterARelaunchOffersResume() async {
        let reservation = ActivityDoubles.reservation(actions: ["CANCEL"],
                                                      currentOperationId: OperationFixtures.operationId)
        let service = ScriptedReservationService(reservations: [.success(reservation)])
        let operations = ScriptedOperationService(reads: [OperationFixtures.read(OperationFixtures.commandSent)])
        let model = model(service, operations: operations)

        await model.load()

        #expect(operations.reads == 1)
        #expect(model.resumableOperationId == OperationFixtures.id)
        #expect(model.operationInProgress)
        #expect(!model.canPrepareCheckout)

        model.resumeOperation(OperationFixtures.id)
        #expect(model.guided?.kind == .checkout)
        await model.hideOperation()
    }

    /// An unreadable operation stays unknown: « Reprendre » is offered and
    /// nothing claims it ended.
    @Test func anUnreadableOperationStaysResumable() async {
        let reservation = ActivityDoubles.reservation(actions: ["CANCEL"],
                                                      currentOperationId: OperationFixtures.operationId)
        let service = ScriptedReservationService(reservations: [.success(reservation)])
        let operations = ScriptedOperationService(reads: [.failure(Self.offline)])
        let model = model(service, operations: operations)

        await model.load()

        #expect(model.resumableOperationId == OperationFixtures.id)
        #expect(model.knownOperations[OperationFixtures.id] == nil)
        #expect(model.finishedAttempt == nil)
    }

    /// A finished attempt (§6 variant B) offers no resumption.
    @Test func aFinishedAttemptIsNotResumable() async {
        let expired = OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                             terminalAt: "2026-09-16T14:32:00Z")
        let reservation = ActivityDoubles.reservation(currentOperationId: OperationFixtures.operationId)
        let service = ScriptedReservationService(reservations: [.success(reservation)])
        let operations = ScriptedOperationService(reads: [OperationFixtures.read(expired, retryAfter: nil)])
        let model = model(service, operations: operations)

        await model.load()

        #expect(model.resumableOperationId == nil)
        #expect(model.finishedAttempt == expired)
        #expect(model.canPrepareCheckout)
    }

    /// « Fermer » hides the tracking: no cancellation is sent, the reservation
    /// is read again, and the last state received keeps « Reprendre ».
    @Test func closingHidesWithoutCancelling() async {
        let reservation = ActivityDoubles.reservation(actions: ["CANCEL"],
                                                      currentOperationId: OperationFixtures.operationId)
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation()), .success(reservation)])
        let operations = ScriptedOperationService(reads: [.failure(Self.offline)],
                                                  preparations: [.success(OperationFixtures.commandSent)])
        let model = model(service, operations: operations)
        await model.load()
        await model.prepareCheckout()
        let readsBefore = service.reads

        await model.hideOperation()

        #expect(model.guided == nil)
        #expect(service.cancelKeys.isEmpty)
        #expect(service.reads == readsBefore + 1)
        #expect(model.knownOperations[OperationFixtures.id] == OperationFixtures.commandSent)
        #expect(model.operationInProgress)
        #expect(model.resumableOperationId == OperationFixtures.id)
    }

    /// « Recommencer » prepares again only when the fresh read lists CHECKOUT.
    @Test(arguments: [true, false])
    func restartingFollowsTheFreshRead(_ listed: Bool) async {
        let expired = OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                             terminalAt: "2026-09-16T14:32:00Z")
        let after = ActivityDoubles.reservation(actions: listed ? ["CHECKOUT", "CANCEL"] : ["CANCEL"],
                                                currentOperationId: OperationFixtures.operationId)
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation()), .success(after)])
        let operations = ScriptedOperationService(
            preparations: [.success(expired),
                           .success(OperationFixtures.view(id: OperationFixtures.otherOperationId))])
        let model = model(service, operations: operations)
        await model.load()
        await model.prepareCheckout()
        #expect(model.guided?.step.ending == .expired)

        await model.restartOperation()

        #expect(operations.prepareKeys.count == (listed ? 2 : 1))
        #expect((model.guided != nil) == listed)
        if listed {
            #expect(operations.prepareKeys[0] != operations.prepareKeys[1])
            #expect(model.guided?.operation?.id.uuidString.lowercased() == OperationFixtures.otherOperationId)
        }
        await model.hideOperation()
    }
}
