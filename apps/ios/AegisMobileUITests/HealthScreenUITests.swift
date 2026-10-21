import XCTest

/// Drives the real app in French and English. The unreachable case points the
/// Debug build at a closed loopback port; the live case needs a running API and
/// is skipped without one, so only `scripts/ios-test.sh live` proves the
/// integration. XCUIAutomation is main-actor isolated, hence the annotations.
final class HealthScreenUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testUnreachableServiceShowsErrorAndRetryInFrench() {
        assertUnreachableFlow(language: .french)
    }

    @MainActor
    func testUnreachableServiceShowsErrorAndRetryInEnglish() {
        assertUnreachableFlow(language: .english)
    }

    @MainActor
    func testLiveServiceShowsHealth() throws {
        guard let address = ProcessInfo.processInfo.environment["AEGIS_LIVE_API_BASE_URL"] else {
            throw XCTSkip("Set TEST_RUNNER_AEGIS_LIVE_API_BASE_URL to a running API (scripts/ios-test.sh live).")
        }
        let app = makeApp(language: .french)
        app.launchEnvironment["AEGIS_API_BASE_URL"] = address
        app.launch()

        XCTAssertTrue(app.staticTexts["Service opérationnel"].waitForExistence(timeout: 30))
        let service = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "aegis-control", "aegis-control"))
        XCTAssertTrue(service.firstMatch.exists)
        XCTAssertTrue(app.buttons["health.refresh"].exists)
        attachScreenshot(app, named: "health-live")
    }

    private struct Language {
        let code: String
        let locale: String
        let unreachableTitle: String
        let retry: String

        static let french = Language(
            code: "fr", locale: "fr_CA", unreachableTitle: "Service injoignable", retry: "Réessayer")
        static let english = Language(
            code: "en", locale: "en_CA", unreachableTitle: "Service unreachable", retry: "Try again")
    }

    @MainActor
    private func makeApp(language: Language) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale]
        return app
    }

    @MainActor
    private func assertUnreachableFlow(language: Language) {
        let app = makeApp(language: language)
        // Port 9 (discard) is closed on the host: the connection is refused.
        app.launchEnvironment["AEGIS_API_BASE_URL"] = "http://127.0.0.1:9/api/v1"
        app.launch()

        let error = app.descendants(matching: .any)["health.error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts[language.unreachableTitle].exists)

        let retry = app.buttons["health.retry"]
        XCTAssertTrue(retry.isHittable)
        XCTAssertEqual(retry.label, language.retry)
        retry.tap()

        // The retry runs a new request and lands on the same designed state.
        XCTAssertTrue(error.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["health.retry"].waitForExistence(timeout: 5))
        attachScreenshot(app, named: "health-unreachable-\(language.code)")
    }

    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
