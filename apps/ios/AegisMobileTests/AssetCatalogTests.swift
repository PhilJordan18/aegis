import Foundation
import Testing
@testable import AegisMobile

/// Contract of the technician catalogue (doc 09 §8.1, §8.2, §11.1, §11.2)
/// as decoded and requested by `APIClient`.
struct AssetCatalogTests {
    private func client(_ outcome: StubTransport.Outcome) -> (APIClient, StubTransport) {
        let transport = StubTransport(outcome)
        return (APIClient(configuration: Fixtures.configuration(), transport: transport), transport)
    }

    // MARK: Decoding

    @Test func decodesTheContractExample() throws {
        let asset = CatalogFixtures.decode(CatalogFixtures.contractExample, as: TechnicianAsset.self)

        #expect(asset.id == UUID(uuidString: "300e72fd-118c-4d1f-af9c-7fb61e89f62c"))
        #expect(asset.assetCode == "MM-001")
        #expect(asset.model.name == "Multimètre 1")
        #expect(asset.model.manufacturer == "Fluke")
        #expect(asset.model.modelNumber == "117")
        #expect(asset.requiredAccessLevel == .known(.standard))
        #expect(asset.operationalStatus == .known(.serviceable))
        #expect(asset.calibration.required)
        #expect(asset.calibration.dueAt == (try Date("2026-12-01T05:00:00Z", strategy: .iso8601)))
        #expect(asset.calibration.status == .known(.valid))
        #expect(asset.availability == .known(.available))
        #expect(asset.presence == .known(.present))
        #expect(asset.readiness.result == .known(.ready))
        #expect(asset.readiness.reasons.isEmpty)
        #expect(asset.readiness.evaluatedForUserId == UUID(uuidString: CatalogFixtures.technicianId))
        #expect(asset.readiness.evaluatedAt == (try Date("2026-09-16T14:30:00Z", strategy: .iso8601)))
        #expect(asset.placement?.compartmentCode == "A1")
        #expect(asset.placement?.lockerCode == "AEGIS-DEMO-01")
    }

    @Test func decodesThePageEnvelope() throws {
        let body = #"{"items":[\#(CatalogFixtures.json(index: 1)),\#(CatalogFixtures.json(index: 2))],"page":0,"size":20,"totalItems":2,"totalPages":1}"#
        let page = CatalogFixtures.decode(body, as: AssetPage.self)

        #expect(page.items.map(\.assetCode) == ["MM-001", "MM-002"])
        #expect(page.page == 0)
        #expect(page.size == 20)
        #expect(page.totalItems == 2)
        #expect(page.totalPages == 1)
        #expect(CatalogFixtures.decode(#"{"items":[],"page":0,"size":20,"totalItems":0,"totalPages":0}"#,
                                       as: AssetPage.self).items.isEmpty)
    }

    @Test func keepsUnknownEnumerationValuesAsUnrecognized() {
        let asset = CatalogFixtures.decode(CatalogFixtures.json(
            result: "PARTIALLY_READY", reasons: ["CALIBRATION_EXPIRED", "SOLAR_FLARE"],
            availability: "IN_TRANSIT", presence: "SOMEWHERE", access: "TOP_SECRET",
            calibration: #"{"required":true,"dueAt":null,"status":"PENDING"}"#), as: TechnicianAsset.self)

        #expect(asset.readiness.result == .unrecognized("PARTIALLY_READY"))
        #expect(asset.readiness.reasons == [.known(.calibrationExpired), .unrecognized("SOLAR_FLARE")])
        #expect(asset.availability == .unrecognized("IN_TRANSIT"))
        #expect(asset.presence == .unrecognized("SOMEWHERE"))
        #expect(asset.requiredAccessLevel == .unrecognized("TOP_SECRET"))
        #expect(asset.calibration.status == .unrecognized("PENDING"))
        #expect(AssetStatus(asset) == .unrecognized)
    }

    @Test(arguments: ["null", "absent"])
    func acceptsMissingOptionalFields(_ form: String) {
        var text = CatalogFixtures.json(
            calibration: #"{"required":false,"dueAt":null,"status":"NOT_REQUIRED"}"#,
            placement: "null", manufacturer: "null", modelNumber: "null")
        if form == "absent" {
            for field in [#","placement":null"#, #","manufacturer":null"#, #","modelNumber":null"#, #","dueAt":null"#] {
                text = text.replacingOccurrences(of: field, with: "")
            }
        }
        let asset = CatalogFixtures.decode(text, as: TechnicianAsset.self)

        #expect(asset.placement == nil)
        #expect(asset.model.manufacturer == nil)
        #expect(asset.model.modelNumber == nil)
        #expect(asset.calibration.dueAt == nil)
        #expect(AssetPresentation.identityLine(for: asset) == "MM-001")
    }

    @Test func dropsTheRFIDIdentifier() {
        let secret = "E28011606000020FAKE0RFID"
        let asset = CatalogFixtures.decode(
            CatalogFixtures.json(extra: #","identifierValue":"\#(secret)","rawRfidPayload":"\#(secret)""#),
            as: TechnicianAsset.self)

        #expect(!String(reflecting: asset).contains(secret))
        #expect(!String(reflecting: asset).contains("identifierValue"))
        #expect(!Mirror(reflecting: asset).children.contains { $0.label == "identifierValue" })
    }

    // MARK: Requests

    @Test func requestsTheFirstPageWithTheBearer() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: #"{"items":[],"page":0,"size":20,"totalItems":0,"totalPages":0}"#))
        _ = try await client.assets(AssetQuery(), bearer: "token-1")

        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "http://localhost:8080/api/v1/assets?page=0&size=20")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
    }

    @Test(arguments: [
        (ReadinessFilter.all, nil as String?),
        (.ready, "READY"),
        (.blocked, "BLOCKED"),
        (.needsChecking, "UNKNOWN"),
    ])
    func sendsTheReadinessFilter(_ filter: ReadinessFilter, _ expected: String?) {
        let items = AssetQuery(readiness: filter).queryItems
        #expect(items.first { $0.name == "readiness" }?.value == expected)
        #expect(!items.contains { $0.name == "sort" || $0.name == "availability" })
    }

    @Test func encodesTheSearchStrictly() {
        let query = AssetQuery(search: "MM+1 & co/é", readiness: .blocked, page: 2)
        let url = APIClient.url(URL(string: "http://localhost:8080/api/v1/assets")!, query: query.queryItems)

        #expect(url.absoluteString
                == "http://localhost:8080/api/v1/assets?q=MM%2B1%20%26%20co%2F%C3%A9&readiness=BLOCKED&page=2&size=20")
    }

    @Test(arguments: [
        ("  MM-001  ", "MM-001" as String?),
        ("", nil),
        ("   \n ", nil),
        ("Fluke", "Fluke"),
    ])
    func normalizesTheSearch(_ text: String, _ expected: String?) {
        #expect(AssetQuery.normalizedSearch(text) == expected)
    }

    @Test func limitsTheSearchToOneHundredUnitsWithoutSplittingACharacter() throws {
        #expect(AssetQuery.normalizedSearch(String(repeating: "a", count: 140))?.count == 100)
        let emoji = String(repeating: "a", count: 99) + "👍🏽"
        let limited = try #require(AssetQuery.normalizedSearch(emoji))
        #expect(limited == String(repeating: "a", count: 99))
        #expect(limited.utf16.count <= 100)
    }

    @Test func requestsOneAssetByLowercasedIdentifier() async throws {
        let (client, transport) = client(.response(status: 200, contentType: "application/json",
                                                   body: CatalogFixtures.contractExample))
        let id = try #require(UUID(uuidString: "300E72FD-118C-4D1F-AF9C-7FB61E89F62C"))
        let asset = try await client.asset(id: id, bearer: "token-1")

        #expect(asset.id == id)
        #expect(transport.requests.first?.url?.absoluteString
                == "http://localhost:8080/api/v1/assets/300e72fd-118c-4d1f-af9c-7fb61e89f62c")
    }

    // MARK: Errors

    @Test func mapsAMissingAssetToANotFoundProblem() async {
        let (client, _) = client(.response(status: 404, contentType: "application/problem+json",
                                           body: CatalogFixtures.problem(404, "ASSET_NOT_FOUND")))
        do {
            _ = try await client.asset(id: CatalogFixtures.id(1), bearer: "t")
            Issue.record("expected a failure")
        } catch {
            guard case let .http(404, problem, _) = error else { Issue.record("unexpected \(error)"); return }
            #expect(problem?.code == "ASSET_NOT_FOUND")
        }
    }

    @Test(arguments: [
        (401, "AUTH_TOKEN_EXPIRED", CatalogFailure.service(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")),
        (403, "FORBIDDEN", .forbidden),
        (500, "INTERNAL_ERROR", .service(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")),
        (503, "SERVICE_UNAVAILABLE", .service(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")),
    ])
    func mapsProblemResponses(_ status: Int, _ code: String, _ failure: CatalogFailure) async {
        let (client, _) = client(.response(status: status, contentType: "application/problem+json",
                                           body: CatalogFixtures.problem(status, code)))
        do {
            _ = try await client.assets(AssetQuery(), bearer: "t")
            Issue.record("expected a failure")
        } catch {
            guard case let .http(received, problem, _) = error else { Issue.record("unexpected \(error)"); return }
            #expect(received == status)
            #expect(problem?.code == code)
            // A 401 never reaches CatalogFailure (it ends the session); the
            // mapping is still total.
            #expect(CatalogFailure(error) == failure)
        }
    }

    /// Doc 09 §7.1: a 400 on `q` or `size`, or any problem or violation code
    /// this client does not know, takes the generic path: a controlled
    /// message with the trace identifier, never the server text.
    @Test(arguments: [
        ("INVALID_VALUE", "q", "SIZE"),
        ("VALIDATION_FAILED", "size", "INVALID_VALUE"),
        ("BRAND_NEW_PROBLEM", "q", "BRAND_NEW_VIOLATION"),
    ])
    func handlesABadRequestGenerically(_ code: String, _ field: String, _ violation: String) async {
        let body = #"{"type":"about:blank","title":"Requête invalide","status":400,"code":"\#(code)","detail":"SERVER DETAIL","instance":"/api/v1/assets","traceId":"5f4bc22e-66a4-48ef-8bf3-6e7184d71c30","timestamp":"2026-10-22T18:30:00Z","violations":[{"field":"\#(field)","code":"\#(violation)","message":"message serveur"}]}"#
        let (client, _) = client(.response(status: 400, contentType: "application/problem+json", body: body))
        do {
            _ = try await client.assets(AssetQuery(search: "MM"), bearer: "t")
            Issue.record("expected a failure")
        } catch {
            guard case let .http(400, problem, _) = error else { Issue.record("unexpected \(error)"); return }
            #expect(problem?.code == code)
            #expect(problem?.violations == [.init(field: field, code: violation)])
            #expect(CatalogFailure(error) == .service(traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30"))
        }
    }

    @Test func dropsAnUnsafeTraceIdentifier() {
        let problem = APIProblem(status: 500, code: "X", title: "t", detail: "d", traceId: "<script>alert(1)</script>")
        #expect(CatalogFailure(.http(status: 500, problem: problem)) == .service(traceId: nil))
        #expect(CatalogFailure(.http(status: 502, problem: nil)) == .service(traceId: nil))
        #expect(CatalogFailure(.invalidResponse) == .service(traceId: nil))
    }

    @Test func mapsTransportFailuresToUnreachable() async {
        let (client, _) = client(.failure(URLError(.notConnectedToInternet)))
        await #expect(throws: APIError.unreachable(.notConnectedToInternet)) {
            try await client.assets(AssetQuery(), bearer: "t")
        }
        #expect(CatalogFailure(.unreachable(.timedOut)) == .unreachable)
    }

    @Test func rejectsAnUnreadableBody() async {
        let (client, _) = client(.response(status: 200, contentType: "application/json", body: #"{"items":"oops"}"#))
        await #expect(throws: APIError.invalidResponse) {
            try await client.assets(AssetQuery(), bearer: "t")
        }
    }
}
