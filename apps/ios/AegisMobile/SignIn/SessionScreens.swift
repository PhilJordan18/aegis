import SwiftUI

struct RestoringView: View {
    var body: some View {
        ZStack {
            Color.brandTop.ignoresSafeArea()
            VStack(spacing: 16) {
                BrandLockup()
                ProgressView()
                Text("Reprise de la session…")
                .fixedSize(horizontal: false, vertical: true)
                    .font(.headline)
                    .foregroundStyle(Color.brandText)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("session.restoring")
        }
    }
}

/// The stored token is kept but was not checked: the session is not
/// presented as verified and no business action is offered.
struct OfflineResumeView: View {
    let session: SessionModel
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        EntryScreen(compact: typeSize.isAccessibilitySize) {
            Text("Connexion au service impossible")
                .fixedSize(horizontal: false, vertical: true)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .accessibilityAddTraits(.isHeader)
            Text("Votre session est conservée, mais elle n’a pas pu être vérifiée. Aucune action n’est possible hors ligne.")
                .font(.subheadline)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("resume.message")
                .padding(.top, 8)
            Button {
                Task { await session.retryResume() }
            } label: {
                HStack(spacing: 10) {
                    if session.isResuming { ProgressView().tint(.white) }
                    Text("Réessayer")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .allowsHitTesting(!session.isResuming)
            .accessibilityIdentifier("resume.retry")
            .padding(.top, 24)
            Button("Se déconnecter") { session.signOut() }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("resume.signOut")
                .padding(.top, 12)
        }
        .onAppear {
            AccessibilityNotification.Announcement(String(localized: "Connexion au service impossible")).post()
        }
    }
}

/// U6: an administrator account belongs to Aegis Manager. Its token was not
/// kept and no data was loaded.
struct WrongRoleView: View {
    let session: SessionModel
    let email: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        EntryScreen(compact: typeSize.isAccessibilitySize) {
            Text("Accès réservé aux techniciens")
                .fixedSize(horizontal: false, vertical: true)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("wrongRole.title")
            NoticeBanner(
                message: String(localized: "Ce compte administrateur s’utilise dans Aegis Manager sur le Web. Aucune donnée n’a été chargée."),
                isError: true)
                .padding(.top, 14)
            VStack(alignment: .leading, spacing: 2) {
                Text("Compte utilisé")
                .fixedSize(horizontal: false, vertical: true)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.brandMuted)
                Text(verbatim: email)
                .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(Color.brandText)
            }
            .accessibilityElement(children: .combine)
            .padding(.top, 18)
            Button("Se connecter avec un autre compte") { session.useAnotherAccount() }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("wrongRole.another")
                .padding(.top, 24)
        }
    }
}

/// Signed-in landing until the business sections exist: the server profile
/// from `GET /auth/me` or the sign-in response, the diagnostic and sign-out.
struct AccountView: View {
    let session: SessionModel
    let profile: UserProfile
    let health: HealthViewModel

    @State private var confirmsSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: profile.displayName)
                            .font(.title3.weight(.semibold))
                            .accessibilityIdentifier("account.name")
                        Text(verbatim: profile.email)
                            .foregroundStyle(Color.brandMuted)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    // Token colours: the system secondary grey and red measure
                    // below 4.5:1 on the panel.
                    LabeledContent("Rôle") { Text(Self.role(profile.role)).foregroundStyle(Color.brandMuted) }
                        .accessibilityIdentifier("account.role")
                    LabeledContent("Niveau d’accès") {
                        Text(Self.accessLevel(profile.maximumAccessLevel)).foregroundStyle(Color.brandMuted)
                    }
                }
                .listRowBackground(Color.brandPanel)

                Section {
                    NavigationLink {
                        HealthView(model: health)
                    } label: {
                        Label("État du service", systemImage: "server.rack")
                    }
                }
                .listRowBackground(Color.brandPanel)

                Section {
                    Button("Se déconnecter", role: .destructive) { confirmsSignOut = true }
                        .foregroundStyle(Color.errorText)
                        .accessibilityIdentifier("account.signOut")
                }
                .listRowBackground(Color.brandPanel)
            }
            .scrollContentBackground(.hidden)
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle("Compte")
            .confirmationDialog("Vous déconnecter ?", isPresented: $confirmsSignOut, titleVisibility: .visible) {
                Button("Se déconnecter", role: .destructive) { session.signOut() }
                    .accessibilityIdentifier("account.confirmSignOut")
            } message: {
                Text("Votre réservation et votre prêt restent actifs.")
            }
        }
    }

    static func role(_ role: UserProfile.Role) -> LocalizedStringKey {
        switch role {
        case .technician: "Technicien"
        case .admin: "Administrateur"
        case .other: "Rôle inconnu"
        }
    }

    static func accessLevel(_ level: UserProfile.AccessLevel) -> LocalizedStringKey {
        switch level {
        case .standard: "Standard"
        case .restricted: "Restreint"
        case .other: "Niveau inconnu"
        }
    }
}
