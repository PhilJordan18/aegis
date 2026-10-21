import SwiftUI

/// Native sign-in of the approved handoff (docs/design/mobile-entree).
struct SignInView: View {
    @Bindable var session: SessionModel
    var initialFocus: SessionModel.Field?

    @FocusState private var focus: SessionModel.Field?
    @State private var revealsPassword = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        EntryScreen(compact: focus != nil || typeSize.isAccessibilitySize) {
            heading

            if let notice = session.notice {
                NoticeBanner(message: SignInText.message(for: notice), isError: SignInText.isError(notice))
                    .padding(.top, 14)
            }

            fields
                .padding(.top, 23)

            SubmitButton(session: session, submit: submit)
                .padding(.top, 17)

            Text("Compte fourni par votre administrateur.")
                .fixedSize(horizontal: false, vertical: true)
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 17)
        }
        .onAppear {
            if let initialFocus { focus = initialFocus }
        }
        .onChange(of: session.notice) { _, notice in
            guard let notice else { return }
            AccessibilityNotification.Announcement(SignInText.message(for: notice)).post()
        }
        .onChange(of: session.isSubmitting) { _, submitting in
            if submitting {
                AccessibilityNotification.Announcement(String(localized: "Connexion en cours")).post()
            }
        }
        .onChange(of: session.retryAvailableAt) { old, new in
            if old != nil, new == nil {
                AccessibilityNotification.Announcement(String(localized: "Vous pouvez réessayer.")).post()
            }
        }
    }

    @ViewBuilder
    private var heading: some View {
        // Uppercased as text, not with textCase, so layout and audits measure
        // what is drawn; VoiceOver reads the sentence-case original.
        Text(verbatim: String(localized: "Espace technicien").localizedUppercase)
            .fixedSize(horizontal: false, vertical: true)
            .font(.caption.weight(.semibold))
            .tracking(1.6)
            .accessibilityLabel(Text("Espace technicien"))
            .foregroundStyle(Color.brandMuted)
            .padding(.bottom, 9)
        Text("Connexion")
            .fixedSize(horizontal: false, vertical: true)
            .font(.title.weight(.semibold))
            .foregroundStyle(Color.brandText)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 7)
        Text("Vos équipements. Votre activité.")
            .font(.subheadline)
            .foregroundStyle(Color.brandMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var fields: some View {
        VStack(spacing: 0) {
            FieldRow(label: "Adresse courriel", error: session.emailError) {
                TextField("Adresse courriel", text: edits(\.email, .email),
                          prompt: Text(verbatim: String(localized: "nom@entreprise.ca")).foregroundStyle(Color.brandMuted))
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
                    .frame(minHeight: 30)
                    .accessibilityLabel(Text("Adresse courriel"))
                    .accessibilityIdentifier("signin.email")
            }
            Rectangle().fill(Color.fieldEdge).frame(height: 1).accessibilityHidden(true)
            FieldRow(label: "Mot de passe", error: session.passwordError) {
                HStack(spacing: 4) {
                    Group {
                        // The persistent label names the field: no repeated placeholder.
                        if revealsPassword {
                            TextField("Mot de passe", text: edits(\.password, .password), prompt: Text(verbatim: ""))
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                        } else {
                            SecureField("Mot de passe", text: edits(\.password, .password), prompt: Text(verbatim: ""))
                        }
                    }
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused($focus, equals: .password)
                    .onSubmit(submit)
                    .frame(minHeight: 30)
                    // An empty prompt would otherwise leave the field unnamed.
                    .accessibilityLabel(Text("Mot de passe"))
                    .accessibilityIdentifier("signin.password")

                    Button {
                        revealsPassword.toggle()
                    } label: {
                        Image(systemName: revealsPassword ? "eye.slash" : "eye")
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .foregroundStyle(Color.brandMuted)
                    .accessibilityLabel(revealsPassword ? Text("Masquer le mot de passe") : Text("Afficher le mot de passe"))
                    .accessibilityIdentifier("signin.reveal")
                    .padding(.vertical, -10)
                }
            }
        }
        .padding(.horizontal, 15)
        .background(Color.brandField, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.fieldEdge))
        .disabled(session.isSubmitting)
    }

    /// User edits withdraw the field's error; programmatic changes (trimming,
    /// clearing after a refusal) do not.
    private func edits(_ keyPath: ReferenceWritableKeyPath<SessionModel, String>,
                       _ field: SessionModel.Field) -> Binding<String> {
        Binding(get: { session[keyPath: keyPath] },
                set: { newValue in
                    // Focus changes can write back the same value: not an edit.
                    guard newValue != session[keyPath: keyPath] else { return }
                    session[keyPath: keyPath] = newValue
                    session.edited(field)
                })
    }

    private func submit() {
        revealsPassword = false
        Task {
            await session.signIn()
            if session.emailError != nil {
                focus = .email
            } else if session.passwordError != nil || session.notice == .rejected {
                focus = .password
            }
        }
    }
}

private struct FieldRow<Input: View>: View {
    let label: LocalizedStringKey
    let error: FieldError?
    @ViewBuilder let input: Input

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .fixedSize(horizontal: false, vertical: true)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.brandText)
                .accessibilityHidden(true)
            input
                .font(.body)
                .foregroundStyle(Color.brandText)
            if let error {
                // Read right after its field by VoiceOver.
                Label(SignInText.message(for: error), systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.errorText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("signin.fieldError")
            }
        }
        .padding(.vertical, 13)
    }
}

private struct SubmitButton: View {
    let session: SessionModel
    let submit: () -> Void

    var body: some View {
        Button(action: submit) {
            HStack(spacing: 10) {
                if session.isSubmitting {
                    ProgressView().tint(.white)
                    Text("Connexion…")
                    Spacer(minLength: 0)
                } else {
                    Text("Se connecter")
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(session.isRateLimited)
        // Busy stays legible: the model ignores repeated submissions instead of
        // dimming the control.
        .accessibilityLabel(session.isSubmitting ? Text("Connexion en cours") : Text("Se connecter"))
        .accessibilityIdentifier("signin.submit")
    }
}
