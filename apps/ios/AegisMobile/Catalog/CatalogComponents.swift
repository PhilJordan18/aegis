import SwiftUI
import UIKit

extension AssetStatus.Tone {
    var text: Color {
        switch self {
        case .ready: .statusReadyText
        case .blocked: .statusBlockedText
        case .unknown: .statusUnknownText
        case .neutral: .statusNeutralText
        case .mine: .statusMineText
        }
    }

    var fill: Color {
        switch self {
        case .ready: .statusReadyFill
        case .blocked: .statusBlockedFill
        case .unknown: .statusUnknownFill
        case .neutral: .statusNeutralFill
        case .mine: .statusMineFill
        }
    }

    var icon: Color {
        switch self {
        // Measured on the render, ReadyIcon reached only 4.24:1 and
        // UnknownIcon 4.15:1 on their fills in light (2026-11-26/27): these
        // symbols take the text colour.
        case .ready: .statusReadyText
        case .blocked: .blockedIcon
        case .unknown: .statusUnknownText
        case .neutral: .neutralIcon
        // The symbol takes the text colour: 6.1:1 and 6.3:1 on its fill (handoff §9).
        case .mine: .statusMineText
        }
    }
}

/// Capsule with symbol and text. A stale status keeps its symbol, turns
/// neutral and is named "Dernier état" (handoff §1, §8.1).
struct StatusChip: View {
    let status: AssetStatus
    var stale = false

    var body: some View {
        let tone = stale ? AssetStatus.Tone.neutral : status.tone
        Label {
            Text(stale ? String(localized: "Dernier état : \(status.label)") : status.label)
        } icon: {
            Image(systemName: status.symbol).foregroundStyle(tone.icon)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(tone.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(tone.fill, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityIdentifier("asset.status")
    }

    var spokenLabel: String {
        Self.spoken(status, stale: stale)
    }

    static func spoken(_ status: AssetStatus, stale: Bool) -> String {
        stale ? String(localized: "Dernier état connu, non actualisé : \(status.label)") : status.label
    }
}

/// Panel of the inner screens: continuous 20 pt corners, hairline border.
struct CatalogCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
    }
}

/// Label and value side by side; stacked at accessibility sizes, where a
/// long value would otherwise be squeezed beside its label.
struct FactRow: View {
    let label: String
    let value: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            Text(label)
                .foregroundStyle(Color.brandText)
                .frame(maxWidth: stacked ? nil : .infinity, alignment: .leading)
            Text(value)
                .foregroundStyle(Color.brandMuted)
                .multilineTextAlignment(stacked ? .leading : .trailing)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

struct ReasonRow: View {
    let symbol: String
    let tone: AssetStatus.Tone
    let title: String
    let guidance: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Color.brandText)
                Text(guidance).font(.footnote).foregroundStyle(Color.brandMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(tone.icon)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("asset.reason")
    }
}

/// Neutral placeholder: no status colour, so nothing looks evaluated yet.
struct SkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Capsule().fill(placeholder).frame(width: 92, height: 30)
            VStack(alignment: .leading, spacing: 8) {
                bar(width: 190, height: 20)
                bar(width: 140, height: 14)
            }
            Divider()
            bar(width: nil, height: 14)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
    }

    private var placeholder: Color { Color.brandMuted.opacity(0.16) }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(placeholder)
            .frame(maxWidth: width ?? .infinity, alignment: .leading)
            .frame(height: height)
    }
}

/// Bordered action that fits inside a notice; 44 pt minimum target.
struct CompactButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.brandAccent)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(Color.brandPanel, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.fieldEdge))
            .contentShape(Capsule())
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// A read that failed: the title from the failure code, the age of the data
/// shown below when there is some, and Try again. Placed above the content
/// it concerns, so the age is read before any status (handoff §3).
struct FailureNotice: View {
    let failure: CatalogFailure
    /// Reception time of the data still shown, nil when nothing is shown.
    var receivedAt: Date?
    var isRetrying = false
    var retry: (() -> Void)?
    /// Replaces the catalogue title derived from the failure.
    var title: String?
    /// Prefix of the accessibility identifiers.
    var identifier = "catalog"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(resolvedTitle).font(.subheadline.weight(.semibold))
                    if case let .service(traceId?) = failure {
                        Text("Identifiant de suivi : \(traceId)").font(.footnote)
                    }
                    if let receivedAt {
                        Text("Informations non actualisées depuis \(AegisTime.deviceTime(receivedAt)).")
                            .font(.subheadline)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: failure == .unreachable ? "wifi.slash" : "exclamationmark.circle.fill")
            }
            .foregroundStyle(Color.errorText)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("\(identifier).notice")
            if let retry {
                Button(action: retry) {
                    HStack(spacing: 8) {
                        if isRetrying { ProgressView() }
                        Text("Réessayer")
                    }
                }
                .buttonStyle(CompactButtonStyle())
                .allowsHitTesting(!isRetrying)
                .accessibilityIdentifier("\(identifier).retry")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onAppear {
            AccessibilityNotification.Announcement(resolvedTitle).post()
        }
    }

    private var resolvedTitle: String { title ?? Self.title(failure) }

    static func title(_ failure: CatalogFailure) -> String {
        switch failure {
        case .unreachable: String(localized: "Connexion au service impossible. Vérifiez le réseau.")
        case .service: String(localized: "Le service n’a pas pu charger les équipements.")
        case .forbidden: String(localized: "Votre compte n’a pas accès aux équipements.")
        }
    }
}

/// Information line (not an error) under the sheet's heading.
struct StaleNote: View {
    let receivedAt: Date

    var body: some View {
        Label {
            Text("Informations non actualisées depuis \(AegisTime.deviceTime(receivedAt)).")
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "clock.arrow.circlepath")
        }
        .font(.subheadline)
        .foregroundStyle(Color.brandText)
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandField, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("asset.staleNote")
    }
}

/// Draws the search field's prompt and magnifier in SearchPrompt. Measured in
/// light (2026-11-27): the system placeholder reached 3.1:1, the iOS 18
/// magnifier 3.11:1, and BrandMuted 4.50:1 on iOS 26 and 4.27:1 on iOS 18
/// with Increase Contrast, whose field fill is darker; SearchPrompt is the
/// darker muted tone that clears 4.5:1 on these fills. iOS ignores a colour
/// given to the SwiftUI prompt, so both are set on the UIKit field
/// `.searchable` installs on the navigation item, again on every update and
/// once the view is in a window, since SwiftUI may redraw the prompt.
struct SearchPromptColour: UIViewRepresentable {
    let prompt: String

    func makeUIView(context: Context) -> Probe {
        let probe = Probe()
        probe.prompt = prompt
        return probe
    }

    func updateUIView(_ probe: Probe, context: Context) {
        probe.prompt = prompt
        probe.apply()
    }

    final class Probe: UIView {
        var prompt = ""

        override func didMoveToWindow() {
            super.didMoveToWindow()
            DispatchQueue.main.async { [weak self] in self?.apply() }
        }

        func apply() {
            let owner = sequence(first: self as UIResponder, next: \.next)
                .compactMap { $0 as? UIViewController }
                .first { $0.navigationItem.searchController != nil }
            guard let field = owner?.navigationItem.searchController?.searchBar.searchTextField else { return }
            let colour = UIColor(resource: .searchPrompt)
            field.leftView?.tintColor = colour
            if field.attributedPlaceholder?.string == prompt,
               field.attributedPlaceholder?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == colour {
                return
            }
            field.attributedPlaceholder = NSAttributedString(string: prompt, attributes: [.foregroundColor: colour])
        }
    }
}
