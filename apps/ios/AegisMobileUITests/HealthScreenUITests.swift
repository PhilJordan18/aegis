import XCTest

/// Drives the real app. The unreachable case points the Debug build at a
/// closed loopback port; the live case needs a running API and is skipped
/// without one, so only `scripts/ios-test.sh live` proves the integration.
final class HealthScreenUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testUnreachableServiceShowsErrorAndRetry() {
        let app = XCUIApplication()
        // Port 9 (discard) is closed on the host: the connection is refused.
        app.launchEnvironment["AEGIS_API_BASE_URL"] = "http://127.0.0.1:9/api/v1"
        app.launch()

        let error = app.descendants(matching: .any)["health.error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["Service injoignable"].exists)

        let retry = app.buttons["health.retry"]
        XCTAssertTrue(retry.isHittable)
        retry.tap()

        // The retry runs a new request and lands on the same designed state.
        XCTAssertTrue(error.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["health.retry"].waitForExistence(timeout: 5))
        attachScreenshot(app, named: "health-unreachable")
    }

    func testLiveServiceShowsHealth() throws {
        guard let address = ProcessInfo.processInfo.environment["AEGIS_LIVE_API_BASE_URL"] else {
            throw XCTSkip("Set TEST_RUNNER_AEGIS_LIVE_API_BASE_URL to a running API (scripts/ios-test.sh live).")
        }
        let app = XCUIApplication()
        app.launchEnvironment["AEGIS_API_BASE_URL"] = address
        app.launch()

        XCTAssertTrue(app.staticTexts["Service opérationnel"].waitForExistence(timeout: 30))
        let service = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "aegis-control", "aegis-control"))
        XCTAssertTrue(service.firstMatch.exists)
        XCTAssertTrue(app.buttons["health.refresh"].exists)
        attachScreenshot(app, named: "health-live")
    }

    private func attachScreenshot(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
