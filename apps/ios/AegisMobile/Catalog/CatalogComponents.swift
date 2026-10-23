import SwiftUI

extension AssetStatus.Tone {
    var text: Color {
        switch self {
        case .ready: .statusReadyText
        case .blocked: .statusBlockedText
        case .unknown: .statusUnknownText
        case .neutral: .statusNeutralText
        }
    }

    var fill: Color {
        switch self {
        case .ready: .statusReadyFill
        case .blocked: .statusBlockedFill
        case .unknown: .statusUnknownFill
        case .neutral: .statusNeutralFill
        }
    }

    var icon: Color {
        switch self {
        case .ready: .readyIcon
        case .blocked: .blockedIcon
        case .unknown: .unknownIcon
        case .neutral: .neutralIcon
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

/// Label and value side by side, stacked when the text no longer fits.
struct FactRow: View {
    let label: String
    let value: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(Color.brandText)
                Spacer(minLength: 12)
                Text(value).foregroundStyle(Color.brandMuted).multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).foregroundStyle(Color.brandText)
                Text(value).foregroundStyle(Color.brandMuted)
            }
        }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Self.title(failure)).font(.subheadline.weight(.semibold))
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
            .accessibilityIdentifier("catalog.notice")
            if let retry {
                Button(action: retry) {
                    HStack(spacing: 8) {
                        if isRetrying { ProgressView() }
                        Text("Réessayer")
                    }
                }
                .buttonStyle(CompactButtonStyle())
                .allowsHitTesting(!isRetrying)
                .accessibilityIdentifier("catalog.retry")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onAppear {
            AccessibilityNotification.Announcement(Self.title(failure)).post()
        }
    }

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
