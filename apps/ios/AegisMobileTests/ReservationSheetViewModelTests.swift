import Foundation
import Testing
@testable import AegisMobile

/// Reservation sheet (handoff §5, doc 09 §14.1): one key per intent, server
/// answers shown as they are, hours as a comfort of entry only.
@MainActor
struct ReservationSheetViewModelTests {
    let session = StubSessionAccess()
    /// 14:07 in Toronto (EDT, UTC-4) on 16 September 2026.
    let clock = TestClock(try! Date("2026-09-16T18:07:00Z", strategy: .iso8601))

    private func model(_ service: ScriptedReservationService,
                       asset: TechnicianAsset = CatalogFixtures.asset(1)) -> ReservationSheetViewModel {
        ReservationSheetViewModel(asset: asset, service: service, session: session, now: { [clock] in clock.now })
    }

    private func instant(_ text: String) -> Date { try! Date(text, strategy: .iso8601) }

    // MARK: Hours

    /// PHY-01 is not on `dev`: the 404 of the missing route means "hours
    /// unavailable", never closed, and the server judges the time.
    @Test func aMissingStatusRouteLeavesTheHoursUnavailable() async {
        let model = model(ScriptedReservationService())

        await model.loadHours()

        #expect(model.hours == .unavailable)
        #expect(model.canConfirm)
        #expect(model.choices.first == instant("2026-09-16T18:15:00Z"))
        // Up to the end of the locker's day, 23:45 in Toronto.
        #expect(model.choices.last == instant("2026-09-17T03:45:00Z"))
        #expect(model.reservedUntil == instant("2026-09-16T19:15:00Z"))
    }

    @Test func anOpenWindowBoundsTheChoicesByItsClosingTime() async {
        let service = ScriptedReservationService(status: .success(ActivityDoubles.window(
            open: true, closesAt: "2026-09-16T21:00:00Z")))
        let model = model(service)

        await model.loadHours()

        #expect(model.hours == .open(closesAt: instant("2026-09-16T21:00:00Z")))
        #expect(model.zone.identifier == "America/Toronto")
        #expect(model.choices.count == 12)
        #expect(model.choices.first == instant("2026-09-16T18:15:00Z"))
        // The closing time itself is accepted (§14.1, step 6).
        #expect(model.choices.last == instant("2026-09-16T21:00:00Z"))
    }

    @Test func theFirstChoiceLeavesTimeToConfirm() {
        let choices = ReservationSheetViewModel.choices(after: instant("2026-09-16T18:11:00Z"), until: nil,
                                                        zone: AegisTime.laboratoryZone)
        #expect(choices.first == instant("2026-09-16T18:30:00Z"))
    }

    @Test(arguments: [("2026-09-17T11:00:00Z" as String?), nil])
    func aClosedLockerDisablesTheConfirmation(_ nextOpensAt: String?) async {
        let model = model(ScriptedReservationService(status: .success(ActivityDoubles.window(
            open: false, nextOpensAt: nextOpensAt))))

        await model.loadHours()

        #expect(model.hours == .closed(nextOpensAt: nextOpensAt.map(instant)))
        #expect(model.choices.isEmpty)
        #expect(!model.canConfirm)
    }

    @Test func anAssetWithoutPlacementDoesNotReadAnyLocker() async {
        let service = ScriptedReservationService()
        let model = model(service, asset: CatalogFixtures.asset(1, placement: "null"))

        await model.loadHours()

        #expect(service.statusCalls == 0)
        #expect(model.hours == .unavailable)
    }

    // MARK: Creation

    @Test func createsTheReservationForTheChosenTime() async {
        let created = ActivityDoubles.reservation()
        let service = ScriptedReservationService(creations: [.success(created)])
        let model = model(service)
        await model.loadHours()
        model.reservedUntil = model.choices[3]

        await model.confirm()

        #expect(model.phase == .created(created))
        #expect(service.createTimes == [instant("2026-09-16T19:00:00Z")])
        #expect(service.createKeys.count == 1)
        #expect(model.currentKey == nil)
    }

    @Test(arguments: [
        APIError.unreachable(.notConnectedToInternet),
        APIError.unreachable(.timedOut),
        ActivityDoubles.refusal(503, "INTERNAL_ERROR"),
        ActivityDoubles.refusal(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS"),
        APIError.invalidResponse,
    ])
    func anUnknownOutcomeIsRetriedWithTheSameKey(_ error: APIError) async {
        let created = ActivityDoubles.reservation()
        let service = ScriptedReservationService(creations: [.failure(error), .success(created)])
        let model = model(service)
        await model.loadHours()

        await model.confirm()
        guard case let .failed(problem) = model.phase else {
            Issue.record("Expected a failure, got \(model.phase)")
            return
        }
        #expect(problem.keepsKey)
        await model.confirm()

        #expect(model.phase == .created(created))
        #expect(service.createKeys.count == 2)
        #expect(service.createKeys[0] == service.createKeys[1])
    }

    /// Production until PHY-02: every reservation is refused 422
    /// `ASSET_NOT_READY` with `UNKNOWN_PHYSICAL_STATE`. It reads as a refusal.
    @Test func theProductionRefusalReadsAsARefusal() async {
        let service = ScriptedReservationService(creations: [
            .failure(ActivityDoubles.refusal(422, "ASSET_NOT_READY", reasons: ["UNKNOWN_PHYSICAL_STATE"])),
            .failure(ActivityDoubles.refusal(422, "ASSET_NOT_READY", reasons: ["UNKNOWN_PHYSICAL_STATE"])),
        ])
        let model = model(service)
        await model.loadHours()

        await model.confirm()

        #expect(model.phase == .failed(.refused(.notReady(.known(.unknownPhysicalState)))))
        #expect(ReservationProblem.refused(.notReady(.known(.unknownPhysicalState))).message
                == String(localized: "Réservation impossible : présence non confirmée par le casier."))
        #expect(model.currentKey == nil)
        await model.confirm()
        #expect(service.createKeys.count == 2)
        #expect(service.createKeys[0] != service.createKeys[1])
    }

    @Test func aNewTimeIsANewIntent() async {
        let service = ScriptedReservationService(creations: [.failure(.unreachable(.timedOut))])
        let model = model(service)
        await model.loadHours()
        await model.confirm()
        #expect(model.currentKey != nil)

        model.reservedUntil = model.choices[5]

        #expect(model.currentKey == nil)
        #expect(model.phase == .editing)
    }

    @Test func aSecondTapWhileSendingIsIgnored() async {
        let gate = Gate()
        let created = ActivityDoubles.reservation()
        let service = ScriptedReservationService(creations: [.success(created)])
        service.gate = gate
        let model = model(service)
        await model.loadHours()

        let first = Task { await model.confirm() }
        while service.createKeys.isEmpty { await Task.yield() }
        #expect(model.isSending)
        #expect(!model.canConfirm)
        await model.confirm()
        await gate.open()
        await first.value

        #expect(service.createKeys.count == 1)
        #expect(model.phase == .created(created))
    }

    @Test func anExpiredSessionEndsTheSession() async {
        let service = ScriptedReservationService(creations: [.failure(ActivityDoubles.refusal(401, "AUTH_TOKEN_EXPIRED"))])
        let model = model(service)
        await model.loadHours()

        await model.confirm()

        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(model.phase == .editing)
    }

    // MARK: Refusal mapping

    @Test(arguments: [
        (403, "ASSET_ACCESS_DENIED", ReservationProblem.Refusal.accessDenied),
        (409, "ASSET_ALREADY_RESERVED", .alreadyReserved),
        (409, "USER_ALREADY_HAS_ACTIVE_RESERVATION", .userHasReservation),
        (409, "ASSET_HAS_OPEN_LOAN", .openLoan),
        (422, "OUTSIDE_OPERATING_HOURS", .lockerClosed),
        (422, "RESERVATION_END_AFTER_CLOSING", .endAfterClosing),
        (404, "ASSET_NOT_FOUND", .assetGone),
        (409, "IDEMPOTENCY_KEY_REUSED", .other(traceId: SessionModel.displayableTraceId("trace-1"))),
    ])
    func eachCreationRefusalHasItsMessage(_ status: Int, _ code: String, _ expected: ReservationProblem.Refusal) {
        let problem = ReservationProblem(ActivityDoubles.refusal(status, code), mutation: .create)
        #expect(problem == .refused(expected))
        #expect(!problem.keepsKey)
    }

    /// The approved French texts are the keys (`sections.md` §4.1).
    @Test func approvedRefusalTextsAreUsed() {
        #expect(ReservationProblem.Refusal.accessDenied.message
                == String(localized: "Votre niveau d’accès ne permet pas cet équipement."))
        #expect(ReservationProblem.Refusal.alreadyReserved.message == String(localized: "Quelqu’un vient de le réserver."))
        #expect(ReservationProblem.Refusal.userHasReservation.message
                == String(localized: "Vous avez déjà une réservation active."))
        #expect(ReservationProblem.Refusal.lockerClosed.message == String(localized: "Le casier est fermé."))
        #expect(ReservationProblem.Refusal.endAfterClosing.message
                == String(localized: "Choisissez une heure avant la fermeture."))
    }

    @Test func aPastEndIsAValidationRefusal() {
        let error = ActivityDoubles.refusal(400, "VALIDATION_ERROR",
                                            violations: [.init(field: "reservedUntil", code: "INVALID_VALUE")])
        #expect(ReservationProblem(error, mutation: .create) == .refused(.endNotAfterNow))
    }

    @Test func refusalReasonsFollowTheDisplayOrder() {
        #expect(ReservationProblem.mainReason(["UNKNOWN_PHYSICAL_STATE", "CALIBRATION_EXPIRED"])
                == .known(.calibrationExpired))
        #expect(ReservationProblem.mainReason([]) == .unrecognized)
        #expect(ReservationProblem.mainReason(["TELEPORTED"]) == .unrecognized)
    }

    @Test func theTraceIdIsKeptOnlyWhenClean() {
        let problem = ReservationProblem(ActivityDoubles.refusal(503, "INTERNAL_ERROR"), mutation: .create)
        #expect(problem == .service(traceId: SessionModel.displayableTraceId("trace-1")))
    }
}
