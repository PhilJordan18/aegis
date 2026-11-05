import Foundation

/// Minimal public health of Aegis Control (`GET /system/health`, doc 09 §10.1).
struct SystemHealth: Decodable, Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case up
        /// A value this client does not know; shown as-is, never assumed healthy.
        case other(String)
    }

    let status: Status
    let service: String
    let version: String
    let timestamp: Date
}

extension SystemHealth.Status: Decodable {
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = raw == "UP" ? .up : .other(raw)
    }
}

extension Endpoint where Response == SystemHealth {
    static let systemHealth = Endpoint(method: "GET", path: "system/health")
}

protocol HealthChecking: Sendable {
    func fetchHealth() async throws(APIError) -> SystemHealth
}

extension APIClient: HealthChecking {
    func fetchHealth() async throws(APIError) -> SystemHealth {
        try await send(.systemHealth)
    }
}
