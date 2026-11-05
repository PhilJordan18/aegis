import Foundation

/// `POST /auth/login` body (doc 09 §10.2). Unknown request fields are rejected
/// by the API, so nothing else is sent.
struct LoginRequest: Encodable, Sendable, CustomReflectable {
    let email: String
    let password: String

    var customMirror: Mirror {
        Mirror(self, children: ["email": email], displayStyle: .struct)
    }
}

/// `POST /auth/login` response. The token is opaque to the client.
struct LoginResponse: Decodable, Equatable, Sendable, CustomDebugStringConvertible, CustomReflectable {
    let accessToken: String
    let tokenType: String
    let expiresIn: Int
    let expiresAt: Date
    let user: UserProfile

    var debugDescription: String {
        "LoginResponse(accessToken: <redacted>, expiresAt: \(expiresAt), user: \(user.id))"
    }

    var customMirror: Mirror {
        Mirror(self, children: ["expiresAt": expiresAt, "user": user], displayStyle: .struct)
    }
}

/// Minimal profile of doc 09 §4.4, from `login` or `GET /auth/me`.
struct UserProfile: Codable, Equatable, Sendable {
    enum Role: Equatable, Sendable {
        case technician
        case admin
        /// A value this client does not know; never treated as a technician.
        case other(String)
    }

    enum AccessLevel: Equatable, Sendable {
        case standard
        case restricted
        case other(String)
    }

    let id: String
    let displayName: String
    let email: String
    let role: Role
    let maximumAccessLevel: AccessLevel
}

extension UserProfile.Role: Codable {
    init(from decoder: any Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "TECHNICIAN": self = .technician
        case "ADMIN": self = .admin
        case let raw: self = .other(raw)
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .technician: try container.encode("TECHNICIAN")
        case .admin: try container.encode("ADMIN")
        case let .other(raw): try container.encode(raw)
        }
    }
}

extension UserProfile.AccessLevel: Codable {
    init(from decoder: any Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "STANDARD": self = .standard
        case "RESTRICTED": self = .restricted
        case let raw: self = .other(raw)
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .standard: try container.encode("STANDARD")
        case .restricted: try container.encode("RESTRICTED")
        case let .other(raw): try container.encode(raw)
        }
    }
}

protocol AuthenticationService: Sendable {
    func login(email: String, password: String) async throws(APIError) -> LoginResponse
    func currentProfile(bearer token: String) async throws(APIError) -> UserProfile
}

extension APIClient: AuthenticationService {
    func login(email: String, password: String) async throws(APIError) -> LoginResponse {
        try await send(.json(method: "POST", path: "auth/login",
                             body: LoginRequest(email: email, password: password)))
    }

    func currentProfile(bearer token: String) async throws(APIError) -> UserProfile {
        try await send(Endpoint<UserProfile>(method: "GET", path: "auth/me"), bearer: token)
    }
}
