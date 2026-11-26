import XCTest

/// Compte > Sécurité > « Changer le mot de passe » (#234, doc 09 §10.7). API
/// answers come from the Debug `AEGIS_UI_SCENARIO` hook; every password here
/// is FICTIONAL and belongs to no account.
final class PasswordChangeUITests: XCTestCase {
    private static let current = "fictional-current-pass"
    private static let new = "fictional-new-passphrase"

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
            "rejected": "Mot de passe actuel incorrect.",
            "mismatch": "La confirmation ne correspond pas au nouveau mot de passe.",
            "changed": "Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.",
            "uncertain": "Le changement du mot de passe n’a pas pu être confirmé. Connectez-vous avec le nouveau mot de passe ; s’il est refusé, utilisez l’ancien.",
        ])
        static let english = Language(code: "en", locale: "en_CA", texts: [
            "rejected": "Incorrect current password.",
            "mismatch": "The confirmation doesn’t match the new password.",
            "changed": "Password changed. Sign in with your new password.",
            "uncertain": "We couldn’t confirm the password change. Sign in with your new password; if it’s refused, use your old one.",
        ])
    }

    /// French, light: a mismatch is caught before sending, a wrong current
    /// password brings the form back to its first step with only that field
    /// cleared, then the change ends the session and the sign-in form keeps
    /// the address.
    @MainActor
    func testChangeEndsTheSessionInFrench() throws {
        XCUIDevice.shared.appearance = .light
        let language = Language.french
        let app = launch(language, scenario: "password")
        openForm(app)
        XCTAssertEqual(app.textFields["password.email"].value as? String, "technician@aegis.demo")
        try audit(app)
        attach(app, "fr-password-current")

        enterCurrent(app, "fictional-wrong-pass")
        try audit(app)
        attach(app, "fr-password-new")
        enterNew(app, Self.new, confirmation: Self.new + "x")
        let mismatch = app.staticTexts["password.confirmation.error"]
        XCTAssertTrue(mismatch.waitForExistence(timeout: 5))
        XCTAssertEqual(mismatch.label, language["mismatch"])

        let confirmation = app.secureTextFields["password.confirmation"]
        focusNew(app, confirmation)
        // A secure field offers no Select All; its first deletion empties it.
        confirmation.typeText(XCUIKeyboardKey.delete.rawValue + Self.new + "\n")
        let rejected = app.staticTexts["password.current.error"]
        XCTAssertTrue(rejected.waitForExistence(timeout: 10))
        XCTAssertEqual(rejected.label, language["rejected"])
        XCTAssertFalse(app.secureTextFields["password.new"].exists)
        XCTAssertFalse(app.textFields["signin.email"].exists)
        attach(app, "fr-password-rejected")

        enterCurrent(app, Self.current)
        enterNew(app, Self.new, confirmation: Self.new)
        XCTAssertTrue(app.staticTexts[language["changed"]].waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["signin.email"].value as? String, "technician@aegis.demo")
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        attach(app, "fr-password-changed")
    }

    /// The defect that split the form: on one screen, iOS offered its strong
    /// password on the current password field and wrote it there. Now the
    /// current password step offers none, and a strong password fills the
    /// new password and its confirmation, which the change accepts.
    @MainActor
    func testStrongPasswordFillsOnlyTheNewPassword() throws {
        let app = launch(.french, scenario: "password")
        openForm(app)
        enterCurrent(app, Self.current)
        let new = app.secureTextFields["password.new"]
        XCTAssertTrue(new.waitForExistence(timeout: 10))
        declineSavingPassword(app, timeout: 0)
        new.tap()
        let fill = app.buttons["GenerateStrongPasswordButton"]
        // Its absence is a defect too: without the user name on this step,
        // iOS offered no strong password at all.
        XCTAssertTrue(fill.waitForExistence(timeout: 5), "iOS offered no strong password for the new password")
        attach(app, "fr-strong-password-offer")
        fill.tap()
        app.buttons["password.submit"].tap()
        XCTAssertTrue(app.staticTexts[Language.french["changed"]].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["password.current.error"].exists)
    }

    /// English, dark: a change whose answer is lost is not shown as done and
    /// is not sent again; the session ends with the uncertain notice.
    @MainActor
    func testLostAnswerIsNotClaimedInEnglish() throws {
        XCUIDevice.shared.appearance = .dark
        let language = Language.english
        let app = launch(language, scenario: "password-lost")
        openForm(app)
        try audit(app)
        attach(app, "en-dark-password-current")
        enterCurrent(app, Self.current)
        try audit(app)
        attach(app, "en-dark-password-new")

        enterNew(app, Self.new, confirmation: Self.new)
        XCTAssertTrue(app.staticTexts[language["uncertain"]].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts[language["changed"]].exists)
        XCTAssertEqual(app.textFields["signin.email"].value as? String, "technician@aegis.demo")
        attach(app, "en-dark-password-uncertain")
    }

    /// The largest accessibility size: both steps stay reachable and their
    /// buttons can be pressed.
    @MainActor
    func testFormAtTheLargestTextSize() throws {
        let app = launch(.french, scenario: "password",
                         arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openForm(app)
        attach(app, "fr-ax5-password-current")
        enterCurrent(app, Self.current)
        XCTAssertTrue(app.secureTextFields["password.new"].waitForExistence(timeout: 10))
        let submit = app.buttons["password.submit"]
        for _ in 0..<8 where !submit.isHittable { app.swipeUp() }
        XCTAssertTrue(submit.isHittable)
        attach(app, "fr-ax5-password-new")
    }

    // MARK: Helpers

    @MainActor
    private func launch(_ language: Language, scenario: String, arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale]
            + arguments + Self.textSize(arguments)
        app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        app.launchEnvironment["AEGIS_START_TAB"] = "account"
        app.launch()
        return app
    }

    @MainActor
    private func openForm(_ app: XCUIApplication) {
        let link = app.buttons["account.password"]
        XCTAssertTrue(app.descendants(matching: .any)["account.name"].firstMatch.waitForExistence(timeout: 30))
        for _ in 0..<10 where !link.isHittable { app.swipeUp() }
        link.tap()
        XCTAssertTrue(app.secureTextFields["password.current"].waitForExistence(timeout: 10))
    }

    /// First step. iOS must not take this field for a new password.
    @MainActor
    private func enterCurrent(_ app: XCUIApplication, _ value: String) {
        let field = app.secureTextFields["password.current"]
        for _ in 0..<6 where !field.isHittable { app.swipeDown() }
        field.tap()
        XCTAssertFalse(app.buttons["GenerateStrongPasswordButton"].waitForExistence(timeout: 3),
                       "iOS offered a strong password on the current password field")
        field.typeText(value)
        let next = app.buttons["password.continue"]
        for _ in 0..<6 where !next.isHittable { app.swipeUp() }
        next.tap()
        guard app.secureTextFields["password.new"].waitForExistence(timeout: 10) else { return }
        declineSavingPassword(app, timeout: 6)
    }

    /// Leaving a form with an address and a password, iOS may offer, a few
    /// seconds later, to save that password, sometimes twice. The user turns
    /// it down; the system prompt is in the simulator's own language, English
    /// here. A tap made while the prompt is still leaving lands on it, not on
    /// the field below (#234, full run on #235): the prompt must be gone.
    @MainActor
    private func declineSavingPassword(_ app: XCUIApplication, timeout: TimeInterval) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: timeout) {
            notNow.tap()
            XCTAssertTrue(notNow.waitForNonExistence(timeout: 5), "The save-password prompt stayed on screen.")
        }
    }

    /// Second step, typed by hand: the user turns down iOS's strong password
    /// when it is offered, then submits with the keyboard's Go key.
    @MainActor
    private func enterNew(_ app: XCUIApplication, _ new: String, confirmation: String) {
        for (identifier, value) in [("password.new", new), ("password.confirmation", confirmation)] {
            let field = app.secureTextFields[identifier]
            XCTAssertTrue(field.waitForExistence(timeout: 10))
            // A prompt over the form makes the field unhittable: decline it
            // rather than scrolling under it.
            declineSavingPassword(app, timeout: 0)
            for _ in 0..<6 where !field.isHittable { app.swipeDown() }
            focusNew(app, field)
            field.typeText(value)
        }
        app.secureTextFields["password.confirmation"].typeText("\n")
    }

    /// Focuses a new password field, turning down iOS's strong password as a
    /// user choosing their own would.
    @MainActor
    private func focusNew(_ app: XCUIApplication, _ field: XCUIElement) {
        declineSavingPassword(app, timeout: 0)
        field.tap()
        if app.buttons["GenerateStrongPasswordButton"].waitForExistence(timeout: 3) {
            app.buttons["xmark"].tap()
            field.tap()
        }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "The field did not take the keyboard focus.")
    }

    /// Xcode's accessibility audit, with the one exception documented in
    /// `SignInUITests`: native single-line fields reported as possibly clipped.
    @MainActor
    private func audit(_ app: XCUIApplication) throws {
        try app.performAccessibilityAudit { issue in
            let element = issue.element.map { "\($0.elementType) '\($0.label)' id=\($0.identifier) frame=\($0.frame)" }
                ?? "none"
            print("AUDIT ISSUE: \(issue.compactDescription) — \(element) — \(issue.detailedDescription)")
            let fieldTypes: [XCUIElement.ElementType] = [.textField, .secureTextField]
            return issue.auditType == .textClipped && fieldTypes.contains(issue.element?.elementType ?? .any)
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
