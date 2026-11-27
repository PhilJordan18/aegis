import Foundation
import Observation

/// The app language chosen in Account (#232). « Système » follows the
/// device; French and English override it for this app only.
enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
    case system
    case french = "fr"
    case english = "en"

    var id: String { rawValue }
}

/// Stores the language choice, the only setting kept on the device besides
/// the session. iOS reads an app's language when the app launches, as it does
/// for the per-app language of the Settings app: a choice applies from the
/// next launch, to every title, button, error, alert, accessibility label and
/// date format at once, never to half of the screen. Asset names come from
/// the server and are never translated; laboratory times keep their zone.
@MainActor
@Observable
final class LanguagePreference {
    /// The app's preference, kept for the whole process: Account is rebuilt
    /// after a sign-out, but the language in effect is still the one iOS
    /// applied at launch, so a pending choice must stay announced.
    static let shared = LanguagePreference()

    static let selectionKey = "AegisAppLanguage"
    /// The key iOS reads at launch to pick the app's localization.
    static let appleLanguagesKey = "AppleLanguages"

    private(set) var selection: AppLanguage
    /// The choice in effect when this launch began.
    let selectionAtLaunch: AppLanguage
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.string(forKey: Self.selectionKey).flatMap(AppLanguage.init(rawValue:)) ?? .system
        selection = stored
        selectionAtLaunch = stored
    }

    /// A different choice than at launch: shown until the app relaunches.
    var appliesAtNextLaunch: Bool { selection != selectionAtLaunch }

    func select(_ language: AppLanguage) {
        selection = language
        defaults.set(language.rawValue, forKey: Self.selectionKey)
        switch language {
        case .system:
            defaults.removeObject(forKey: Self.appleLanguagesKey)
        case .french, .english:
            defaults.set([language.rawValue], forKey: Self.appleLanguagesKey)
        }
    }
}

/// Version, build and environment shown in Account (#232). The environment
/// is a name, never a host, a key or another infrastructure detail.
struct AppIdentity: Equatable, Sendable {
    enum Environment: String, Equatable, Sendable {
        case local
        case staging
        case production
        /// A remote server the build does not name.
        case remote
    }

    static let environmentKey = "AegisEnvironment"

    let version: String
    let build: String
    let environment: Environment

    /// The build names its environment; the API address only corrects it. A
    /// loopback address is always local, and a remote one is never called
    /// local, whatever a machine's local configuration says.
    static func read(info: [String: Any]? = Bundle.main.infoDictionary,
                     apiBaseURL: URL? = try? APIConfiguration.resolve().baseURL) -> AppIdentity {
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        let named = (info?[environmentKey] as? String).flatMap(Environment.init(rawValue:))
        let loopback = apiBaseURL?.host(percentEncoded: false).map { ["localhost", "127.0.0.1", "::1"].contains($0.lowercased()) }
        let environment: Environment = switch (named, loopback) {
        case (_, true?): .local
        case (.local?, _), (nil, _): .remote
        case let (named?, _): named
        }
        return AppIdentity(version: version, build: build, environment: environment)
    }

    var environmentName: String {
        switch environment {
        case .local: String(localized: "Développement local")
        case .staging: String(localized: "Recette (staging)")
        case .production: String(localized: "Production")
        case .remote: String(localized: "Serveur distant")
        }
    }
}
