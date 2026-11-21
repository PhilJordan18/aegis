import Foundation

/// Why a scanned code is not submitted. Nothing is sent to the server for any
/// of them, and no attempt of the technician is counted.
enum LocalAccessCodeRejection: Error, Equatable, Sendable {
    /// Not an `aegis:` code at all: a web address, plain text, another app.
    case notAegis
    /// The Aegis local access form with another version than 1.
    case unsupportedVersion
    /// The Aegis form, but a field is missing, repeated, unknown or invalid.
    case malformed
    /// A well-formed code of another operation, locker or challenge, such as
    /// the code of an earlier preparation.
    case wrongContext
}

/// The hub QR, doc 10 §27.1:
/// `aegis://local-access?v=1&challengeId=<UUID>&operationId=<UUID>&lockerId=<UUID>&token=<base64url>`.
///
/// Only this exact form is read; the app never opens or follows the scanned
/// text. The checks only spare a useless request: the server checks
/// everything again (doc 09 §15.5). The token is the one-time secret of the
/// challenge, so a description never shows it.
struct LocalAccessCode: Equatable, Sendable {
    let challengeId: UUID
    let operationId: UUID
    let lockerId: UUID
    private let token: String

    /// Far above the ~230 characters of a valid code; a longer text is not
    /// parsed at all.
    static let maximumLength = 512
    /// 32 random bytes in base64url without padding, as the server requires.
    static let tokenLength = 43

    private static let fields: Set<String> = ["v", "challengeId", "operationId", "lockerId", "token"]
    private static let tokenAlphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

    static func parse(_ text: String) -> Result<LocalAccessCode, LocalAccessCodeRejection> {
        // Only the scheme separates a foreign code from a broken Aegis one.
        // Surrounding spaces are not trimmed for parsing: they only make the
        // code broken rather than foreign.
        let claimsAegis = text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(6).lowercased() == "aegis:"
        let broken: LocalAccessCodeRejection = claimsAegis ? .malformed : .notAegis
        guard text.utf8.count <= maximumLength, let components = URLComponents(string: text),
              components.scheme?.lowercased() == "aegis" else { return .failure(broken) }
        guard components.host?.lowercased() == "local-access", components.user == nil,
              components.password == nil, components.port == nil, components.path.isEmpty,
              components.fragment == nil, let query = components.percentEncodedQuery,
              // The values are UUIDs and base64url: an escape or a `+` has no
              // legitimate use here.
              !query.contains("%"), !query.contains("+") else { return .failure(.malformed) }

        var values: [String: String] = [:]
        for pair in query.split(separator: "&", omittingEmptySubsequences: false) {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, values.updateValue(String(parts[1]), forKey: String(parts[0])) == nil else {
                return .failure(.malformed)
            }
        }
        // A later version may change every other field, so it is checked first.
        guard let version = values["v"] else { return .failure(.malformed) }
        guard version == "1" else { return .failure(.unsupportedVersion) }
        guard Set(values.keys) == fields,
              let challengeId = uuid(values["challengeId"]),
              let operationId = uuid(values["operationId"]),
              let lockerId = uuid(values["lockerId"]),
              let token = values["token"], isToken(token) else { return .failure(.malformed) }
        return .success(LocalAccessCode(challengeId: challengeId, operationId: operationId,
                                        lockerId: lockerId, token: token))
    }

    /// Reads a scanned text for the operation shown on screen: the proof to
    /// submit, or why nothing is sent.
    static func proof(from text: String, for operation: LockerOperationView) -> Result<LocalProof, LocalAccessCodeRejection> {
        parse(text).flatMap { code in
            code.belongs(to: operation) ? .success(code.proof) : .failure(.wrongContext)
        }
    }

    /// Every visible identifier must be those of the displayed operation
    /// (doc 09 §15.5).
    func belongs(to operation: LockerOperationView) -> Bool {
        operationId == operation.id && lockerId == operation.lockerId
            && challengeId == operation.localAccessChallengeId
    }

    var proof: LocalProof { LocalProof(challengeId: challengeId, token: token) }

    /// Canonical 8-4-4-4-12 form only; `UUID(uuidString:)` also checks the
    /// hexadecimal digits.
    private static func uuid(_ text: String?) -> UUID? {
        guard let text, text.utf8.count == 36 else { return nil }
        return UUID(uuidString: text)
    }

    private static func isToken(_ text: String) -> Bool {
        text.utf8.count == tokenLength && text.utf8.allSatisfy(tokenAlphabet.contains)
    }
}

extension LocalAccessCode: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    var description: String {
        "LocalAccessCode(challengeId: \(challengeId.uuidString.lowercased()), "
            + "operationId: \(operationId.uuidString.lowercased()), "
            + "lockerId: \(lockerId.uuidString.lowercased()), token: <redacted>)"
    }

    var debugDescription: String { description }

    var customMirror: Mirror {
        Mirror(self, children: ["challengeId": challengeId, "operationId": operationId, "lockerId": lockerId],
               displayStyle: .struct)
    }
}
