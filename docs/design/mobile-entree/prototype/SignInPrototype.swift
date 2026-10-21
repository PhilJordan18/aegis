// Design prototype for the Aegis Mobile sign-in, direction "Lumière du hub" v3
// (no hardware illustration). Static presentation only: no network, no
// Keychain, no session. render.sh compiles it into a temporary copy of
// apps/ios to produce ../captures/; it is never part of the application.
//
// Launch variables: AEGIS_PROTO_STATE (see ProtoState), AEGIS_PROTO_LANG
// (fr | en). Strings live in a local table here; the application will use a
// String Catalog (#36 and the iOS localization issue).

import SwiftUI

@main
struct SignInPrototypeApp: App {
    private let environment = ProcessInfo.processInfo.environment

    var body: some Scene {
        WindowGroup {
            let lang = Lang(rawValue: environment["AEGIS_PROTO_LANG"] ?? "") ?? .fr
            SignInPrototypeScreen(
                state: ProtoState(rawValue: environment["AEGIS_PROTO_STATE"] ?? "") ?? .idle,
                text: Copy(lang: lang))
                .environment(\.locale, lang.locale)
        }
    }
}

enum ProtoState: String {
    case idle = "inactif"
    case keyboard = "clavier"
    case validation
    case sending = "envoi"
    case rejected = "identifiants-refuses"
    case rateLimited = "trop-de-tentatives"
    case unreachable = "service-injoignable"
    case expired = "session-expiree"
    case offlineResume = "reprise-hors-ligne"
}

// MARK: - Screen

struct SignInPrototypeScreen: View {
    let state: ProtoState
    let text: Copy

    @FocusState private var focus: Field?
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Field { case email, password }

    /// The keyboard and accessibility text sizes both need the vertical room.
    private var compact: Bool { focus != nil || typeSize.isAccessibilitySize }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Hero(text: text, compact: compact)
                    Panel {
                        if state == .offlineResume {
                            OfflineResume(text: text)
                        } else {
                            SignInForm(state: state, text: text, focus: $focus)
                        }
                    }
                    .frame(maxHeight: .infinity, alignment: .top)
                }
                .frame(minHeight: proxy.size.height, alignment: .top)
                .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: compact)
            }
            .scrollDismissesKeyboard(.interactively)
            // Hero colour above, panel colour below: no band whatever the
            // content height or scroll position.
            .background {
                VStack(spacing: 0) { Palette.top; Palette.panel }
                    .ignoresSafeArea()
            }
        }
        .onAppear {
            if state == .keyboard { focus = .password }
        }
    }
}

private struct Hero: View {
    let text: Copy
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 0 : 26) {
            BrandLockup()
            if !compact {
                // One localized string, three lines on screen; the accent on the
                // last line is styling, not a separate sentence fragment.
                Text(text.promiseStyled)
                    .font(.system(size: 30, weight: .semibold))
                    .tracking(-1.1)
                    .lineSpacing(-2)
                    .accessibilityLabel(text.promiseSpoken)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 26)
        .padding(.top, compact ? 12 : 20)
        .padding(.bottom, compact ? 22 : 40)
        .background {
            EllipticalGradient(colors: [Palette.halo, .clear],
                               center: UnitPoint(x: 0.75, y: 0.8),
                               startRadiusFraction: 0, endRadiusFraction: 0.63)
                .ignoresSafeArea(edges: .top)
                .accessibilityHidden(true)
        }
    }
}

/// Provisional "Aegis Core" lockup. The mark is the replaceable `AegisMark`
/// vector asset; the words are text so they render without the SVG font.
private struct BrandLockup: View {
    var body: some View {
        HStack(spacing: 10) {
            Image("AegisMark")
                .resizable()
                .frame(width: 34, height: 34)
            Text(verbatim: "aegis")
                .font(.system(size: 29, weight: .semibold))
                .tracking(-1.3)
            Text(verbatim: "CORE")
                .font(.system(size: 10, weight: .medium))
                .tracking(2.1)
                .foregroundStyle(Palette.muted)
                .padding(.leading, 11)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Palette.border).frame(width: 1, height: 22)
                }
                .padding(.leading, 3)
        }
        .foregroundStyle(Palette.text)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "Aegis"))
        .accessibilityAddTraits(.isHeader)
    }
}

private struct Panel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 26)
            .padding(.top, 25)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: 27, topTrailingRadius: 27, style: .continuous)
                    .fill(Palette.panel)
                    .overlay {
                        UnevenRoundedRectangle(topLeadingRadius: 27, topTrailingRadius: 27, style: .continuous)
                            .strokeBorder(Palette.border, lineWidth: 1)
                            .mask(alignment: .top) { Rectangle().frame(height: 40) }
                    }
                    .ignoresSafeArea(edges: .bottom)
            }
    }
}

private struct PanelHeading: View {
    let text: Copy

    var body: some View {
        Text(text.eyebrow)
            .font(.caption2.weight(.semibold))
            .tracking(1.8)
            .textCase(.uppercase)
            .foregroundStyle(Palette.muted)
            .padding(.bottom, 9)
        Text(text.title)
            .font(.title.weight(.semibold))
            .foregroundStyle(Palette.text)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 7)
        Text(text.subtitle)
            .font(.subheadline)
            .foregroundStyle(Palette.muted)
    }
}

private struct SignInForm: View {
    let state: ProtoState
    let text: Copy
    var focus: FocusState<SignInPrototypeScreen.Field?>.Binding

    @State private var email: String
    @State private var password: String
    @State private var revealed = false
    @Environment(\.colorSchemeContrast) private var contrast

    /// The v3 border (1.3–1.6:1) is decorative; Increase Contrast gets an
    /// edge that meets 3:1 for the input boundary.
    private var fieldEdge: Color { contrast == .increased ? Palette.muted : Palette.border }

    init(state: ProtoState, text: Copy, focus: FocusState<SignInPrototypeScreen.Field?>.Binding) {
        self.state = state
        self.text = text
        self.focus = focus
        switch state {
        case .idle, .keyboard: _email = State(initialValue: "")
        case .validation: _email = State(initialValue: "technicien.aegis.demo")
        default: _email = State(initialValue: "technician@aegis.demo")
        }
        switch state {
        case .sending, .unreachable, .rateLimited: _password = State(initialValue: "demo-password")
        default: _password = State(initialValue: "")
        }
    }

    var body: some View {
        PanelHeading(text: text)

        if let message = text.banner(for: state) {
            Banner(message: message)
                .padding(.top, 14)
        }

        VStack(spacing: 0) {
            field(label: text.emailLabel,
                  error: state == .validation ? text.emailInvalid : nil) {
                TextField(text.emailLabel, text: $email,
                          prompt: Text(text.emailExample).foregroundStyle(Palette.muted))
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused(focus, equals: .email)
            }
            Rectangle().fill(fieldEdge).frame(height: 1)
            field(label: text.passwordLabel,
                  error: state == .validation ? text.passwordMissing : nil) {
                HStack(spacing: 4) {
                    Group {
                        // The persistent label names the field; no repeated placeholder.
                        if revealed {
                            TextField(text.passwordLabel, text: $password, prompt: Text(verbatim: ""))
                        } else {
                            SecureField(text.passwordLabel, text: $password, prompt: Text(verbatim: ""))
                        }
                    }
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused(focus, equals: .password)
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye")
                            .frame(width: 44, height: 44)
                    }
                    .foregroundStyle(Palette.muted)
                    .accessibilityLabel(revealed ? text.hidePassword : text.showPassword)
                    .padding(.vertical, -10)
                }
            }
        }
        .padding(.horizontal, 15)
        .background(Palette.field, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(fieldEdge))
        .disabled(state == .sending)
        .padding(.top, 23)

        SubmitButton(state: state, text: text)
            .padding(.top, 17)

        Text(text.accountNote)
            .font(.footnote)
            .foregroundStyle(Palette.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 17)
    }

    private func field<Input: View>(label: String, error: String?,
                                    @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Palette.text)
                .accessibilityHidden(true)
            input()
                .font(.body)
                .foregroundStyle(Palette.text)
                .frame(minHeight: 24)
            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(Palette.errorText)
            }
        }
        .padding(.vertical, 13)
    }
}

private struct SubmitButton: View {
    let state: ProtoState
    let text: Copy

    var body: some View {
        Button {} label: {
            HStack {
                if state == .sending {
                    ProgressView().tint(.white)
                    Text(text.sending)
                    Spacer()
                } else {
                    Text(text.signIn)
                    Spacer()
                    Image(systemName: "arrow.right")
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(state == .rateLimited)
        // Busy stays legible: taps are ignored instead of dimming the control.
        .allowsHitTesting(state != .sending)
        .accessibilityLabel(state == .sending ? text.sendingSpoken : text.signIn)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(isEnabled ? Color.white : Palette.muted)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(isEnabled ? Palette.button : Palette.field,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isEnabled ? Palette.buttonEdge : Palette.border))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Palette.accent)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Palette.field, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

private struct Banner: View {
    let message: String

    var body: some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: "exclamationmark.circle.fill")
        }
        .font(.footnote)
        .foregroundStyle(Palette.errorText)
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.errorFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Network failure while resuming a non-expired token: the token is kept, the
/// session is not presented as verified, and no business action is offered.
private struct OfflineResume: View {
    let text: Copy

    var body: some View {
        Text(text.offlineTitle)
            .font(.title2.weight(.semibold))
            .foregroundStyle(Palette.text)
            .accessibilityAddTraits(.isHeader)
        Text(text.offlineBody)
            .font(.subheadline)
            .foregroundStyle(Palette.muted)
            .padding(.top, 8)
        Button(text.retry) {}
            .buttonStyle(PrimaryButtonStyle())
            .padding(.top, 24)
        Button(text.signOut) {}
            .buttonStyle(SecondaryButtonStyle())
            .padding(.top, 12)
    }
}

// MARK: - Copy (FR reference, EN proposed)

enum Lang: String {
    case fr, en

    var locale: Locale { Locale(identifier: self == .fr ? "fr_CA" : "en_CA") }
}

struct Copy {
    let lang: Lang

    private func t(_ fr: String, _ en: String) -> String { lang == .fr ? fr : en }

    var promise: String { t("Prêt.\nAutorisé.\nProuvé.", "Ready.\nAuthorized.\nProven.") }
    var promiseSpoken: String { promise.replacingOccurrences(of: "\n", with: " ") }
    var promiseStyled: AttributedString {
        var styled = AttributedString(promise)
        if let lastBreak = styled.characters.lastIndex(of: "\n") {
            let lastLine = styled.characters.index(after: lastBreak)..<styled.endIndex
            styled[lastLine].foregroundColor = Palette.accent
        }
        return styled
    }
    var eyebrow: String { t("Espace technicien", "Technician access") }
    var title: String { t("Connexion", "Sign in") }
    var subtitle: String { t("Vos équipements. Votre activité.", "Your equipment. Your activity.") }
    var emailLabel: String { t("Adresse courriel", "Email address") }
    var emailExample: String { t("nom@entreprise.ca", "name@company.ca") }
    var passwordLabel: String { t("Mot de passe", "Password") }
    var showPassword: String { t("Afficher le mot de passe", "Show password") }
    var hidePassword: String { t("Masquer le mot de passe", "Hide password") }
    var signIn: String { t("Se connecter", "Sign in") }
    var sending: String { t("Connexion…", "Signing in…") }
    var sendingSpoken: String { t("Connexion en cours", "Signing in") }
    var accountNote: String { t("Compte fourni par votre administrateur.", "Account provided by your administrator.") }
    var emailInvalid: String { t("Saisissez une adresse courriel valide.", "Enter a valid email address.") }
    var passwordMissing: String { t("Saisissez votre mot de passe.", "Enter your password.") }
    var offlineTitle: String { t("Connexion au service impossible", "Can't reach the service") }
    var offlineBody: String {
        t("Votre session est conservée, mais elle n’a pas pu être vérifiée. Aucune action n’est possible hors ligne.",
          "Your session is kept but couldn't be verified. No action is available offline.")
    }
    var retry: String { t("Réessayer", "Try again") }
    var signOut: String { t("Se déconnecter", "Sign out") }

    func banner(for state: ProtoState) -> String? {
        switch state {
        case .rejected:
            t("Adresse courriel ou mot de passe incorrect.", "Incorrect email address or password.")
        case .rateLimited:
            // The delay appears once, formatted natively from Retry-After.
            t("Trop de tentatives. Réessayez dans \(delay).", "Too many attempts. Try again in \(delay).")
        case .unreachable:
            t("Connexion au service impossible. Vérifiez le réseau.", "Can't reach the service. Check your network.")
        case .expired:
            t("Votre session a expiré. Vos réservations et prêts sont conservés.",
              "Your session has expired. Your reservations and loans are kept.")
        default:
            nil
        }
    }

    private var delay: String {
        Duration.seconds(55).formatted(.units(allowed: [.seconds], width: .wide).locale(lang.locale))
    }
}

// MARK: - Palette (v3 values from aegis-lumiere-du-hub-v3.html; proposals)

enum Palette {
    static let top = dynamic(light: 0xEDF2FA, dark: 0x070D17)
    static let panel = dynamic(light: 0xFFFFFF, dark: 0x0D1520)
    static let field = dynamic(light: 0xF3F5F9, dark: 0x141F2D)
    static let text = dynamic(light: 0x122339, dark: 0xF1F5FC)
    static let muted = dynamic(light: 0x53647B, dark: 0xABB9CD)
    static let border = dynamic(light: 0xD7DFE9, dark: 0x2B3B50)
    static let accent = dynamic(light: 0x234BCE, dark: 0x8CAEFF)
    static let button = dynamic(light: 0x234BCE, dark: 0x315EE8)
    static let buttonEdge = Color(red: 0x7D / 255, green: 0x9B / 255, blue: 1, opacity: 0.4)
    static let halo = dynamic(light: 0x92B8F7, dark: 0x193E73, lightAlpha: 0.23, darkAlpha: 0.33)
    static let errorFill = dynamic(light: 0xFFF0F1, dark: 0x3B2024)
    static let errorText = dynamic(light: 0x9E2837, dark: 0xFFC9CB)

    static func dynamic(light: UInt32, dark: UInt32,
                        lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let hex = isDark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255,
                           alpha: isDark ? darkAlpha : lightAlpha)
        })
    }
}
