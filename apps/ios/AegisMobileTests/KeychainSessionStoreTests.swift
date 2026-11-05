import Foundation
import Security
import Testing
@testable import AegisMobile

/// Uses the simulator's real Keychain with a per-test service name.
@Suite(.serialized)
struct KeychainSessionStoreTests {
    let store = KeychainSessionStore(service: "aegis.tests.\(UUID().uuidString)")
    let session = StoredSession(accessToken: "token-a", expiresAt: Date(timeIntervalSince1970: 1_800_000_000),
                                email: "technician@aegis.demo")

    @Test func savesLoadsReplacesAndDeletes() throws {
        defer { try? store.delete() }
        #expect(try store.load() == nil)

        try store.save(session)
        #expect(try store.load() == session)

        let renewed = StoredSession(accessToken: "token-b", expiresAt: session.expiresAt + 3600, email: session.email)
        try store.save(renewed)
        #expect(try store.load() == renewed)

        try store.delete()
        #expect(try store.load() == nil)
        try store.delete()
    }

    @Test func itemIsLimitedToThisUnlockedDevice() throws {
        defer { try? store.delete() }
        try store.save(session)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: store.service,
            kSecAttrAccount as String: store.account,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        #expect(SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess)
        let attributes = try #require(result as? [String: Any])
        #expect(attributes[kSecAttrAccessible as String] as? String
                == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    }

    @Test func storedSessionDescriptionHidesTheToken() {
        #expect(!String(reflecting: session).contains("token-a"))
    }
}
