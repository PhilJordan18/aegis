import XCTest

/// What one accessibility audit found, collected while each issue is handled
/// and reported together once the audit ends. It is shared by the audited
/// suites so that their reports read the same way; each suite keeps its own
/// rules for which issue is tolerated.
@MainActor
final class AuditRecord {
    private var unhandled: [String] = []
    private var accepted: [String] = []
    private var ignored: [String] = []

    /// A rendered contrast measure: kept as evidence when it reaches 4.5:1,
    /// failed otherwise. Returns whether the issue is tolerated.
    func measured(passed: Bool, _ line: String) -> Bool {
        if passed { accepted.append(line) } else { unhandled.append("Contrast below 4.5:1 — \(line)") }
        return passed
    }

    /// Whether a contrast issue is tolerated from what is visible of its
    /// element, or nil when the element is entirely visible and the suite's
    /// other rules judge it.
    func tolerates(_ judgement: VisiblePartContrast, note: inout String) -> Bool? {
        switch judgement {
        case let .nothingToMeasure(reason):
            note = " (\(reason))"
            return true
        case let .measured(passed, line):
            // Measured, never trusted. The note pairs the tolerated issue
            // with its measure, kept as evidence (#222).
            note = " (measured: \(line))"
            return measured(passed: passed, line)
        case .entirelyVisible:
            return nil
        }
    }

    /// Records one issue; every issue is collected, then reported together.
    func record(_ issue: XCUIAccessibilityAuditIssue, tolerated: Bool, note: String) {
        let element = issue.element.map { "\($0.elementType) '\($0.label)' id=\($0.identifier) frame=\($0.frame)" }
            ?? "none"
        if tolerated {
            ignored.append("\(issue.compactDescription) — \(element)\(note)")
        } else {
            unhandled.append("\(issue.compactDescription) — \(element) — \(issue.detailedDescription)")
        }
    }

    /// Attaches the tolerated issues, the passing measures (as
    /// `acceptedName`) and the failing issues, then fails on the latter.
    /// `areas` describes the visible areas the rules used.
    func report(to testCase: XCTestCase, areas: [String], acceptedName: String,
                file: StaticString = #filePath, line: UInt = #line) {
        // Every tolerated issue stays visible in the result: a rule that hides
        // an issue must not look like an audit that found nothing.
        attach(areas + ignored, named: "audit-tolerated", to: testCase, when: !ignored.isEmpty)
        attach(accepted, named: acceptedName, to: testCase, when: !accepted.isEmpty)
        if !unhandled.isEmpty {
            attach(areas + unhandled, named: "audit-issues", to: testCase, when: true)
            XCTFail("Accessibility audit: \(unhandled.joined(separator: " | "))", file: file, line: line)
        }
    }

    private func attach(_ lines: [String], named name: String, to testCase: XCTestCase, when needed: Bool) {
        guard needed else { return }
        let report = XCTAttachment(string: lines.joined(separator: "\n"))
        report.name = name
        report.lifetime = .keepAlways
        testCase.add(report)
    }
}
