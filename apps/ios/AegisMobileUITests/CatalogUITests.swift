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
        // Appearance is the outer loop so the run switches light to dark once and never dark to
        // light: in 12 hosted runs every audit slower than 10 s, including the three that XCTest
        // abandoned, came right after a dark-to-light switch or was the cold first audit (#67).
        // This is a hypothesis under measurement; all four combinations are still audited, and
        // the test still ends in dark mode, as before, for the tests that follow.
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            for language in [Language.french, .english] {
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
                // MM-002 was already listed: the filtered answer is the one
                // without MM-001.
                XCTAssertTrue(card(app, "MM-001").waitForNonExistence(timeout: 10))
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

    // MARK: Pages

    /// The search field and the status chips on screen, measured on their
    /// render in light and dark (2026-11-26): an automatic exclusion is no
    /// proof. Each measure keeps its crop, its conditions and its result,
    /// and fails below 4.5:1, a chip's symbol included. The chips are read
    /// at the top of the list and again after one swipe, and the five of the
    /// scenario must all be measured. The magnifier is measured on its own
    /// crop, where it is not a minor share of the pixels, and the prompt and
    /// magnifier again after the asset sheet and after a search was typed,
    /// deleted and closed, since SwiftUI may redraw the field. `TEST_RUNNER_AEGIS_CONTRAST`
    /// names a contrast setting applied to the simulator for the record.
    @MainActor
    func testSearchFieldAndStatusChipsReachContrastOnTheirRender() throws {
        var below: [String] = []
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = appearance
            let theme = appearance == .dark ? "dark" : "light"
            let app = launch(.french, scenario: "catalog")
            XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 30))
            XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing; the measure needs a still screen.")
            let window = app.windows.firstMatch.frame
            let search = app.searchFields.firstMatch
            XCTAssertTrue(search.exists, "\(theme): no search field to measure")
            // Every measure is taken before any verdict, so that one failure
            // does not hide the others.
            var lines: [String] = []
            func measure(_ target: XCUIElement, _ moment: String = "") {
                guard case let .measured(passed, measured) = entireContrast(of: target, window: window, in: app) else {
                    return below.append("\(theme): '\(target.label)' was not measured")
                }
                let line = moment.isEmpty ? measured : "\(moment): \(measured)"
                lines.append(line)
                if !passed { below.append("\(theme): \(line)") }
            }
            // The magnifier sits at the leading end of the field: three
            // quarters of the field's height hold it without the prompt or the
            // caret, which would be measured in its place.
            func measureSearch(_ moment: String) {
                guard app.waitForStillScreen() else { return below.append("\(theme) \(moment): the screen kept changing") }
                let field = search.frame
                measure(search, moment)
                let glyph = CGRect(x: field.minX, y: field.minY, width: field.height * 0.75, height: field.height)
                let shot = app.screenshot()
                let image = Self.crop(shot, to: glyph, window: window)
                let name = "rendered-contrast-search-magnifier-\(theme)-\(moment)"
                let evidence = XCTAttachment(image: image)
                evidence.name = name
                evidence.lifetime = .keepAlways
                add(evidence)
                let conditions = "search magnifier \(moment) at \(glyph), " + measureConditions(in: app, window: window, shot: shot)
                guard let ratio = RenderedContrast.ratio(of: image) else {
                    return below.append("\(theme): \(conditions): no ink to measure, evidence \(name)")
                }
                let line = conditions + String(format: ": rendered %.2f:1, threshold 4.5:1", ratio) + ", evidence \(name)"
                lines.append(line)
                if ratio < 4.5 { below.append("\(theme): \(line)") }
            }
            measureSearch("at launch")
            var labels = Set<String>()
            for pass in 0..<2 {
                if pass == 1 {
                    app.swipeUp()
                    XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing after the swipe.")
                }
                var visible = window
                let tabBar = app.tabBars.firstMatch
                if tabBar.exists { visible.size.height = max(0, tabBar.frame.minY - fadeHeight - window.minY) }
                let chips = app.descendants(matching: .any).matching(identifier: "asset.status").allElementsBoundByIndex
                for chip in chips where visible.contains(chip.frame) && !labels.contains(chip.label) {
                    labels.insert(chip.label)
                    measure(chip)
                }
            }
            let expected: Set = ["Prêt", "Bloqué", "Emprunté", "À vérifier", "Indisponible"]
            if labels != expected { below.append("\(theme): chips measured \(labels.sorted()), expected \(expected.sorted())") }

            // After the asset sheet, then after a search typed and deleted.
            app.swipeDown()
            XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing after the swipe back.")
            card(app, "MM-001").tap()
            XCTAssertTrue(element(app, "asset.name").waitForExistence(timeout: 10))
            app.navigationBars.buttons.firstMatch.tap()
            XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 10))
            measureSearch("after the asset sheet")
            search.tap()
            search.typeText("MM")
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2) + "\n")
            XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 10))
            // While the search is active, iOS 26 draws the field as a glass
            // gradient whose shades `RenderedContrast` takes for inks
            // (1.01:1): that state is kept as evidence, not measured here
            // (measured by hand on its pixels, 2026-11-27; the measuring
            // tool's rework is a separate task). The prompt is measured once
            // the search is closed.
            XCTAssertTrue(app.waitForStillScreen())
            let active = XCTAttachment(image: Self.crop(app.screenshot(), to: search.frame, window: window))
            active.name = "search-active-\(theme)-not-measured-glass-gradient"
            active.lifetime = .keepAlways
            add(active)
            let close = app.buttons.matching(NSPredicate(format: "label IN %@", ["Annuler", "Fermer", "Cancel", "Close"])).firstMatch
            XCTAssertTrue(close.exists, "\(theme): no button closes the search")
            close.tap()
            XCTAssertTrue(card(app, "MM-001").waitForExistence(timeout: 10))
            measureSearch("after a deleted search")

            let setting = ProcessInfo.processInfo.environment["AEGIS_CONTRAST"].map { ", contrast \($0)" } ?? ""
            let record = XCTAttachment(string: lines.joined(separator: "\n"))
            record.name = "rendered-contrast-search-and-chips-\(theme)\(setting)"
            record.lifetime = .keepAlways
            add(record)
            app.terminate()
        }
        XCTAssertTrue(below.isEmpty, below.joined(separator: "\n"))
    }

    /// Twenty cards per page: the second page is read only once the last
    /// card of the first one is scrolled into view, not as soon as it exists.
    @MainActor
    func testNextPageIsReadWhenTheLastCardIsReached() {
        let app = launch(.french, scenario: "catalog-pages")
        XCTAssertTrue(card(app, "PG-001").waitForExistence(timeout: 30))
        XCTAssertTrue(app.waitForStillScreen())
        XCTAssertFalse(card(app, "PG-021").exists)

        let last = card(app, "PG-025")
        var swipes = 0
        while !last.waitForExistence(timeout: 2), swipes < 12 {
            app.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(last.exists)
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
                let restingTop = element(app, "catalog.filter.all").frame.minY

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
                XCTAssertTrue(returnToRest(app, restingTop: restingTop, inert: notice))
                XCTAssertTrue(waitUntilSettled(retry))
                try audit(app)
                attach(app, "\(language.code)-catalog-offline-\(theme)")

                // Still and at rest again after the audit, which scrolls and
                // resizes the text: a tap on a held list only releases it (#220).
                XCTAssertTrue(returnToRest(app, restingTop: restingTop, inert: notice))
                XCTAssertTrue(waitUntilSettled(retry), "Try again is still moving after the audit")
                retry.tap()
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

    /// Brings the list back to where it rests, with the filter row at
    /// `restingTop`. The synthesized pull sometimes leaves the list held
    /// below that place, perfectly still, until the next touch: the next tap
    /// then only releases the list, and its button never acts (#220, seen in
    /// the screen recording; the same pull leaves the list at rest in other
    /// iterations). A frame that stopped moving does not tell the two apart.
    /// The list is released by a tap on `inert`, a text without action, and
    /// the held state is attached as `list-held-after-pull` for review.
    @MainActor
    private func returnToRest(_ app: XCUIApplication, restingTop: CGFloat, inert: XCUIElement) -> Bool {
        let filter = element(app, "catalog.filter.all")
        func atRest(within timeout: TimeInterval) -> Bool {
            let deadline = Date.now + timeout
            repeat {
                if filter.exists, abs(filter.frame.minY - restingTop) < 1 { return true }
                Thread.sleep(forTimeInterval: 0.3)
            } while Date.now < deadline
            return false
        }
        if atRest(within: 3) { return true }
        let held = XCTAttachment(screenshot: app.screenshot())
        held.name = "list-held-after-pull"
        held.lifetime = .keepAlways
        add(held)
        inert.tap()
        return atRest(within: 5)
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
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale]
            + Self.textSize(arguments) + arguments
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        app.launch()
        return app
    }

    /// Same policy as the sign-in tests: every issue fails, except reports
    /// on system rendering, each limited to where it occurs:
    /// - clipped text in the native single-line search field, and in the
    ///   native filter menu label at the largest size, which wraps in full
    ///   (see the `fr-catalog-ax5-light` capture);
    /// - the contrast of the search field, or of a status chip the sampling
    ///   reports as nearly passed, when its render measures 4.5:1 or more on
    ///   the still screen; the measure is kept with its conditions;
    /// - the hit region of the search field's own clear button;
    /// - Dynamic Type of an element only partly visible: cut by the screen
    ///   edge (horizontal filter chips) or under the iOS 26 floating tab bar,
    ///   whose scroll-edge fade the audit samples. The same element passes
    ///   once scrolled into full view.
    /// - the contrast of such an element when nothing of it is visible, or
    ///   its visible part holds no ink. Otherwise its visible part is measured
    ///   on the pixels and fails below 4.5:1 (#211).
    /// Every tolerated issue is attached as `audit-tolerated`.
    /// - Dynamic Type of the filter chips, replaced by a menu at accessibility
    ///   sizes (checked by `testLargestTextUsesTheFilterMenu`).
    /// `atLargestSize` skips the Dynamic Type check when the text already uses
    /// the largest accessibility size and cannot grow further.
    /// The audit waits for a still screen and runs once: an audit XCTest
    /// abandons fails the test (`performMeasuredAccessibilityAudit`).
    /// Height above the floating tab bar covered by its scroll-edge fade.
    private let fadeHeight: CGFloat = 120

    @MainActor
    private func audit(_ app: XCUIApplication, atLargestSize: Bool = false) throws {
        XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing; the audit needs a still screen.")
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
        // The pixel sampling of the status chips reports "nearly passed" for
        // pairs above 5:1 (Prêt, light: 5.75:1), before iOS 26 and, since the
        // cards are no longer lazy, on iOS 26 too. Their ratios are computed
        // from the asset catalogue by `StatusContrastTests`; a reported chip
        // is also measured on its render.
        let chipFrames = app.descendants(matching: .any).matching(identifier: "asset.status")
            .allElementsBoundByIndex.map(\.frame)
        let bar = app.navigationBars.firstMatch
        let largeTitle = bar.exists ? bar.frame : .null
        var types = XCUIAccessibilityAuditType.all
        if atLargestSize { types.remove(.dynamicType) }
        // Before iOS 26 the audit reads the chips giving way to the menu,
        // which moves every card, as sizes the cards do not support. There
        // the Dynamic Type proof is the AX5 test, which renders and audits
        // the list at the largest size.
        if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26 { types.remove(.dynamicType) }
        let findings = AuditRecord()
        try app.performMeasuredAccessibilityAudit(for: types) { issue in
            var note = ""
            let tolerated: Bool
            if let target = issue.element {
                let center = CGPoint(x: target.frame.midX, y: target.frame.midY)
                let summary = issue.compactDescription
                let nearlyInChip = summary.contains("nearly")
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
                    // The search field and the chips are measured on the still
                    // screen, never excluded (2026-11-26): a passing measure
                    // qualifies this issue alone. By type as well: after a
                    // pull the search field may have moved since its frame
                    // was read.
                    let partly = self.visiblePartContrast(of: target, visible: visible, window: window, in: app)
                    if let judged = findings.tolerates(partly, note: &note) {
                        tolerated = judged
                    } else if searchFrame.contains(center) || target.elementType == .searchField || nearlyInChip {
                        let entire = self.entireContrast(of: target, window: window, in: app)
                        tolerated = findings.tolerates(entire, note: &note) ?? false
                    } else {
                        tolerated = false
                    }
                default:
                    tolerated = false
                }
            } else {
                tolerated = false
            }
            findings.record(issue, tolerated: tolerated, note: note)
            return true
        }
        findings.report(to: self, areas: ["visible=\(visible)"], acceptedName: "audit-visible-part-contrast")
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
