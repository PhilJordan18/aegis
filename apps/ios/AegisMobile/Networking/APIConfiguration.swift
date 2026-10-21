import Foundation

/// Validated location of the Aegis Control REST API (`/api/v1`).
///
/// The app talks only to Aegis Control. Remote hosts must use HTTPS (doc 09 §3);
/// cleartext HTTP is accepted solely for a loopback host, which only exists in
/// the simulator running next to the local Docker stack.
struct APIConfiguration: Equatable, Sendable {
    enum Failure: Error, Equatable {
        case missing
        case malformed(String)
        case insecureTransport(host: String)
    }

    static let infoPlistKey = "AegisAPIBaseURL"
    static let environmentKey = "AEGIS_API_BASE_URL"

    private static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

    let baseURL: URL

    init(baseURL: URL) throws(Failure) {
        guard let scheme = baseURL.scheme?.lowercased(),
              let host = baseURL.host(percentEncoded: false), !host.isEmpty,
              baseURL.query() == nil, baseURL.fragment() == nil else {
            throw .malformed(baseURL.absoluteString)
        }
        switch scheme {
        case "https":
            break
        case "http" where Self.loopbackHosts.contains(host.lowercased()):
            break
        case "http":
            throw .insecureTransport(host: host)
        default:
            throw .malformed(baseURL.absoluteString)
        }
        self.baseURL = baseURL
    }

    init(string: String?) throws(Failure) {
        let trimmed = string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // An unresolved "$(...)" means the build setting was not defined.
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { throw .missing }
        guard let url = URL(string: trimmed) else { throw .malformed(trimmed) }
        try self.init(baseURL: url)
    }

    /// Reads the build-time address, letting Debug builds (UI tests, other local
    /// ports) override it through the launch environment.
    static func resolve(
        infoDictionary: [String: Any]? = Bundle.main.infoDictionary,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        allowsEnvironmentOverride: Bool = isDebugBuild
    ) throws(Failure) -> APIConfiguration {
        if allowsEnvironmentOverride, let override = environment[environmentKey] {
            return try APIConfiguration(string: override)
        }
        return try APIConfiguration(string: infoDictionary?[infoPlistKey] as? String)
    }

    static var isDebugBuild: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}
