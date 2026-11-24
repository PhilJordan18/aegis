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
enum RenderedContrast {
    /// Share of the pixels an exact colour must cover to count as an ink.
    static let minimumShare = 0.005

    /// The lowest ratio between the background and an ink, or nil when the
    /// image holds no ink.
    static func ratio(of image: UIImage) -> Double? {
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

        var counts: [UInt32: Int] = [:]
        for pixel in pixels { counts[pixel & 0x00FF_FFFF, default: 0] += 1 }
        guard let background = counts.max(by: { $0.value < $1.value })?.key else { return nil }
        let threshold = max(1, Int(Double(pixels.count) * minimumShare))
        let backgroundLuminance = luminance(background)
        return counts
            .filter { $0.key != background && $0.value >= threshold }
            .map { contrast(luminance($0.key), backgroundLuminance) }
            .min()
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
