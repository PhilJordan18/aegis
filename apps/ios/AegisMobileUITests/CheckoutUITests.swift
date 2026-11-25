import XCTest

/// Guided checkout (#46) and return (#50) of the real app: preparation, the
/// scan sheet, the progress read from the server, refusals, interruption and
/// resumption. API
/// answers come from the Debug `AEGIS_UI_SCENARIO` hook and its FICTIONAL
/// fixtures. The code is typed into the Debug-only field, which goes through
/// the same parser and `authorize-local` call as the camera: these tests say
/// nothing about the camera permission or the optical reading, which are
/// validated on a real iPhone only.
final class CheckoutUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
    }

    /// The fictional code of `UITestActivityFixtures`.
    private static let code = "aegis://local-access?v=1&challengeId=9d65cbae-4610-4e40-a314-3b93af07be9c&operationId=2f38d3b6-c18f-4a74-aa9a-2d574286013f&lockerId=d46a74ae-39dc-460b-8af0-38fc791b376a&token="
        + String(Data((0..<32).map(UInt8.init)).base64EncodedString().dropLast())
    private static let retryCode = code.replacingOccurrences(of: "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
                                                             with: "6c2a9e41-5d3b-4f7a-8e0c-1b2d3f4a5c6e")

    struct Language {
        let code: String
        let locale: String
        let texts: [String: String]

        subscript(_ key: String) -> String { texts[key]! }

        static let french = Language(code: "fr", locale: "fr_CA", texts: [
            "scan": "Scannez le code du casier", "confirmed": "Retrait confirmé",
            "refused": "Code refusé. Scannez à nouveau l’écran du casier.",
            "offline": "Le casier est hors ligne. Réessayez plus tard.", "attempt": "Essai de",
            "retryCheckout": "Nouvelle tentative de retrait", "expired": "Délai dépassé",
            "lastReceived": "Dernier état reçu", "inProgress": "Retrait en cours",
            "commandSent": "Commande transmise au casier", "borrowed": "Emprunté par vous",
            "returnConfirmed": "Retour confirmé", "returnInProgress": "Retour en cours",
            "noLongerPossible": "Cette action n’est plus possible.",
            "returnUnavailable": "Retour indisponible pour le moment. Actualisez pour vérifier à nouveau.",
        ])
        static let english = Language(code: "en", locale: "en_CA", texts: [
            "scan": "Scan the locker code", "confirmed": "Checkout confirmed",
            "refused": "Code refused. Scan the locker screen again.",
            "offline": "The locker is offline. Try again later.", "attempt": "Attempt at",
            "retryCheckout": "Try checkout again", "expired": "Time limit reached",
            "lastReceived": "Last status received", "inProgress": "Checkout in progress",
            "commandSent": "Command sent to the locker", "borrowed": "Borrowed by you",
            "returnConfirmed": "Return confirmed", "returnInProgress": "Return in progress",
            "noLongerPossible": "This action is no longer possible.",
            "returnUnavailable": "Return isn’t available right now. Refresh to check again.",
        ])
    }

    /// The whole path. Only CONFIRMED read from the server shows a success;
    /// the loan appears in Mon activité only after it.
    @MainActor
    func testGuidedCheckoutReachesConfirmedOnlyFromTheServer() throws {
        for (language, appearance) in [(Language.french, XCUIDevice.Appearance.light), (.english, .dark)] {
            XCUIDevice.shared.appearance = appearance
            let theme = appearance == .dark ? "dark" : "light"
            let app = launch(language, scenario: "checkout")

            prepare(app)
            XCTAssertTrue(waitForLabel(title(app), language["scan"]))
            let field = element(app, "scan.debugCode")
            XCTAssertTrue(field.waitForExistence(timeout: 10), "The scan sheet opens once the code is displayed.")
            attach(app, "\(language.code)-checkout-scan-\(theme)")
            try audit(app)

            submit(app, Self.code)
            XCTAssertTrue(field.waitForNonExistence(timeout: 10), "The sheet closes once the server authorized.")
            XCTAssertFalse(app.staticTexts[language["confirmed"]].exists)
            XCTAssertFalse(element(app, "operation.done").exists)
            XCTAssertTrue(element(app, "operation.countdown").waitForExistence(timeout: 5))

            XCTAssertTrue(waitForLabel(title(app), language["confirmed"], timeout: 30))
            XCTAssertFalse(element(app, "operation.closeNote").exists)
            attach(app, "\(language.code)-checkout-confirmed-\(theme)")
            try audit(app)

            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.loan").waitForExistence(timeout: 15))
            XCTAssertTrue(app.staticTexts[language["borrowed"]].exists)
            XCTAssertFalse(element(app, "activity.reservation").exists)
            app.terminate()
        }
    }

    /// A refused code drops the secret: a new reading is needed, which the
    /// server then accepts.
    @MainActor
    func testARefusedCodeNeedsANewScan() throws {
        let app = launch(.french, scenario: "checkout-refused")
        prepare(app)
        XCTAssertTrue(element(app, "scan.debugCode").waitForExistence(timeout: 10))

        submit(app, Self.code)
        let notice = element(app, "scan.notice")
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertTrue(notice.label.contains(Language.french["refused"]))
        attach(app, "fr-checkout-scan-refused-light")
        try audit(app)

        element(app, "scan.again").tap()
        submit(app, Self.code)
        XCTAssertTrue(element(app, "scan.debugCode").waitForNonExistence(timeout: 10))
        XCTAssertTrue(waitForLabel(title(app), Language.french["confirmed"], timeout: 30))
    }

    /// `503 LOCKER_OFFLINE`: no guided operation opens; the card keeps the
    /// server's actions and names the attempt (handoff §6 variant A).
    @MainActor
    func testAnOfflineLockerOffersANewAttempt() throws {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "checkout-offline")
            prepare(app)

            let feedback = element(app, "activity.feedback")
            XCTAssertTrue(feedback.waitForExistence(timeout: 10))
            XCTAssertTrue(feedback.label.contains(language["offline"]))
            XCTAssertFalse(title(app).exists)
            XCTAssertTrue(element(app, "activity.checkout.notice").waitForExistence(timeout: 10))
            XCTAssertTrue(element(app, "activity.checkout.notice").label.hasPrefix(language["attempt"]))
            XCTAssertEqual(element(app, "activity.checkout").label, language["retryCheckout"])
            attach(app, "\(language.code)-activity-checkout-offline-light")
            try audit(app)
            app.terminate()
        }
    }

    /// `EXPIRED` read from the server: « Recommencer » prepares a new
    /// operation; nothing is reused from the expired one.
    @MainActor
    func testAnExpiredOperationStartsAgainThroughANewPreparation() throws {
        let app = launch(.english, scenario: "checkout-expired")
        prepare(app)
        XCTAssertTrue(element(app, "scan.debugCode").waitForExistence(timeout: 10))
        submit(app, Self.code)

        XCTAssertTrue(waitForLabel(title(app), Language.english["expired"], timeout: 15))
        attach(app, "en-checkout-expired-light")
        try audit(app)

        element(app, "operation.restart").tap()
        XCTAssertTrue(element(app, "scan.debugCode").waitForExistence(timeout: 15),
                      "A new preparation opens a new scan.")
        submit(app, Self.code)
        // The first code belongs to the expired operation: it is never sent.
        let notice = element(app, "scan.notice")
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        submit(app, Self.retryCode)
        XCTAssertTrue(element(app, "scan.debugCode").waitForNonExistence(timeout: 10))
    }

    /// Lost reads after the authorization: the last state received stays,
    /// named as such, with no cancellation or confirmation claimed.
    @MainActor
    func testALostConnectionIsNeitherACancellationNorAConfirmation() throws {
        let app = launch(.french, scenario: "checkout-network-lost")
        prepare(app)
        XCTAssertTrue(element(app, "scan.debugCode").waitForExistence(timeout: 10))
        submit(app, Self.code)

        XCTAssertTrue(element(app, "operation.interrupted").waitForExistence(timeout: 15))
        XCTAssertTrue(title(app).label.hasPrefix(Language.french["lastReceived"]))
        XCTAssertFalse(element(app, "operation.done").exists)
        attach(app, "fr-checkout-network-lost-light")
        try audit(app)
    }

    /// After a relaunch, the reservation points to an operation in progress:
    /// « Reprendre » reads it again; « Fermer » hides it without cancelling.
    @MainActor
    func testCloseHidesAndResumeReadsAgain() throws {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "checkout-resume")
            let status = element(app, "activity.operation.status")
            XCTAssertTrue(status.waitForExistence(timeout: 15))
            XCTAssertEqual(status.label, language["inProgress"])
            XCTAssertTrue(element(app, "activity.operation.hidden").exists)
            // « Reprendre » takes the place of the preparation: no second one.
            XCTAssertFalse(element(app, "activity.checkout").exists)
            attach(app, "\(language.code)-activity-operation-hidden-light")
            try audit(app)

            element(app, "activity.resume").tap()
            XCTAssertTrue(waitForLabel(title(app), language["commandSent"]))
            XCTAssertTrue(element(app, "operation.closeNote").exists)
            attach(app, "\(language.code)-checkout-command-sent-light")
            try audit(app)

            element(app, "operation.close").tap()
            XCTAssertTrue(element(app, "activity.resume").waitForExistence(timeout: 10))
            XCTAssertTrue(element(app, "activity.operation.status").exists)
            app.terminate()
        }
    }

    // MARK: Return (#50)

    /// The whole return. The loan stays in Mon activité until CONFIRMED is
    /// read from the server; only then does a new read find no loan.
    @MainActor
    func testGuidedReturnReachesConfirmedOnlyFromTheServer() throws {
        for (language, appearance) in [(Language.french, XCUIDevice.Appearance.light), (.english, .dark)] {
            XCUIDevice.shared.appearance = appearance
            let theme = appearance == .dark ? "dark" : "light"
            let app = launch(language, scenario: "return")
            XCTAssertTrue(element(app, "activity.loan").waitForExistence(timeout: 15))
            attach(app, "\(language.code)-activity-loan-return-\(theme)")
            try audit(app)

            prepare(app, "activity.return")
            let field = element(app, "scan.debugCode")
            XCTAssertTrue(field.waitForExistence(timeout: 10), "The scan sheet opens once the code is displayed.")
            submit(app, Self.code)
            XCTAssertTrue(field.waitForNonExistence(timeout: 10), "The sheet closes once the server authorized.")
            XCTAssertFalse(app.staticTexts[language["returnConfirmed"]].exists)
            XCTAssertFalse(element(app, "operation.done").exists)

            XCTAssertTrue(waitForLabel(title(app), language["returnConfirmed"], timeout: 30))
            attach(app, "\(language.code)-return-confirmed-\(theme)")
            try audit(app)

            element(app, "operation.done").tap()
            XCTAssertTrue(element(app, "activity.empty").waitForExistence(timeout: 15))
            XCTAssertFalse(element(app, "activity.loan").exists)
            app.terminate()
        }
    }

    /// `409 LOAN_NOT_RETURNABLE`: no guided return opens, the loan is read
    /// again and, without `RETURN`, the button is disabled and explained.
    @MainActor
    func testANoLongerReturnableLoanIsReadAgain() throws {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "return-refused")
            prepare(app, "activity.return")

            let feedback = element(app, "activity.feedback")
            XCTAssertTrue(feedback.waitForExistence(timeout: 10))
            XCTAssertTrue(feedback.label.contains(language["noLongerPossible"]))
            XCTAssertFalse(title(app).exists)
            let notice = element(app, "activity.return.notice")
            XCTAssertTrue(notice.waitForExistence(timeout: 10))
            XCTAssertTrue(notice.label.contains(language["returnUnavailable"]))
            XCTAssertFalse(app.buttons["activity.return"].isEnabled)
            XCTAssertTrue(element(app, "activity.loan").exists, "A refusal never ends the loan.")
            attach(app, "\(language.code)-activity-return-refused-light")
            try audit(app)
            app.terminate()
        }
    }

    /// After a relaunch, the loan points to a return in progress: « Reprendre »
    /// reads it again; « Fermer » hides it without cancelling.
    @MainActor
    func testAHiddenReturnResumesFromTheLoan() throws {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "return-resume")
            let status = element(app, "activity.operation.status")
            XCTAssertTrue(status.waitForExistence(timeout: 15))
            XCTAssertEqual(status.label, language["returnInProgress"])
            XCTAssertTrue(element(app, "activity.loan.operation.hidden").exists)
            XCTAssertFalse(element(app, "activity.return").exists, "« Reprendre » takes the place of the return.")
            attach(app, "\(language.code)-activity-return-hidden-light")
            try audit(app)

            element(app, "activity.loan.resume").tap()
            XCTAssertTrue(waitForLabel(title(app), language["commandSent"]))
            attach(app, "\(language.code)-return-command-sent-light")
            try audit(app)

            element(app, "operation.close").tap()
            XCTAssertTrue(element(app, "activity.loan.resume").waitForExistence(timeout: 10))
            XCTAssertTrue(element(app, "activity.loan").exists)
            app.terminate()
        }
    }

    // MARK: Helpers

    @MainActor
    private func prepare(_ app: XCUIApplication, _ identifier: String = "activity.checkout") {
        let button = app.buttons[identifier]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        XCTAssertTrue(waitUntilEnabled(button))
        button.tap()
    }

    @MainActor
    private func submit(_ app: XCUIApplication, _ code: String) {
        let field = element(app, "scan.debugCode")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(code)
        app.buttons["scan.debugSubmit"].tap()
    }

    @MainActor
    private func title(_ app: XCUIApplication) -> XCUIElement { element(app, "operation.title") }

    @MainActor
    private func waitForLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 15) -> Bool {
        let predicate = NSPredicate(format: "label == %@", label)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    @MainActor
    private func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval = 15) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"),
                                                    object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor
    private func launch(_ language: Language, scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale]
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        app.launchEnvironment["AEGIS_START_TAB"] = "activity"
        app.launch()
        return app
    }

    /// Height above the floating tab bar covered by its scroll-edge fade.
    private let fadeHeight: CGFloat = 120

    /// A text that the iOS 26 contrast audit, at an accessibility size, failed
    /// on a sample it took after scrolling the screen itself (#207). The
    /// texts it failed measure 8:1 to 17:1 in the catalogue, and the frames
    /// read in the handler are the ones after its scroll, so they cannot place
    /// the sample. Each entry names the element by an identifier the app sets,
    /// the only tests where it was observed, and the colour pair that
    /// `StatusContrastTests` proves in light and dark. The flagged node is the
    /// inner text of that element and carries no identifier, so it is matched
    /// by its frame lying inside the identified element. It is then measured
    /// on the pixels drawn at that moment, and passes only at 4.5:1 or more.
    /// Any other contrast issue, an issue without an element, or one of these
    /// elements in another test or configuration still fails.
    private struct SampledContrast {
        let anchor: String
        let pair: String
        let tests: Set<String>
    }

    private static let sampledContrast = [
        SampledContrast(anchor: "activity.asset.name", pair: "BrandText on BrandPanel",
                        tests: ["testAnOfflineLockerOffersANewAttempt", "testANoLongerReturnableLoanIsReadAgain"]),
        SampledContrast(anchor: "asset.status", pair: "StatusMineText on StatusMineFill",
                        tests: ["testAnOfflineLockerOffersANewAttempt"]),
        // A countdown: its digits change while the audit runs, so the sample
        // may also be a re-rendered label, not only a scrolled one.
        SampledContrast(anchor: "operation.proofCountdown", pair: "BrandText on BrandPanel",
                        tests: ["testARefusedCodeNeedsANewScan"]),
        // The same scan sheet: the audit failed the countdown on some runs and
        // this message on others.
        SampledContrast(anchor: "scan.cameraMessage", pair: "BrandText on BrandPanel",
                        tests: ["testARefusedCodeNeedsANewScan"]),
    ]

    /// The listed element whose frame holds `target`, if `target` is a text.
    @MainActor
    private static func sampledElement(_ target: XCUIElement, in app: XCUIApplication,
                                       among entries: [SampledContrast]) -> SampledContrast? {
        guard target.elementType == .staticText else { return nil }
        let frame = target.frame
        return entries.first { entry in
            app.descendants(matching: .any).matching(identifier: entry.anchor).allElementsBoundByIndex
                .contains { $0.frame.insetBy(dx: -1, dy: -1).contains(frame) }
        }
    }

    /// The running test method, as listed in `SampledContrast.tests`.
    private var testMethod: String {
        String(name.split(separator: " ").last?.dropLast() ?? "")
    }

    /// The policy of `ReservationUITests`: every issue fails, except system
    /// rendering limited to where it occurs (partly visible elements, system
    /// bar items that do not grow, the non-wrapping large title). A contrast
    /// issue on a partly visible element is measured on its visible part
    /// (#208): a faint text the audit reported there must fail.
    @MainActor
    private func audit(_ app: XCUIApplication) throws {
        if !waitForStillScreen(app) {
            reportMotion(app)
            XCTFail("The screen kept changing; the audit needs a still screen.")
        }
        let tabBar = app.tabBars.firstMatch
        let window = app.windows.firstMatch.frame
        var visible = window
        if tabBar.exists, tabBar.isHittable {
            visible.size.height = max(0, tabBar.frame.minY - fadeHeight - window.minY)
        }
        let bar = app.navigationBars.firstMatch
        let largeTitle = bar.exists ? bar.frame : .null
        let bars = app.navigationBars.allElementsBoundByIndex.map(\.frame)
        // These tests do not override the text size: the device setting read
        // here is the app's.
        let sampled = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
            && UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory
            ? Self.sampledContrast.filter { $0.tests.contains(testMethod) } : []
        var unhandled: [String] = []
        var accepted: [String] = []
        var ignored: [String] = []
        try app.performMeasuredAccessibilityAudit(for: .all) { issue in
            var note = ""
            let tolerated: Bool
            if let target = issue.element {
                let center = CGPoint(x: target.frame.midX, y: target.frame.midY)
                switch issue.auditType {
                case .textClipped:
                    tolerated = largeTitle.contains(center)
                case .dynamicType:
                    tolerated = !visible.contains(target.frame) || bars.contains { $0.contains(center) }
                case .contrast:
                    switch self.visiblePartContrast(of: target, visible: visible, window: window, in: app) {
                    case let .nothingToMeasure(reason):
                        tolerated = true
                        note = " (\(reason))"
                    case let .measured(passed, line):
                        // Partly visible: the visible part is measured, never trusted.
                        tolerated = passed
                        if passed { accepted.append(line) } else { unhandled.append("Contrast below 4.5:1 — \(line)") }
                    case .entirelyVisible:
                        if let known = Self.sampledElement(target, in: app, among: sampled) {
                            let shot = target.screenshot()
                            let ratio = RenderedContrast.ratio(of: shot.image) ?? 0
                            tolerated = ratio >= 4.5
                            let line = "'\(target.label)' frame=\(target.frame) in \(known.anchor) (\(known.pair)): "
                                + String(format: "rendered %.2f:1", ratio)
                            let evidence = XCTAttachment(screenshot: shot)
                            evidence.name = "audit-sampled-contrast-\(known.anchor)"
                            evidence.lifetime = .keepAlways
                            self.add(evidence)
                            if tolerated { accepted.append(line) } else { unhandled.append("Contrast below 4.5:1 — \(line)") }
                        } else {
                            tolerated = false
                        }
                    }
                default:
                    tolerated = false
                }
            } else {
                tolerated = false
            }
            let element = issue.element.map { "\($0.elementType) '\($0.label)' id=\($0.identifier) frame=\($0.frame)" } ?? "none"
            if tolerated {
                ignored.append("\(issue.compactDescription) — \(element)\(note)")
            } else {
                unhandled.append("\(issue.compactDescription) — \(element) — \(issue.detailedDescription)")
            }
            return true
        }
        // Every tolerated issue stays visible in the result: a rule that hides
        // an issue must not look like an audit that found nothing.
        if !ignored.isEmpty {
            let report = XCTAttachment(string: (["visible=\(visible)"] + ignored).joined(separator: "\n"))
            report.name = "audit-tolerated"
            report.lifetime = .keepAlways
            add(report)
        }
        if !accepted.isEmpty {
            let report = XCTAttachment(string: accepted.joined(separator: "\n"))
            report.name = "audit-sampled-contrast"
            report.lifetime = .keepAlways
            add(report)
        }
        if !unhandled.isEmpty {
            let report = XCTAttachment(string: (["visible=\(visible)"] + unhandled).joined(separator: "\n"))
            report.name = "audit-issues"
            report.lifetime = .keepAlways
            add(report)
            XCTFail("Accessibility audit: \(unhandled.joined(separator: " | "))")
        }
    }

    /// `waitForStillScreen` of the other suites, except for the descendants
    /// of the guided countdown: its digits are meant to tick every second.
    /// The countdown element itself (label « Temps restant », frame) is still
    /// compared, and the audit still covers it.
    @MainActor
    private func waitForStillScreen(_ app: XCUIApplication, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date.now + timeout
        var last: [String]?
        var stillFor = 0
        while Date.now < deadline {
            let current = (try? app.snapshot()).map(Self.signature) ?? []
            stillFor = current == last ? stillFor + 1 : 0
            if stillFor >= 2 { return true }
            last = current
            Thread.sleep(forTimeInterval: 0.4)
        }
        return false
    }

    private static let liveClocks: Set<String> = ["operation.countdown"]

    @MainActor
    private static func signature(_ root: any XCUIElementSnapshot) -> [String] {
        var lines: [String] = []
        var pending: [any XCUIElementSnapshot] = [root]
        while let element = pending.popLast() {
            lines.append("\(element.elementType.rawValue)|\(element.identifier)|\(element.label)|\(element.frame)")
            if !liveClocks.contains(element.identifier) { pending.append(contentsOf: element.children) }
        }
        return lines
    }

    /// Names what moved between two snapshots, so a still-screen failure
    /// points to its element instead of failing blind.
    @MainActor
    private func reportMotion(_ app: XCUIApplication) {
        func lines() -> Set<String> {
            guard let root = try? app.snapshot() else { return [] }
            var result: Set<String> = []
            var pending: [any XCUIElementSnapshot] = [root]
            while let element = pending.popLast() {
                result.insert("\(element.elementType.rawValue)|\(element.identifier)|\(element.label)|\(element.frame)")
                pending.append(contentsOf: element.children)
            }
            return result
        }
        let first = lines()
        let second = XCTWaiter.wait(for: [XCTestExpectation(description: "motion window")], timeout: 1.5) == .timedOut
            ? lines() : first
        let moved = first.symmetricDifference(second).sorted()
        let report = XCTAttachment(string: moved.isEmpty ? "no difference in 1.5 s" : moved.joined(separator: "\n"))
        report.name = "motion"
        report.lifetime = .keepAlways
        add(report)
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
