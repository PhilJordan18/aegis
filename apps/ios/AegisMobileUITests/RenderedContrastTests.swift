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

    func testTheMeasureNeverOverstatesAKnownPair() throws {
        // #767676 on white is 4.54:1.
        let grey = UIColor(red: 0x76 / 255, green: 0x76 / 255, blue: 0x76 / 255, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(grey, on: .white)))
        XCTAssertLessThanOrEqual(ratio, 4.54)
        XCTAssertGreaterThan(ratio, 4.3)
    }

    func testALowContrastTextIsRejected() throws {
        // #AAAAAA on white is 2.32:1; light text on a light panel, as a wrong
        // background would draw it.
        let grey = UIColor(red: 0xAA / 255, green: 0xAA / 255, blue: 0xAA / 255, alpha: 1)
        let ratio = try XCTUnwrap(RenderedContrast.ratio(of: Self.text(grey, on: .white)))
        XCTAssertLessThan(ratio, 4.5)
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

    /// A title-sized semibold text, at the scale of an iPhone screenshot.
    private static func text(_ color: UIColor, on background: UIColor) -> UIImage {
        let size = CGSize(width: 300, height: 66)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            background.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            NSAttributedString(string: "Multimètre 1", attributes: [
                .font: UIFont.systemFont(ofSize: 40, weight: .semibold),
                .foregroundColor: color,
            ]).draw(at: CGPoint(x: 8, y: 8))
        }
    }
}
