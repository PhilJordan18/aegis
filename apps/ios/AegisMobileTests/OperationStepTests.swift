import Foundation
import Testing
@testable import AegisMobile

/// What the guided operation shows for each state received (handoff
/// `mobile-parcours` §7.3, `sections.md` §1.4). Only `CONFIRMED` is a success,
/// and nothing but a server state moves the step.
struct OperationStepTests {
    private func step(_ operation: LockerOperationView?, kind: OperationStep.Kind = .checkout,
                      interrupted: Bool = false) -> OperationStep {
        OperationStep(operation, kind: kind, compartment: "A1", assetName: "Multimètre 1", interrupted: interrupted)
    }

    private static let deadline = "2026-09-16T14:33:00Z"

    @Test(arguments: [
        ("REQUESTED", "WAIT", 1), ("AWAITING_LOCAL_PROOF", "SCAN_HUB_QR", 2), ("AUTHORIZED", "WAIT", 3),
        ("COMMAND_SENT", "WAIT", 4), ("COMMAND_ACKNOWLEDGED", "WAIT", 4), ("DOOR_OPENED", "WAIT", 5),
        ("OBSERVATION_RECEIVED", "WAIT", 6),
    ])
    func eachStateInProgressHasItsPhaseAndIsNeverAnEnd(status: String, action: String, phase: Int) {
        let step = step(OperationFixtures.view(status: status, requiredAction: action))
        #expect(step.phase == phase)
        #expect(step.tone == .progress)
        #expect(step.ending == nil)
        #expect(step.title != String(localized: "Retrait confirmé"))
    }

    @Test func onlyConfirmedIsASuccess() {
        let confirmed = step(OperationFixtures.confirmed)
        #expect(confirmed.ending == .confirmed)
        #expect(confirmed.tone == .success)
        #expect(confirmed.phase == 7)
        #expect(confirmed.title == String(localized: "Retrait confirmé"))
        #expect(step(OperationFixtures.confirmed, kind: .return).title == String(localized: "Retour confirmé"))
    }

    @Test(arguments: [("EXPIRED", OperationStep.Ending.expired), ("FAILED", .failed), ("ANOMALY", .anomaly)])
    func otherEndsAreFailuresWithTheirOwnAction(status: String, ending: OperationStep.Ending) {
        let step = step(OperationFixtures.view(status: status, requiredAction: "NONE",
                                               terminalAt: "2026-09-16T14:33:00Z"))
        #expect(step.ending == ending)
        #expect(step.tone == .failure)
        #expect(step.deadline == nil)
        #expect(!step.canScan)
    }

    /// An `EXPIRED` operation stopped at the code or after the authorization.
    @Test func anExpiryKeepsThePhaseItReached() {
        let beforeAuthorization = step(OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                                              terminalAt: Self.deadline))
        let afterAuthorization = step(OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE",
                                                             terminalAt: Self.deadline,
                                                             authorizedAt: "2026-09-16T14:31:10Z"))
        #expect(beforeAuthorization.phase == 2)
        #expect(afterAuthorization.phase == 5)
        #expect(beforeAuthorization.title == String(localized: "Délai dépassé"))
        #expect(step(OperationFixtures.view(status: "EXPIRED", requiredAction: "NONE", terminalAt: Self.deadline),
                     kind: .return).instruction
                == String(localized: "operation.expired.return",
                          defaultValue: "Aucune porte n’a été ouverte. Recommencez la préparation."))
    }

    /// §8.5: a status this version does not know implies no progress, success
    /// or physical action, whether or not the server ended it.
    @Test(arguments: [nil, "2026-09-16T14:33:00Z"])
    func anUnknownStatusClaimsNothing(terminalAt: String?) {
        let step = step(OperationFixtures.view(status: "TELEPORTED", requiredAction: "WAIT", terminalAt: terminalAt))
        #expect(step.phase == 0)
        #expect(step.tone == .neutral)
        #expect(step.ending == (terminalAt == nil ? nil : .unrecognized))
        #expect(step.title == String(localized: "État indisponible"))
        #expect(step.instruction == nil)
        #expect(!step.canScan)
    }

    @Test func nothingReceivedYetIsAWait() {
        let step = step(nil)
        #expect(step.phase == 0)
        #expect(step.ending == nil)
        #expect(!step.canScan)
    }

    /// The scan is offered only once the locker confirmed the display.
    @Test func theCodeCanBeScannedOnlyOnceDisplayed() {
        let hidden = step(OperationFixtures.view(displayedAt: nil))
        let shown = step(OperationFixtures.awaiting)
        #expect(hidden.awaitsDisplay)
        #expect(!hidden.canScan)
        #expect(hidden.title == String(localized: "Le code s’affiche sur le casier"))
        #expect(shown.canScan)
        #expect(!shown.awaitsDisplay)
        #expect(shown.title == String(localized: "Scannez le code du casier"))
    }

    /// A lost connection names the last state received and offers no scan.
    @Test func anInterruptedStepSaysItIsTheLastStateReceived() {
        let door = step(OperationFixtures.view(status: "DOOR_OPENED", requiredAction: "WAIT"), interrupted: true)
        #expect(door.title == String(localized: "Dernier état reçu : \(String(localized: "porte ouverte"))"))
        #expect(door.ending == nil)
        #expect(!step(OperationFixtures.awaiting, interrupted: true).canScan)
    }

    /// The physical window is shown from the authorization, never on an end.
    @Test func theDeadlineComesFromTheServerWhileInProgress() {
        let authorized = step(OperationFixtures.view(status: "AUTHORIZED", requiredAction: "WAIT",
                                                     expiresAt: Self.deadline))
        #expect(authorized.deadline == ISO8601DateFormatter().date(from: Self.deadline))
    }

    @Test func checkoutAndReturnAskForOppositeGestures() {
        let acknowledged = OperationFixtures.view(status: "COMMAND_ACKNOWLEDGED", requiredAction: "WAIT")
        #expect(step(acknowledged).instruction != step(acknowledged, kind: .return).instruction)
        #expect(step(acknowledged).instruction?.contains("Multimètre 1") == true)
        #expect(OperationStep.phaseNames.count == OperationStep.phaseCount)
    }
}
