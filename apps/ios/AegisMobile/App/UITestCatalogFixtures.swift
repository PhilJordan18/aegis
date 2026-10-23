#if DEBUG
import Foundation

/// FICTIONAL catalogue answers for UI tests and captures (Debug only, compiled
/// out of Release). The technician GET /assets route does not exist yet; these
/// payloads follow doc 09 §8.2 and §11.1 and are served only through the
/// `AEGIS_UI_SCENARIO` hook. Nothing here is a fallback of the real app.
enum UITestCatalogFixtures {
    static let technicianId = "75acc15f-fc23-45d9-857d-b543694e4fc2"
    /// 14:30 EDT on 22 October 2026.
    static let evaluatedAt = "2026-10-22T18:30:00Z"
    /// Deliberately present on one item: the client must drop it (§8.2).
    static let leakedIdentifier = "E28011606000020FAKE0RFID"

    struct Item {
        let id: String
        let code: String
        let name: String
        let manufacturer: String?
        let modelNumber: String?
        let access: String
        let operational: String
        let calibration: String
        let availability: String
        let presence: String
        let result: String
        let reasons: [String]
        let compartment: String?
        var extra = ""

        var json: String {
            func text(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
            let placement = compartment.map {
                #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","lockerCode":"AEGIS-DEMO-01","compartmentId":"1ae77ae3-8490-4f09-9412-a7816b77b\#(id.suffix(3))","compartmentCode":"\#($0)"}"#
            } ?? "null"
            let reasonList = reasons.map { "\"\($0)\"" }.joined(separator: ",")
            return #"{"id":"\#(id)","assetCode":"\#(code)","model":{"id":"a09aa622-fba1-4457-8f67-7f123284e\#(id.suffix(3))","name":"\#(name)","manufacturer":\#(text(manufacturer)),"modelNumber":\#(text(modelNumber))},"requiredAccessLevel":"\#(access)","operationalStatus":"\#(operational)","calibration":\#(calibration),"availability":"\#(availability)","presence":"\#(presence)","readiness":{"assetId":"\#(id)","evaluatedForUserId":"\#(technicianId)","result":"\#(result)","reasons":[\#(reasonList)],"evaluatedAt":"\#(evaluatedAt)"},"placement":\#(placement)\#(extra)}"#
        }
    }

    static let items: [Item] = [
        Item(id: "300e72fd-118c-4d1f-af9c-7fb61e89f001", code: "MM-001", name: "Multimètre 1",
             manufacturer: "Fluke", modelNumber: "117", access: "STANDARD", operational: "SERVICEABLE",
             calibration: #"{"required":true,"dueAt":"2026-12-01T17:00:00Z","status":"VALID"}"#,
             availability: "AVAILABLE", presence: "PRESENT", result: "READY", reasons: [], compartment: "A1"),
        Item(id: "300e72fd-118c-4d1f-af9c-7fb61e89f002", code: "MM-002", name: "Multimètre 2",
             manufacturer: "Fluke", modelNumber: "117", access: "RESTRICTED", operational: "SERVICEABLE",
             calibration: #"{"required":true,"dueAt":"2026-09-08T16:00:00Z","status":"EXPIRED"}"#,
             availability: "AVAILABLE", presence: "PRESENT", result: "BLOCKED",
             reasons: ["ACCESS_DENIED", "CALIBRATION_EXPIRED"], compartment: "A2",
             extra: #","identifierValue":"\#(leakedIdentifier)""#),
        Item(id: "300e72fd-118c-4d1f-af9c-7fb61e89f003", code: "PA-004", name: "Pince ampèremétrique",
             manufacturer: "Klein", modelNumber: "CL800", access: "STANDARD", operational: "SERVICEABLE",
             calibration: #"{"required":false,"dueAt":null,"status":"NOT_REQUIRED"}"#,
             availability: "BORROWED", presence: "ABSENT", result: "BLOCKED", reasons: ["NOT_AVAILABLE"],
             compartment: "A3"),
        Item(id: "300e72fd-118c-4d1f-af9c-7fb61e89f004", code: "TI-002", name: "Thermomètre infrarouge",
             manufacturer: "Fluke", modelNumber: "62 Max", access: "STANDARD", operational: "SERVICEABLE",
             calibration: #"{"required":true,"dueAt":"2027-03-15T16:00:00Z","status":"VALID"}"#,
             availability: "AVAILABLE", presence: "UNKNOWN", result: "UNKNOWN",
             reasons: ["UNKNOWN_PHYSICAL_STATE"], compartment: "A4"),
        Item(id: "300e72fd-118c-4d1f-af9c-7fb61e89f005", code: "OS-001", name: "Oscilloscope portatif",
             manufacturer: nil, modelNumber: nil, access: "STANDARD", operational: "MAINTENANCE",
             calibration: #"{"required":true,"dueAt":null,"status":"UNKNOWN"}"#,
             availability: "UNAVAILABLE", presence: "PRESENT", result: "BLOCKED", reasons: ["MAINTENANCE"],
             compartment: nil),
    ]

    /// A fake server: filters by `readiness` and `q`, pages by `page` and `size`.
    static func page(for url: URL, empty: Bool = false) -> String {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        var matches = empty ? [] : items
        if let readiness = value("readiness") { matches = matches.filter { $0.result == readiness } }
        if let search = value("q")?.lowercased() {
            matches = matches.filter { $0.code.lowercased().contains(search) || $0.name.lowercased().contains(search) }
        }
        let size = Int(value("size") ?? "") ?? 20
        let page = Int(value("page") ?? "") ?? 0
        let slice = matches.dropFirst(page * size).prefix(size)
        let pages = matches.isEmpty ? 0 : (matches.count + size - 1) / size
        return #"{"items":[\#(slice.map(\.json).joined(separator: ","))],"page":\#(page),"size":\#(size),"totalItems":\#(matches.count),"totalPages":\#(pages)}"#
    }

    static func item(id: String) -> String? {
        items.first { $0.id == id }?.json
    }
}
#endif
