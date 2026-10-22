import SwiftUI

/// Temporary logo (decision of 21 October 2026): the replaceable `AegisMark`
/// asset followed by "aegis" in the system font. Swap the image set to adopt
/// the designer's final mark.
struct BrandLockup: View {
    @ScaledMetric(relativeTo: .title) private var markSize = 34

    var body: some View {
        HStack(spacing: 10) {
            Image(.aegisMark)
                .resizable()
                .scaledToFit()
                .frame(width: min(markSize, 48), height: min(markSize, 48))
            Text(verbatim: "aegis")
                .font(.title.weight(.semibold))
                .tracking(-1.2)
                .foregroundStyle(Color.brandText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "Aegis"))
        .accessibilityAddTraits(.isHeader)
    }
}

/// Header of the entry screens: brand, then the common signature unless the
/// layout is compact (keyboard shown or accessibility text size).
struct BrandHero: View {
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 0 : 26) {
            BrandLockup()
            if !compact {
                Text(Self.signature)
                    .fixedSize(horizontal: false, vertical: true)
                    .font(.largeTitle.weight(.semibold))
                    .tracking(-1)
                    .foregroundStyle(Color.brandText)
                    .accessibilityLabel(Self.spokenSignature)
                    .accessibilityIdentifier("brand.signature")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 26)
        .padding(.top, compact ? 12 : 20)
        .padding(.bottom, compact ? 22 : 40)
        .background {
            EllipticalGradient(colors: [Color.brandHalo, .clear],
                               center: UnitPoint(x: 0.75, y: 0.8),
                               startRadiusFraction: 0, endRadiusFraction: 0.63)
                .ignoresSafeArea(edges: .top)
                .accessibilityHidden(true)
        }
    }

    private static var lines: String {
        String(localized: "Prêt.\nAutorisé.\nProuvé.", comment: "Common Aegis signature, three lines")
    }

    /// One localized string; the accent on its last line is styling only.
    private static var signature: AttributedString {
        var styled = AttributedString(lines)
        if let lastBreak = styled.characters.lastIndex(of: "\n") {
            styled[styled.characters.index(after: lastBreak)...].foregroundColor = Color.brandAccent
        }
        return styled
    }

    private static var spokenSignature: String {
        lines.replacingOccurrences(of: "\n", with: " ")
    }
}

/// Panel with rounded top corners that continues to the bottom of the screen.
struct BrandPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 26)
            .padding(.top, 25)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: 27, topTrailingRadius: 27, style: .continuous)
                    .fill(Color.brandPanel)
                    .overlay {
                        UnevenRoundedRectangle(topLeadingRadius: 27, topTrailingRadius: 27, style: .continuous)
                            .strokeBorder(Color.brandBorder, lineWidth: 1)
                            .mask(alignment: .top) { Rectangle().frame(height: 40) }
                    }
                    .ignoresSafeArea(edges: .bottom)
                    .accessibilityHidden(true)
            }
    }
}

/// Scrollable entry layout: hero above, panel below, no colour band at any
/// content height. The bottom of the panel stays reachable by scrolling.
struct EntryScreen<Content: View>: View {
    let compact: Bool
    @ViewBuilder let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    BrandHero(compact: compact)
                    BrandPanel { content }
                }
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
                .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: compact)
            }
            .scrollDismissesKeyboard(.interactively)
            .background {
                VStack(spacing: 0) { Color.brandTop; Color.brandPanel }
                    .ignoresSafeArea()
            }
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(isEnabled ? Color.white : Color.brandMuted)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(isEnabled ? Color.accentColor : Color.brandField,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isEnabled ? Color.white.opacity(0.25) : Color.fieldEdge))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.brandAccent)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Color.brandField, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.fieldEdge))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// One-sentence message under the heading. Errors and information share the
/// tinted treatment of the approved handoff; the symbol changes with the kind.
struct NoticeBanner: View {
    let message: String
    let isError: Bool

    var body: some View {
        Label {
            Text(message)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: isError ? "exclamationmark.circle.fill" : "info.circle.fill")
        }
        .font(.subheadline)
        .foregroundStyle(isError ? Color.errorText : Color.brandText)
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Color.errorFill : Color.brandField,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("signin.notice")
    }
}
