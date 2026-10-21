import XCTest

/// Sign-in flows of the real app in French and English. API answers come from
/// the Debug `AEGIS_UI_SCENARIO` hook (no backend); `SignInLiveUITests` covers
/// the real API and Keychain.
final class SignInUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    struct Language {
        let code: String
        let locale: String
        let texts: [String: String]

        subscript(_ key: String) -> String { texts[key]! }

        static let french = Language(code: "fr", locale: "fr_CA", texts: [
            "submit": "Se connecter", "busy": "Connexion en cours", "role": "Technicien",
            "rejected": "Adresse courriel ou mot de passe incorrect.",
            "rateLimited": "Trop de tentatives. Réessayez dans 55 secondes.",
            "rateLimitedLater": "Trop de tentatives. Réessayez plus tard.",
            "signedOut": "Vous êtes déconnecté.", "confirm": "Se déconnecter",
            "wrongRole": "Accès réservé aux techniciens", "another": "Se connecter avec un autre compte",
            "offline": "Connexion au service impossible",
            "expired": "Votre session a expiré. Vos réservations et prêts sont conservés.",
            "invalid": "Votre session n’est plus valide. Reconnectez-vous.",
            "unreachable": "Connexion au service impossible. Vérifiez le réseau.",
            "serviceError": "Le service n’a pas pu traiter la connexion. Identifiant de suivi : 5f4bc22e-66a4-48ef-8bf3-6e7184d71c30",
            "emailMissing": "Saisissez votre adresse courriel.", "passwordMissing": "Saisissez votre mot de passe.",
            "emailInvalid": "Saisissez une adresse courriel valide.",
        ])
        static let english = Language(code: "en", locale: "en_CA", texts: [
            "submit": "Sign in", "busy": "Signing in", "role": "Technician",
            "rejected": "Incorrect email address or password.",
            "rateLimited": "Too many attempts. Try again in 55 seconds.",
            "rateLimitedLater": "Too many attempts. Try again later.",
            "signedOut": "You're signed out.", "confirm": "Sign out",
            "wrongRole": "Technicians only", "another": "Sign in with another account",
            "offline": "Can't reach the service",
            "expired": "Your session has expired. Your reservations and loans are kept.",
            "invalid": "Your session is no longer valid. Sign in again.",
            "unreachable": "Can't reach the service. Check your network.",
            "serviceError": "The service couldn't process the sign-in. Trace ID: 5f4bc22e-66a4-48ef-8bf3-6e7184d71c30",
            "emailMissing": "Enter your email address.", "passwordMissing": "Enter your password.",
            "emailInvalid": "Enter a valid email address.",
        ])
    }

    // MARK: Nominal

    @MainActor
    func testSignInAndSignOutInFrench() throws {
        try assertSignInAndSignOut(.french)
    }

    @MainActor
    func testSignInAndSignOutInEnglish() throws {
        try assertSignInAndSignOut(.english)
    }

    @MainActor
    func testDarkAppearancePassesTheAccessibilityAudit() throws {
        XCUIDevice.shared.appearance = .dark
        defer { XCUIDevice.shared.appearance = .light }
        let app = launch(.english, scenario: "login-success")
        XCTAssertTrue(app.textFields["signin.email"].waitForExistence(timeout: 30))
        try audit(app)
        attach(app, "en-signin-dark")
    }

    // MARK: Refusals

    @MainActor
    func testRejectedCredentialsKeepTheAddressInBothLanguages() {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "login-rejected")
            submit(app, email: "technician@aegis.demo", password: "wrong")
            XCTAssertTrue(app.staticTexts[language["rejected"]].waitForExistence(timeout: 15))
            XCTAssertEqual(app.textFields["signin.email"].value as? String, "technician@aegis.demo")
            attach(app, "\(language.code)-rejected")
        }
    }

    @MainActor
    func testRateLimitShowsTheServerDelayOnceAndLocksSubmission() {
        let app = launch(.french, scenario: "login-rate-limited")
        submit(app, email: "technician@aegis.demo", password: "x")

        XCTAssertTrue(app.staticTexts[Language.french["rateLimited"]].waitForExistence(timeout: 15))
        // The banner may be exposed as a group and its text: one distinct message.
        let delays = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "55"))
        XCTAssertEqual(Set(delays.allElementsBoundByIndex.map(\.label)), [Language.french["rateLimited"]])
        XCTAssertFalse(app.buttons["signin.submit"].isEnabled)
        attach(app, "fr-rate-limited")
    }

    @MainActor
    func testRateLimitWithoutAValidDelayDoesNotInventOne() {
        let app = launch(.english, scenario: "login-rate-limited-no-delay")
        submit(app, email: "technician@aegis.demo", password: "x")

        XCTAssertTrue(app.staticTexts[Language.english["rateLimitedLater"]].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["signin.submit"].isEnabled)
    }

    @MainActor
    func testAdministratorAccountIsRefused() {
        let app = launch(.french, scenario: "login-admin")
        submit(app, email: "admin@aegis.demo", password: "x")

        XCTAssertTrue(app.staticTexts[Language.french["wrongRole"]].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["admin@aegis.demo"].exists)
        attach(app, "fr-wrong-role")
        app.buttons["wrongRole.another"].tap()
        XCTAssertTrue(app.textFields["signin.email"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testServerErrorShowsOnlyTheTraceId() {
        let app = launch(.english, scenario: "login-server-error")
        submit(app, email: "technician@aegis.demo", password: "x")

        XCTAssertTrue(app.staticTexts[Language.english["serviceError"]].waitForExistence(timeout: 15))
    }

    @MainActor
    func testUnreachableServiceKeepsBothValues() {
        // Real transport against a closed loopback port.
        let app = launch(.french, scenario: nil, environment: ["AEGIS_API_BASE_URL": "http://127.0.0.1:9/api/v1"])
        submit(app, email: "technician@aegis.demo", password: "kept")

        XCTAssertTrue(app.staticTexts[Language.french["unreachable"]].waitForExistence(timeout: 30))
        XCTAssertEqual(app.textFields["signin.email"].value as? String, "technician@aegis.demo")
    }

    @MainActor
    func testFieldErrorsAppearNextToTheirFields() {
        let app = launch(.english, scenario: "login-success")
        let submitButton = app.buttons["signin.submit"]
        XCTAssertTrue(submitButton.waitForExistence(timeout: 30))
        submitButton.tap()

        let fieldErrors = app.descendants(matching: .any).matching(identifier: "signin.fieldError")
        XCTAssertTrue(fieldErrors.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(Set(fieldErrors.allElementsBoundByIndex.map(\.label)),
                       [Language.english["emailMissing"], Language.english["passwordMissing"]])

        // Submit with the keyboard's Go key; the button may sit under the keyboard.
        let email = app.textFields["signin.email"]
        email.tap()
        email.typeText("technician.aegis.demo\n")
        app.secureTextFields["signin.password"].typeText("\n")
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", Language.english["emailInvalid"])).firstMatch
            .waitForExistence(timeout: 5))
        attach(app, "en-validation")
    }

    // MARK: Busy and resume

    @MainActor
    func testBusyStateIsPerceptibleAndIgnoresRepeatedSubmissions() {
        let app = launch(.french, scenario: "login-slow")
        submit(app, email: "technician@aegis.demo", password: "x")

        let busy = app.buttons[Language.french["busy"]]
        XCTAssertTrue(busy.waitForExistence(timeout: 10))
        busy.tap()
        XCTAssertTrue(busy.exists)
        XCTAssertFalse(app.textFields["signin.email"].isEnabled)
        attach(app, "fr-busy")
    }

    @MainActor
    func testOfflineResumeKeepsTheSessionUnverified() {
        for language in [Language.french, .english] {
            let app = launch(language, scenario: "resume-offline")
            XCTAssertTrue(app.staticTexts[language["offline"]].waitForExistence(timeout: 30))
            XCTAssertTrue(app.buttons["resume.retry"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["account.name"].firstMatch.exists)

            app.buttons["resume.retry"].tap()
            XCTAssertTrue(app.staticTexts[language["offline"]].waitForExistence(timeout: 30))

            app.buttons["resume.signOut"].tap()
            XCTAssertTrue(app.staticTexts[language["signedOut"]].waitForExistence(timeout: 10))
        }
    }

    @MainActor
    func testExpiredStoredSessionPrefillsTheAddress() {
        let app = launch(.english, scenario: "resume-expired")
        XCTAssertTrue(app.staticTexts[Language.english["expired"]].waitForExistence(timeout: 30))
        XCTAssertEqual(app.textFields["signin.email"].value as? String, "technician@aegis.demo")
        attach(app, "en-expired")
    }

    @MainActor
    func testRefusedStoredTokenEndsTheSession() {
        let app = launch(.french, scenario: "resume-invalid")
        XCTAssertTrue(app.staticTexts[Language.french["invalid"]].waitForExistence(timeout: 30))
    }

    // MARK: Layout and accessibility

    @MainActor
    func testKeyboardCompactsTheHeader() {
        let app = launch(.french, scenario: "login-success")
        XCTAssertTrue(app.descendants(matching: .any)["brand.signature"].waitForExistence(timeout: 30))

        app.textFields["signin.email"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["brand.signature"].exists)
        XCTAssertTrue(app.buttons["signin.submit"].isHittable)
        attach(app, "fr-keyboard")
    }

    @MainActor
    func testLargestTextKeepsTheFormReachable() throws {
        let app = launch(.french, scenario: "login-rejected",
                         arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        XCTAssertTrue(app.textFields["signin.email"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.descendants(matching: .any)["brand.signature"].exists)

        let submitButton = app.buttons["signin.submit"]
        for _ in 0..<6 where !submitButton.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(submitButton.isHittable)
        attach(app, "fr-signin-ax")
    }

    // MARK: Helpers

    @MainActor
    private func assertSignInAndSignOut(_ language: Language) throws {
        let app = launch(language, scenario: "login-success")
        XCTAssertTrue(app.textFields["signin.email"].waitForExistence(timeout: 30))
        XCTAssertEqual(app.buttons["signin.submit"].label, language["submit"])
        try audit(app)
        attach(app, "\(language.code)-signin")

        submit(app, email: "technician@aegis.demo", password: "secret")
        XCTAssertTrue(app.descendants(matching: .any)["account.name"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.descendants(matching: .any)["account.name"].firstMatch.label.contains("Technicien Démo"))
        let role = app.descendants(matching: .any)["account.role"].firstMatch
        XCTAssertTrue(role.label.contains(language["role"]) || (role.value as? String) == language["role"])
        try audit(app)
        attach(app, "\(language.code)-account")

        app.buttons["account.signOut"].tap()
        let confirm = app.buttons.matching(identifier: "account.confirmSignOut").firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertEqual(confirm.label, language["confirm"])
        confirm.tap()
        XCTAssertTrue(app.staticTexts[language["signedOut"]].waitForExistence(timeout: 10))
    }

    @MainActor
    private func launch(_ language: Language, scenario: String?, arguments: [String] = [],
                        environment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(\(language.code))", "-AppleLocale", language.locale] + arguments
        app.launchEnvironment.merge(environment) { $1 }
        if let scenario {
            app.launchEnvironment["AEGIS_UI_SCENARIO"] = scenario
        } else {
            app.launchEnvironment["AEGIS_RESET_SESSION"] = "1"
        }
        app.launch()
        return app
    }

    /// Types with the keyboard and submits with its Go key, as a user would.
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

    /// Xcode's accessibility audit: contrast, element description, hit region,
    /// clipped text, Dynamic Type and traits. One documented exception: the audit
    /// reports native single-line text fields as possibly clipped at larger
    /// sizes, while they grow with Dynamic Type (see the very-large-text test
    /// and capture). Every other issue fails the test.
    @MainActor
    private func audit(_ app: XCUIApplication) throws {
        try app.performAccessibilityAudit { issue in
            let element = issue.element.map { "\($0.elementType) '\($0.label)' id=\($0.identifier)" } ?? "none"
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
