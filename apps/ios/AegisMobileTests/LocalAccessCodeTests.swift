import Foundation
import Testing
@testable import AegisMobile

private typealias F = OperationFixtures

/// The hub QR (doc 10 §27.1) and the client checks of doc 09 §15.5: only the
/// exact Aegis form of the displayed operation becomes a proof to submit.
struct LocalAccessCodeTests {
    @Test func readsTheFormBuiltByTheHub() throws {
        let code = try LocalAccessCode.parse(F.uri()).get()

        #expect(code.challengeId == UUID(uuidString: F.challengeId))
        #expect(code.operationId == UUID(uuidString: F.operationId))
        #expect(code.lockerId == UUID(uuidString: F.lockerId))
        #expect(code.proof.challengeId == UUID(uuidString: F.challengeId))
        #expect(code.proof.token == F.token)
        #expect(F.token.utf8.count == LocalAccessCode.tokenLength)
    }

    @Test func theOrderOfTheFieldsAndTheCaseOfTheSchemeDoNotMatter() throws {
        let reordered = "aegis://local-access?token=\(F.token)&lockerId=\(F.lockerId)&operationId=\(F.operationId)"
            + "&challengeId=\(F.challengeId)&v=1"
        let upper = F.uri().replacingOccurrences(of: "aegis://", with: "AEGIS://")

        #expect(try LocalAccessCode.parse(reordered).get() == LocalAccessCode.parse(F.uri()).get())
        #expect(try LocalAccessCode.parse(upper).get() == LocalAccessCode.parse(F.uri()).get())
    }

    @Test func aCodeOfTheDisplayedOperationBecomesItsProof() throws {
        let proof = try LocalAccessCode.proof(from: F.uri(), for: F.awaiting).get()

        #expect(proof == LocalProof(challengeId: try #require(UUID(uuidString: F.challengeId)), token: F.token))
    }

    @Test(arguments: [
        F.uri(operationId: F.otherOperationId),
        F.uri(lockerId: F.otherLockerId),
        F.uri(challengeId: F.otherChallengeId),
    ])
    func aValidCodeOfAnotherContextIsNeverSent(text: String) {
        #expect(LocalAccessCode.proof(from: text, for: F.awaiting) == .failure(.wrongContext))
    }

    @Test func anOperationWithoutChallengeMatchesNoCode() {
        let view = OperationFixtures.view(challengeId: nil)

        #expect(LocalAccessCode.proof(from: F.uri(), for: view) == .failure(.wrongContext))
    }

    @Test(arguments: [
        "",
        "hello",
        "https://aegis.example/local-access?v=1",
        "http://local-access?v=1&challengeId=x",
        "aegis",
        "mailto:someone@example.com",
        String(repeating: "x", count: 600),
    ])
    func anythingElseIsNotAnAegisCode(text: String) {
        #expect(LocalAccessCode.parse(text) == .failure(.notAegis))
    }

    @Test(arguments: [
        F.uri(v: "2"),
        "aegis://local-access?v=2&ticket=abc",
        F.uri(v: "1.1"),
    ])
    func anotherVersionIsUnsupported(text: String) {
        #expect(LocalAccessCode.parse(text) == .failure(.unsupportedVersion))
    }

    @Test(arguments: [
        // Missing, repeated, empty or unknown fields.
        "aegis://local-access?challengeId=\(F.challengeId)&operationId=\(F.operationId)&lockerId=\(F.lockerId)&token=\(F.token)",
        "aegis://local-access?v=1&challengeId=\(F.challengeId)&operationId=\(F.operationId)&lockerId=\(F.lockerId)",
        F.uri() + "&token=\(F.token)",
        F.uri() + "&v=1",
        F.uri() + "&extra=1",
        F.uri() + "&",
        F.uri(challengeId: ""),
        F.uri().replacingOccurrences(of: "&lockerId=", with: "&lockerId"),
        // Invalid identifiers.
        F.uri(challengeId: "not-a-uuid"),
        F.uri(operationId: F.operationId.replacingOccurrences(of: "-", with: "")),
        F.uri(lockerId: "{\(F.lockerId)}"),
        F.uri(challengeId: "9d65cbae-4610-4e40-a314-3b93af07be9g"),
        // Invalid tokens: length, padding, alphabet, escapes.
        F.uri(token: String(F.token.dropLast())),
        F.uri(token: F.token + "A"),
        F.uri(token: String(F.token.dropLast()) + "="),
        F.uri(token: String(F.token.dropLast()) + "+"),
        F.uri(token: String(F.token.dropLast()) + "/"),
        F.uri(token: String(F.token.dropLast(3)) + "%2D"),
        // Anything around the query.
        F.uri().replacingOccurrences(of: "local-access?", with: "local-access/open?"),
        F.uri().replacingOccurrences(of: "local-access?", with: "local-access:443?"),
        F.uri().replacingOccurrences(of: "aegis://", with: "aegis://user@"),
        F.uri() + "#fragment",
        F.uri().replacingOccurrences(of: "local-access", with: "open-door"),
        "aegis://local-access",
        "aegis:local-access?v=1",
        " " + F.uri(),
        F.uri() + "\n",
        F.uri() + "&padding=" + String(repeating: "a", count: 400),
    ])
    func aBrokenAegisCodeIsMalformed(text: String) {
        #expect(LocalAccessCode.parse(text) == .failure(.malformed))
    }

    @Test func theCodeNeverDescribesItsToken() throws {
        let code = try LocalAccessCode.parse(F.uri()).get()
        var dumped = ""
        dump(code, to: &dumped)

        for text in [String(describing: code), String(reflecting: code), "\(code)", dumped] {
            #expect(!text.contains(F.token))
        }
        #expect(String(describing: code).contains(F.operationId))
    }
}
