import Foundation
import os

// Technician catalogue contract, doc 09 §8.1, §8.2, §11.1 and §11.2.
// The client only displays what the server evaluated: readiness is never
// computed here, and no RFID identifier is part of these types (§8.2).

/// A contract enumeration value. A value this client does not know is kept as
/// `unrecognized`, logged, and never stands for a known value (doc 09 §3).
enum ContractValue<Known>: Hashable, Sendable
where Known: RawRepresentable & Hashable & Sendable, Known.RawValue == String {
    case known(Known)
    case unrecognized(String)

    var known: Known? {
        if case let .known(value) = self { value } else { nil }
    }
}

extension ContractValue: Decodable {
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        if let value = Known(rawValue: raw) {
            self = .known(value)
        } else {
            ContractLog.unrecognized(String(describing: Known.self), raw: raw, at: decoder.codingPath)
            self = .unrecognized(raw)
        }
    }
}

enum ContractLog {
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "AegisMobile", category: "contract")

    /// Enumeration codes are public contract vocabulary, never personal data.
    static func unrecognized(_ type: String, raw: String, at path: [any CodingKey]) {
        let location = path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
        logger.warning("Unrecognized \(type, privacy: .public) value '\(raw, privacy: .public)' at \(location, privacy: .public)")
    }
}

enum ReadinessResult: String, Hashable, Sendable {
    case ready = "READY"
    case blocked = "BLOCKED"
    case unknown = "UNKNOWN"
}

enum ReadinessReason: String, Hashable, Sendable, CaseIterable {
    case notPresent = "NOT_PRESENT"
    case notAvailable = "NOT_AVAILABLE"
    case maintenance = "MAINTENANCE"
    case damaged = "DAMAGED"
    case calibrationExpired = "CALIBRATION_EXPIRED"
    case accessDenied = "ACCESS_DENIED"
    case unknownPhysicalState = "UNKNOWN_PHYSICAL_STATE"
}

enum OperationalStatus: String, Hashable, Sendable {
    case serviceable = "SERVICEABLE"
    case maintenance = "MAINTENANCE"
    case damaged = "DAMAGED"
}

enum Availability: String, Hashable, Sendable {
    case available = "AVAILABLE"
    case reserved = "RESERVED"
    case borrowed = "BORROWED"
    case unavailable = "UNAVAILABLE"
}

enum Presence: String, Hashable, Sendable {
    case present = "PRESENT"
    case absent = "ABSENT"
    case unknown = "UNKNOWN"
}

enum CalibrationStatus: String, Hashable, Sendable {
    case notRequired = "NOT_REQUIRED"
    case valid = "VALID"
    case expired = "EXPIRED"
    case unknown = "UNKNOWN"
}

enum AssetAccessLevel: String, Hashable, Sendable {
    case standard = "STANDARD"
    case restricted = "RESTRICTED"
}

/// §8.1, evaluated by the server for the signed-in technician.
struct ReadinessAssessment: Decodable, Hashable, Sendable {
    let assetId: UUID
    let evaluatedForUserId: UUID
    let result: ContractValue<ReadinessResult>
    let reasons: [ContractValue<ReadinessReason>]
    let evaluatedAt: Date
}

struct AssetModelSummary: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let manufacturer: String?
    let modelNumber: String?
}

struct CalibrationView: Decodable, Hashable, Sendable {
    let required: Bool
    let dueAt: Date?
    let status: ContractValue<CalibrationStatus>
}

struct PlacementSummary: Decodable, Hashable, Sendable {
    let lockerId: UUID
    let lockerCode: String
    let compartmentId: UUID
    let compartmentCode: String
}

/// `AssetView` of the technician (§8.2). Only the declared properties are
/// decoded: an unexpected field such as `identifierValue` is dropped by the
/// decoder and can never be stored or displayed.
struct TechnicianAsset: Decodable, Hashable, Sendable, Identifiable {
    let id: UUID
    let assetCode: String
    let model: AssetModelSummary
    let requiredAccessLevel: ContractValue<AssetAccessLevel>
    let operationalStatus: ContractValue<OperationalStatus>
    let calibration: CalibrationView
    let availability: ContractValue<Availability>
    let presence: ContractValue<Presence>
    let readiness: ReadinessAssessment
    let placement: PlacementSummary?

    // `placement`, `manufacturer`, `modelNumber` and `dueAt` may be null or
    // omitted (doc 09 §3): both mean absent.
}

/// §11.1 envelope; `page` is zero-based.
struct AssetPage: Decodable, Hashable, Sendable {
    let items: [TechnicianAsset]
    let page: Int
    let size: Int
    let totalItems: Int
    let totalPages: Int
}

/// Readiness filter of the catalogue (§11.1 `readiness`).
enum ReadinessFilter: String, CaseIterable, Hashable, Sendable {
    case all
    case ready
    case blocked
    case needsChecking

    var apiValue: String? {
        switch self {
        case .all: nil
        case .ready: ReadinessResult.ready.rawValue
        case .blocked: ReadinessResult.blocked.rawValue
        case .needsChecking: ReadinessResult.unknown.rawValue
        }
    }
}

/// Parameters of `GET /assets`. The sort stays the server default
/// (`assetCode,asc`, then `id`, §22.1), so pages do not overlap.
struct AssetQuery: Hashable, Sendable {
    static let pageSize = 20
    static let maximumSearchLength = 100

    var search: String?
    var readiness: ReadinessFilter = .all
    var page = 0
    var size = pageSize

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let search { items.append(URLQueryItem(name: "q", value: search)) }
        if let value = readiness.apiValue { items.append(URLQueryItem(name: "readiness", value: value)) }
        items.append(URLQueryItem(name: "page", value: String(page)))
        items.append(URLQueryItem(name: "size", value: String(size)))
        return items
    }

    /// §22.3: outer spaces removed, an empty search is not sent, and the
    /// length stays within 1 to 100 (UTF-16 units, as the server counts them)
    /// without splitting a character.
    static func normalizedSearch(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return limited(trimmed)
    }

    static func limited(_ text: String) -> String {
        guard text.utf16.count > maximumSearchLength else { return text }
        var result = ""
        for character in text {
            guard result.utf16.count + character.utf16.count <= maximumSearchLength else { break }
            result.append(character)
        }
        return result
    }
}

extension Endpoint where Response == AssetPage {
    static func assets(_ query: AssetQuery) -> Endpoint {
        Endpoint(method: "GET", path: "assets", query: query.queryItems)
    }
}

extension Endpoint where Response == TechnicianAsset {
    static func asset(id: UUID) -> Endpoint {
        Endpoint(method: "GET", path: "assets/\(id.uuidString.lowercased())")
    }
}

protocol AssetCatalogService: Sendable {
    func assets(_ query: AssetQuery, bearer token: String) async throws(APIError) -> AssetPage
    func asset(id: UUID, bearer token: String) async throws(APIError) -> TechnicianAsset
}

extension APIClient: AssetCatalogService {
    func assets(_ query: AssetQuery, bearer token: String) async throws(APIError) -> AssetPage {
        try await send(.assets(query), bearer: token)
    }

    func asset(id: UUID, bearer token: String) async throws(APIError) -> TechnicianAsset {
        try await send(.asset(id: id), bearer: token)
    }
}
