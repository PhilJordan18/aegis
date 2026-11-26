#if DEBUG
import Foundation

/// FICTIONAL reservation and loan answers for UI tests and captures (Debug
/// only, compiled out of Release), built on `UITestCatalogFixtures`. They
/// follow doc 09 §8.3, §8.4, §8.6 and §8.8 and are served only through the
/// `AEGIS_UI_SCENARIO` hook.
enum UITestActivityFixtures {
    static let reservationId = "7b726e56-2a19-44de-887b-d3e2bfc8bf28"
    static let loanId = "c0d1e2f3-0415-4c6d-9e8f-a0b1c2d3e4f5"
    /// MM-001, ready in A1.
    static var reservable: UITestCatalogFixtures.Item { UITestCatalogFixtures.items[0] }

    static func instant(_ date: Date) -> String { date.formatted(.iso8601) }

    /// §8.8: identity only, built from the catalogue item.
    static func summary(_ item: UITestCatalogFixtures.Item) -> String {
        func text(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        let placement = item.compartment.map {
            #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","lockerCode":"AEGIS-DEMO-01","compartmentId":"1ae77ae3-8490-4f09-9412-a7816b77b\#(item.id.suffix(3))","compartmentCode":"\#($0)"}"#
        } ?? "null"
        return #"{"id":"\#(item.id)","assetCode":"\#(item.code)","model":{"id":"a09aa622-fba1-4457-8f67-7f123284e\#(item.id.suffix(3))","name":"\#(item.name)","manufacturer":\#(text(item.manufacturer)),"modelNumber":\#(text(item.modelNumber))},"placement":\#(placement)}"#
    }

    static func reservation(until: String, status: String = "ACTIVE", actions: [String] = ["CHECKOUT", "CANCEL"],
                            cancelledAt: String? = nil, currentOperationId: String? = nil) -> String {
        let now = instant(.now)
        let list = actions.map { "\"\($0)\"" }.joined(separator: ",")
        let cancelled = cancelledAt.map { "\"\($0)\"" } ?? "null"
        let operation = currentOperationId.map { "\"\($0)\"" } ?? "null"
        return #"{"id":"\#(reservationId)","asset":\#(summary(reservable)),"userId":"\#(UITestCatalogFixtures.technicianId)","status":"\#(status)","reservedFrom":"\#(now)","reservedUntil":"\#(until)","createdAt":"\#(now)","cancelledAt":\#(cancelled),"fulfilledAt":null,"expiredAt":null,"currentOperationId":\#(operation),"availableActions":[\#(list)]}"#
    }

    // FICTIONAL checkout operation and hub QR (doc 09 §8.5, doc 10 §27.1).
    // The token has the right shape and is no secret: it encodes the bytes
    // 0x00…0x1F, and the UI tests type the same URI into the Debug-only code field.
    static let operationId = "2f38d3b6-c18f-4a74-aa9a-2d574286013f"
    static let retryOperationId = "6c2a9e41-5d3b-4f7a-8e0c-1b2d3f4a5c6e"
    static let lockerId = "d46a74ae-39dc-460b-8af0-38fc791b376a"
    static let challengeId = "9d65cbae-4610-4e40-a314-3b93af07be9c"
    static let token = String(Data((0..<32).map(UInt8.init)).base64EncodedString().dropLast())

    /// §8.5. `authorized` stamps `authorizedAt` and the 120 s window.
    static func operation(id: String = operationId, type: String = "CHECKOUT", status: String,
                          requiredAction: String, displayed: Bool = true, authorized: Date? = nil,
                          terminal: Date? = nil) -> String {
        func text(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        let created = Date.now - 5
        let compartmentId = "1ae77ae3-8490-4f09-9412-a7816b77b\(reservable.id.suffix(3))"
        let isReturn = type == "RETURN"
        return #"{"id":"\#(id)","type":"\#(type)","status":"\#(status)","userId":"\#(UITestCatalogFixtures.technicianId)","assetId":"\#(reservable.id)","lockerId":"\#(lockerId)","compartmentId":"\#(compartmentId)","reservationId":\#(text(isReturn ? nil : reservationId)),"loanId":\#(text(isReturn ? loanId : nil)),"createdAt":"\#(instant(created))","authorizedAt":\#(text(authorized.map(instant))),"localAccessChallengeId":"\#(challengeId)","localProofExpiresAt":"\#(instant(created + 60))","localProofDisplayedAt":\#(text(displayed ? instant(created + 1) : nil)),"localProofValidatedAt":\#(text(authorized.map(instant))),"requiredAction":"\#(requiredAction)","expiresAt":\#(text(authorized.map { instant($0 + 120) })),"commandSentAt":null,"acknowledgedAt":null,"doorOpenedAt":null,"observationReceivedAt":null,"confirmedAt":null,"terminalAt":\#(text(terminal.map(instant))),"failureReason":null,"anomalyId":null}"#
    }

    /// The loan opened by the confirmed checkout. `RETURN` is not listed: the
    /// return route belongs to RET-01 (#50).
    static func checkedOutLoan() -> String {
        #"{"id":"\#(loanId)","asset":\#(summary(reservable)),"holderUserId":"\#(UITestCatalogFixtures.technicianId)","status":"ACTIVE","checkedOutAt":"\#(instant(.now))","dueAt":"\#(instant(.now + 2 * 3600))","overdue":false,"returnRequestedAt":null,"returnedAt":null,"checkoutOperationId":"\#(operationId)","returnOperationId":null,"currentOperationId":null,"availableActions":[]}"#
    }

    /// The loan of the return scenarios, on the same asset and compartment as
    /// the checkout ones.
    static func openLoan(status: String = "ACTIVE", actions: [String], currentOperationId: String? = nil) -> String {
        let list = "[" + actions.map { "\"\($0)\"" }.joined(separator: ",") + "]"
        let current = currentOperationId.map { "\"\($0)\"" } ?? "null"
        return #"{"id":"\#(loanId)","asset":\#(summary(reservable)),"holderUserId":"\#(UITestCatalogFixtures.technicianId)","status":"\#(status)","checkedOutAt":"\#(instant(.now - 3600))","dueAt":"\#(instant(.now + 3600))","overdue":false,"returnRequestedAt":null,"returnedAt":null,"checkoutOperationId":"5f0e2b8c-3a4d-4e6f-8a9b-0c1d2e3f4a5b","returnOperationId":null,"currentOperationId":\#(current),"availableActions":\#(list)}"#
    }

    /// An overdue loan of the clamp meter: the server sets `overdue`.
    static func overdueLoan() -> String {
        let item = UITestCatalogFixtures.items[2]
        let checkedOut = instant(.now - 3 * 3600)
        let due = instant(.now - 3600)
        return #"{"id":"\#(loanId)","asset":\#(summary(item)),"holderUserId":"\#(UITestCatalogFixtures.technicianId)","status":"ACTIVE","checkedOutAt":"\#(checkedOut)","dueAt":"\#(due)","overdue":true,"returnRequestedAt":null,"returnedAt":null,"checkoutOperationId":"5f0e2b8c-3a4d-4e6f-8a9b-0c1d2e3f4a5b","returnOperationId":null,"currentOperationId":null,"availableActions":["RETURN"]}"#
    }

    /// §29: past records, newest first, with no action and no current
    /// operation. FICTIONAL identifiers.
    static func reservationHistory() -> [String] {
        let items = UITestCatalogFixtures.items
        func record(_ index: Int, _ item: UITestCatalogFixtures.Item, status: String, hoursAgo: Double,
                    closing: String) -> String {
            let created = Date.now - hoursAgo * 3600
            let closed = #""\#(instant(created + 1800))""#
            func at(_ field: String) -> String { field == closing ? closed : "null" }
            return #"{"id":"8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c\#(String(format: "%02d", index))","asset":\#(summary(item)),"userId":"\#(UITestCatalogFixtures.technicianId)","status":"\#(status)","reservedFrom":"\#(instant(created))","reservedUntil":"\#(instant(created + 7200))","createdAt":"\#(instant(created))","cancelledAt":\#(at("cancelledAt")),"fulfilledAt":\#(at("fulfilledAt")),"expiredAt":\#(at("expiredAt")),"currentOperationId":null,"availableActions":[]}"#
        }
        return [record(1, items[0], status: "FULFILLED", hoursAgo: 5, closing: "fulfilledAt"),
                record(2, items[1], status: "CANCELLED", hoursAgo: 30, closing: "cancelledAt"),
                record(3, items[2], status: "EXPIRED", hoursAgo: 52, closing: "expiredAt")]
    }

    static func loanHistory() -> [String] {
        let items = UITestCatalogFixtures.items
        func record(_ index: Int, _ item: UITestCatalogFixtures.Item, hoursAgo: Double, late: Bool) -> String {
            let out = Date.now - hoursAgo * 3600
            let returned = out + (late ? 3 : 1) * 3600
            return #"{"id":"9b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d\#(String(format: "%02d", index))","asset":\#(summary(item)),"holderUserId":"\#(UITestCatalogFixtures.technicianId)","status":"COMPLETED","checkedOutAt":"\#(instant(out))","dueAt":"\#(instant(out + 7200))","overdue":false,"returnRequestedAt":"\#(instant(returned - 120))","returnedAt":"\#(instant(returned))","checkoutOperationId":"5f0e2b8c-3a4d-4e6f-8a9b-0c1d2e3f4a\#(String(format: "%02d", index))","returnOperationId":"6a1f3c9d-4b5e-4f70-9bac-1d2e3f4a5b\#(String(format: "%02d", index))","currentOperationId":null,"availableActions":[]}"#
        }
        // The second was returned an hour after its due time, yet neither is
        // `overdue`: doc 03 sets it only on a loan not yet finished.
        return [record(1, items[0], hoursAgo: 4.5, late: false), record(2, items[3], hoursAgo: 75, late: true)]
    }

    /// One §29 page of the given records.
    static func historyPage(_ records: [String], for url: URL) -> String {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let page = query.first { $0.name == "page" }.flatMap { $0.value.flatMap(Int.init) } ?? 0
        let size = query.first { $0.name == "size" }.flatMap { $0.value.flatMap(Int.init) } ?? 20
        let slice = records.dropFirst(page * size).prefix(size)
        let totalPages = (records.count + size - 1) / size
        return #"{"items":[\#(slice.joined(separator: ","))],"page":\#(page),"size":\#(size),"totalItems":\#(records.count),"totalPages":\#(totalPages)}"#
    }

    /// §8.6, closed until the given instant.
    static func closedLocker(nextOpensAt: Date) -> String {
        #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","code":"AEGIS-DEMO-01","name":"Casier démo","topology":"HUB_CELL","connectionStatus":"ONLINE","lastSeenAt":"\#(instant(.now))","evaluatedAt":"\#(instant(.now))","currentWindow":{"timeZone":"America/Toronto","open":false,"closesAt":null,"nextOpensAt":"\#(instant(nextOpensAt))"},"compartments":[]}"#
    }
}
#endif
