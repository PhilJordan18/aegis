import Foundation
import Observation

/// Why the health check could not show a healthy service.
enum HealthFailure: Equatable, Sendable {
    /// No HTTP response: network, address or transport security problem.
    case unreachable
    /// The service answered with an error status.
    case unavailable(status: Int, traceId: String?)
    case unexpectedResponse
    /// The app was built without a usable API address; retrying cannot help.
    case misconfigured

    init(_ error: APIError) {
        switch error {
        case .unreachable, .cancelled:
            self = .unreachable
        case let .http(status, problem, _):
            self = .unavailable(status: status, traceId: problem?.traceId)
        case .invalidResponse:
            self = .unexpectedResponse
        }
    }

    var isRetryable: Bool { self != .misconfigured }
}

@MainActor
@Observable
final class HealthViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded(SystemHealth)
        case failed(HealthFailure)
    }

    private(set) var state: State
    /// Host shown to identify which service was checked; never a credential.
    let serviceHost: String?

    private let checker: (any HealthChecking)?

    init(checker: (any HealthChecking)?, serviceHost: String?) {
        self.checker = checker
        self.serviceHost = serviceHost
        state = checker == nil ? .failed(.misconfigured) : .idle
    }

    convenience init(configuration: Result<APIConfiguration, APIConfiguration.Failure>) {
        switch configuration {
        case let .success(configuration):
            self.init(checker: APIClient(configuration: configuration),
                      serviceHost: configuration.baseURL.host(percentEncoded: false))
        case .failure:
            self.init(checker: nil, serviceHost: nil)
        }
    }

    var isLoading: Bool { state == .loading }

    /// Loads the health once; a call made while a request is in flight is
    /// ignored so repeated appearance or taps never stack requests.
    func load() async {
        guard let checker, state != .loading else { return }
        let previous = state
        state = .loading
        do throws(APIError) {
            let health = try await checker.fetchHealth()
            state = Task.isCancelled ? previous : .loaded(health)
        } catch .cancelled {
            state = previous
        } catch {
            state = Task.isCancelled ? previous : .failed(HealthFailure(error))
        }
    }
}
