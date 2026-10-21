// Design prototype for the Aegis Mobile sign-in proposal (#35, then #36).
// Static presentation only: no network, no Keychain, no real session. It is
// compiled into a temporary copy of apps/ios by render.sh to produce the
// captures in ../captures/, and is never part of the application target.
// The state is chosen with the AEGIS_PROTO_STATE launch variable.

import SwiftUI

@main
struct SignInPrototypeApp: App {
    private let state = ProtoState(
        rawValue: ProcessInfo.processInfo.environment["AEGIS_PROTO_STATE"] ?? "") ?? .idle

    var body: some Scene {
        WindowGroup {
            SignInPrototypeScreen(state: state)
        }
    }
}

enum ProtoState: String {
    case restoring = "reprise"
    case idle = "inactif"
    case validation
    case sending = "envoi"
    case rejected = "identifiants-refuses"
    case rateLimited = "trop-de-tentatives"
    case unreachable = "service-injoignable"
    case serviceError = "erreur-service"
    case expired = "session-expiree"
    case invalidSession = "session-invalide"
    case signedOut = "deconnecte"
    case wrongRole = "role-non-autorise"
}

// MARK: - Screen

struct SignInPrototypeScreen: View {
    let state: ProtoState

    var body: some View {
        ZStack {
            ProtoBackground()
            switch state {
            case .restoring:
                RestoringView()
            case .wrongRole:
                ScrollView { WrongRoleView().screenPadding() }
            default:
                ScrollView { SignInForm(state: state).screenPadding() }
                    .scrollDismissesKeyboard(.interactively)
            }
        }
    }
}

private struct BrandMark: View {
    var body: some View {
        Text("Aegis")
            .font(.title3.weight(.bold))
            .foregroundStyle(Color.accentText)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct SignInForm: View {
    let state: ProtoState

    private var email: String {
        switch state {
        case .idle, .signedOut, .restoring, .wrongRole: ""
        case .validation: "technicien.aegis.demo"
        default: "technician@aegis.demo"
        }
    }

    private var password: String {
        switch state {
        case .sending, .unreachable, .serviceError, .rateLimited: "••••••••••••"
        default: ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            BrandMark()
            Text("Connexion")
                .font(.largeTitle.weight(.bold))
                .accessibilityAddTraits(.isHeader)

            if let banner = Banner.for(state) {
                BannerView(banner: banner)
            }

            VStack(spacing: 0) {
                FieldRow(label: "Adresse courriel", value: email, placeholder: "nom@example.com",
                         symbol: nil,
                         error: state == .validation ? "Saisissez une adresse courriel valide, par exemple nom@example.com." : nil,
                         readOnly: state == .sending)
                Divider().padding(.leading, 16)
                FieldRow(label: "Mot de passe", value: password, placeholder: "",
                         symbol: "eye",
                         error: state == .validation ? "Saisissez votre mot de passe." : nil,
                         readOnly: state == .sending)
            }
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(spacing: 10) {
                SubmitButton(state: state)
                if state == .rateLimited {
                    Text("Disponible dans 0:55")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text("Compte fourni par votre administrateur.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

private struct FieldRow: View {
    let label: String
    let value: String
    let placeholder: String
    let symbol: String?
    let error: String?
    let readOnly: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline.weight(.semibold))
            HStack(spacing: 8) {
                Text(value.isEmpty ? placeholder : value)
                    .foregroundStyle(value.isEmpty || readOnly ? Color.secondary : Color.primary)
                    .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                if let symbol {
                    Image(systemName: symbol)
                        .foregroundStyle(Color.accentText)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel("Afficher le mot de passe")
                }
            }
            if let error {
                Label {
                    Text(error)
                } icon: {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(Color.blockedIcon)
                }
                .font(.footnote)
                .foregroundStyle(Color.roleBlockedText)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 72)
    }
}

private struct SubmitButton: View {
    let state: ProtoState

    var body: some View {
        Button {} label: {
            HStack(spacing: 10) {
                if state == .sending {
                    ProgressView().tint(.white)
                    Text("Connexion…")
                } else {
                    Text("Se connecter")
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 30)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        // Busy keeps the prominent look so "Connexion…" stays legible; taps are
        // ignored instead of disabling the control.
        .disabled(state == .rateLimited)
        .allowsHitTesting(state != .sending)
    }
}

// MARK: - Banners

private struct Banner {
    enum Role { case error, warning, info }

    let role: Role
    let symbol: String
    let title: String
    let message: String?
    var traceId: String? = nil

    static func `for`(_ state: ProtoState) -> Banner? {
        switch state {
        case .rejected:
            Banner(role: .error, symbol: "exclamationmark.octagon.fill",
                   title: "Adresse courriel ou mot de passe incorrect.",
                   message: "Vérifiez les deux champs, puis réessayez.")
        case .rateLimited:
            Banner(role: .warning, symbol: "clock.badge.exclamationmark.fill",
                   title: "Trop de tentatives.",
                   message: "Réessayez dans 55 secondes.")
        case .unreachable:
            Banner(role: .warning, symbol: "wifi.exclamationmark",
                   title: "Connexion au service impossible.",
                   message: "Vérifiez le réseau, puis réessayez.")
        case .serviceError:
            Banner(role: .error, symbol: "exclamationmark.octagon.fill",
                   title: "Le service n’a pas pu traiter la connexion.",
                   message: "Réessayez dans un instant. Si le problème persiste, transmettez ce code au support :",
                   traceId: "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30")
        case .expired:
            Banner(role: .info, symbol: "clock.fill",
                   title: "Votre session a expiré. Reconnectez-vous.",
                   message: "Vos réservations et prêts sont conservés.")
        case .invalidSession:
            Banner(role: .info, symbol: "info.circle.fill",
                   title: "Votre session n’est plus valide. Reconnectez-vous.",
                   message: "Aucune réservation, aucun prêt ni aucune opération n’a été modifié.")
        case .signedOut:
            Banner(role: .info, symbol: "info.circle.fill",
                   title: "Vous êtes déconnecté.", message: nil)
        default:
            nil
        }
    }
}

private struct BannerView: View {
    let banner: Banner

    private var icon: Color {
        switch banner.role {
        case .error: .blockedIcon
        case .warning: .unknownIcon
        case .info: .accentText
        }
    }

    private var fill: Color {
        switch banner.role {
        case .error: .roleBlockedFill
        case .warning: .roleUnknownFill
        case .info: .roleInfoFill
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: banner.symbol)
                .foregroundStyle(icon)
                .font(.body.weight(.semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text(banner.title)
                    .font(.headline)
                if let message = banner.message {
                    Text(message)
                        .font(.subheadline)
                }
                if let traceId = banner.traceId {
                    Text(traceId)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Other states

private struct RestoringView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandMark()
            ProgressView()
            Text("Reprise de la session…")
                .font(.headline)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct WrongRoleView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            BrandMark()
            Text("Accès réservé aux techniciens")
                .font(.largeTitle.weight(.bold))
                .accessibilityAddTraits(.isHeader)
            BannerView(banner: Banner(
                role: .warning, symbol: "person.crop.square.fill",
                title: "Ce compte administrateur s’utilise dans Aegis Manager sur le Web.",
                message: "L’application Aegis est réservée aux comptes technicien. Aucune donnée n’a été chargée et la session a été fermée."))
            VStack(alignment: .leading, spacing: 2) {
                Text("Compte utilisé")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(verbatim: "admin@aegis.demo")
            }
            .accessibilityElement(children: .combine)
            Button {} label: {
                Text("Se connecter avec un autre compte")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 30)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }
}

// MARK: - Shared presentation

private struct ProtoBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            Color.canvas
            if !reduceTransparency {
                RadialGradient(colors: [Color.glowBlue.opacity(0.35), .clear],
                               center: .topLeading, startRadius: 0, endRadius: 420)
                RadialGradient(colors: [Color.glowIndigo.opacity(0.25), .clear],
                               center: .topTrailing, startRadius: 0, endRadius: 360)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private extension View {
    func screenPadding() -> some View {
        padding(.horizontal, 20)
            .padding(.vertical, 24)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
    }
}

/// Alert fills from the Aegis Manager tokens (manager-entree/handoff.md §5);
/// prototype values, not approved iOS tokens.
private extension Color {
    static let roleBlockedFill = dynamic(light: 0xFCE7E6, dark: 0x3A1424)
    static let roleUnknownFill = dynamic(light: 0xFFF0D1, dark: 0x33280F)
    static let roleInfoFill = dynamic(light: 0xEEF3FF, dark: 0x111F4D)
    static let roleBlockedText = dynamic(light: 0xA3161A, dark: 0xFFA59E)
    /// `--ag-accent-text`: accent used as text or symbol on dark surfaces.
    static let accentText = dynamic(light: 0x1A45CC, dark: 0x93B1FF)

    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}
