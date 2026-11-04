import XCTest

/// Reservation of the real app against the real API (#37, #38). Skipped
/// without the live variables; `scripts/ios-test.sh live` requires them and
/// fails if this test is skipped. Which path runs depends on the server and
/// is recorded as an activity: a ready asset is reserved, shown in « Mon
/// activité » and cancelled; without a ready asset (`dev` before PHY-02),
/// Reserve stays disabled with its reason.
final class ReservationLiveUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTechnicianReservesAReadyAssetFollowsItAndCancels() throws {
        let live = try SignInLiveUITests.Live()
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA"]
        app.launchEnvironment["AEGIS_API_BASE_URL"] = live.address
        app.launchEnvironment["AEGIS_RESET_SESSION"] = "1"
        app.launch()
        signIn(app, live)

        let cards = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'asset.card.'"))
        XCTAssertTrue(cards.firstMatch.waitForExistence(timeout: 30))
        app.buttons["catalog.filter.ready"].tap()
        XCTAssertTrue(app.buttons["catalog.filter.ready"].isSelected)
        guard cards.firstMatch.waitForExistence(timeout: 15) else {
            XCTContext.runActivity(named: "No ready asset: Reserve must stay disabled") { _ in }
            app.buttons["catalog.filter.all"].tap()
            XCTAssertTrue(cards.firstMatch.waitForExistence(timeout: 15))
            cards.firstMatch.tap()
            let reserve = app.buttons["asset.reserve"]
            XCTAssertTrue(reserve.waitForExistence(timeout: 15))
            XCTAssertFalse(reserve.isEnabled)
            XCTAssertTrue(element(app, "asset.reserveReason").exists)
            attach(app, "live-fr-sheet-reserve-disabled-light")
            return
        }

        cards.firstMatch.tap()
        let reserve = app.buttons["asset.reserve"]
        XCTAssertTrue(reserve.waitForExistence(timeout: 15))
        if !reserve.isHittable { app.swipeUp() }
        reserve.tap()
        let confirm = app.buttons["reservation.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "reservation.hours").waitForExistence(timeout: 15))
        attach(app, "live-fr-reservation-sheet-light")
        guard confirm.isEnabled else {
            XCTContext.runActivity(named: "Locker closed: Confirm disabled (\(element(app, "reservation.hours").label))") { _ in }
            return
        }
        confirm.tap()

        let reservation = element(app, "activity.reservation")
        let problem = element(app, "reservation.problem")
        let deadline = Date.now + 20
        while !reservation.exists, !problem.exists, Date.now < deadline { Thread.sleep(forTimeInterval: 0.5) }
        if problem.exists {
            XCTContext.runActivity(named: "Refused by the server: \(problem.label)") { _ in }
            XCTAssertFalse(problem.label.contains("SERVER"))
            attach(app, "live-fr-reservation-refused-light")
            return
        }
        XCTAssertTrue(reservation.exists)
        XCTAssertTrue(app.tabBars.buttons["Mon activité"].isSelected)
        XCTAssertTrue(app.staticTexts["Réservé pour vous"].exists)
        XCTAssertTrue(element(app, "activity.reservation.until").label.hasPrefix("À retirer avant"))
        attach(app, "live-fr-activity-reserved-light")

        app.buttons["activity.cancel"].tap()
        let confirmCancel = app.buttons["activity.cancel.confirm"].firstMatch
        XCTAssertTrue(confirmCancel.waitForExistence(timeout: 5))
        confirmCancel.tap()
        XCTAssertTrue(reservation.waitForNonExistence(timeout: 20))
        XCTAssertTrue(element(app, "activity.feedback").label.contains("Réservation annulée."))
        attach(app, "live-fr-activity-cancelled-light")
    }

    @MainActor
    private func signIn(_ app: XCUIApplication, _ live: SignInLiveUITests.Live) {
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 30))
        email.tap()
        email.typeText(live.technicianEmail + "\n")
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.typeText(live.technicianPassword + "\n")

        // Five sign-ins per minute per account (doc 09 §23.4), and the live
        // recipe signs in more often: the refusal is waited out as the screen
        // asks, then submitted again, once.
        let notice = element(app, "signin.notice")
        guard notice.waitForExistence(timeout: 5), notice.label.hasPrefix("Trop de tentatives") else { return }
        XCTContext.runActivity(named: "Sign-in rate limited by the server; waiting for Retry-After") { _ in }
        let submit = app.buttons["signin.submit"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: submit)
        XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 70), .completed)
        submit.tap()
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
