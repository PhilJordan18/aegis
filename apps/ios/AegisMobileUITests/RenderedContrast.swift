import CoreGraphics
import UIKit

/// The WCAG contrast between the background and the text of a screenshot of
/// one text element, read from its pixels: the background is the most common
/// luminance, the text the luminance farthest from it that still covers a
/// share of the pixels, so that anti-aliased edges are not taken for the text.
/// Measured on what is drawn, it catches a text over the wrong background,
/// which the colour tokens alone cannot.
enum RenderedContrast {
    /// Share of the pixels the text luminance must cover.
    static let minimumShare = 0.005

    static func ratio(of image: UIImage) -> Double? {
        guard let cgImage = image.cgImage, cgImage.width > 0, cgImage.height > 0,
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = cgImage.width, height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }

        let bins = 512
        var histogram = [Int](repeating: 0, count: bins)
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let luminance = 0.2126 * linear(pixels[index]) + 0.7152 * linear(pixels[index + 1])
                + 0.0722 * linear(pixels[index + 2])
            histogram[min(bins - 1, Int(luminance * Double(bins)))] += 1
        }
        let total = width * height
        guard let background = histogram.indices.max(by: { histogram[$0] < histogram[$1] }) else { return nil }
        let threshold = max(1, Int(Double(total) * minimumShare))
        // The nearest edges of the two bins: the ratio is never overstated.
        func contrast(_ a: Int, _ b: Int) -> Double {
            let light = Double(max(a, b)) / Double(bins), dark = Double(min(a, b) + 1) / Double(bins)
            return max(1, (light + 0.05) / (dark + 0.05))
        }
        let text = histogram.indices
            .filter { $0 != background && histogram[$0] >= threshold }
            .max { contrast($0, background) < contrast($1, background) }
        return text.map { contrast($0, background) }
    }

    private static func linear(_ component: UInt8) -> Double {
        let value = Double(component) / 255
        return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
}
