import CoreGraphics
import UIKit

/// The WCAG 1.4.11 contrast of a control's border, read from a strip of the
/// screen that crosses the border from the control's fill to whatever lies
/// outside it (2026-11-27). `RenderedContrast` reads only the span of the most
/// common colour on each row, so a border on a fill unlike the page around it
/// falls outside that span and is never measured: this reads the border
/// itself, against both its sides.
///
/// Each row of the strip is reduced to its most common exact colour. The
/// first row is the fill, the last row the outside; the border is the most
/// common row colour that is neither, a 1 pt stroke covering whole rows at
/// the screenshot's scale.
enum BoundaryContrast {
    struct Measure {
        let border: UInt32
        let inside: Double
        let outside: Double
        var weakest: Double { min(inside, outside) }
    }

    static func measure(_ image: UIImage) -> Measure? {
        guard let cgImage = image.cgImage, cgImage.width > 0, cgImage.height > 2,
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
        let rows: [UInt32] = (0..<height).map { row in
            var counts: [UInt32: Int] = [:]
            for pixel in pixels[(row * width)..<((row + 1) * width)] { counts[pixel & 0x00FF_FFFF, default: 0] += 1 }
            return counts.max { $0.value < $1.value }!.key
        }
        let fill = rows[0], outside = rows[height - 1]
        var borders: [UInt32: Int] = [:]
        for colour in rows.dropFirst().dropLast() where colour != fill && colour != outside {
            borders[colour, default: 0] += 1
        }
        guard let border = borders.max(by: { $0.value < $1.value })?.key else { return nil }
        let line = luminance(border)
        return Measure(border: border, inside: contrast(line, luminance(fill)),
                       outside: contrast(line, luminance(outside)))
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
