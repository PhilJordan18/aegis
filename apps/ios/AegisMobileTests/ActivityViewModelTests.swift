import Foundation
import Testing
@testable import AegisMobile

/// « Mon activité » (handoff §6, doc 09 §8.10, §14.2, §14.4, §15.3): actions
/// follow the last fresh read; a loan error never hides a reservation.
@MainActor
struct ActivityViewModelTests {
    let session = StubSessionAccess()
    let clock = TestClock()

    private func model(_ service: ScriptedReservationService) -> ActivityViewModel {
        ActivityViewModel(service: service, session: session, now: { [clock] in clock.now })
    }

    @Test func showsTheActiveReservationAndOffersCancelWhenListed() async {
        let reservation = ActivityDoubles.reservation()
        let model = model(ScriptedReservationService(reservations: [.success(reservation)]))

        await model.load()

        #expect(model.reservation.value == reservation)
        #expect(model.loan.isKnown)
        #expect(model.canCancel)
        #expect(!model.isEmpty)
    }

    @Test func noReservationAndNoLoanIsTheEmptyState() async {
        let model = model(ScriptedReservationService())

        await model.load()

        #expect(model.isEmpty)
        #expect(!model.canCancel)
    }

    /// `GET /me/loan` has no controller on `dev`: its 404 RESOURCE_NOT_FOUND
    /// stays an error and neither hides the reservation nor fakes a loan.
    @Test func aMissingLoanRouteNeverHidesTheReservation() async {
        let reservation = ActivityDoubles.reservation()
        let model = model(ScriptedReservationService(reservations: [.success(reservation)],
                                                     loans: [.failure(ActivityDoubles.routeMissing)]))

        await model.load()

        #expect(model.reservation.value == reservation)
        #expect(model.loan.value == nil)
        #expect(model.loan.failure == .service(traceId: SessionModel.displayableTraceId("trace-1")))
        #expect(!model.isEmpty)
        #expect(model.canCancel)
    }

    @Test func aMissingLoanRouteIsNotAnEmptyActivity() async {
        let model = model(ScriptedReservationService(loans: [.failure(ActivityDoubles.routeMissing)]))

        await model.load()

        #expect(model.reservation.isKnown)
        #expect(model.reservation.value == nil)
        #expect(!model.isEmpty)
    }

    @Test(arguments: [[String](), ["CHECKOUT"], ["TELEPORT"]])
    func cancelIsOfferedOnlyWhenListed(_ actions: [String]) async {
        let service = ScriptedReservationService(reservations: [.success(ActivityDoubles.reservation(actions: actions))])
        let model = model(service)
        await model.load()

        #expect(!model.canCancel)
        await model.cancel()
        #expect(service.cancelKeys.isEmpty)
    }

    @Test func anOfflineRefreshKeepsTheLastStateAndDisablesCancel() async {
        let reservation = ActivityDoubles.reservation()
        let service = ScriptedReservationService(reservations: [.success(reservation), .failure(.unreachable(.notConnectedToInternet))])
        let model = model(service)
        await model.load()
        let received = clock.now
        clock.advance(by: 60)

        await model.refresh()

        #expect(model.reservation.value == reservation)
        #expect(model.reservation.isStale)
        #expect(model.reservation.receivedAt == received)
        #expect(model.actionableReservation == nil)
        #expect(!model.canCancel)
    }

    @Test func cancellingSendsAKeyThenReadsTheActivityAgain() async {
        let service = ScriptedReservationService(
            reservations: [.success(ActivityDoubles.reservation()), .success(nil)],
            cancellations: [.success(ActivityDoubles.reservation(status: "CANCELLED", actions: []))])
        let model = model(service)
        await model.load()

        await model.cancel()

        #expect(service.cancelKeys.count == 1)
        #expect(service.reads == 2)
        #expect(model.feedback == .cancelled)
        #expect(model.reservation.value == nil)
        #expect(model.isEmpty)
        #expect(model.announcement == String(localized: "Réservation annulée."))
    }

    @Test func aLostCancelAnswerIsRetriedWithTheSameKey() async {
        let service = ScriptedReservationService(
            reservations: [.success(ActivityDoubles.reservation())],
            cancellations: [.failure(.unreachable(.timedOut)),
                            .success(ActivityDoubles.reservation(status: "CANCELLED", actions: []))])
        let model = model(service)
        await model.load()

        await model.cancel()
        #expect(model.feedback == .cancelFailed(.unreachable))
        // The answer was lost: the card is not read again and still offers Cancel.
        #expect(service.reads == 1)
        await model.cancel()

        #expect(service.cancelKeys.count == 2)
        #expect(service.cancelKeys[0] == service.cancelKeys[1])
        #expect(model.feedback == .cancelled)
    }

    /// §14.4: FULFILLED, EXPIRED, an authorized checkout or a physical
    /// uncertainty. The card follows the new read, which no longer lists CANCEL.
    @Test func aRefusedCancelReadsTheReservationAgain() async {
        let service = ScriptedReservationService(
            reservations: [.success(ActivityDoubles.reservation()), .success(ActivityDoubles.reservation(actions: []))],
            cancellations: [.failure(ActivityDoubles.refusal(409, "RESERVATION_NOT_CANCELLABLE"))])
        let model = model(service)
        await model.load()

        await model.cancel()

        #expect(model.feedback == .cancelFailed(.refused(.notCancellable)))
        #expect(service.reads == 2)
        #expect(!model.canCancel)
        #expect(model.reservation.value != nil)
    }

    @Test func aSecondCancelWhileSendingIsIgnored() async {
        let gate = Gate()
        let service = ScriptedReservationService(
            reservations: [.success(ActivityDoubles.reservation()), .success(nil)],
            cancellations: [.success(ActivityDoubles.reservation(status: "CANCELLED", actions: []))])
        service.gate = gate
        let model = model(service)
        await model.load()

        let first = Task { await model.cancel() }
        while service.cancelKeys.isEmpty { await Task.yield() }
        #expect(model.isCancelling)
        await model.cancel()
        await gate.open()
        await first.value

        #expect(service.cancelKeys.count == 1)
    }

    @Test(arguments: [true, false])
    func anExpiredSessionOnEitherReadEndsTheSession(_ onReservation: Bool) async {
        let expired = ActivityDoubles.refusal(401, "AUTH_TOKEN_EXPIRED")
        let service = onReservation
            ? ScriptedReservationService(reservations: [.failure(expired)])
            : ScriptedReservationService(loans: [.failure(expired)])
        let model = model(service)

        await model.load()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(!model.hasRead)
    }

    @Test func aCreatedReservationIsShownAndAnnounced() {
        let reservation = ActivityDoubles.reservation()
        let model = model(ScriptedReservationService())

        model.accept(created: reservation)

        #expect(model.reservation.value == reservation)
        #expect(model.feedback == .created(reservation))
        #expect(model.announcement == ActivityViewModel.confirmation(reservation))
        #expect(model.canCancel)
    }

    @Test func showsAnOverdueLoanFromTheServer() async {
        let loan = ActivityDoubles.loan()
        let model = model(ScriptedReservationService(loans: [.success(loan)]))

        await model.load()

        #expect(model.loan.value?.overdue == true)
        #expect(!model.isEmpty)
    }
}
