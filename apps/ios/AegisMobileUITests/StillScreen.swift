import XCTest

extension XCUIApplication {
    /// Waits until no element appears, disappears, moves or changes its text
    /// across three snapshots about a second apart in all. An accessibility
    /// audit taken earlier samples a screen still in transition (a list
    /// filling in after launch, a refresh collapsing) and reports text it
    /// cannot match to an element, or sizes caught mid-animation.
    @MainActor
    func waitForStillScreen(timeout: TimeInterval = 10) -> Bool {
        let deadline = Date.now + timeout
        var last: [String]?
        var stillFor = 0
        while Date.now < deadline {
            let current = (try? snapshot()).map(Self.signature) ?? []
            stillFor = current == last ? stillFor + 1 : 0
            if stillFor >= 2 { return true }
            last = current
            Thread.sleep(forTimeInterval: 0.4)
        }
        return false
    }

    private static func signature(_ root: any XCUIElementSnapshot) -> [String] {
        var lines: [String] = []
        var pending: [any XCUIElementSnapshot] = [root]
        while let element = pending.popLast() {
            lines.append("\(element.elementType.rawValue)|\(element.identifier)|\(element.label)|\(element.frame)")
            pending.append(contentsOf: element.children)
        }
        return lines
    }
}

/// Audits run so far by this UI test process: the first one is the cold start of the run.
@MainActor private var accessibilityAuditCount = 0
/// Whether this UI test process has run its warm-up audit, passed or not: it runs once.
@MainActor private var accessibilityAuditWarmedUp = false

extension XCUIApplication {
    /// Runs the accessibility audit and records how long it took, so that slow
    /// audits can be measured from the result bundle. An audit that XCTest
    /// abandons ("Audit failed to complete in time", code -56) fails the test at
    /// its first occurrence: no retry hides it.
    ///
    /// Element detection runs in its own call, after the other types, on the
    /// same screen and with the same handler. XCTest gives each call about
    /// 15 s. On the hosted runner, the other types take up to 8 s on the asset
    /// sheet (their text-size passes), then element detection reads the whole
    /// screenshot with text recognition, which took 5.8 s and over 7.1 s on
    /// that sheet: together they passed the limit, and the audit was abandoned
    /// during element detection (#67). Each type is still checked on every
    /// audited screen; only the call that runs it changes.
    @MainActor
    func performMeasuredAccessibilityAudit(
        for types: XCUIAccessibilityAuditType,
        _ issueHandler: ((XCUIAccessibilityAuditIssue) throws -> Bool)?
    ) throws {
        if !accessibilityAuditWarmedUp {
            accessibilityAuditWarmedUp = true
            try warmUpAccessibilityAudit()
        }
        accessibilityAuditCount += 1
        let number = accessibilityAuditCount
        let others = types.subtracting(.elementDetection)
        if !others.isEmpty {
            try performMeasuredAuditCall(number, others, "all types but element detection", issueHandler)
        }
        if types.contains(.elementDetection) {
            try performMeasuredAuditCall(number, .elementDetection, "element detection", issueHandler)
        }
    }

    @MainActor
    private func performMeasuredAuditCall(
        _ number: Int,
        _ types: XCUIAccessibilityAuditType,
        _ scope: String,
        _ issueHandler: ((XCUIAccessibilityAuditIssue) throws -> Bool)?
    ) throws {
        let start = Date.now
        // The issue handler runs inside the call, so its element queries count
        // toward the time XCTest allows it.
        var issues = 0
        var handling: TimeInterval = 0
        func record(_ outcome: String) {
            let seconds = String(format: "%.1f", Date.now.timeIntervalSince(start))
            let handler = String(format: "%.1f", handling)
            let cold = number == 1 ? ", cold: first audit of this test process" : ""
            XCTContext.runActivity(
                named: "Accessibility audit \(number) \(outcome) in \(seconds) s (\(scope)), "
                    + "\(issues) issues handled in \(handler) s\(cold)"
            ) { _ in }
        }
        let measuredHandler = issueHandler.map { handler in
            { (issue: XCUIAccessibilityAuditIssue) throws -> Bool in
                let started = Date.now
                defer { issues += 1; handling += Date.now.timeIntervalSince(started) }
                return try handler(issue)
            }
        }
        do {
            try performAccessibilityAudit(for: types, measuredHandler)
            record("completed")
        } catch {
            record("ended with an error")
            throw error
        }
    }

    /// The first audit of a UI test process pays the cold start of the audit
    /// stack on a simulator that has just run its first launches. In the five
    /// hosted runs after #143 it took 7.5 to 10.1 s when it passed, and both
    /// failures were abandoned at about 15 s within the first two audits of the
    /// run (#67). One narrow audit, element descriptions only, takes that start
    /// before the first full audit, which still runs once. Whether this is
    /// enough is measured from the result bundles, not assumed.
    ///
    /// This adds a check and hides nothing: any issue it reports, or its
    /// abandonment, fails the test, and its duration is recorded beside the
    /// others.
    @MainActor
    private func warmUpAccessibilityAudit() throws {
        let start = Date.now
        func record(_ outcome: String) {
            let seconds = String(format: "%.1f", Date.now.timeIntervalSince(start))
            XCTContext.runActivity(named: "Accessibility audit warm-up \(outcome) in \(seconds) s") { _ in }
        }
        do {
            try performAccessibilityAudit(for: .sufficientElementDescription) { _ in false }
            record("completed")
        } catch {
            record("ended with an error")
            throw error
        }
    }
}
