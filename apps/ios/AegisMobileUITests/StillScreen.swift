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
    /// Runs the accessibility audit once and records how long it took, so that
    /// slow audits can be measured from the result bundle. An audit that XCTest
    /// abandons ("Audit failed to complete in time", code -56) fails the test at
    /// its first occurrence: no retry hides it.
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
        let start = Date.now
        func record(_ outcome: String) {
            let seconds = String(format: "%.1f", Date.now.timeIntervalSince(start))
            let cold = number == 1 ? ", cold: first audit of this test process" : ""
            XCTContext.runActivity(named: "Accessibility audit \(number) \(outcome) in \(seconds) s\(cold)") { _ in }
        }
        do {
            try performAccessibilityAudit(for: types, issueHandler)
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
