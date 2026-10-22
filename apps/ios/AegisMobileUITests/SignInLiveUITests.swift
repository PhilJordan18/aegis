import XCTest

/// The real app against the real API and the simulator Keychain. Skipped
/// without the live variables; `scripts/ios-test.sh live` requires them and
/// fails if these tests are skipped.
final class SignInLiveUITests: XCTestCase {
    struct Live {
        let address: String
        let technicianEmail: String
        let technicianPassword: String
        let adminEmail: String
        let adminPassword: String

        init() throws {
            let environment = ProcessInfo.processInfo.environment
            guard let address = environment["AEGIS_LIVE_API_BASE_URL"],
                  let technicianPassword = environment["AEGIS_LIVE_TECHNICIAN_PASSWORD"],
                  let adminPassword = environment["AEGIS_LIVE_ADMIN_PASSWORD"] else {
                throw XCTSkip("Live API variables are not set (scripts/ios-test.sh live).")
            }
            self.address = address
            self.technicianPassword = technicianPassword
            self.adminPassword = adminPassword
            technicianEmail = environment["AEGIS_LIVE_TECHNICIAN_EMAIL"] ?? "technician@aegis.demo"
            adminEmail = environment["AEGIS_LIVE_ADMIN_EMAIL"] ?? "admin@aegis.demo"
        }
    }

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTechnicianSignsInResumesFromTheKeychainAndSignsOut() throws {
        let live = try Live()
        let app = makeApp(live, resetSession: true)
        app.launch()
        submit(app, email: live.technicianEmail, password: live.technicianPassword)
        XCTAssertTrue(app.descendants(matching: .any)["account.name"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["account.role"].firstMatch.label.contains("Technicien"))

        // A new launch resumes from the Keychain once GET /auth/me accepts the token.
        app.terminate()
        let resumed = makeApp(live, resetSession: false)
        resumed.launch()
        XCTAssertTrue(resumed.descendants(matching: .any)["account.name"].firstMatch.waitForExistence(timeout: 30))

        resumed.buttons["account.signOut"].tap()
        let confirm = resumed.buttons.matching(identifier: "account.confirmSignOut").firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(resumed.staticTexts["Vous êtes déconnecté."].waitForExistence(timeout: 10))

        // The token is gone: the next launch shows the form.
        resumed.terminate()
        let afterSignOut = makeApp(live, resetSession: false)
        afterSignOut.launch()
        XCTAssertTrue(afterSignOut.textFields["signin.email"].waitForExistence(timeout: 30))
    }

    @MainActor
    func testAdministratorIsRefusedByTheApp() throws {
        let live = try Live()
        let app = makeApp(live, resetSession: true)
        app.launch()
        submit(app, email: live.adminEmail, password: live.adminPassword)

        XCTAssertTrue(app.staticTexts["Accès réservé aux techniciens"].waitForExistence(timeout: 30))
    }

    @MainActor
    private func makeApp(_ live: Live, resetSession: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA"]
        app.launchEnvironment["AEGIS_API_BASE_URL"] = live.address
        if resetSession { app.launchEnvironment["AEGIS_RESET_SESSION"] = "1" }
        return app
    }

    @MainActor
    private func submit(_ app: XCUIApplication, email: String, password: String) {
        let emailField = app.textFields["signin.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 30))
        emailField.tap()
        emailField.typeText(email + "\n")
        let passwordField = app.secureTextFields["signin.password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.typeText(password + "\n")
    }
}
