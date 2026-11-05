import XCTest

/// Reservation sheet and « Mon activité » of the real app (#37, #38). API
/// answers come from the Debug `AEGIS_UI_SCENARIO` hook and its FICTIONAL
/// fixtures, never from a backend. Screenshots are attached as fixture renders.
final class ReservationUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
    }

    struct Language {
        let code: String
        let locale: String
        let texts: [String: String]

        subscript(_ key: String) -> String { texts[key]! }

        static let french = Language(code: "fr", locale: "fr_CA", texts: [
            "activity": "Mon activité", "reservedForYou": "Réservé pour vous",
            "hoursUnavailable": "Heures d’ouverture indisponibles.", "confirmed": "Réservation confirmée jusqu’à",
            "cancelled": "Réservation annulée.", "loanUnknown": "Le prêt en cours n’a pas pu être vérifié.",
            "noReservation": "Aucune réservation en cours.",
            "notPresent": "Réservation impossible : présence non confirmée par le casier.",
            "unreachable": "Connexion au service impossible.", "closed": "Le casier est fermé. Réouverture à",
            "notCancellable": "Cette réservation ne peut plus être annulée.", "overdue": "En retard depuis",
        ])
        static let english = Language(code: "en", locale: "en_CA", texts: [
            "activity": "My activity", "reservedForYou": "Reserved for you",
            "hoursUnavailable": "Opening hours unavailable.", "confirmed": "Reservation confirmed until",
            "cancelled": "Reservation cancelled.", "loanUnknown": "Your current loan couldn’t be checked.",
            "noReservation": "No reservation in progress.",
            "notPresent": "Can’t reserve: presence not confirmed by the locker.",
            "unreachable": "Can’t connect to the service.", "closed": "The locker is closed. Reopens at",
            "notCancellable": "This reservation can no longer be cancelled.", "overdue": "Overdue since",
        ])
    }

    // MARK: Reserve, follow, cancel

    /// The whole path on fixtures: the hours route is missing as on `dev`,
    /// `GET /me/loan` answers 404 RESOURCE_NOT_FOUND, a read failure and not
    /// « no loan ». Its notice stays below the confirmation and the
    /// reservation, or below the empty state once cancelled (#38).
    @MainActor
    func testReserveThenCancelInBothLanguagesAndAppearances() throws {
        for (language, appearance) in [(Language.french, XCUIDevice.Appearance.light), (.english, .dark)] {
            XCUIDevice.shared.appearance = appearance
            let theme = appearance == .dark ? "dark" : "light"
            let app = launch(language, scenario: "reservation")
            openReservation(app)

            XCTAssertTrue(element(app, "reservation.until").waitForExistence(timeout: 15))
            XCTAssertTrue(element(app, "reservation.hours").label.hasPrefix(language["hoursUnavailable"]))
            XCTAssertTrue(element(app, "reservation.noDoor").exists)
            try audit(app)
            attach(app, "\(language.code)-reservation-sheet-\(theme)")

            app.buttons["reservation.confirm"].tap()
            let reservation = element(app, "activity.reservation")
            XCTAssertTrue(reservation.waitForExistence(timeout: 15))
            XCTAssertTrue(app.tabBars.buttons[language["activity"]].isSelected)
            XCTAssertTrue(element(app, "activity.feedback").label.contains(language["confirmed"]))
            XCTAssertTrue(app.staticTexts[language["reservedForYou"]].exists)
            XCTAssertTrue(element(app, "activity.reservation.until").exists)
            assertTopToBottom(app, [element(app, "activity.feedback"), reservation, loanNotice(app, language)])
            try audit(app)
            attach(app, "\(language.code)-activity-reserved-\(theme)")

            app.buttons["activity.cancel"].tap()
            let confirm = app.buttons["activity.cancel.confirm"].firstMatch
            XCTAssertTrue(confirm.waitForExistence(timeout: 5))
            confirm.tap()
            XCTAssertTrue(reservation.waitForNonExistence(timeout: 15))
            XCTAssertTrue(element(app, "activity.feedback").label.contains(language["cancelled"]))
            // The loan stays unknown: only the reservation is known to be absent.
            XCTAssertEqual(element(app, "activity.empty").label, language["noReservation"])
            assertTopToBottom(app, [element(app, "activity.feedback"), element(app, "activity.empty"),
                                    loanNotice(app, language)])
            try audit(app)
            attach(app, "\(language.code)-activity-cancelled-\(theme)")
            app.terminate()
        }
    }

    /// A loan read that fails while the reservation is read: the reservation
    /// comes first, the loan section carries the notice, its trace id and
    /// the retry, and the retry recovers without a false « no loan » before.
    @MainActor
    func testALoanReadFailureStaysInTheLoanSection() throws {
        let app = launch(.english, scenario: "activity-loan-unavailable", tab: "activity")
        let reservation = element(app, "activity.reservation")
        XCTAssertTrue(reservation.waitForExistence(timeout: 15))
        let notice = loanNotice(app, .english)
        XCTAssertTrue(notice.waitForExistence(timeout: 15))
        XCTAssertEqual(notice.identifier, "activity.loan.notice")
        XCTAssertTrue(notice.label.contains("5f4bc22e-66a4-48ef-8bf3-6e7184d71c30"))
        XCTAssertFalse(element(app, "activity.empty").exists)
        assertTopToBottom(app, [reservation, notice])
        let retry = app.buttons["activity.loan.retry"]
        assertTopToBottom(app, [notice, retry])
        try audit(app)
        attach(app, "en-activity-loan-unavailable")

        retry.tap()
        XCTAssertTrue(notice.waitForNonExistence(timeout: 15))
        XCTAssertTrue(reservation.exists)
        XCTAssertTrue(app.buttons["activity.cancel"].exists)
        XCTAssertFalse(element(app, "activity.empty").exists)
    }

    /// Production until PHY-02: 422 ASSET_NOT_READY with
    /// UNKNOWN_PHYSICAL_STATE is a refusal, never an outage to retry.
    @MainActor
    func testTheProductionRefusalReadsAsARefusal() throws {
        let app = launch(.english, scenario: "reservation-refused")
        openReservation(app)
        app.buttons["reservation.confirm"].tap()

        let problem = element(app, "reservation.problem")
        XCTAssertTrue(problem.waitForExistence(timeout: 15))
        XCTAssertTrue(problem.label.contains(Language.english["notPresent"]))
        XCTAssertFalse(app.buttons["reservation.retry"].exists)
        XCTAssertFalse(element(app, "activity.reservation").exists)
        try audit(app)
        attach(app, "en-reservation-refused-light")
    }

    /// The first answer is lost: Try again repeats the same intent with the
    /// same key. A new key would be refused 409 by the fixture server.
    @MainActor
    func testALostAnswerIsRetriedAsTheSameIntent() throws {
        let app = launch(.french, scenario: "reservation-offline")
        openReservation(app)
        app.buttons["reservation.confirm"].tap()

        let problem = element(app, "reservation.problem")
        XCTAssertTrue(problem.waitForExistence(timeout: 15))
        XCTAssertTrue(problem.label.contains(Language.french["unreachable"]))
        try audit(app)
        attach(app, "fr-reservation-offline-light")

        app.buttons["reservation.retry"].tap()
        XCTAssertTrue(element(app, "activity.reservation").waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "activity.feedback").label.contains(Language.french["confirmed"]))
    }

    @MainActor
    func testAClosedLockerCannotBeConfirmed() throws {
        let app = launch(.english, scenario: "reservation-closed")
        openReservation(app)

        let hours = element(app, "reservation.hours")
        XCTAssertTrue(hours.waitForExistence(timeout: 15))
        XCTAssertTrue(hours.label.hasPrefix(Language.english["closed"]))
        XCTAssertFalse(element(app, "reservation.until").exists)
        XCTAssertFalse(app.buttons["reservation.confirm"].isEnabled)
        try audit(app)
        attach(app, "en-reservation-closed-light")
    }

    /// Confirm stays reachable above the text at the largest size.
    @MainActor
    func testLargestTextKeepsConfirmReachable() throws {
        let app = launch(.french, scenario: "reservation",
                         arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openReservation(app)
        let confirm = app.buttons["reservation.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 15))
        XCTAssertTrue(confirm.isHittable)
        try audit(app, atLargestSize: true)
        attach(app, "fr-reservation-sheet-ax5-light")
    }

    // MARK: Activity states

    @MainActor
    func testMyOwnReservationReplacesReserveOnTheSheet() throws {
        let app = launch(.english, scenario: "activity-reserved")
        let card = element(app, "asset.card.MM-001")
        XCTAssertTrue(card.waitForExistence(timeout: 30))
        card.tap()

        let status = element(app, "asset.status")
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "asset.viewActivity").waitForExistence(timeout: 15))
        XCTAssertTrue(status.label.contains(Language.english["reservedForYou"]))
        XCTAssertFalse(app.buttons["asset.reserve"].exists)
        try audit(app)
        attach(app, "en-sheet-reserved-for-you-light")

        app.buttons["asset.viewActivity"].tap()
        XCTAssertTrue(element(app, "activity.reservation").waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["activity.cancel"].exists)
    }

    /// §14.4: the refused cancel reads the reservation again, which no longer
    /// lists CANCEL.
    @MainActor
    func testARefusedCancelFollowsTheNewRead() throws {
        let app = launch(.french, scenario: "activity-not-cancellable", tab: "activity")
        let cancel = app.buttons["activity.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 30))
        cancel.tap()
        let confirm = app.buttons["activity.cancel.confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()

        let feedback = element(app, "activity.feedback")
        XCTAssertTrue(feedback.waitForExistence(timeout: 15))
        XCTAssertTrue(feedback.label.contains(Language.french["notCancellable"]))
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 15))
        XCTAssertTrue(element(app, "activity.reservation").exists)
        try audit(app)
        attach(app, "fr-activity-not-cancellable-light")
    }

    /// The server says overdue; the app only shows it. Return equipment
    /// arrives with RET-01 (#50).
    @MainActor
    func testAnOverdueLoanInBothLanguages() throws {
        for (language, appearance) in [(Language.french, XCUIDevice.Appearance.dark), (.english, .light)] {
            XCUIDevice.shared.appearance = appearance
            let theme = appearance == .dark ? "dark" : "light"
            let app = launch(language, scenario: "activity-loan", tab: "activity")
            let due = element(app, "activity.loan.due")
            XCTAssertTrue(due.waitForExistence(timeout: 30))
            XCTAssertTrue(due.label.contains(language["overdue"]))
            XCTAssertFalse(element(app, "activity.reservation").exists)
            XCTAssertFalse(element(app, "activity.empty").exists)
            try audit(app)
            attach(app, "\(language.code)-activity-loan-\(theme)")
            app.terminate()
        }
    }

    // MARK: Helpers

    /// The loan read failure, found by its words so the order is checked
    /// wherever the notice sits.
    @MainActor
    private func loanNotice(_ app: XCUIApplication, _ language: Language) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", language["loanUnknown"])).firstMatch
    }

    /// Reading order, which VoiceOver follows in this single column.
    @MainActor
    private func assertTopToBottom(_ app: XCUIApplication, _ elements: [XCUIElement],
                                   file: StaticString = #filePath, line: UInt = #line) {
        let frames = elements.map(\.frame)
        for (element, frame) in zip(elements, frames) {
            XCTAssertTrue(element.exists, "missing \(element)", file: file, line: line)
            XCTAssertFalse(frame.isEmpty, "no frame for \(element)", file: file, line: line)
        }
        for (upper, lower) in zip(frames, frames.dropFirst()) {
            XCTAssertLessThanOrEqual(upper.maxY, lower.minY, "\(upper) is not above \(lower)", file: file, line: line)
        }
    }

    @MainActor
    private func openReservation(_ app: XCUIApplication) {
        let card = element(app, "asset.card.MM-001")
        XCTAssertTrue(card.waitForExistence(timeout: 30))
        card.tap()
        let reserve = app.buttons["asset.reserve"]
        XCTAssertTrue(reserve.waitForExistence(timeout: 15))
        XCTAssertTrue(waitUntilEnabled(reserve))
        if !reserve.isHittable { app.swipeUp() }
        reserve.tap()
        XCTAssertTrue(app.buttons["reservation.confirm"].waitForExistence(timeout: 15))
    }

    @MainActor
    private func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval = 15) -> Bool {
        let deadline = Date.now + timeout
        while Date.now < deadline {
            if element.isEnabled { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor
    private func launch(_ language: Language, scenario: String, tab: String? = nil,
                        arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale] + arguments
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        if let tab { app.launchEnvironment["AEGIS_START_TAB"] = tab }
        app.launch()
        return app
    }

    /// Height above the floating tab bar covered by its scroll-edge fade.
    private let fadeHeight: CGFloat = 120

    /// The catalogue policy: every issue fails, except reports on system
    /// rendering, each limited to where it occurs:
    /// - contrast and Dynamic Type of an element only partly visible, cut by
    ///   the screen edge or under the iOS 26 floating tab bar's fade;
    /// - the non-wrapping system large title at accessibility sizes;
    /// - Dynamic Type of navigation bar items, which the system caps;
    /// - before iOS 26, "nearly passed" contrast sampled in the status chips,
    ///   whose ratios `StatusContrastTests` computes from the asset catalogue.
    /// `atLargestSize` skips the Dynamic Type check: the text cannot grow.
    @MainActor
    private func audit(_ app: XCUIApplication, atLargestSize: Bool = false) throws {
        XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing; the audit needs a still screen.")
        let tabBar = app.tabBars.firstMatch
        let window = app.windows.firstMatch.frame
        var visible = window
        if tabBar.exists, tabBar.isHittable {
            visible.size.height = max(0, tabBar.frame.minY - fadeHeight - window.minY)
        }
        let chipFrames = app.descendants(matching: .any).matching(identifier: "asset.status")
            .allElementsBoundByIndex.map(\.frame)
        let sampledChips = ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26
        let bar = app.navigationBars.firstMatch
        let largeTitle = bar.exists ? bar.frame : .null
        let bars = app.navigationBars.allElementsBoundByIndex.map(\.frame)
        var types = XCUIAccessibilityAuditType.all
        if atLargestSize { types.remove(.dynamicType) }
        var unhandled: [String] = []
        try app.performCompletedAccessibilityAudit(for: types) { issue in
            let tolerated: Bool
            if let target = issue.element {
                let center = CGPoint(x: target.frame.midX, y: target.frame.midY)
                let summary = issue.compactDescription
                let nearlyInChip = sampledChips && summary.contains("nearly")
                    && chipFrames.contains { $0.contains(center) }
                switch issue.auditType {
                case .textClipped:
                    tolerated = largeTitle.contains(center)
                case .dynamicType:
                    // System bar items (Close) do not grow by design; UIKit
                    // shows them in the Large Content Viewer instead.
                    tolerated = !visible.contains(target.frame) || bars.contains { $0.contains(center) }
                case .contrast:
                    tolerated = !visible.contains(target.frame) || nearlyInChip
                default:
                    tolerated = false
                }
            } else {
                tolerated = false
            }
            if !tolerated {
                let element = issue.element.map { "\($0.elementType) '\($0.label)' id=\($0.identifier) frame=\($0.frame)" } ?? "none"
                unhandled.append("\(issue.compactDescription) — \(element) — \(issue.detailedDescription)")
            }
            return true
        }
        if !unhandled.isEmpty {
            let report = XCTAttachment(string: (["visible=\(visible)"] + unhandled).joined(separator: "\n"))
            report.name = "audit-issues"
            report.lifetime = .keepAlways
            add(report)
            XCTFail("Accessibility audit: \(unhandled.joined(separator: " | "))")
        }
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
