import XCTest

/// The areas of a screen hidden by its bars, and the dithering of the dark
/// panel in captures.
enum BarAwareAudit {
    /// The tab bar's fade above its top edge, as in the other audited suites.
    static let fadeHeight: CGFloat = 120
    /// The navigation bar's scroll edge effect below its frame: on the AX5
    /// capture of #234 its gradient reached the page colour 20 pt under the
    /// bar, where a strip of black text on white measured 1.00:1.
    static let navigationEdgeHeight: CGFloat = 24
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
    /// is judged by `unattributedContrast`; clipped text is tolerated only
    /// where a bar cuts it (`cutByABar`); at the largest size the rendered
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
            let top = navigationBar.frame.maxY + BarAwareAudit.navigationEdgeHeight
            visible = CGRect(x: visible.minX, y: top, width: visible.width, height: max(0, visible.maxY - top))
        }
        var types = XCUIAccessibilityAuditType.all
        if atLargestSize { types.remove(.dynamicType) }
        let findings = AuditRecord()
        try app.performMeasuredAccessibilityAudit(for: types) { issue in
            var note = ""
            var tolerated = false
            if issue.auditType == .textClipped {
                tolerated = self.cutByABar(issue.element, in: app, visible: visible, window: window, note: &note)
            } else if issue.auditType == .contrast {
                if let target = issue.element {
                    // The audit scrolls while it runs (#222): its frame and
                    // the screenshot are only read together on a still screen.
                    guard app.waitForStillScreen() else {
                        findings.record(issue, tolerated: false, note: " (the screen never stopped moving)")
                        return true
                    }
                    let partly = self.visiblePartContrast(of: target, visible: visible, window: window, in: app)
                    if let judged = findings.tolerates(partly, note: &note) {
                        tolerated = judged
                    } else {
                        // The audit scrolls while it runs (#222): an entirely
                        // visible element is measured on the still screen.
                        let entire = self.entireContrast(of: target, window: window, in: app,
                                                         shade: BarAwareAudit.panelShade)
                        tolerated = findings.tolerates(entire, note: &note) ?? false
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

    /// A contrast issue the audit reports without its element. On these
    /// screens, audited twice in a row, the first audit named the text under
    /// the tab bar's fade (« Sign out », « Réglages ») and the second gave
    /// the same issue no element. Every text and button that could be it is
    /// then measured under the rules for a named element, whatever its kind
    /// or width (#232): entirely visible, on its whole frame; partly under a
    /// bar, on its visible part; wholly under a bar, nothing to measure. It
    /// is tolerated only when some text or button does lie under a bar and
    /// every measure reaches 4.5:1; any measure below, or a visible element
    /// with no ink, fails the audit.
    @MainActor
    private func unattributedContrast(in app: XCUIApplication, visible: CGRect, window: CGRect,
                                      findings: AuditRecord, note: inout String) -> Bool {
        // The snapshot and the screenshot must show the same screen: with
        // the audit scrolling, « Role » once measured where another row was.
        guard app.waitForStillScreen() else {
            note = " (the screen never stopped moving)"
            return false
        }
        guard let root = try? app.snapshot() else { return false }
        let shot = app.screenshot()
        // The bars' own items (title, back button, tabs) are left out by
        // ancestry, not by frame: a row scrolled under a bar intersects it
        // and is exactly the text sought (#234, « Changer le mot de passe »).
        var content: [any XCUIElementSnapshot] = []
        var pending: [(element: any XCUIElementSnapshot, inBar: Bool)] = [(root, false)]
        while let (element, parentInBar) = pending.popLast() {
            let inBar = parentInBar || [.navigationBar, .tabBar].contains(element.elementType)
            if !inBar, [.staticText, .button].contains(element.elementType), !element.frame.isEmpty {
                content.append(element)
            }
            pending.append(contentsOf: element.children.map { ($0, inBar) })
        }
        guard content.contains(where: { !visible.contains($0.frame) && $0.frame.intersects(window) }) else {
            note = " (no text or button under a bar)"
            return false
        }
        let name = "audit-unattributed-contrast"
        let conditions = measureConditions(in: app, window: window, shot: shot)
        var passed = true
        var measures = 0
        // A row spans the panel's width; its texts are narrower.
        let rows = content.map(\.frame).filter { $0.width >= window.width * 0.8 }
        for element in content {
            let part = element.frame.intersection(visible)
            guard !part.isNull, part.width >= 1, part.height >= 1 else { continue }
            let entire = visible.contains(element.frame)
            // Read on its ink with 8 pt of its own background around it, so
            // that the anti-aliased edges of a small text stay rare (read
            // tight, « Rôle » gave 4.02:1 and with its margin 18.34:1). The
            // margin stays within the row that holds the element, 2 pt
            // inside its edges: beyond, a header's margin reached the white
            // panel (1.12:1) and a row's edge holds its separator (1.47:1 in
            // dark), neither of them text.
            let row = rows.filter { $0.contains(element.frame) }.min { $0.height * $0.width < $1.height * $1.width }
            let bound = (row ?? element.frame.insetBy(dx: -8, dy: -8)).insetBy(dx: 0, dy: 2).intersection(visible)
            guard let ink = Self.inkBounds(in: shot, region: part.intersection(bound), window: window) else {
                if entire {
                    let line = "'\(element.label)' id=\(element.identifier) entirely visible, frame=\(element.frame), \(conditions)"
                    passed = findings.measured(passed: false, line + ": no ink to measure, evidence \(name)") && passed
                }
                continue
            }
            let read = ink.insetBy(dx: -8, dy: -8).intersection(bound)
            let image = Self.crop(shot, to: read, window: window)
            let kind = element.elementType == .button ? "button" : "text"
            let place = entire ? "entirely visible, frame=\(element.frame)"
                : "partly visible, \(part) of frame=\(element.frame)"
            let line = "\(kind) '\(element.label)' id=\(element.identifier) \(place), read \(read), \(conditions)"
            guard let ratio = RenderedContrast.ratio(of: image, shade: BarAwareAudit.panelShade) else {
                if entire {
                    passed = findings.measured(passed: false, line + ": no ink to measure, evidence \(name)") && passed
                }
                continue
            }
            measures += 1
            passed = findings.measured(passed: ratio >= 4.5, line
                + String(format: ": rendered %.2f:1, threshold 4.5:1", ratio) + ", evidence \(name)") && passed
        }
        let evidence = XCTAttachment(screenshot: shot)
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
        note = " (no element; \(measures) texts and buttons measured on the still screen, \(name))"
        return passed
    }

    /// Where, in `region`, the screen differs from the region's most common
    /// colour by more than the capture's dithering: the ink of a text, a
    /// symbol or a control, in window points. Nil when there is none.
    @MainActor
    static func inkBounds(in shot: XCUIScreenshot, region: CGRect, window: CGRect) -> CGRect? {
        guard !region.isNull, region.width >= 1, region.height >= 1,
              let image = crop(shot, to: region, window: window).cgImage,
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = image.width, height = image.height
        var pixels = [UInt32](repeating: 0, count: width * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        var counts: [UInt32: Int] = [:]
        for pixel in pixels { counts[pixel & 0x00FF_FFFF, default: 0] += 1 }
        guard let background = counts.max(by: { $0.value < $1.value })?.key else { return nil }
        let shade = Int(BarAwareAudit.panelShade)
        func ink(_ pixel: UInt32) -> Bool {
            (0..<3).contains { channel in
                let shift = UInt32(channel * 8)
                return abs(Int((pixel >> shift) & 0xFF) - Int((background >> shift) & 0xFF)) > shade
            }
        }
        var minX = width, minY = height, maxX = -1, maxY = -1
        for y in 0..<height {
            for x in 0..<width where ink(pixels[y * width + x]) {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= 0 else { return nil }
        let scale = CGFloat(width) / region.width
        return CGRect(x: region.minX + CGFloat(minX) / scale, y: region.minY + CGFloat(minY) / scale,
                      width: CGFloat(maxX - minX + 1) / scale, height: CGFloat(maxY - minY + 1) / scale)
    }

    /// A clipped-text issue is tolerated only where a bar or the window's
    /// edge cuts the text: at the largest size, the rows the bars overlap
    /// (« Standard » under the navigation bar, « passe » under the tab bar)
    /// are reported, sometimes without their element. Named, the element must
    /// itself be cut; unnamed, a text must be cut on the still screen. A text
    /// clipped inside the visible area still fails.
    @MainActor
    private func cutByABar(_ element: XCUIElement?, in app: XCUIApplication, visible: CGRect, window: CGRect,
                           note: inout String) -> Bool {
        guard app.waitForStillScreen() else {
            note = " (the screen never stopped moving)"
            return false
        }
        // Straddling an edge: partly visible, partly under a bar or off the
        // window. A bar's own title lies wholly outside the visible area.
        func cut(_ frame: CGRect) -> Bool {
            !frame.isEmpty && ((frame.intersects(visible) && !visible.contains(frame))
                || (frame.intersects(window) && !window.contains(frame)))
        }
        if let element {
            guard cut(element.frame) else { return false }
            note = " (cut by a bar or the window edge)"
            return true
        }
        guard let root = try? app.snapshot() else { return false }
        var pending: [any XCUIElementSnapshot] = [root]
        var cutTexts: [String] = []
        while let element = pending.popLast() {
            pending.append(contentsOf: element.children)
            if element.elementType == .staticText, cut(element.frame) { cutTexts.append(element.label) }
        }
        guard !cutTexts.isEmpty else {
            note = " (no text cut by a bar)"
            return false
        }
        note = " (no element; text cut by a bar: \(cutTexts.joined(separator: ", ")))"
        return true
    }
}
