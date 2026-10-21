import Foundation
import Testing
@testable import AegisMobile

/// Checks the compiled String Catalog inside the app bundle. Key coverage
/// against the code is checked by scripts/check-strings.py after a build.
struct LocalizationTests {
    /// French is the source language, so the build emits no fr.lproj table;
    /// CFBundleLocalizations still declares both languages to the system.
    @Test func appDeclaresFrenchAndEnglish() {
        #expect(Bundle.main.developmentLocalization == "fr")
        #expect(Bundle.main.object(forInfoDictionaryKey: "CFBundleLocalizations") as? [String] == ["fr", "en"])
        #expect(Set(Bundle.main.localizations).isSuperset(of: ["fr", "en"]))
    }

    @Test(arguments: [
        ("en", "Réessayer", "Try again"),
        ("en", "Service injoignable", "Service unreachable"),
        ("en", "Identifiant de suivi : %@", "Trace ID: %@"),
    ])
    func resolvesCompiledTranslations(_ language: String, _ key: String, _ expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: key, value: "MISSING", table: nil) == expected)
    }

    @Test func formatsTheErrorStatusWithoutGrouping() throws {
        let path = try #require(Bundle.main.path(forResource: "en", ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let format = bundle.localizedString(
            forKey: "Le service a répondu avec l’erreur %lld. Réessayez dans un instant.", value: nil, table: nil)
        #expect(String(format: format, locale: Locale(identifier: "en_CA"), 503)
                == "The service returned error 503. Try again in a moment.")
    }
}
