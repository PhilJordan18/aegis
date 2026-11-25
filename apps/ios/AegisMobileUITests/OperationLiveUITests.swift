import UIKit
import XCTest

/// The technician journey of the real app against a real API, PostgreSQL,
/// MQTT broker and the simulated hub (#46, #50, #67): reservation, checkout,
/// return, Q2 recovery after an anomaly, lost connection, background,
/// relaunch and revoked authentication.
///
/// Run only by `scripts/live-journey.sh`, which owns the disposable stack and
/// answers this test through a bridge directory on the Mac. The bridge holds
/// the URI of the QR the hub displays; it is decrypted there from the sealed
/// row, as the QA recipes do. The test pastes it into the Debug-only code
/// entry through the pasteboard, so the token never appears in a test
/// activity, and clears the pasteboard at once. This is not camera or
/// physical acceptance.
final class OperationLiveUITests: XCTestCase {
    private struct Journey {
        let address: String
        let technicianEmail: String
        let initialPassword: String
        let bridge: URL

        init() throws {
            let environment = ProcessInfo.processInfo.environment
            guard let address = environment["AEGIS_LIVE_API_BASE_URL"],
                  let password = environment["AEGIS_LIVE_TECHNICIAN_PASSWORD"],
                  let bridge = environment["AEGIS_LIVE_BRIDGE_DIR"] else {
                throw XCTSkip("Run through scripts/live-journey.sh: it starts the stack and the bridge.")
            }
            self.address = address
            initialPassword = password
            technicianEmail = environment["AEGIS_LIVE_TECHNICIAN_EMAIL"] ?? "technician@aegis.demo"
            self.bridge = URL(fileURLWithPath: bridge, isDirectory: true)
        }

        /// The password after a rotation, else the initial one.
        var technicianPassword: String {
            let rotated = bridge.appendingPathComponent("technician-password")
            guard let value = try? String(contentsOf: rotated, encoding: .utf8) else { return initialPassword }
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTechnicianCompletesTheJourneyAgainstTheRealStack() throws {
        let journey = try Journey()
        XCUIDevice.shared.appearance = .light
        var app = launch(journey, resetSession: true)
        signIn(app, journey)

        // 1. Reservation, guided checkout, loan.
        try XCTContext.runActivity(named: "Checkout through the real hub QR") { _ in
            reserve(app, journey)
            prepare(app, "activity.checkout")
            try scanTheDisplayedCode(app, journey)
            XCTAssertTrue(waitForLabel(title(app), "Retrait confirmé", timeout: 90))
            attach(app, "live-fr-checkout-confirmed")
            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.loan").waitForExistence(timeout: 20))
            XCTAssertTrue(app.staticTexts["Emprunté par vous"].exists)
        }

        // 2. A return whose closing scan misses the asset: ANOMALY at the
        // deadline, the loan stays RETURN_PENDING and offers no return.
        try XCTContext.runActivity(named: "Return ending in ANOMALY") { _ in
            try prepareReturn(app, journey)
            try scanTheDisplayedCode(app, journey)
            XCTAssertTrue(waitForLabel(title(app), "Intervention requise", timeout: 240))
            XCTAssertFalse(app.staticTexts["Retour confirmé"].exists)
            attach(app, "live-fr-return-anomaly")
            leaveTheOperation(app)
            XCTAssertTrue(element(app, "activity.loan").waitForExistence(timeout: 20))
            XCTAssertTrue(waitForLabel(element(app, "activity.loan.due"), "Retour en attente de vérification."))
            XCTAssertFalse(app.buttons["activity.return"].exists, "An OPEN anomaly admits no new return.")
            attach(app, "live-fr-loan-return-pending")
        }

        // 3. Q2: once the administrator acknowledged the anomaly, the server
        // lists RETURN again; the new return closes the loan.
        try XCTContext.runActivity(named: "Q2 recovery after the acknowledgement") { _ in
            try request(journey, "acknowledge-anomaly")
            element(app, "activity.loan.refresh").tap()
            let returnButton = app.buttons["activity.return"]
            XCTAssertTrue(returnButton.waitForExistence(timeout: 20))
            XCTAssertTrue(waitUntilEnabled(returnButton))
            attach(app, "live-fr-loan-q2-return-listed")
            returnButton.tap()
            try scanTheDisplayedCode(app, journey)
            XCTAssertTrue(waitForLabel(title(app), "Retour confirmé", timeout: 90))
            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.empty").waitForExistence(timeout: 20))
        }

        // 4. Lost connection after the authorization, then the background:
        // never a cancellation or a confirmation until the server says so.
        try XCTContext.runActivity(named: "Checkout through a lost API and the background") { _ in
            try request(journey, "asset-ready")
            reserve(app, journey)
            prepare(app, "activity.checkout")
            try scanTheDisplayedCode(app, journey)
            try request(journey, "stop-api")
            XCTAssertTrue(element(app, "operation.interrupted").waitForExistence(timeout: 60))
            XCTAssertTrue(title(app).label.hasPrefix("Dernier état reçu"))
            XCTAssertFalse(element(app, "operation.done").exists)
            attach(app, "live-fr-checkout-api-lost")
            try request(journey, "start-api")
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertTrue(waitForLabel(title(app), "Retrait confirmé", timeout: 150))
            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.loan").waitForExistence(timeout: 20))
        }

        // 5. The app ends during the return: after a relaunch, the loan points
        // to the return in progress and « Reprendre » only reads it.
        try XCTContext.runActivity(named: "Return resumed after a relaunch") { _ in
            try prepareReturn(app, journey)
            try scanTheDisplayedCode(app, journey)
            app.terminate()
            app = launch(journey, resetSession: false)
            // A relaunch opens the default tab; « Reprendre » is on the loan card of « Mon activité ».
            XCTAssertTrue(app.tabBars.buttons["Mon activité"].waitForExistence(timeout: 30))
            app.tabBars.buttons["Mon activité"].tap()
            let resume = element(app, "activity.loan.resume")
            XCTAssertTrue(resume.waitForExistence(timeout: 30))
            XCTAssertEqual(element(app, "activity.operation.status").label, "Retour en cours")
            attach(app, "live-fr-loan-return-resume")
            resume.tap()
            XCTAssertTrue(waitForLabel(title(app), "Retour confirmé", timeout: 120))
            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.empty").waitForExistence(timeout: 20))
        }

        // 6. A real password change revokes every access token (ADR-018): the
        // next read ends the session, and the new password signs in again.
        try XCTContext.runActivity(named: "Revoked authentication") { _ in
            try request(journey, "rotate-password")
            // Pull to refresh Mon activité: its next read carries the old token.
            XCTAssertTrue(element(app, "activity.empty").exists)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
            XCTAssertTrue(app.textFields["signin.email"].waitForExistence(timeout: 30))
            XCTAssertTrue(app.staticTexts["Votre session n’est plus valide. Reconnectez-vous."].exists)
            attach(app, "live-fr-session-revoked")
            signIn(app, journey, prefilled: true)
            XCTAssertTrue(app.tabBars.buttons["Mon activité"].waitForExistence(timeout: 30))
        }
    }

    // MARK: Bridge

    /// Asks the script for a step it alone can do and waits for its answer.
    private func request(_ journey: Journey, _ name: String, timeout: TimeInterval = 180) throws {
        let done = journey.bridge.appendingPathComponent("done.\(name)")
        try? FileManager.default.removeItem(at: done)
        try Data().write(to: journey.bridge.appendingPathComponent("request.\(name)"))
        XCTAssertTrue(waitForFile(done, timeout: timeout), "The script did not answer \(name).")
        if let failure = try? String(contentsOf: done, encoding: .utf8), !failure.isEmpty {
            XCTFail("The script could not do \(name): \(failure)")
        }
    }

    /// Pastes the displayed QR into the Debug-only entry. The URI goes from
    /// the bridge file to the pasteboard and is never typed, logged or kept.
    @MainActor
    private func scanTheDisplayedCode(_ app: XCUIApplication, _ journey: Journey) throws {
        let field = element(app, "scan.debugCode")
        XCTAssertTrue(field.waitForExistence(timeout: 45), "The scan sheet opens once the hub displayed the code.")
        let file = journey.bridge.appendingPathComponent("qr")
        XCTAssertTrue(waitForFile(file, timeout: 30), "The bridge has no displayed code.")
        UIPasteboard.general.string = try String(contentsOf: file, encoding: .utf8)
        defer { UIPasteboard.general.items = [] }
        field.tap()
        field.tap()
        let paste = app.menuItems["Coller"]
        XCTAssertTrue(paste.waitForExistence(timeout: 10))
        paste.tap()
        UIPasteboard.general.items = []
        app.buttons["scan.debugSubmit"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 20), "The sheet closes once the server authorized.")
    }

    private func waitForFile(_ url: URL, timeout: TimeInterval) -> Bool {
        let exists = NSPredicate { _, _ in FileManager.default.fileExists(atPath: url.path) }
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: exists, object: nil)],
                              timeout: timeout) == .completed
    }

    // MARK: App

    @MainActor
    private func launch(_ journey: Journey, resetSession: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA"]
        app.launchEnvironment["AEGIS_API_BASE_URL"] = journey.address
        if resetSession { app.launchEnvironment["AEGIS_RESET_SESSION"] = "1" }
        app.launch()
        return app
    }

    @MainActor
    private func signIn(_ app: XCUIApplication, _ journey: Journey, prefilled: Bool = false) {
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 30))
        if !prefilled {
            email.tap()
            email.typeText(journey.technicianEmail)
        }
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.tap()
        password.typeText(journey.technicianPassword + "\n")
        XCTAssertTrue(app.tabBars.buttons["Équipements"].waitForExistence(timeout: 30))
    }

    /// Reserves the demo asset from the catalogue and lands on Mon activité.
    @MainActor
    private func reserve(_ app: XCUIApplication, _ journey: Journey) {
        app.tabBars.buttons["Équipements"].tap()
        // The tab keeps its stack: after the first reservation it still shows that asset's detail.
        let back = app.navigationBars.buttons["BackButton"]
        if back.exists { back.tap() }
        let card = element(app, "asset.card.AEG-DEMO-001")
        XCTAssertTrue(card.waitForExistence(timeout: 30))
        card.tap()
        let reserve = app.buttons["asset.reserve"]
        XCTAssertTrue(reserve.waitForExistence(timeout: 15))
        XCTAssertTrue(waitUntilEnabled(reserve, timeout: 30), "The demo asset is READY.")
        if !reserve.isHittable { app.swipeUp() }
        reserve.tap()
        let confirm = app.buttons["reservation.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 15))
        XCTAssertTrue(waitUntilEnabled(confirm))
        confirm.tap()
        XCTAssertTrue(element(app, "activity.reservation").waitForExistence(timeout: 20))
    }

    @MainActor
    private func prepare(_ app: XCUIApplication, _ identifier: String) {
        let button = app.buttons[identifier]
        XCTAssertTrue(button.waitForExistence(timeout: 20))
        XCTAssertTrue(waitUntilEnabled(button))
        button.tap()
    }

    /// The loan card reads the server once: when its `RETURN` hint is not
    /// listed yet, the designed path is one « Actualiser ». The server state
    /// is captured first and the run reports it, so it is never silent.
    @MainActor
    private func prepareReturn(_ app: XCUIApplication, _ journey: Journey) throws {
        let button = app.buttons["activity.return"]
        XCTAssertTrue(button.waitForExistence(timeout: 20))
        if !waitUntilEnabled(button, timeout: 10) {
            attach(app, "live-fr-return-not-listed")
            try request(journey, "diagnose")
            element(app, "activity.loan.refresh").tap()
            XCTAssertTrue(waitUntilEnabled(button), "RETURN is still not listed after « Actualiser ».")
        }
        button.tap()
    }

    /// A terminal screen other than CONFIRMED offers « Terminé » or « Fermer ».
    @MainActor
    private func leaveTheOperation(_ app: XCUIApplication) {
        let done = element(app, "operation.done")
        if done.exists { done.tap() } else { element(app, "operation.close").tap() }
    }

    @MainActor
    private func title(_ app: XCUIApplication) -> XCUIElement { element(app, "operation.title") }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor
    private func waitForLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 20) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label),
                                                    object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    @MainActor
    private func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval = 20) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"),
                                                    object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    /// Never taken while the code field holds text: the field is empty once
    /// the sheet closed.
    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
