import Foundation
@testable import AegisMobile

/// Authentication double with scripted results; records what was sent.
final class StubAuthentication: AuthenticationService, @unchecked Sendable {
    private let lock = NSLock()
    private var _loginResult: Result<LoginResponse, APIError>
    private var _profileResult: Result<UserProfile, APIError>
    private var _loginCalls = 0
    private var _profileTokens: [String] = []
    /// When set, `login` or `currentProfile` waits until the gate opens.
    let loginGate: Gate?
    let profileGate: Gate?

    init(login: Result<LoginResponse, APIError> = .failure(.invalidResponse),
         profile: Result<UserProfile, APIError> = .failure(.invalidResponse),
         loginGate: Gate? = nil, profileGate: Gate? = nil) {
        _loginResult = login
        _profileResult = profile
        self.loginGate = loginGate
        self.profileGate = profileGate
    }

    func setLogin(_ result: Result<LoginResponse, APIError>) {
        lock.withLock { _loginResult = result }
    }

    var loginCalls: Int { lock.withLock { _loginCalls } }
    var profileTokens: [String] { lock.withLock { _profileTokens } }

    func setProfile(_ result: Result<UserProfile, APIError>) {
        lock.withLock { _profileResult = result }
    }

    func login(email: String, password: String) async throws(APIError) -> LoginResponse {
        lock.withLock { _loginCalls += 1 }
        if let loginGate { await loginGate.wait() }
        return try lock.withLock { _loginResult }.get()
    }

    func currentProfile(bearer token: String) async throws(APIError) -> UserProfile {
        lock.withLock { _profileTokens.append(token) }
        if let profileGate { await profileGate.wait() }
        return try lock.withLock { _profileResult }.get()
    }
}

/// One-shot barrier released by the test.
actor Gate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }

    var waiting: Int { waiters.count }
}

final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_800_000_000)) {
        current = start
    }

    var now: Date { lock.withLock { current } }

    func advance(by seconds: TimeInterval) {
        lock.withLock { current = current.addingTimeInterval(seconds) }
    }
}

final class FailingSessionStore: SessionStore, @unchecked Sendable {
    func load() throws(SessionStoreError) -> StoredSession? { nil }
    func save(_ session: StoredSession) throws(SessionStoreError) { throw .keychain(-34018) }
    func delete() throws(SessionStoreError) {}
}

/// Keychain double whose load or delete fails, recording what was attempted.
final class FaultySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?
    private let loadError: SessionStoreError?
    private let deleteFails: Bool
    private var _deleteCalls = 0

    init(_ session: StoredSession?, loadError: SessionStoreError? = nil, deleteFails: Bool = false) {
        self.session = session
        self.loadError = loadError
        self.deleteFails = deleteFails
    }

    var deleteCalls: Int { lock.withLock { _deleteCalls } }
    var current: StoredSession? { lock.withLock { session } }

    func load() throws(SessionStoreError) -> StoredSession? {
        if let loadError { throw loadError }
        return lock.withLock { session }
    }

    func save(_ session: StoredSession) throws(SessionStoreError) {
        lock.withLock { self.session = session }
    }

    func delete() throws(SessionStoreError) {
        lock.withLock { _deleteCalls += 1 }
        if deleteFails { throw .keychain(-25308) }
        lock.withLock { session = nil }
    }
}

enum SessionFixtures {
    static let technician = UserProfile(
        id: "75acc15f-fc23-45d9-857d-b543694e4fc2", displayName: "Technicien Démo",
        email: "technician@aegis.demo", role: .technician, maximumAccessLevel: .standard)
    static let admin = UserProfile(
        id: "a1", displayName: "Admin Démo", email: "admin@aegis.demo",
        role: .admin, maximumAccessLevel: .restricted)

    static func login(_ user: UserProfile, expiresAt: Date, expiresIn: Int = 3600) -> LoginResponse {
        LoginResponse(accessToken: "token-\(user.id)", tokenType: "Bearer", expiresIn: expiresIn,
                      expiresAt: expiresAt, user: user)
    }

    static func problem(_ status: Int, _ code: String, traceId: String? = "trace-1",
                        violations: [APIProblem.Violation]? = nil) -> APIProblem {
        APIProblem(status: status, code: code, title: "t", detail: "d", traceId: traceId, violations: violations)
    }
}
