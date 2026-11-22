import Foundation
import Testing
@testable import AegisMobile

/// « Retourner l'équipement » from Mon activité (doc 09 §15.2, handoff
/// `mobile-parcours` §6 and §7): the same preparation as the checkout for the
/// holder's loan. The loan stays as read until the server confirms the return
/// and a new read no longer finds it.
@MainActor
struct ReturnPreparationTests {
    let session = StubSessionAccess()
    let clock = TestClock()

    private func model(_ service: ScriptedReservationService, operations: ScriptedOperationService,
                       sleeper: RecordingSleeper = RecordingSleeper(immediate: 0)) -> ActivityViewModel {
        ActivityViewModel(service: service, operations: operations, session: session, now: { [clock] in clock.now },
                          sleep: { [sleeper] in try await sleeper.sleep($0) })
    }

    private static func refusal(_ status: Int, _ code: String) -> APIError {
        .http(status: status, problem: SessionFixtures.problem(status, code), retryAfter: nil)
    }

    private static let offline = APIError.unreachable(.notConnectedToInternet)

    private static func returning(_ status: String = "AWAITING_LOCAL_PROOF",
                                  requiredAction: String = "SCAN_HUB_QR",
                                  terminalAt: String? = nil) -> LockerOperationView {
        OperationFixtures.view(status: status, requiredAction: requiredAction, type: "RETURN", terminalAt: terminalAt)
    }

    private func loanOnly(_ loans: [Result<LoanView?, APIError>]) -> ScriptedReservationService {
        ScriptedReservationService(reservations: [.success(nil)], loans: loans)
    }

    @Test func aLoanThatIsNoLongerReturnableIsANewRead() {
        let problem = PreparationProblem(Self.refusal(409, "LOAN_NOT_RETURNABLE"))
        #expect(problem == .refused(.noLongerPossible))
        #expect(!problem.keepsKey)
        #expect(PreparationProblem(Self.refusal(404, "ACTIVE_LOAN_NOT_FOUND")) == .refused(.noLongerPossible))
    }

    /// 202: the guided return opens on the state received; the loan is the
    /// one read before, unchanged.
    @Test func aPreparedReturnOpensTheGuidedReturnAndKeepsTheLoan() async {
        let loan = ActivityDoubles.loan()
        let operations = ScriptedOperationService(returns: [.success(Self.returning())])
        let model = model(loanOnly([.success(loan)]), operations: operations)
        await model.load()
        #expect(model.canPrepareReturn)

        await model.prepareReturn()

        #expect(operations.returnKeys.count == 1)
        #expect(operations.prepareKeys.isEmpty)
        #expect(model.guided?.kind == .return)
        #expect(model.guided?.step.ending == nil)
        #expect(model.guided?.isScanPresented == true)
        #expect(model.loan.value == loan)
        await model.hideOperation()
    }

    /// Neither `overdue` nor any readiness gates the return: only `RETURN`.
    @Test(arguments: [true, false])
    func anOverdueLoanIsReturnedLikeAnyOther(_ overdue: Bool) async {
        let operations = ScriptedOperationService(returns: [.success(Self.returning())])
        let model = model(loanOnly([.success(ActivityDoubles.loan(overdue: overdue))]), operations: operations)
        await model.load()

        #expect(model.canPrepareReturn)
        await model.prepareReturn()
        #expect(operations.returnKeys.count == 1)
        await model.hideOperation()
    }

    /// The loan disappears only after `CONFIRMED` was read and `GET /me/loan`
    /// no longer finds it; nothing is concluded locally.
    @Test func theLoanEndsOnlyAfterTheServerConfirmedTheReturn() async {
        let loan = ActivityDoubles.loan(overdue: false)
        let service = loanOnly([.success(loan)])
        let confirmed = Self.returning("CONFIRMED", requiredAction: "NONE", terminalAt: "2026-09-16T14:31:40Z")
        let operations = ScriptedOperationService(
            reads: [OperationFixtures.read(Self.returning("COMMAND_SENT", requiredAction: "WAIT")),
                    OperationFixtures.read(confirmed, retryAfter: nil)],
            returns: [.success(Self.returning("AUTHORIZED", requiredAction: "WAIT"))])
        let model = model(service, operations: operations, sleeper: RecordingSleeper())
        await model.load()

        await model.prepareReturn()
        await model.guided?.follower.waitUntilIdle()
        #expect(model.guided?.step.ending == .confirmed)
        #expect(model.guided?.step.title == String(localized: "Retour confirmé"))
        #expect(model.loan.value == loan, "Nothing is inferred locally from CONFIRMED.")

        service.setLoans([.success(nil)])
        await model.hideOperation()

        #expect(model.guided == nil)
        #expect(model.loan.value == nil)
        #expect(model.isEmpty)
    }

    @Test func aSecondTapWhilePreparingIsIgnored() async {
        let gate = Gate()
        let operations = ScriptedOperationService(returns: [.success(Self.returning())])
        operations.prepareGate = gate
        let model = model(loanOnly([.success(ActivityDoubles.loan())]), operations: operations)
        await model.load()

        let first = Task { await model.prepareReturn() }
        while operations.returnKeys.isEmpty { await Task.yield() }
        #expect(model.isPreparing)
        #expect(!model.canPrepareReturn)
        await model.prepareReturn()
        await gate.open()
        await first.value

        #expect(operations.returnKeys.count == 1)
        await model.hideOperation()
    }

    /// An unknown outcome then a new tap: the same intent, the same key.
    @Test func aRetryAfterAnUnknownOutcomeReusesTheKey() async {
        let operations = ScriptedOperationService(returns: [.failure(Self.offline), .success(Self.returning())])
        let model = model(loanOnly([.success(ActivityDoubles.loan())]), operations: operations)
        await model.load()

        await model.prepareReturn()
        #expect(model.feedback == .preparationFailed(.unreachable, compartment: "A1"))
        #expect(model.guided == nil)
        await model.prepareReturn()

        #expect(operations.returnKeys.count == 2)
        #expect(operations.returnKeys[0] == operations.returnKeys[1])
        #expect(model.guided?.kind == .return)
        await model.hideOperation()
    }

    /// `409 LOAN_NOT_RETURNABLE`: « Cette action n'est plus possible. », the
    /// loan is read again, and a later tap is a new intent with a new key.
    @Test func aRefusalReadsTheLoanAgainAndChangesTheKey() async {
        let service = loanOnly([.success(ActivityDoubles.loan())])
        let operations = ScriptedOperationService(returns: [.failure(Self.refusal(409, "LOAN_NOT_RETURNABLE")),
                                                            .success(Self.returning())])
        let model = model(service, operations: operations)
        await model.load()
        let readsBefore = service.reads

        await model.prepareReturn()
        #expect(model.feedback == .preparationFailed(.refused(.noLongerPossible), compartment: "A1"))
        #expect(model.announcement == String(localized: "Cette action n’est plus possible."))
        #expect(service.reads == readsBefore + 1)
        #expect(model.guided == nil)
        await model.prepareReturn()

        #expect(operations.returnKeys.count == 2)
        #expect(operations.returnKeys[0] != operations.returnKeys[1])
        await model.hideOperation()
    }

    /// `503 LOCKER_OFFLINE` on a return: the refusal is shown and the loan
    /// read again; the checkout's offline note is not reused for it.
    @Test func anOfflineLockerRefusesTheReturnWithoutTheCheckoutNote() async {
        let operations = ScriptedOperationService(returns: [.failure(Self.refusal(503, "LOCKER_OFFLINE"))])
        let model = model(loanOnly([.success(ActivityDoubles.loan())]), operations: operations)
        await model.load()

        await model.prepareReturn()

        #expect(model.feedback == .preparationFailed(.refused(.lockerOffline), compartment: "A1"))
        #expect(model.offlineAttemptAt == nil)
        #expect(model.guided == nil)
    }

    /// An empty list (locker not `ONLINE`, closed hours) or a stale read
    /// offers no return, whatever the device remembers.
    @Test func aReturnIsOfferedOnlyWhenListedInAFreshRead() async {
        let unlisted = model(loanOnly([.success(ActivityDoubles.loan(actions: []))]),
                             operations: ScriptedOperationService(returns: [.success(Self.returning())]))
        await unlisted.load()
        #expect(!unlisted.canPrepareReturn)
        await unlisted.prepareReturn()
        #expect(unlisted.guided == nil)

        let service = loanOnly([.success(ActivityDoubles.loan()), .failure(Self.offline)])
        let stale = model(service, operations: ScriptedOperationService(returns: [.success(Self.returning())]))
        await stale.load()
        await stale.load()
        #expect(stale.loan.isStale)
        #expect(!stale.canPrepareReturn)
    }

    @Test func anExpiredSessionEndsTheSessionWithoutFeedback() async {
        let operations = ScriptedOperationService(returns: [.failure(Self.refusal(401, "AUTH_TOKEN_EXPIRED"))])
        let model = model(loanOnly([.success(ActivityDoubles.loan())]), operations: operations)
        await model.load()

        await model.prepareReturn()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(model.feedback == nil)
        #expect(model.guided == nil)
    }

    // MARK: Interruption and resumption

    /// After a relaunch, the loan's `currentOperationId` is read once: a
    /// return in progress offers « Reprendre » and blocks a second one.
    @Test func aReturnInProgressAfterARelaunchOffersResume() async {
        let loan = ActivityDoubles.loan(status: "RETURN_PENDING", actions: [],
                                        currentOperationId: OperationFixtures.operationId)
        let operations = ScriptedOperationService(
            reads: [OperationFixtures.read(Self.returning("COMMAND_SENT", requiredAction: "WAIT"))])
        let model = model(loanOnly([.success(loan)]), operations: operations)

        await model.load()

        #expect(operations.reads == 1)
        #expect(model.isInProgress(loan.currentOperationId))
        #expect(model.isResumable(loan.currentOperationId))
        #expect(!model.canPrepareReturn)

        model.resumeOperation(OperationFixtures.id)
        #expect(model.guided?.kind == .return)
        await model.hideOperation()
    }

    /// Q2 (doc 09 §8.10, `06` §13.4): after a return that ended in `ANOMALY`
    /// the loan stays `RETURN_PENDING`. A new return follows only the
    /// server's `RETURN`; the finished attempt is never offered to resume.
    @Test(arguments: [true, false])
    func aPendingLoanAfterAnAnomalyFollowsTheListedReturn(_ listed: Bool) async {
        let anomaly = Self.returning("ANOMALY", requiredAction: "NONE", terminalAt: "2026-09-16T14:32:00Z")
        let loan = ActivityDoubles.loan(status: "RETURN_PENDING", actions: listed ? ["RETURN"] : [],
                                        currentOperationId: OperationFixtures.operationId)
        let operations = ScriptedOperationService(
            reads: [OperationFixtures.read(anomaly, retryAfter: nil)],
            returns: [.success(OperationFixtures.view(id: OperationFixtures.otherOperationId, type: "RETURN"))])
        let model = model(loanOnly([.success(loan)]), operations: operations)

        await model.load()

        #expect(operations.reads == 1)
        #expect(!model.isResumable(loan.currentOperationId))
        #expect(!model.operationInProgress)
        #expect(model.canPrepareReturn == listed)

        await model.prepareReturn()

        #expect(operations.returnKeys.count == (listed ? 1 : 0))
        #expect((model.guided?.kind == .return) == listed)
        await model.hideOperation()
    }

    /// A reservation and a loan each with an operation: both are read, and
    /// each card knows its own state.
    @Test func theReservationAndTheLoanKeepTheirOwnOperation() async throws {
        let expired = OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                             terminalAt: "2026-09-16T14:32:00Z")
        let reservation = ActivityDoubles.reservation(currentOperationId: OperationFixtures.operationId)
        let loan = ActivityDoubles.loan(status: "RETURN_PENDING", actions: [],
                                        currentOperationId: OperationFixtures.otherOperationId)
        let service = ScriptedReservationService(reservations: [.success(reservation)], loans: [.success(loan)])
        let operations = ScriptedOperationService(
            reads: [OperationFixtures.read(expired, retryAfter: nil),
                    OperationFixtures.read(OperationFixtures.view(id: OperationFixtures.otherOperationId,
                                                                  status: "DOOR_OPENED", requiredAction: "WAIT",
                                                                  type: "RETURN"))])
        let model = model(service, operations: operations)

        await model.load()

        #expect(operations.reads == 2)
        #expect(!model.isResumable(reservation.currentOperationId))
        #expect(model.finishedAttempt == expired)
        #expect(model.isInProgress(loan.currentOperationId))
        #expect(model.resumableOperationId == loan.currentOperationId)
        #expect(model.operationInProgress)
        #expect(!model.canPrepareCheckout, "One physical operation at a time on the locker.")

        model.resumeOperation(try #require(loan.currentOperationId))
        #expect(model.guided?.kind == .return)
        await model.hideOperation()
    }

    /// « Fermer » hides the return without cancelling it; the loan is read
    /// again and keeps « Reprendre ».
    @Test func closingHidesTheReturnWithoutCancelling() async {
        let pending = ActivityDoubles.loan(status: "RETURN_PENDING", actions: [],
                                           currentOperationId: OperationFixtures.operationId)
        let service = loanOnly([.success(ActivityDoubles.loan()), .success(pending)])
        let commandSent = Self.returning("COMMAND_SENT", requiredAction: "WAIT")
        let operations = ScriptedOperationService(reads: [.failure(Self.offline)], returns: [.success(commandSent)])
        let model = model(service, operations: operations)
        await model.load()
        await model.prepareReturn()

        await model.hideOperation()

        #expect(model.guided == nil)
        #expect(model.loan.value == pending)
        #expect(model.knownOperations[OperationFixtures.id] == commandSent)
        #expect(model.isResumable(pending.currentOperationId))
    }

    /// « Recommencer » after an expired return prepares again only when the
    /// fresh read still lists `RETURN`.
    @Test(arguments: [true, false])
    func restartingAReturnFollowsTheFreshRead(_ listed: Bool) async {
        let expired = Self.returning("EXPIRED", requiredAction: "NONE", terminalAt: "2026-09-16T14:32:00Z")
        let after = ActivityDoubles.loan(actions: listed ? ["RETURN"] : [],
                                         currentOperationId: OperationFixtures.operationId)
        let service = loanOnly([.success(ActivityDoubles.loan()), .success(after)])
        let operations = ScriptedOperationService(
            returns: [.success(expired),
                      .success(OperationFixtures.view(id: OperationFixtures.otherOperationId, type: "RETURN"))])
        let model = model(service, operations: operations)
        await model.load()
        await model.prepareReturn()
        #expect(model.guided?.step.ending == .expired)

        await model.restartOperation()

        #expect(operations.returnKeys.count == (listed ? 2 : 1))
        #expect(operations.prepareKeys.isEmpty)
        #expect((model.guided?.kind == .return) == listed)
        if listed { #expect(operations.returnKeys[0] != operations.returnKeys[1]) }
        await model.hideOperation()
    }
}
