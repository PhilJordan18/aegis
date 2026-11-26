import XCTest

/// The areas of a screen hidden by its bars, and the dithering of the dark
/// panel in captures.
enum BarAwareAudit {
    /// The tab bar's fade above its top edge, as in the other audited suites.
    static let fadeHeight: CGFloat = 120
    /// The dark panel is captured dithered by one unit (#232): see
    /// `RenderedContrast.ratio(of:shade:)`.
    static let panelShade: UInt8 = 2
}

extension XCTestCase {
    /// Xcode's accessibility audit of a scrolling screen between a navigation
    /// bar and the tab bar, the Account screen (#232), under the rules of the
    /// other audited suites: a still screen first; a contrast issue on an
    /// element partly under the navigation bar or the tab bar's fade is
    /// measured on its visible part, never trusted; one without its element
    /// is judged by `unattributedContrast`; at the largest size the rendered
    /// screens are the Dynamic Type proof. Everything else fails.
    @MainActor
    func auditAccountScreen(_ app: XCUIApplication, atLargestSize: Bool = false) throws {
        XCTAssertTrue(app.waitForStillScreen(), "The screen kept changing; the audit needs a still screen.")
        let window = app.windows.firstMatch.frame
        var visible = window
        let tabBar = app.tabBars.firstMatch
        if tabBar.exists, tabBar.isHittable {
            visible.size.height = max(0, tabBar.frame.minY - BarAwareAudit.fadeHeight - window.minY)
        }
        // What scrolls under the navigation bar is blurred by the system's
        // scroll edge effect, as what scrolls under the tab bar fades.
        let navigationBar = app.navigationBars.firstMatch
        if navigationBar.exists {
            let top = navigationBar.frame.maxY
            visible = CGRect(x: visible.minX, y: top, width: visible.width, height: max(0, visible.maxY - top))
        }
        var types = XCUIAccessibilityAuditType.all
        if atLargestSize { types.remove(.dynamicType) }
        let findings = AuditRecord()
        try app.performMeasuredAccessibilityAudit(for: types) { issue in
            var note = ""
            var tolerated = false
            if issue.auditType == .contrast {
                if let target = issue.element {
                    let partly = self.visiblePartContrast(of: target, visible: visible, window: window, in: app)
                    if let judged = findings.tolerates(partly, note: &note) {
                        tolerated = judged
                    } else {
                        // The audit scrolls while it runs (#222): an entirely
                        // visible element is measured on the still screen.
                        tolerated = self.stillContrast(of: target, window: window, in: app, findings: findings)
                    }
                } else {
                    tolerated = self.unattributedContrast(in: app, visible: visible, window: window,
                                                          findings: findings, note: &note)
                }
            }
            findings.record(issue, tolerated: tolerated, note: note)
            return true
        }
        findings.report(to: self, areas: ["visible=\(visible)"], acceptedName: "audit-visible-part-contrast")
    }

    /// Measures an entirely visible element on the screen once still; it
    /// passes at 4.5:1 or more. The same rule as `entireContrast` of #222,
    /// kept private here until both branches meet.
    @MainActor
    private func stillContrast(of target: XCUIElement, window: CGRect, in app: XCUIApplication,
                               findings: AuditRecord) -> Bool {
        guard app.waitForStillScreen() else {
            return findings.measured(passed: false, "'\(target.label)': the screen never stopped moving")
        }
        let frame = target.frame
        guard window.contains(frame) else {
            return findings.measured(passed: false, "'\(target.label)' frame=\(frame) left the window")
        }
        let image = Self.crop(app.screenshot(), to: frame, window: window)
        let evidence = XCTAttachment(image: image)
        evidence.name = "audit-entire-contrast"
        evidence.lifetime = .keepAlways
        add(evidence)
        guard let ratio = RenderedContrast.ratio(of: image, shade: BarAwareAudit.panelShade) else {
            return findings.measured(passed: false, "'\(target.label)' frame=\(frame): no ink to measure")
        }
        return findings.measured(passed: ratio >= 4.5, "'\(target.label)' entirely visible, frame=\(frame): "
                                 + String(format: "rendered %.2f:1", ratio))
    }

    /// A contrast issue the audit reports without its element. On these
    /// screens, audited twice in a row, the first audit named the text under
    /// the tab bar's fade (« Sign out », « Réglages ») and the second gave
    /// the same issue no element. It is tolerated only when text does lie
    /// under a bar and every text entirely visible, measured on the same
    /// screenshot, reaches 4.5:1; any measure below fails the audit.
    @MainActor
    private func unattributedContrast(in app: XCUIApplication, visible: CGRect, window: CGRect,
                                      findings: AuditRecord, note: inout String) -> Bool {
        guard let root = try? app.snapshot() else { return false }
        let shot = app.screenshot()
        var elements: [any XCUIElementSnapshot] = []
        var pending: [any XCUIElementSnapshot] = [root]
        while let element = pending.popLast() {
            elements.append(element)
            pending.append(contentsOf: element.children)
        }
        let bars = elements.filter { [.navigationBar, .tabBar].contains($0.elementType) }.map(\.frame)
        let content = elements.filter { [.staticText, .button].contains($0.elementType) && !$0.frame.isEmpty }
            .filter { element in !bars.contains { $0.intersects(element.frame) } }
        let texts = content.filter { $0.elementType == .staticText }
        // Under the navigation bar's blur or the tab bar's fade. « Se
        // déconnecter » is a button: what lies there may be either.
        let hidden = [CGRect(x: window.minX, y: window.minY, width: window.width,
                             height: max(0, visible.minY - window.minY)),
                      CGRect(x: window.minX, y: visible.maxY, width: window.width,
                             height: max(0, window.maxY - visible.maxY))]
        guard content.contains(where: { element in hidden.contains { $0.intersects(element.frame) } }) else {
            note = " (no text under a bar)"
            return false
        }
        var passed = true
        // Each text on its own, not a whole row, whose separator and rounded
        // corners are no text; with 8 pt of its background around it, so that
        // the shades of its anti-aliased edges stay rare.
        for text in texts where visible.contains(text.frame) && text.frame.width < window.width * 0.8 {
            let frame = text.frame.insetBy(dx: -8, dy: -8)
            let image = Self.crop(shot, to: frame, window: window)
            guard let ratio = RenderedContrast.ratio(of: image, shade: BarAwareAudit.panelShade) else {
                passed = findings.measured(passed: false, "'\(text.label)' frame=\(text.frame): no ink to measure")
                    && passed
                continue
            }
            let line = "'\(text.label)' entirely visible, frame=\(text.frame): "
                + String(format: "rendered %.2f:1", ratio)
            passed = findings.measured(passed: ratio >= 4.5, line) && passed
        }
        let evidence = XCTAttachment(screenshot: shot)
        evidence.name = "audit-unattributed-contrast"
        evidence.lifetime = .keepAlways
        add(evidence)
        note = " (text under a bar; every entirely visible text measured)"
        return passed
    }
}
