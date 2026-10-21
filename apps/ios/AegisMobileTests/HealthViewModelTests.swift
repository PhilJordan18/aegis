import Foundation
import Testing
@testable import AegisMobile

@MainActor
struct HealthViewModelTests {
    @Test func startsIdleThenShowsTheHealth() async {
        let model = HealthViewModel(checker: ScriptedHealthChecker(result: .success(Fixtures.health)), serviceHost: "localhost")
        #expect(model.state == .idle)

        await model.load()

        #expect(model.state == .loaded(Fixtures.health))
    }

    @Test func exposesTheLoadingStateWhileTheRequestIsInFlight() async {
        let checker = GatedHealthChecker()
        let model = HealthViewModel(checker: checker, serviceHost: "localhost")

        let load = Task { await model.load() }
        await checker.waitForCalls(1)
        #expect(model.state == .loading)
        #expect(model.isLoading)

        await checker.release(.success(Fixtures.health))
        await load.value
        #expect(model.state == .loaded(Fixtures.health))
    }

    @Test func ignoresALoadRequestedWhileOneIsInFlight() async {
        let checker = GatedHealthChecker()
        let model = HealthViewModel(checker: checker, serviceHost: "localhost")

        let first = Task { await model.load() }
        await checker.waitForCalls(1)
        await model.load()

        #expect(await checker.callCount == 1)
        await checker.release(.success(Fixtures.health))
        await first.value
    }

    @Test(arguments: [
        (APIError.unreachable(.cannotConnectToHost), HealthFailure.unreachable),
        (.http(status: 503, problem: nil), .unavailable(status: 503, traceId: nil)),
        (.invalidResponse, .unexpectedResponse),
    ])
    func showsARetryableFailure(_ error: APIError, _ expected: HealthFailure) async {
        let model = HealthViewModel(checker: ScriptedHealthChecker(result: .failure(error)), serviceHost: "localhost")

        await model.load()

        #expect(model.state == .failed(expected))
        #expect(expected.isRetryable)
    }

    @Test func retryAfterANetworkErrorShowsTheHealth() async {
        let checker = GatedHealthChecker()
        let model = HealthViewModel(checker: checker, serviceHost: "localhost")

        let first = Task { await model.load() }
        await checker.waitForCalls(1)
        await checker.release(.failure(.unreachable(.notConnectedToInternet)))
        await first.value
        #expect(model.state == .failed(.unreachable))

        let retry = Task { await model.load() }
        await checker.waitForCalls(2)
        #expect(model.state == .loading)
        await checker.release(.success(Fixtures.health))
        await retry.value
        #expect(model.state == .loaded(Fixtures.health))
    }

    @Test func cancellingTheOwningTaskRestoresThePreviousState() async {
        let checker = GatedHealthChecker()
        let model = HealthViewModel(checker: checker, serviceHost: "localhost")

        let load = Task { await model.load() }
        await checker.waitForCalls(1)
        load.cancel()
        await checker.release(.success(Fixtures.health))
        await load.value

        #expect(model.state == .idle)
    }

    @Test func aMissingAddressIsAFinalConfigurationFailure() async {
        let model = HealthViewModel(configuration: .failure(.missing))

        await model.load()

        #expect(model.state == .failed(.misconfigured))
        #expect(!HealthFailure.misconfigured.isRetryable)
        #expect(model.serviceHost == nil)
    }

    @Test func aValidConfigurationExposesOnlyTheHost() {
        let model = HealthViewModel(configuration: .success(Fixtures.configuration("https://aegis.example.lan:8443/api/v1")))

        #expect(model.serviceHost == "aegis.example.lan")
        #expect(model.state == .idle)
    }
}
