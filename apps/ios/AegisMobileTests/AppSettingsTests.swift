import Foundation
import Testing
@testable import AegisMobile

/// Account settings (#232): the language choice is the only stored setting,
/// and the environment is a name, never an address.
@MainActor
struct AppSettingsTests {
    private let suite = "AppSettingsTests-\(UUID().uuidString)"

    private func defaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    @Test func theSystemLanguageIsTheDefault() {
        let preference = LanguagePreference(defaults: defaults())
        #expect(preference.selection == .system)
        #expect(!preference.appliesAtNextLaunch)
    }

    @Test(arguments: [(AppLanguage.french, ["fr"]), (.english, ["en"])])
    func aChosenLanguageIsStoredForTheNextLaunch(_ language: AppLanguage, _ expected: [String]) {
        let defaults = defaults()
        let preference = LanguagePreference(defaults: defaults)

        preference.select(language)

        #expect(defaults.stringArray(forKey: LanguagePreference.appleLanguagesKey) == expected)
        #expect(preference.appliesAtNextLaunch)
        let relaunched = LanguagePreference(defaults: defaults)
        #expect(relaunched.selection == language)
        #expect(!relaunched.appliesAtNextLaunch)
    }

    @Test func theSystemChoiceRemovesTheAppOverride() {
        let defaults = defaults()
        let preference = LanguagePreference(defaults: defaults)
        preference.select(.english)
        #expect(defaults.persistentDomain(forName: suite)?[LanguagePreference.appleLanguagesKey] as? [String] == ["en"])

        preference.select(.system)

        // Reading the key would fall back to the device's own languages: the
        // app's domain itself must no longer hold an override.
        #expect(defaults.persistentDomain(forName: suite)?[LanguagePreference.appleLanguagesKey] == nil)
        #expect(LanguagePreference(defaults: defaults).selection == .system)
        #expect(!preference.appliesAtNextLaunch)
    }

    @Test func anUnknownStoredValueFallsBackToTheSystem() {
        let defaults = defaults()
        defaults.set("de", forKey: LanguagePreference.selectionKey)
        #expect(LanguagePreference(defaults: defaults).selection == .system)
    }

    @Test(arguments: [
        ("staging", "https://api.example.test/api/v1", AppIdentity.Environment.staging),
        ("production", "https://api.example.test/api/v1", .production),
        ("", "https://api.example.test/api/v1", .remote),
        ("$(AEGIS_ENVIRONMENT)", "https://api.example.test/api/v1", .remote),
        // A machine's configuration cannot call a remote server local...
        ("local", "https://api.example.test/api/v1", .remote),
        // ...nor a loopback address anything else.
        ("staging", "http://localhost:8080/api/v1", .local),
        ("local", "http://127.0.0.1:8080/api/v1", .local),
    ])
    func namesTheEnvironmentWithoutItsAddress(_ named: String, _ url: String, _ expected: AppIdentity.Environment) {
        let identity = AppIdentity.read(
            info: ["CFBundleShortVersionString": "0.1.0", "CFBundleVersion": "7", AppIdentity.environmentKey: named],
            apiBaseURL: URL(string: url))

        #expect(identity == AppIdentity(version: "0.1.0", build: "7", environment: expected))
        #expect(!identity.environmentName.contains("example"))
        #expect(!identity.environmentName.contains("localhost"))
    }

    @Test func aMissingAddressIsARemoteServer() {
        let identity = AppIdentity.read(info: [AppIdentity.environmentKey: "local"], apiBaseURL: nil)
        #expect(identity.environment == .remote)
        #expect(identity.version == "?")
    }

    /// The build setting reaches the bundle; its value depends on the
    /// machine's Local.xcconfig, so only its substitution is checked.
    @Test func theAppBundleCarriesTheEnvironmentSetting() throws {
        let named = try #require(Bundle.main.object(forInfoDictionaryKey: AppIdentity.environmentKey) as? String)
        #expect(!named.hasPrefix("$("))
    }
}
