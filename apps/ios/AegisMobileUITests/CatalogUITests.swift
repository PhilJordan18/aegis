import XCTest

/// Technician catalogue of the real app (#34). API answers come from the
/// Debug `AEGIS_UI_SCENARIO` hook and its FICTIONAL fixtures, never from a
/// backend. Screenshots are attached as fixture renders.
final class CatalogUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // A failed assertion inside a light/dark loop must not leave the
    // simulator dark for the next test.
    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
    }

    struct Language {
        let code: String
        let locale: String
        let texts: [String: String]

        subscript(_ key: String) -> String { texts[key]! }

        static let french = Language(code: "fr", locale: "fr_CA", texts: [
            "title": "Équipements", "lastKnown": "Dernier état", "blockedHeading": "Pourquoi il est bloqué",
            "noMatch": "Aucun équipement ne correspond.", "none": "Aucun équipement n’est encore disponible.",
            "gone": "Cet équipement n’est plus disponible.", "unreachable": "Connexion au service impossible. Vérifiez le réseau.",
            "notUpToDate": "Informations non actualisées depuis",
        ])
        static let english = Language(code: "en", locale: "en_CA", texts: [
            "title": "Equipment", "lastKnown": "Last known", "blockedHeading": "Why it's blocked",
            "noMatch": "No equipment matches.", "none": "No equipment is available yet.",
            "gone": "This equipment is no longer available.", "unreachable": "Can't reach the service. Check your network.",
            "notUpToDate": "Not up to date since",
        ])
    }

    private let leakedIdentifier = "E28011606000020FAKE0RFID"

    // MARK: Nominal

    @MainActor
    func testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances() throws {
        for language in [Language.french, .english] {
            for appearance in [XCUIDevice.Appearance.light, .dark] {
                XCUIDevice.shared.appearance = appearance
                let theme = appearance == .dark ? "dark" : "light"
                let app = launch(language, scenario: "catalog")

                XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))
                XCTAssertTrue(app.navigationBars[language["title"]].exists)
                try audit(app)
                attach(app, "\(language.code)-catalog-\(theme)")
                // On a small screen the evaluation footer is below the cards.
                XCTAssertTrue(reveal(app, element(app, "catalog.footer")))

                // Bloqué sends readiness=BLOCKED; the fixture server filters.
                app.buttons["catalog.filter.blocked"].tap()
                XCTAssertTrue(card(app, "MM-002").waitForExistence(timeout: 10))
                XCTAssertFalse(card(app, "MM-001").exists)
                XCTAssertTrue(app.buttons["catalog.filter.blocked"].isSelected)

                card(app, "MM-002").tap()
                XCTAssertTrue(element(app, "asset.name").waitForExistence(timeout: 10))
                XCTAssertTrue(app.staticTexts[language["blockedHeading"]].exists)
                XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "asset.reason").count, 2)
                assertNoIdentifierShown(app)
                try audit(app)
                attach(app, "\(language.code)-sheet-blocked-\(theme)")

                app.navigationBars.buttons.firstMatch.tap()
                XCTAssertTrue(card(app, "MM-002").waitForExistence(timeout: 10))
                app.terminate()
            }
        }
    }

    @MainActor
    func testEveryCardStatesItsStatusInWords() {
        let app = launch(.french, scenario: "catalog")
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))
        XCTAssertTrue(card(app, "MM-001").label.hasPrefix("Prêt, Multimètre 1, MM-001"))
        XCTAssertTrue(card(app, "MM-002").label.hasPrefix("Bloqué, Multimètre 2, MM-002"))
        XCTAssertTrue(card(app, "PA-004").label.hasPrefix("Emprunté, "))
        app.swipeUp()
        XCTAssertTrue(card(app, "TI-002").label.hasPrefix("À vérifier, "))
        XCTAssertTrue(card(app, "OS-001").label.hasPrefix("Indisponible, "))
        assertNoIdentifierShown(app)
    }

    // MARK: Empty

    @MainActor
    func testEmptyCatalogueOffersNoFilterToClear() {
        let app = launch(.english, scenario: "catalog-empty")
        XCTAssertTrue(app.staticTexts[Language.english["none"]].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["catalog.clearFilters"].exists)
    }

    @MainActor
    func testSearchWithoutMatchClearsItsFilters() throws {
        let app = launch(.french, scenario: "catalog")
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))

        let search = app.searchFields.firstMatch
        search.tap()
        search.typeText("zzz\n")
        XCTAssertTrue(app.staticTexts[Language.french["noMatch"]].waitForExistence(timeout: 10))
        try audit(app)
        attach(app, "fr-catalog-no-match-light")

        app.buttons["catalog.clearFilters"].tap()
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 10))
    }

    // MARK: Offline

    @MainActor
    func testOfflineRefreshKeepsTheLastListThenTryAgainRecovers() throws {
        for language in [Language.french, .english] {
            for appearance in [XCUIDevice.Appearance.light, .dark] {
                XCUIDevice.shared.appearance = appearance
                let theme = appearance == .dark ? "dark" : "light"
                let app = launch(language, scenario: "catalog-offline")
                XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))

                pullToRefresh(app)

                let notice = element(app, "catalog.notice")
                XCTAssertTrue(notice.waitForExistence(timeout: 15))
                XCTAssertTrue(notice.label.contains(language["unreachable"]))
                XCTAssertTrue(notice.label.contains(language["notUpToDate"]))
                XCTAssertTrue(card(app, "MM-001").label.contains(language["lastKnown"]))
                XCTAssertFalse(element(app, "catalog.footer").exists)
                // The refresh indicator must collapse before the audit, the
                // capture and the tap: a tap on a moving list only stops it.
                let retry = app.buttons["catalog.retry"]
                XCTAssertTrue(waitUntilSettled(retry))
                try audit(app)
                attach(app, "\(language.code)-catalog-offline-\(theme)")

                XCTAssertTrue(waitUntilSettled(retry))
                retry.tap()
                // A tap that lands while the scroll view is still ending the
                // pull's bounce only stops it (seen once on iOS 26): one more
                // tap on the settled button, never more.
                if !notice.waitForNonExistence(timeout: 5) {
                    XCTAssertTrue(waitUntilSettled(retry))
                    retry.tap()
                }
                XCTAssertTrue(notice.waitForNonExistence(timeout: 15))
                XCTAssertFalse(card(app, "MM-001").label.contains(language["lastKnown"]))
                app.terminate()
            }
        }
    }

    @MainActor
    func testOfflineSheetShowsTheLastKnownState() throws {
        let app = launch(.french, scenario: "catalog-detail-offline")
        XCTAssertTrue(card(app, "MM-002").waitForExistence(timeout: 30))
        card(app, "MM-002").tap()

        XCTAssertTrue(element(app, "asset.staleNote").waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "asset.status").label.contains(Language.french["lastKnown"]))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "asset.reason").count, 2)
        try audit(app)
        attach(app, "fr-sheet-offline-light")
    }

    @MainActor
    func testRemovedAssetOffersTheWayBack() throws {
        let app = launch(.english, scenario: "catalog-detail-gone")
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))
        card(app, "MM-001").tap()

        XCTAssertTrue(app.staticTexts[Language.english["gone"]].waitForExistence(timeout: 15))
        try audit(app)
        app.buttons["asset.backToList"].tap()
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 10))
    }

    // MARK: Accessibility sizes

    @MainActor
    func testLargestTextUsesTheFilterMenu() throws {
        let app = launch(.french, scenario: "catalog",
                         arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let menu = app.buttons["catalog.filterMenu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        XCTAssertTrue(menu.label.contains("Tous"))
        XCTAssertFalse(app.buttons["catalog.filter.blocked"].exists)
        XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 15))
        try audit(app, atLargestSize: true)
        attach(app, "fr-catalog-ax5-light")

        menu.tap()
        let blocked = app.buttons["Bloqué"]
        XCTAssertTrue(blocked.waitForExistence(timeout: 5))
        blocked.tap()
        XCTAssertTrue(menu.label.contains("Bloqué"))
        XCTAssertTrue(card(app, "MM-002").waitForExistence(timeout: 10))
    }

    // MARK: Helpers

    /// Scrolls down until the element exists, then back to the top so the
    /// filters stay reachable.
    @MainActor
    private func reveal(_ app: XCUIApplication, _ target: XCUIElement) -> Bool {
        var swipes = 0
        while !target.exists, swipes < 4 {
            app.swipeUp()
            swipes += 1
        }
        let found = target.exists
        for _ in 0..<swipes { app.swipeDown() }
        return found
    }

    @MainActor
    private func card(_ app: XCUIApplication, _ code: String) -> XCUIElement {
        element(app, "asset.card.\(code)")
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// The fixture puts an RFID identifier in one payload: it must never show.
    @MainActor
    private func assertNoIdentifierShown(_ app: XCUIApplication) {
        let predicate = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", leakedIdentifier, leakedIdentifier)
        XCTAssertEqual(app.descendants(matching: .any).matching(predicate).count, 0)
    }

    @MainActor
    private func pullToRefresh(_ app: XCUIApplication) {
        let start = card(app, "MM-001").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        // A quick pull, as a person makes it: a drag still held seconds after
        // the refresh ended leaves UIKit's list offset where the finger was.
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 420)),
                    withVelocity: XCUIGestureVelocity(1500), thenHoldForDuration: 0)
    }

    /// Waits until the element is hittable and its frame stops moving.
    @MainActor
    private func waitUntilSettled(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date.now + timeout
        var last = CGRect.null
        while Date.now < deadline {
            let frame = element.exists ? element.frame : .null
            if element.exists, element.isHittable, frame == last { return true }
            last = frame
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    @MainActor
    private func launch(_ language: Language, scenario: String, arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale] + arguments
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        app.launch()
        return app
    }

    /// Same policy as the sign-in tests: every issue fails, except reports
    /// on system rendering, each limited to where it occurs:
    /// - clipped text in the native single-line search field, and in the
    ///   native filter menu label at the largest size, which wraps in full
    ///   (see the `fr-catalog-ax5-light` capture);
    /// - the contrast of the system search field placeholder;
    /// - the hit region of the search field's own clear button;
    /// - contrast and Dynamic Type of an element only partly visible: cut by
    ///   the screen edge (horizontal filter chips) or under the iOS 26
    ///   floating tab bar, whose scroll-edge fade the audit samples. The same
    ///   element passes once scrolled into full view.
    /// - Dynamic Type of the filter chips, replaced by a menu at accessibility
    ///   sizes (checked by `testLargestTextUsesTheFilterMenu`).
    /// `atLargestSize` skips the Dynamic Type check when the text already uses
    /// the largest accessibility size and cannot grow further.
    /// Height above the floating tab bar covered by its scroll-edge fade.
    private let fadeHeight: CGFloat = 120

    @MainActor
    private func audit(_ app: XCUIApplication, atLargestSize: Bool = false) throws {
        let tabBar = app.tabBars.firstMatch
        let window = app.windows.firstMatch.frame
        var visible = window
        if tabBar.exists { visible.size.height = max(0, tabBar.frame.minY - fadeHeight - window.minY) }
        let search = app.searchFields.firstMatch
        let searchFrame = search.exists ? search.frame : .null
        // The chips give way to a menu at accessibility sizes (handoff §2):
        // the audit, enlarging the text, sees them disappear instead of grow.
        let chips = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'catalog.filter.'"))
            .allElementsBoundByIndex.reduce(CGRect.null) { $0.union($1.frame) }
        let menu = app.buttons["catalog.filterMenu"]
        let menuFrame = menu.exists ? menu.frame : .null
        // The system large title does not wrap: on a 375 pt screen
        // "Équipements" is truncated from AX3 (a known limit, reported).
        // Before iOS 26 the pixel sampling of the status chips reports "nearly
        // passed" for pairs above 5:1; their ratios are computed from the
        // asset catalogue by `StatusContrastTests`.
        let chipFrames = app.descendants(matching: .any).matching(identifier: "asset.status")
            .allElementsBoundByIndex.map(\.frame)
        let sampledChips = ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26
        let bar = app.navigationBars.firstMatch
        let largeTitle = bar.exists ? bar.frame : .null
        var types = XCUIAccessibilityAuditType.all
        if atLargestSize { types.remove(.dynamicType) }
        // Before iOS 26 the audit reads the chips giving way to the menu,
        // which moves every card, as sizes the cards do not support. There
        // the Dynamic Type proof is the AX5 test, which renders and audits
        // the list at the largest size.
        if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26 { types.remove(.dynamicType) }
        var unhandled: [String] = []
        try app.performAccessibilityAudit(for: types) { issue in
            let tolerated: Bool
            if let target = issue.element {
                let center = CGPoint(x: target.frame.midX, y: target.frame.midY)
                let summary = issue.compactDescription
                let nearlyInChip = sampledChips && summary.contains("nearly")
                    && chipFrames.contains { $0.contains(center) }
                switch issue.auditType {
                case .textClipped:
                    tolerated = [.textField, .searchField].contains(target.elementType)
                        || (atLargestSize && menuFrame.contains(center))
                        || largeTitle.contains(center)
                case .hitRegion:
                    tolerated = searchFrame.contains(center)
                case .dynamicType:
                    tolerated = !visible.contains(target.frame) || chips.contains(center)
                case .contrast:
                    // By type as well: after a pull the search field may have
                    // moved since its frame was read.
                    tolerated = !visible.contains(target.frame) || searchFrame.contains(center)
                        || target.elementType == .searchField || nearlyInChip
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
            // Every issue is collected, then reported together below.
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
