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
                            cancelledAt: String? = nil) -> String {
        let now = instant(.now)
        let list = actions.map { "\"\($0)\"" }.joined(separator: ",")
        let cancelled = cancelledAt.map { "\"\($0)\"" } ?? "null"
        return #"{"id":"\#(reservationId)","asset":\#(summary(reservable)),"userId":"\#(UITestCatalogFixtures.technicianId)","status":"\#(status)","reservedFrom":"\#(now)","reservedUntil":"\#(until)","createdAt":"\#(now)","cancelledAt":\#(cancelled),"fulfilledAt":null,"expiredAt":null,"currentOperationId":null,"availableActions":[\#(list)]}"#
    }

    /// An overdue loan of the clamp meter: the server sets `overdue`.
    static func overdueLoan() -> String {
        let item = UITestCatalogFixtures.items[2]
        let checkedOut = instant(.now - 3 * 3600)
        let due = instant(.now - 3600)
        return #"{"id":"\#(loanId)","asset":\#(summary(item)),"holderUserId":"\#(UITestCatalogFixtures.technicianId)","status":"ACTIVE","checkedOutAt":"\#(checkedOut)","dueAt":"\#(due)","overdue":true,"returnRequestedAt":null,"returnedAt":null,"checkoutOperationId":"5f0e2b8c-3a4d-4e6f-8a9b-0c1d2e3f4a5b","returnOperationId":null,"currentOperationId":null,"availableActions":["RETURN"]}"#
    }

    /// §8.6, closed until the given instant.
    static func closedLocker(nextOpensAt: Date) -> String {
        #"{"lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a","code":"AEGIS-DEMO-01","name":"Casier démo","topology":"HUB_CELL","connectionStatus":"ONLINE","lastSeenAt":"\#(instant(.now))","evaluatedAt":"\#(instant(.now))","currentWindow":{"timeZone":"America/Toronto","open":false,"closesAt":null,"nextOpensAt":"\#(instant(nextOpensAt))"},"compartments":[]}"#
    }
}
#endif
