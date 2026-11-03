import Testing
import UIKit
@testable import AegisMobile

/// WCAG 2.2 contrast of the status chips (handoff `mobile-parcours` §9),
/// computed from the asset catalogue rather than sampled from pixels.
struct StatusContrastTests {
    @Test(arguments: [
        ("StatusReadyText", "StatusReadyFill"),
        ("StatusBlockedText", "StatusBlockedFill"),
        ("StatusUnknownText", "StatusUnknownFill"),
        ("StatusNeutralText", "StatusNeutralFill"),
    ], [UIUserInterfaceStyle.light, .dark])
    func chipTextReachesNormalTextContrast(_ pair: (String, String), _ style: UIUserInterfaceStyle) throws {
        let ratio = try Self.contrast(pair.0, pair.1, style)
        #expect(ratio >= 4.5, "\(pair.0) on \(pair.1), \(style == .dark ? "dark" : "light"): \(ratio)")
    }

    /// Filter chips: unselected text on the panel, selected white on the accent.
    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func filterChipTextReachesNormalTextContrast(_ style: UIUserInterfaceStyle) throws {
        #expect(try Self.contrast("BrandText", "BrandPanel", style) >= 4.5)
        let traits = UITraitCollection(userInterfaceStyle: style)
        let accent = try Self.luminance(try #require(UIColor(named: "AccentColor")).resolvedColor(with: traits))
        #expect((1 + 0.05) / (accent + 0.05) >= 4.5)
    }

    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func neutralIconReachesNonTextContrast(_ style: UIUserInterfaceStyle) throws {
        #expect(try Self.contrast("NeutralIcon", "StatusNeutralFill", style) >= 3)
    }

    static func contrast(_ foreground: String, _ background: String, _ style: UIUserInterfaceStyle) throws -> Double {
        let traits = UITraitCollection(userInterfaceStyle: style)
        let first = try luminance(try #require(UIColor(named: foreground)).resolvedColor(with: traits))
        let second = try luminance(try #require(UIColor(named: background)).resolvedColor(with: traits))
        return (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    static func luminance(_ color: UIColor) throws -> Double {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        try #require(color.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        #expect(alpha == 1)
        func linear(_ value: CGFloat) -> Double {
            let value = Double(value)
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
}
