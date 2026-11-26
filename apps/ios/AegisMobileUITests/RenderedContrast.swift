import CoreGraphics
import UIKit

/// The WCAG contrast of the weakest ink of a screenshot of one text element,
/// read from its pixels. The background is the most common exact colour; an
/// ink is any other exact colour covering a share of the pixels, so the
/// anti-aliased edges, each a rare colour, are not taken for one. Every ink
/// must pass: a high-contrast symbol beside a faint text, as in the countdown
/// or a status chip, cannot stand in for the text. Measured on what is drawn,
/// it also catches a text over the wrong background, which the colour tokens
/// alone cannot.
///
/// Only the background's own fill is read: on each row, from its first to
/// its last pixel. The fills of these elements, a panel or a capsule, are
/// convex, so each row crosses them once; the page outside a rounded corner
/// is left out, while the text and its symbol, drawn on the fill, stay in.
/// An icon is held to 4.5:1 like the text, stricter than the 3:1 of WCAG for
/// graphics: it can only reject more.
enum RenderedContrast {
    /// Share of the pixels an exact colour must cover to count as an ink.
    static let minimumShare = 0.005

    /// The lowest ratio between the background and an ink, or nil when the
    /// image holds no ink. `shade` folds into the background the colours
    /// within that many units of it on every channel: a dark panel is
    /// captured dithered (#0D1520 beside #0D1420, #0D151F and #0C1520),
    /// shades that would count as an ink at 1.00:1. Such a shade is no text;
    /// a text drawn in one would leave no ink, and a missing ink fails.
    static func ratio(of image: UIImage, shade: UInt8 = 0) -> Double? {
        guard let cgImage = image.cgImage, cgImage.width > 0, cgImage.height > 0,
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = cgImage.width, height = cgImage.height
        var pixels = [UInt32](repeating: 0, count: width * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }

        var all: [UInt32: Int] = [:]
        for pixel in pixels { all[pixel & 0x00FF_FFFF, default: 0] += 1 }
        guard let background = all.max(by: { $0.value < $1.value })?.key else { return nil }

        var counts: [UInt32: Int] = [:]
        var inside = 0
        // With a tolerance, a row's fill is found with it too: in a dithered
        // capture many rows hold no pixel of the exact panel colour, and the
        // text rows of « Role » were all skipped (#234).
        func isFill(_ pixel: UInt32) -> Bool {
            let colour = pixel & 0x00FF_FFFF
            return colour == background || near(colour, background, shade)
        }
        for row in 0..<height {
            let line = pixels[(row * width)..<((row + 1) * width)]
            guard let first = line.firstIndex(where: isFill), let last = line.lastIndex(where: isFill) else { continue }
            for pixel in line[first...last] where !near(pixel & 0x00FF_FFFF, background, shade) {
                counts[pixel & 0x00FF_FFFF, default: 0] += 1
            }
            inside += last - first + 1
        }
        let threshold = max(1, Int(Double(inside) * minimumShare))
        let backgroundLuminance = luminance(background)
        return counts
            .filter { $0.key != background && $0.value >= threshold }
            .map { contrast(luminance($0.key), backgroundLuminance) }
            .min()
    }

    private static func near(_ a: UInt32, _ b: UInt32, _ shade: UInt8) -> Bool {
        guard shade > 0 else { return false }
        return (0..<3).allSatisfy { channel in
            let shift = UInt32(channel * 8)
            return abs(Int((a >> shift) & 0xFF) - Int((b >> shift) & 0xFF)) <= Int(shade)
        }
    }

    private static func contrast(_ a: Double, _ b: Double) -> Double {
        (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /// The colour is packed as read on a little-endian device: red in the low byte.
    private static func luminance(_ rgb: UInt32) -> Double {
        0.2126 * linear(UInt8(rgb & 0xFF)) + 0.7152 * linear(UInt8((rgb >> 8) & 0xFF))
            + 0.0722 * linear(UInt8((rgb >> 16) & 0xFF))
    }

    private static func linear(_ component: UInt8) -> Double {
        let value = Double(component) / 255
        return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
}
