import Foundation
@testable import AegisMobile

/// Explicit network double: records requests and replays a scripted outcome.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    enum Outcome {
        case response(status: Int, contentType: String?, body: String)
        case failure(any Error)
    }

    private let lock = NSLock()
    private let outcome: Outcome
    private var recorded: [URLRequest] = []

    init(_ outcome: Outcome) {
        self.outcome = outcome
    }

    var requests: [URLRequest] {
        lock.withLock { recorded }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { recorded.append(request) }
        switch outcome {
        case let .failure(error):
            throw error
        case let .response(status, contentType, body):
            let headers = contentType.map { ["Content-Type": $0] } ?? [:]
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            return (Data(body.utf8), response)
        }
    }
}

/// Health double whose answer is released by the test, to observe the
/// in-flight state and duplicate calls deterministically.
actor GatedHealthChecker: HealthChecking {
    private(set) var callCount = 0
    private var pending: [CheckedContinuation<Result<SystemHealth, APIError>, Never>] = []

    func fetchHealth() async throws(APIError) -> SystemHealth {
        callCount += 1
        let result = await withCheckedContinuation { pending.append($0) }
        return try result.get()
    }

    func release(_ result: Result<SystemHealth, APIError>) {
        pending.forEach { $0.resume(returning: result) }
        pending.removeAll()
    }

    func waitForCalls(_ count: Int) async {
        while callCount < count {
            await Task.yield()
        }
    }
}

struct ScriptedHealthChecker: HealthChecking {
    let result: Result<SystemHealth, APIError>

    func fetchHealth() async throws(APIError) -> SystemHealth {
        try result.get()
    }
}

enum Fixtures {
    static let healthJSON = """
        {"status":"UP","service":"aegis-control","version":"0.1.0","timestamp":"2026-10-14T18:43:28.524852Z"}
        """

    static let health = SystemHealth(
        status: .up, service: "aegis-control", version: "0.1.0",
        timestamp: Date(timeIntervalSince1970: 1_791_000_000))

    static func configuration(_ string: String = "http://localhost:8080/api/v1") -> APIConfiguration {
        try! APIConfiguration(string: string)
    }
}
