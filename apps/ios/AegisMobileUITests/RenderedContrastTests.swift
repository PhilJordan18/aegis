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

    /// A title-sized semibold text, at the scale of an iPhone screenshot,
    /// after an optional filled symbol like the timer of the countdown.
    private static func text(_ color: UIColor, on background: UIColor, icon: UIColor? = nil) -> UIImage {
        let size = CGSize(width: 360, height: 66)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            background.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            var x: CGFloat = 8
            if let icon {
                let symbol = UIImage(systemName: "timer", withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 40, weight: .semibold))?.withTintColor(icon, renderingMode: .alwaysOriginal)
                symbol?.draw(at: CGPoint(x: x, y: 10))
                x += 56
            }
            NSAttributedString(string: "Multimètre 1", attributes: [
                .font: UIFont.systemFont(ofSize: 40, weight: .semibold),
                .foregroundColor: color,
            ]).draw(at: CGPoint(x: x, y: 8))
        }
    }
}
