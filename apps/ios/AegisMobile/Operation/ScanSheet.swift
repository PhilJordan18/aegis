import SwiftUI

/// « Scannez le code affiché sur le casier » (handoff `mobile-parcours` §7.2,
/// `sections.md` §6). Shown only while the server asks for the code. A code
/// read here is checked locally, then sent once to `authorize-local`; the
/// secret is never kept beyond an unknown outcome, logged or shown.
struct ScanSheet: View {
    let model: GuidedOperation

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var access = CameraAccess.current

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Scannez le code affiché sur le casier")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.brandText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    camera
                    if let expires = model.operation?.localProofExpiresAt {
                        ProofCountdown(expiresAt: expires)
                    }
                    Label("Aucune porte n’est ouverte.", systemImage: "lock.fill")
                        .font(.headline)
                        .foregroundStyle(Color.brandText)
                    Text("Le scan n’ouvre rien tant que le serveur n’a pas autorisé.")
                        .font(.subheadline)
                        .foregroundStyle(Color.brandMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    status
                    #if DEBUG
                    DebugCodeEntry { text in Task { await model.submit(scanned: text) } }
                    #endif
                }
                .padding(20)
            }
            .background(Color.brandPanel.ignoresSafeArea())
            .navigationTitle(Text("Code du casier"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                        .accessibilityIdentifier("scan.cancel")
                }
            }
        }
        .tint(Color.brandAccent)
        .sensoryFeedback(.impact(weight: .light), trigger: model.submission.isSubmitting) { _, submitting in
            submitting
        }
        .onChange(of: model.submission.isSubmitting) { _, submitting in
            if submitting { AccessibilityNotification.Announcement(String(localized: "Code lu")).post() }
        }
        .onChange(of: model.submission.outcome) { _, outcome in
            if let message = outcome.flatMap(Self.message) {
                AccessibilityNotification.Announcement(message).post()
            }
        }
    }

    @ViewBuilder
    private var camera: some View {
        switch access {
        case .authorized:
            CameraScannerView { text in Task { await model.submit(scanned: text) } }
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Aperçu de l’appareil photo"))
                .accessibilityIdentifier("scan.camera")
        case .notDetermined:
            cameraMessage("L’appareil photo sert uniquement à lire le code du casier.", symbol: "camera.fill") {
                Button("Scanner le code") { Task { access = await CameraAccess.request() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("scan.requestCamera")
            }
        case .denied, .restricted:
            cameraMessage("Autorisez l’appareil photo dans Réglages pour scanner le code.", symbol: "camera.fill") {
                Button("Ouvrir Réglages") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("scan.openSettings")
            }
        case .unavailable:
            cameraMessage("Aucun appareil photo n’est disponible sur cet appareil.", symbol: "camera.fill") {
                EmptyView()
            }
        }
    }

    private func cameraMessage<Action: View>(_ text: LocalizedStringKey, symbol: String,
                                             @ViewBuilder action: () -> Action) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
            Text(text)
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("scan.cameraMessage")
            action()
        }
    }

    @ViewBuilder
    private var status: some View {
        let submission = model.submission
        if submission.isSubmitting {
            HStack(spacing: 8) {
                ProgressView()
                Text("Vérification du code…").foregroundStyle(Color.brandText)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("scan.checking")
        } else if let outcome = submission.outcome, let message = Self.message(outcome) {
            VStack(alignment: .leading, spacing: 10) {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(message).font(.subheadline.weight(.semibold))
                        if case let .refused(.other(_, traceId?)) = outcome {
                            Text("Identifiant de suivi : \(traceId)").font(.footnote)
                        }
                        if case let .unknown(.service(traceId?)) = outcome {
                            Text("Identifiant de suivi : \(traceId)").font(.footnote)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.circle.fill")
                }
                .foregroundStyle(Color.errorText)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("scan.notice")
                if submission.canRetry {
                    // Unknown outcome: the same key and body.
                    Button("Réessayer") { Task { await submission.retry() } }
                        .buttonStyle(CompactButtonStyle())
                        .accessibilityIdentifier("scan.retry")
                } else if submission.awaitsNewScan {
                    // A refusal: the next reading is a new intent.
                    Button("Réessayer") { submission.scanAgain() }
                        .buttonStyle(CompactButtonStyle())
                        .accessibilityIdentifier("scan.again")
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    /// One short sentence per outcome (`sections.md` §6, handoff §7.2); nil
    /// when the screen says nothing more (authorized, session ended).
    static func message(_ outcome: LocalProofSubmission.Outcome) -> String? {
        switch outcome {
        case .authorized, .sessionEnded:
            nil
        case .rejected(.wrongContext), .refused(.contextMismatch):
            String(localized: "Ce code correspond à une autre opération.")
        case .rejected, .refused(.malformed):
            String(localized: "Ce code n’est pas un code Aegis.")
        case .refused(.invalid):
            String(localized: "Code refusé. Scannez à nouveau l’écran du casier.")
        case .refused(.notDisplayed):
            String(localized: "Le casier n’a pas encore confirmé l’affichage.")
        case .refused(.expired):
            String(localized: "Le code a expiré. Recommencez la préparation.")
        case let .refused(.rateLimited(retryAfter?)) where (1...3600).contains(retryAfter.components.seconds):
            String(localized: "Trop d’essais. Réessayez dans \(SignInText.duration(retryAfter)).",
                   comment: "The argument is a localized duration, for example 42 seconds")
        case .refused(.rateLimited):
            String(localized: "Trop de tentatives. Réessayez plus tard.")
        case .refused(.lockerOffline):
            String(localized: "Le casier est hors ligne. Réessayez plus tard.")
        case .refused(.alreadyUsed), .refused(.invalidated), .refused(.operationNotFound), .refused(.other):
            String(localized: "Le service a refusé la demande.")
        case .unknown(.unreachable):
            String(localized: "Connexion au service impossible.")
        case .unknown:
            String(localized: "Le service n’a pas pu traiter la demande.")
        }
    }
}

#if DEBUG
/// Development builds only, compiled out of Release and TestFlight: a field
/// that takes the text of the hub QR when no camera can read it (simulator).
/// It goes through the same parser and the same `authorize-local` call as
/// the camera, bypasses no guard, and never keeps, logs or shows the text.
/// It is not camera or physical acceptance.
private struct DebugCodeEntry: View {
    let submit: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Field and button side by side, stacked at accessibility sizes: on a
        // small screen a stacked button below a refusal notice ended cut at
        // the bottom of the sheet (#211).
        let row = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 8))
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: "DEBUG · QR")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.brandMuted)
            row {
                // A short placeholder: the field is empty whenever it is shown.
                TextField(text: $text) { Text(verbatim: "aegis://") }
                    .frame(minHeight: 44)
                    .focused($focused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.none)
                    .privacySensitive()
                    .font(.footnote.monospaced())
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("scan.debugCode")
                Button {
                    let value = text
                    text = ""
                    // The keyboard would cover the outcome shown below.
                    focused = false
                    submit(value)
                } label: {
                    Text(verbatim: "Submit")
                }
                .buttonStyle(CompactButtonStyle())
                .fixedSize()
                .disabled(text.isEmpty)
                .accessibilityIdentifier("scan.debugSubmit")
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(Color.fieldEdge, style: StrokeStyle(lineWidth: 1, dash: [4])))
    }
}
#endif
