import SwiftUI

/// Compte > Sécurité > « Changer le mot de passe » (#234). Native fields the
/// password manager understands, in two steps (see `PasswordChangeModel`):
/// the account's address as the user name with the current password, then
/// the new password with its confirmation. The change ends the session; the
/// next screen is the sign-in form.
struct PasswordChangeView: View {
    @State private var model: PasswordChangeModel
    let email: String
    @FocusState private var focus: PasswordChangeModel.Field?

    init(session: any PasswordChanging, email: String) {
        _model = State(initialValue: PasswordChangeModel(session: session))
        self.email = email
    }

    var body: some View {
        Form {
            Section {
                AccountNameField(email: email)
                PasswordField("Mot de passe actuel", text: $model.current, content: .password,
                              error: model.currentError, identifier: "password.current",
                              focus: $focus, field: .current) {
                    model.edited(.current)
                }
                .submitLabel(.continue)
                .onSubmit(proceed)
            }
            .listRowBackground(Color.brandPanel)

            Section {
                Button(action: proceed) {
                    Text("Continuer").frame(maxWidth: .infinity, minHeight: 44)
                }
                .foregroundStyle(Color.brandAccent)
                .accessibilityIdentifier("password.continue")
            }
            .listRowBackground(Color.brandPanel)
        }
        .passwordFormStyle()
        .navigationDestination(isPresented: Binding(get: { model.step == .new },
                                                    set: { if !$0 { model.step = .current } })) {
            NewPasswordStep(model: model, email: email)
        }
        // Closing the form, not pushing its second step, wipes the secrets.
        .onDisappear { if model.step == .current { model.clear() } }
        .onChange(of: model.currentError) { _, error in
            // A refused current password brings the form back to this step.
            guard error == .currentRejected else { return }
            focus = .current
            AccessibilityNotification.Announcement(Self.text(.currentRejected)).post()
        }
    }

    private func proceed() {
        model.proceed()
        focus = model.currentError == nil ? nil : .current
    }

    static func text(_ error: PasswordChangeModel.FieldError) -> String {
        switch error {
        case .currentMissing: String(localized: "Saisissez votre mot de passe actuel.")
        case .currentTooLong: String(localized: "Ce mot de passe est trop long.")
        case .currentRejected: String(localized: "Mot de passe actuel incorrect.")
        case .newTooShort: String(localized: "Le nouveau mot de passe doit compter au moins 12 caractères.")
        case .newTooLong: String(localized: "Le nouveau mot de passe est trop long.")
        case .sameAsCurrent: String(localized: "Choisissez un mot de passe différent de l’actuel.")
        case .confirmationMismatch: String(localized: "La confirmation ne correspond pas au nouveau mot de passe.")
        }
    }

    static func text(_ message: PasswordChangeModel.Message) -> String {
        switch message {
        case .invalid:
            String(localized: "Le mot de passe n’a pas été modifié. Vérifiez les champs.")
        case let .rateLimited(retryAfter?):
            String(localized: "Trop de tentatives. Réessayez dans \(SignInText.duration(retryAfter)).",
                   comment: "The argument is a localized duration, for example 55 seconds")
        case .rateLimited(nil):
            String(localized: "Trop de tentatives. Réessayez plus tard.")
        case .unavailable:
            String(localized: "Le changement de mot de passe est temporairement indisponible. Votre mot de passe n’a pas changé.")
        case .refused:
            String(localized: "Votre compte ne peut pas changer son mot de passe ici.")
        case .notSent:
            String(localized: "Connexion au service impossible. Votre mot de passe n’a pas changé.")
        case let .serviceError(traceId?):
            String(localized: "Le service n’a pas pu modifier le mot de passe. Identifiant de suivi : \(traceId)")
        case .serviceError(nil):
            String(localized: "Le service n’a pas pu modifier le mot de passe. Réessayez dans un instant.")
        }
    }
}

/// The new password and its confirmation, then the single send.
private struct NewPasswordStep: View {
    @Bindable var model: PasswordChangeModel
    let email: String
    @FocusState private var focus: PasswordChangeModel.Field?

    var body: some View {
        Form {
            Section {
                // Without the user name on this screen, iOS offers no strong
                // password and has no account to file the new one under.
                AccountNameField(email: email)
                PasswordField("Nouveau mot de passe", text: $model.new, content: .newPassword,
                              error: model.newError, identifier: "password.new",
                              focus: $focus, field: .new) {
                    model.edited(.new)
                }
                .submitLabel(.next)
                .onSubmit { focus = .confirmation }
                PasswordField("Confirmer le nouveau mot de passe", text: $model.confirmation,
                              content: .newPassword, error: model.confirmationError,
                              identifier: "password.confirmation", focus: $focus, field: .confirmation) {
                    model.edited(.confirmation)
                }
                .submitLabel(.go)
                .onSubmit(submit)
            }
            .listRowBackground(Color.brandPanel)
            // Rows rather than section footers, which do not follow every
            // Dynamic Type size. The consequence is read before the button,
            // which ends the form clear of the tab bar's fade.
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Au moins 12 caractères et au plus 72. Un caractère accentué compte pour deux.")
                    Text("Tous vos appareils seront déconnectés. Vos réservations et prêts sont conservés.")
                }
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
            }

            if let message = model.message {
                Section {
                    Label {
                        Text(PasswordChangeView.text(message)).fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: message == .notSent ? "wifi.slash" : "exclamationmark.circle.fill")
                    }
                    .foregroundStyle(Color.errorText)
                    .accessibilityIdentifier("password.message")
                }
                .listRowBackground(Color.errorFill)
            }

            Section {
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if model.isSubmitting { ProgressView() }
                        Text(model.isSubmitting ? "Modification…" : "Changer le mot de passe")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .foregroundStyle(Color.brandAccent)
                .disabled(!model.canSubmit)
                .accessibilityIdentifier("password.submit")
            }
            .listRowBackground(Color.brandPanel)
        }
        .passwordFormStyle()
        .interactiveDismissDisabled(model.isSubmitting)
        .navigationBarBackButtonHidden(model.isSubmitting)
        .onDisappear { model.clearNew() }
        .onChange(of: model.message) { _, message in
            if let message { AccessibilityNotification.Announcement(PasswordChangeView.text(message)).post() }
        }
    }

    /// An unstructured task: leaving the screen must not cancel a change in
    /// flight, whose outcome would then be unknown.
    private func submit() {
        focus = nil
        Task { await model.submit() }
    }
}

/// A secure field under its visible name, with its error right after it so
/// VoiceOver reads them together.
private struct PasswordField: View {
    let title: LocalizedStringKey
    @Binding var text: String
    let content: UITextContentType
    let error: PasswordChangeModel.FieldError?
    let identifier: String
    let focus: FocusState<PasswordChangeModel.Field?>.Binding
    let field: PasswordChangeModel.Field
    let edited: () -> Void

    init(_ title: LocalizedStringKey, text: Binding<String>, content: UITextContentType,
         error: PasswordChangeModel.FieldError?, identifier: String,
         focus: FocusState<PasswordChangeModel.Field?>.Binding, field: PasswordChangeModel.Field,
         edited: @escaping () -> Void) {
        self.title = title
        _text = text
        self.content = content
        self.error = error
        self.identifier = identifier
        self.focus = focus
        self.field = field
        self.edited = edited
    }

    var body: some View {
        PasswordLabelled(title) {
            // The persistent label names the field: no placeholder, which
            // would vanish while typing.
            SecureField(title, text: Binding(get: { text },
                                             set: { newValue in
                                                 // Focus changes can write back the same value: not an edit.
                                                 guard newValue != text else { return }
                                                 text = newValue
                                                 edited()
                                             }),
                        prompt: Text(verbatim: ""))
                .textContentType(content)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused(focus, equals: field)
                .accessibilityLabel(Text(title))
                .accessibilityIdentifier(identifier)
            if let error {
                Text(PasswordChangeView.text(error))
                    .font(.footnote)
                    .foregroundStyle(Color.errorText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("\(identifier).error")
            }
        }
    }
}

/// The user name the password manager files the password under, shown on
/// both steps.
private struct AccountNameField: View {
    let email: String

    var body: some View {
        PasswordLabelled("Adresse courriel") {
            TextField("Adresse courriel", text: .constant(email), prompt: Text(verbatim: ""))
                .textContentType(.username)
                .disabled(true)
                .foregroundStyle(Color.brandText)
                .accessibilityLabel(Text("Adresse courriel"))
                .accessibilityIdentifier("password.email")
        }
    }
}

/// A field under its visible name, as on the sign-in form.
private struct PasswordLabelled<Input: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder let input: Input

    init(_ title: LocalizedStringKey, @ViewBuilder input: () -> Input) {
        self.title = title
        self.input = input()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
            input
        }
        .padding(.vertical, 4)
    }
}

private extension View {
    func passwordFormStyle() -> some View {
        scrollContentBackground(.hidden)
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle("Mot de passe")
            .navigationBarTitleDisplayMode(.inline)
    }
}
