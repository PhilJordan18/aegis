import Foundation
import Testing
@testable import AegisMobile

struct APIConfigurationTests {
    @Test(arguments: [
        "https://aegis-control.example.lan:8443/api/v1",
        "http://localhost:8080/api/v1",
        "http://127.0.0.1:8080/api/v1",
        "http://[::1]:8080/api/v1",
    ])
    func acceptsHTTPSOrLoopbackHTTP(_ address: String) throws {
        let configuration = try APIConfiguration(string: address)
        #expect(configuration.baseURL.absoluteString == address)
    }

    @Test(arguments: [
        ("http://192.168.1.20:8080/api/v1", "192.168.1.20"),
        ("http://aegis.local/api/v1", "aegis.local"),
    ])
    func rejectsCleartextToANonLoopbackHost(_ address: String, _ host: String) {
        #expect(throws: APIConfiguration.Failure.insecureTransport(host: host)) {
            try APIConfiguration(string: address)
        }
    }

    @Test(arguments: [nil, "", "   ", "$(AEGIS_API_BASE_URL)"] as [String?])
    func treatsAnEmptyOrUnresolvedSettingAsMissing(_ value: String?) {
        #expect(throws: APIConfiguration.Failure.missing) {
            try APIConfiguration(string: value)
        }
    }

    @Test(arguments: ["ftp://localhost/api/v1", "localhost:8080", "https://example.com/api/v1?debug=1"])
    func rejectsMalformedAddresses(_ value: String) {
        #expect(throws: APIConfiguration.Failure.malformed(value)) {
            try APIConfiguration(string: value)
        }
    }

    @Test func environmentOverridesOnlyWhenAllowed() throws {
        let info: [String: Any] = [APIConfiguration.infoPlistKey: "https://built-in.example/api/v1"]
        let environment = [APIConfiguration.environmentKey: "http://127.0.0.1:9/api/v1"]

        let debug = try APIConfiguration.resolve(
            infoDictionary: info, environment: environment, allowsEnvironmentOverride: true)
        let release = try APIConfiguration.resolve(
            infoDictionary: info, environment: environment, allowsEnvironmentOverride: false)

        #expect(debug.baseURL.absoluteString == "http://127.0.0.1:9/api/v1")
        #expect(release.baseURL.absoluteString == "https://built-in.example/api/v1")
    }

    @Test func overrideIsValidatedLikeTheBuiltInAddress() {
        #expect(throws: APIConfiguration.Failure.insecureTransport(host: "10.0.0.5")) {
            try APIConfiguration.resolve(
                infoDictionary: [:],
                environment: [APIConfiguration.environmentKey: "http://10.0.0.5:8080/api/v1"],
                allowsEnvironmentOverride: true)
        }
    }
}
