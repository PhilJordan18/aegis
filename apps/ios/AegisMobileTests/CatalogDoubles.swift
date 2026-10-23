import Foundation
@testable import AegisMobile

/// Catalogue double: answers each read from a script the test sets, records
/// the queries, and can hold a read until the test releases it.
final class ScriptedCatalogService: AssetCatalogService, @unchecked Sendable {
    private let lock = NSLock()
    private var _pages: [Result<AssetPage, APIError>]
    private var _asset: Result<TechnicianAsset, APIError>
    private var _queries: [AssetQuery] = []
    private var _tokens: [String] = []
    private var _assetCalls = 0
    var gate: Gate?

    init(pages: [Result<AssetPage, APIError>] = [], asset: Result<TechnicianAsset, APIError> = .failure(.invalidResponse)) {
        _pages = pages
        _asset = asset
    }

    /// Answers of the next list reads, in order; the last one repeats.
    func setPages(_ pages: [Result<AssetPage, APIError>]) { lock.withLock { _pages = pages } }
    func setAsset(_ result: Result<TechnicianAsset, APIError>) { lock.withLock { _asset = result } }

    var queries: [AssetQuery] { lock.withLock { _queries } }
    var tokens: [String] { lock.withLock { _tokens } }
    var assetCalls: Int { lock.withLock { _assetCalls } }

    func assets(_ query: AssetQuery, bearer token: String) async throws(APIError) -> AssetPage {
        let result: Result<AssetPage, APIError> = lock.withLock {
            _queries.append(query)
            _tokens.append(token)
            return _pages.count > 1 ? _pages.removeFirst() : _pages.first ?? .failure(.invalidResponse)
        }
        if let gate { await gate.wait() }
        return try result.get()
    }

    func asset(id: UUID, bearer token: String) async throws(APIError) -> TechnicianAsset {
        let result = lock.withLock {
            _assetCalls += 1
            _tokens.append(token)
            return _asset
        }
        if let gate { await gate.wait() }
        return try result.get()
    }
}

@MainActor
final class StubSessionAccess: SessionAccess {
    var token: String? = "technician-token"
    private(set) var unauthorizedCodes: [String?] = []
    private(set) var missingTokenCalls = 0

    func accessToken() -> String? { token }
    func handleUnauthorized(code: String?) { unauthorizedCodes.append(code) }
    func handleMissingToken() { missingTokenCalls += 1 }
}

enum CatalogFixtures {
    static let technicianId = "75acc15f-fc23-45d9-857d-b543694e4fc2"

    /// The §8.2 example of doc 09, verbatim.
    static let contractExample = """
        {
          "id": "300e72fd-118c-4d1f-af9c-7fb61e89f62c",
          "assetCode": "MM-001",
          "model": {
            "id": "a09aa622-fba1-4457-8f67-7f123284e132",
            "name": "Multimètre 1",
            "manufacturer": "Fluke",
            "modelNumber": "117"
          },
          "requiredAccessLevel": "STANDARD",
          "operationalStatus": "SERVICEABLE",
          "calibration": {
            "required": true,
            "dueAt": "2026-12-01T05:00:00Z",
            "status": "VALID"
          },
          "availability": "AVAILABLE",
          "presence": "PRESENT",
          "readiness": {
            "assetId": "300e72fd-118c-4d1f-af9c-7fb61e89f62c",
            "evaluatedForUserId": "75acc15f-fc23-45d9-857d-b543694e4fc2",
            "result": "READY",
            "reasons": [],
            "evaluatedAt": "2026-09-16T14:30:00Z"
          },
          "placement": {
            "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
            "lockerCode": "AEGIS-DEMO-01",
            "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
            "compartmentCode": "A1"
          }
        }
        """

    /// One asset as JSON; every field can be overridden by a raw JSON value.
    static func json(index: Int = 1, code: String? = nil, result: String = "READY", reasons: [String] = [],
                     availability: String = "AVAILABLE", presence: String = "PRESENT",
                     access: String = "STANDARD", calibration: String? = nil,
                     placement: String? = nil, manufacturer: String = #""Fluke""#,
                     modelNumber: String = #""117""#, evaluatedAt: String = "2026-10-22T18:30:00Z",
                     extra: String = "") -> String {
        let id = id(index).uuidString.lowercased()
        let reasonList = reasons.map { "\"\($0)\"" }.joined(separator: ",")
        let calibration = calibration ?? #"{"required":true,"dueAt":"2026-12-01T17:00:00Z","status":"VALID"}"#
        let placement = placement ?? #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","lockerCode":"AEGIS-DEMO-01","compartmentId":"1ae77ae3-8490-4f09-9412-a7816b77bff9","compartmentCode":"A1"}"#
        return #"{"id":"\#(id)","assetCode":"\#(code ?? String(format: "MM-%03d", index))","model":{"id":"a09aa622-fba1-4457-8f67-7f123284e132","name":"Multimètre \#(index)","manufacturer":\#(manufacturer),"modelNumber":\#(modelNumber)},"requiredAccessLevel":"\#(access)","operationalStatus":"SERVICEABLE","calibration":\#(calibration),"availability":"\#(availability)","presence":"\#(presence)","readiness":{"assetId":"\#(id)","evaluatedForUserId":"\#(technicianId)","result":"\#(result)","reasons":[\#(reasonList)],"evaluatedAt":"\#(evaluatedAt)"},"placement":\#(placement)\#(extra)}"#
    }

    static func id(_ index: Int) -> UUID {
        UUID(uuidString: String(format: "300e72fd-118c-4d1f-af9c-%012d", index))!
    }

    static func asset(_ index: Int = 1, result: String = "READY", reasons: [String] = [],
                      availability: String = "AVAILABLE", placement: String? = nil,
                      calibration: String? = nil, access: String = "STANDARD") -> TechnicianAsset {
        decode(json(index: index, result: result, reasons: reasons, availability: availability,
                    access: access, calibration: calibration, placement: placement))
    }

    static func decode<T: Decodable>(_ text: String, as type: T.Type = T.self) -> T {
        try! APIClient.decoder.decode(T.self, from: Data(text.utf8))
    }

    static func page(_ indexes: ClosedRange<Int>, page: Int = 0, totalPages: Int = 1) -> AssetPage {
        let items = indexes.map { asset($0) }
        return AssetPage(items: items, page: page, size: 20, totalItems: items.count, totalPages: totalPages)
    }

    static let empty = AssetPage(items: [], page: 0, size: 20, totalItems: 0, totalPages: 0)

    static func problem(_ status: Int, _ code: String, traceId: String? = "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30") -> String {
        let trace = traceId.map { #","traceId":"\#($0)""# } ?? ""
        return #"{"type":"about:blank","title":"t","status":\#(status),"code":"\#(code)","detail":"d","instance":"/api/v1/assets","timestamp":"2026-10-22T18:30:00Z"\#(trace)}"#
    }
}
