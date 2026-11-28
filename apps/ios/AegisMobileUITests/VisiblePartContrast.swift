import XCTest

/// How a contrast issue reported on an element is judged from what is visible
/// of it. An element only partly visible, cut by the screen edge or under the
/// floating tab bar's fade, is measured on its visible part with
/// `RenderedContrast` (#208, #211): a faint text the audit reported there
/// fails, whatever the text size or the iOS version.
enum VisiblePartContrast {
    /// Entirely inside the visible area: the suite's other rules judge it.
    case entirelyVisible
    /// Nothing of it is visible, or its visible part holds no ink: there is
    /// nothing to measure, and the issue is tolerated with this reason.
    case nothingToMeasure(String)
    /// Its visible part was measured; it passes at 4.5:1 or more.
    case measured(passed: Bool, line: String)
}

extension XCTestCase {
    /// Judges a contrast issue on `target` from the part of it inside
    /// `visible`. A measured part is attached with its screenshot as
    /// `audit-visible-part-contrast`. The screenshot is taken now, as the
    /// issue is handled, because the audit may have scrolled the screen
    /// since it began; its line keeps the conditions of the measure.
    @MainActor
    func visiblePartContrast(of target: XCUIElement, visible: CGRect, window: CGRect,
                             in app: XCUIApplication) -> VisiblePartContrast {
        let part = target.frame.intersection(visible)
        if part.isNull || part.width < 1 || part.height < 1 {
            return .nothingToMeasure("nothing visible")
        }
        if visible.contains(target.frame) { return .entirelyVisible }
        let shot = app.screenshot()
        let image = Self.crop(shot, to: part, window: window)
        guard let ratio = RenderedContrast.ratio(of: image, shade: BarAwareAudit.panelShade) else {
            return .nothingToMeasure("no ink in its visible part \(part)")
        }
        let name = "audit-visible-part-contrast '\(target.label)'"
        let line = "'\(target.label)' id=\(target.identifier) partly visible, \(part) of frame=\(target.frame), "
            + measureConditions(in: app, window: window, shot: shot)
            + String(format: ": rendered %.2f:1, threshold 4.5:1", ratio) + ", evidence \(name)"
        let evidence = XCTAttachment(image: image)
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
        return .measured(passed: ratio >= 4.5, line: line)
    }

    /// Measures an entirely visible element on the screen as it is once
    /// still, for a suite whose audit scrolls while it runs, so that the
    /// audit's samples may not be of the screen it reports on. It passes at
    /// 4.5:1 or more. A passing measure only qualifies the issue the audit
    /// reported on this element; it is no exception for any other (#222).
    /// The crop is attached under the name its line gives, and the line
    /// keeps the conditions of the measure with its result. `shade` is
    /// passed to `RenderedContrast.ratio(of:shade:)`.
    @MainActor
    func entireContrast(of target: XCUIElement, window: CGRect, in app: XCUIApplication,
                        shade: UInt8 = 0) -> VisiblePartContrast {
        guard app.waitForStillScreen() else {
            return .measured(passed: false, line: "'\(target.label)': the screen never stopped moving")
        }
        let frame = target.frame
        guard window.contains(frame) else {
            return .measured(passed: false, line: "'\(target.label)' frame=\(frame) left the window")
        }
        let shot = app.screenshot()
        let image = Self.crop(shot, to: frame, window: window)
        let name = "audit-entire-contrast '\(target.label)'"
        let evidence = XCTAttachment(image: image)
        evidence.name = name
        evidence.lifetime = .keepAlways
        add(evidence)
        let measure = "'\(target.label)' id=\(target.identifier) entirely visible on a still screen, frame=\(frame), "
            + measureConditions(in: app, window: window, shot: shot)
        guard let ratio = RenderedContrast.ratio(of: image, shade: shade) else {
            return .measured(passed: false, line: measure + ": no ink to measure, evidence \(name)")
        }
        return .measured(passed: ratio >= 4.5,
                         line: measure + String(format: ": rendered %.2f:1, threshold 4.5:1", ratio)
                            + ", evidence \(name)")
    }

    /// The conditions of a rendered measure, kept with its result (#222):
    /// the appearance, the text size the app was launched with, the window
    /// and the capture it was read from.
    @MainActor
    func measureConditions(in app: XCUIApplication, window: CGRect, shot: XCUIScreenshot) -> String {
        let appearance = XCUIDevice.shared.appearance == .dark ? "dark" : "light"
        let arguments = app.launchArguments
        let size = arguments.firstIndex(of: "-UIPreferredContentSizeCategoryName")
            .flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil } ?? "default text size"
        let pixels = shot.image.cgImage.map { "\($0.width)x\($0.height) px" } ?? "no pixels"
        return "\(appearance), \(size), window \(window.width)x\(window.height) pt, captured at \(pixels)"
    }

    /// The part of a full-screen screenshot under `frame`, in window points.
    static func crop(_ shot: XCUIScreenshot, to frame: CGRect, window: CGRect) -> UIImage {
        guard let image = shot.image.cgImage, window.width > 0 else { return UIImage() }
        let scale = CGFloat(image.width) / window.width
        let pixels = CGRect(x: (frame.minX - window.minX) * scale, y: (frame.minY - window.minY) * scale,
                            width: frame.width * scale, height: frame.height * scale).integral
        guard let part = image.cropping(to: pixels) else { return UIImage() }
        return UIImage(cgImage: part, scale: scale, orientation: .up)
    }
}
