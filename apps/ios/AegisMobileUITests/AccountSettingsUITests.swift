import XCTest

/// Compte > Réglages (#232): the app's language, its version and build, and
/// the environment it talks to. Signed in through the Debug
/// `AEGIS_UI_SCENARIO` hook; no backend is needed.
final class AccountSettingsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.appearance = .light }
    }

    /// French, light, then English, dark: the account settings and the
    /// language list read in each language and pass the accessibility audit;
    /// the environment is named, never given as an address.
    @MainActor
    func testSettingsInBothLanguagesAndAppearances() throws {
        for (code, locale, appearance, about, environment) in [
            ("fr", "fr_CA", XCUIDevice.Appearance.light, "À propos", "Développement local"),
            ("en", "en_CA", .dark, "About", "Local development"),
        ] {
            XCUIDevice.shared.appearance = appearance
            let app = launch(["-AppleLanguages", "(\(code))", "-AppleLocale", locale])
            let row = app.buttons["account.language"]
            XCTAssertTrue(row.exists)
            attach(app, "\(code)-\(appearance == .dark ? "dark" : "light")-account-settings")
            assertLanguageValueContrast(app, row)

            // Audited scrolled to its end, where every row is entirely
            // visible. At rest « Se déconnecter » sits under the tab bar's
            // fade, an issue the audit sometimes reports without its element,
            // which no rule can then judge.
            scrollToEnd(app)
            let version = element(app, "account.version")
            XCTAssertTrue(version.isHittable)
            XCTAssertTrue(app.staticTexts[about].exists)
            XCTAssertTrue(version.label.range(of: #"\d+\.\d+(\.\d+)? \(\d+\)"#, options: .regularExpression) != nil,
                          "version and build: \(version.label)")
            let named = element(app, "account.environment")
            XCTAssertTrue(named.label.contains(environment), named.label)
            XCTAssertFalse(named.label.contains("localhost"))
            XCTAssertFalse(named.label.contains("http"))
            attach(app, "\(code)-\(appearance == .dark ? "dark" : "light")-account-end")
            try audit(app)

            openLanguages(app)
            XCTAssertTrue(app.buttons["language.system"].isSelected)
            attach(app, "\(code)-\(appearance == .dark ? "dark" : "light")-language")
            try audit(app)
            app.terminate()
        }
    }

    /// The choice applies from the next launch, as the per-app language of
    /// iOS does, then « Système » gives the device's language back. The
    /// simulator runs in English, so French proves the override.
    @MainActor
    func testChosenLanguageAppliesAtTheNextLaunchAndSystemRestoresTheDevice() throws {
        var app = launch([])
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10),
                      "the simulator is expected to run in English")
        openLanguages(app)
        XCTAssertTrue(app.buttons["language.system"].isSelected)
        try audit(app)
        attach(app, "en-language-system")
        app.buttons["language.fr"].tap()
        XCTAssertTrue(app.buttons["language.fr"].isSelected)
        XCTAssertFalse(app.buttons["language.system"].isSelected)
        XCTAssertTrue(element(app, "language.pending").waitForExistence(timeout: 5))
        // Nothing switches mid-screen: the rest of the app stays in English.
        XCTAssertTrue(app.navigationBars["Language"].exists)
        attach(app, "en-language-pending")
        try audit(app)
        app.terminate()

        app = launch([])
        XCTAssertTrue(app.navigationBars["Compte"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.tabBars.buttons["Compte"].exists)
        XCTAssertTrue(app.buttons["account.language"].label.contains("Français"), app.buttons["account.language"].label)
        attach(app, "fr-after-relaunch")
        openLanguages(app)
        XCTAssertTrue(app.buttons["language.fr"].isSelected)
        XCTAssertFalse(element(app, "language.pending").exists)

        app.buttons["language.system"].tap()
        XCTAssertTrue(element(app, "language.pending").waitForExistence(timeout: 5))
        app.terminate()

        app = launch([])
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["account.language"].label.contains("System"), app.buttons["account.language"].label)
    }

    /// The largest accessibility size: every setting stays readable and
    /// reachable on the account and language screens. As in the other
    /// audited suites, these renders are the Dynamic Type proof there.
    @MainActor
    func testSettingsAtTheLargestTextSize() throws {
        let app = launch(["-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA",
                          "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let language = app.buttons["account.language"]
        scrollTo(app, language)
        attach(app, "fr-ax5-account-settings")
        try audit(app, atLargestSize: true)
        let environment = element(app, "account.environment")
        scrollTo(app, environment)
        attach(app, "fr-ax5-account-about")
        try audit(app, atLargestSize: true)

        openLanguages(app)
        scrollTo(app, element(app, "language.en"))
        attach(app, "fr-ax5-language")
        try audit(app, atLargestSize: true)
    }

    // MARK: Helpers

    @MainActor
    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments + Self.textSize(arguments)
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = "signed-in"
        app.launchEnvironment["AEGIS_START_TAB"] = "account"
        app.launch()
        XCTAssertTrue(element(app, "account.name").waitForExistence(timeout: 30))
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// Scrolls, either way, until `element` can be tapped.
    @MainActor
    private func scrollTo(_ app: XCUIApplication, _ element: XCUIElement) {
        let middle = app.windows.firstMatch.frame.midY
        var down = false
        for attempt in 0..<12 where !element.isHittable {
            // A list unloads the rows it scrolled past: without a frame, look
            // below first, then above.
            if element.exists { down = element.frame.midY < middle } else if attempt == 6 { down = true }
            if down { app.swipeDown() } else { app.swipeUp() }
        }
        XCTAssertTrue(element.isHittable)
    }

    /// Scrolls until the last row, « Se déconnecter », stops moving.
    @MainActor
    private func scrollToEnd(_ app: XCUIApplication) {
        let last = app.buttons["account.signOut"]
        var previous = CGRect.null
        for _ in 0..<10 where last.frame != previous {
            previous = last.frame
            app.swipeUp()
        }
    }

    @MainActor
    private func openLanguages(_ app: XCUIApplication) {
        let row = app.buttons["account.language"]
        scrollTo(app, row)
        row.tap()
        XCTAssertTrue(app.buttons["language.system"].waitForExistence(timeout: 5))
    }

    /// The value beside « Langue », measured on its pixels between the row's
    /// middle and the chevron: the system grey of a navigation-link picker
    /// measured 3.44:1 there.
    @MainActor
    private func assertLanguageValueContrast(_ app: XCUIApplication, _ row: XCUIElement) {
        XCTAssertTrue(app.waitForStillScreen())
        let window = app.windows.firstMatch.frame
        let frame = row.frame
        let value = CGRect(x: frame.midX, y: frame.minY, width: frame.maxX - 36 - frame.midX, height: frame.height)
        let image = Self.crop(app.screenshot(), to: value, window: window)
        let evidence = XCTAttachment(image: image)
        evidence.name = "language-value"
        evidence.lifetime = .keepAlways
        add(evidence)
        let ratio = RenderedContrast.ratio(of: image, shade: BarAwareAudit.panelShade)
        XCTAssertNotNil(ratio, "no ink beside the language")
        XCTAssertGreaterThanOrEqual(ratio ?? 0, 4.5, String(format: "language value rendered %.2f:1", ratio ?? 0))
    }

    @MainActor
    private func audit(_ app: XCUIApplication, atLargestSize: Bool = false) throws {
        try auditAccountScreen(app, atLargestSize: atLargestSize)
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
