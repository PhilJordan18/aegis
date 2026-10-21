import Foundation
import Security

/// What survives a relaunch: the opaque token, its expiry and the account
/// address used to prefill the form after expiry. Never logged.
struct StoredSession: Codable, Equatable, Sendable, CustomDebugStringConvertible {
    let accessToken: String
    let expiresAt: Date
    let email: String

    var debugDescription: String {
        "StoredSession(accessToken: <redacted>, expiresAt: \(expiresAt))"
    }
}

enum SessionStoreError: Error, Equatable {
    case keychain(OSStatus)
    case corrupted
}

protocol SessionStore: Sendable {
    func load() throws(SessionStoreError) -> StoredSession?
    func save(_ session: StoredSession) throws(SessionStoreError)
    func delete() throws(SessionStoreError)
}

/// Keychain storage (doc 09 §4.2): one generic password item, readable only
/// while the device is unlocked and never migrated to another device.
struct KeychainSessionStore: SessionStore {
    let service: String
    let account = "access-token"

    init(service: String = (Bundle.main.bundleIdentifier ?? "aegis.mobile") + ".session") {
        self.service = service
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func load() throws(SessionStoreError) -> StoredSession? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data,
                  let session = try? JSONDecoder().decode(StoredSession.self, from: data) else {
                throw .corrupted
            }
            return session
        case errSecItemNotFound:
            return nil
        default:
            throw .keychain(status)
        }
    }

    func save(_ session: StoredSession) throws(SessionStoreError) {
        guard let data = try? JSONEncoder().encode(session) else { throw .corrupted }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw .keychain(status) }
    }

    func delete() throws(SessionStoreError) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .keychain(status) }
    }
}

/// Process-local store for tests and Debug UI-test scenarios.
final class InMemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    init(_ session: StoredSession? = nil) {
        self.session = session
    }

    func load() throws(SessionStoreError) -> StoredSession? {
        lock.withLock { session }
    }

    func save(_ session: StoredSession) throws(SessionStoreError) {
        lock.withLock { self.session = session }
    }

    func delete() throws(SessionStoreError) {
        lock.withLock { session = nil }
    }
}
