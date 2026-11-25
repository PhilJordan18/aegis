import UIKit
import XCTest

/// `RenderedContrast` on drawn text of known colours, without launching the
/// app: the measure that lets `CheckoutUITests` accept a sampled contrast
/// issue must itself reject a low-contrast text (#207).
final class RenderedContrastTests: XCTestCase {
    func testBlackOnWhiteIsNearTheMaximum() throws {
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.black, on: .white)))
        XCTAssertGreaterThan(ratio, 19)
    }

    func testAKnownPairIsMeasuredExactly() throws {
        // #767676 on white is 4.54:1.
        let grey = UIColor(red: 0x76 / 255, green: 0x76 / 255, blue: 0x76 / 255, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(grey, on: .white)))
        XCTAssertEqual(ratio, 4.54, accuracy: 0.01)
    }

    /// Pure red on white is 4.00:1 and pure blue 8.59:1: a swap of the
    /// channels would pass the red text.
    func testTheChannelsAreReadInOrder() throws {
        let red = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.red, on: .white)))
        XCTAssertEqual(red, 4.00, accuracy: 0.01)
        let blue = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.blue, on: .white)))
        XCTAssertEqual(blue, 8.59, accuracy: 0.01)
    }

    func testALowContrastTextIsRejected() throws {
        // #AAAAAA on white is 2.32:1; light text on a light panel, as a wrong
        // background would draw it.
        let grey = UIColor(red: 0xAA / 255, green: 0xAA / 255, blue: 0xAA / 255, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(grey, on: .white)))
        XCTAssertLessThan(ratio, 4.5)
    }

    /// A high-contrast icon beside the text must not stand in for it: the
    /// countdown and the status chip draw a symbol in the same frame.
    func testALowContrastTextBesideAHighContrastIconIsRejected() throws {
        let grey = UIColor(red: 0xAA / 255, green: 0xAA / 255, blue: 0xAA / 255, alpha: 1)
        let image = Self.text(grey, on: .white, icon: .black)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: image))
        XCTAssertLessThan(ratio, 4.5)
    }

    func testAnIconOfTheTextColourKeepsTheTextRatio() throws {
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.black, on: .white, icon: .black)))
        XCTAssertGreaterThan(ratio, 19)
    }

    /// The status chip: a capsule on the card. The card colour in the
    /// corners outside the capsule is not an ink of the text.
    func testThePageOutsideARoundedFillIsLeftOut() throws {
        let image = Self.text(Self.chipText, on: Self.chipFill, icon: Self.chipText, page: .white)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: image))
        XCTAssertGreaterThan(ratio, 7)
    }

    /// The mutation of #208 on the chip: a faint text beside its strong symbol.
    func testAFaintTextInACapsuleBesideAStrongIconIsRejected() throws {
        let grey = UIColor(white: 0.75, alpha: 1)
        let image = Self.text(grey, on: Self.chipFill, icon: Self.chipText, page: .white)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: image))
        XCTAssertLessThan(ratio, 4.5)
    }

    /// A symbol of another colour that also reaches 4.5:1 keeps the element
    /// accepted: the weaker of the two is reported.
    func testAContrastingIconBesideAContrastingTextPasses() throws {
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.black, on: .white, icon: Self.chipText)))
        XCTAssertGreaterThan(ratio, 4.5)
        XCTAssertLessThan(ratio, 19)
    }

    /// Documented strictness: a symbol at 3:1 meets WCAG for graphics but is
    /// held to 4.5:1 here. It can only reject, never accept, a text.
    func testAnIconBelowTheTextThresholdIsRejected() throws {
        // #949494 on white is 3.03:1.
        let icon = UIColor(red: 0x94 / 255, green: 0x94 / 255, blue: 0x94 / 255, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.black, on: .white, icon: icon)))
        XCTAssertEqual(ratio, 3.03, accuracy: 0.01)
    }

    func testLightTextOnADarkPanelIsMeasuredToo() throws {
        let panel = UIColor(red: 0.08, green: 0.09, blue: 0.11, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(.white, on: panel)))
        XCTAssertGreaterThan(ratio, 15)
    }

    func testAPlainImageHasNoText() {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let image = UIGraphicsImageRenderer(size: CGSize(width: 100, height: 40), format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 100, height: 40))
        }
        XCTAssertNil(RenderedContrast.ratio(of: image))
    }

    /// Light-mode colours of the status chip of the #208 screenshots: an
    /// indigo text and symbol on a lavender capsule.
    private static let chipText = UIColor(red: 0x37 / 255, green: 0x26 / 255, blue: 0xB8 / 255, alpha: 1)
    private static let chipFill = UIColor(red: 0xEC / 255, green: 0xEA / 255, blue: 0xFF / 255, alpha: 1)

    /// A title-sized semibold text, at the scale of an iPhone screenshot,
    /// after an optional filled symbol like the timer of the countdown. With a
    /// page colour, the background is a capsule on that page, like a chip.
    private static func text(_ color: UIColor, on background: UIColor, icon: UIColor? = nil,
                             page: UIColor? = nil) -> UIImage {
        let size = CGSize(width: page == nil ? 360 : 420, height: page == nil ? 66 : 80)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let bounds = CGRect(origin: .zero, size: size)
            if let page {
                page.setFill()
                context.fill(bounds)
                background.setFill()
                UIBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), cornerRadius: 38).fill()
            } else {
                background.setFill()
                context.fill(bounds)
            }
            let top: CGFloat = page == nil ? 0 : 7
            var x: CGFloat = page == nil ? 8 : 30
            if let icon {
                let symbol = UIImage(systemName: "timer", withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 40, weight: .semibold))?.withTintColor(icon, renderingMode: .alwaysOriginal)
                symbol?.draw(at: CGPoint(x: x, y: top + 10))
                x += 56
            }
            NSAttributedString(string: "Multimètre 1", attributes: [
                .font: UIFont.systemFont(ofSize: 40, weight: .semibold),
                .foregroundColor: color,
            ]).draw(at: CGPoint(x: x, y: top + 8))
        }
    }
}
