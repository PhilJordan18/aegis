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
    /// since it began.
    @MainActor
    func visiblePartContrast(of target: XCUIElement, visible: CGRect, window: CGRect,
                             in app: XCUIApplication) -> VisiblePartContrast {
        let part = target.frame.intersection(visible)
        if part.isNull || part.width < 1 || part.height < 1 {
            return .nothingToMeasure("nothing visible")
        }
        if visible.contains(target.frame) { return .entirelyVisible }
        let image = Self.crop(app.screenshot(), to: part, window: window)
        guard let ratio = RenderedContrast.ratio(of: image) else {
            return .nothingToMeasure("no ink in its visible part \(part)")
        }
        let line = "'\(target.label)' partly visible, \(part) of frame=\(target.frame): "
            + String(format: "rendered %.2f:1", ratio)
        let evidence = XCTAttachment(image: image)
        evidence.name = "audit-visible-part-contrast"
        evidence.lifetime = .keepAlways
        add(evidence)
        return .measured(passed: ratio >= 4.5, line: line)
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
