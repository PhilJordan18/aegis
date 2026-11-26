import SwiftUI

/// The guided checkout or return (handoff `mobile-parcours` §7.3): cell in very large
/// type, the state received and its single instruction, the time left, the
/// six phases, then the action of the state. « Fermer » hides the tracking
/// without cancelling; no button ends or confirms an operation.
struct GuidedOperationScreen: View {
    let model: GuidedOperation
    let close: () -> Void
    let restart: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var cellSize: CGFloat = 64

    var body: some View {
        let step = model.step
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if typeSize.isAccessibilitySize {
                        cell
                        StepHeader(step: step)
                        interruption
                        countdown(step)
                        identity
                    } else {
                        interruption
                        // Side by side when both fit; otherwise the cell above
                        // the asset, so neither is ever truncated.
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                cell
                                identity
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                cell
                                identity
                            }
                        }
                        StepHeader(step: step)
                        countdown(step)
                    }
                    PhaseList(step: step, interrupted: isInterrupted)
                    actions(step)
                    if step.ending == nil {
                        Text("Fermer masque ce suivi sans annuler l’opération. Reprenez-le depuis Mon activité.")
                            .font(.footnote)
                            .foregroundStyle(Color.brandMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("operation.closeNote")
                    }
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle(model.kind == .checkout ? Text("Retrait guidé") : Text("Retour guidé"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer", action: close)
                        .accessibilityHint(step.ending == nil ? Text("Masque le suivi sans annuler l’opération.") : Text(verbatim: ""))
                        .accessibilityIdentifier("operation.close")
                }
            }
            .sheet(isPresented: Binding(get: { model.isScanPresented }, set: { model.isScanPresented = $0 })) {
                ScanSheet(model: model)
            }
        }
        // Text-level accent: #8CAEFF on the dark background, not the fill accent.
        .tint(Color.brandAccent)
        .onChange(of: model.operation) { _, _ in model.operationChanged() }
        .onChange(of: step.title) { _, _ in
            // Each change of step is announced once, title then instruction.
            let spoken = [step.title, step.instruction].compactMap(\.self).joined(separator: " ")
            AccessibilityNotification.Announcement(spoken).post()
        }
        .onChange(of: model.follower.interruption) { _, interruption in
            // §15.4: a 404 means the activity must be read again, never recreated.
            if interruption == .notFound { close() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.resumeForeground() } else if phase == .background { model.suspend() }
        }
    }

    private var readFailure: CatalogFailure? {
        if case let .readFailing(failure) = model.follower.interruption { failure } else { nil }
    }

    private var isInterrupted: Bool { readFailure != nil }

    /// The network is named only when the service could not be reached; an
    /// answer in error is the service's, not the user's connection (#247).
    @ViewBuilder
    private var interruption: some View {
        if let readFailure {
            Group {
                if readFailure == .unreachable {
                    OperationNotice(title: String(localized: "Suivi interrompu : connexion perdue"),
                                    detail: String(localized: "Ce n’est ni une annulation ni une confirmation. L’état sera relu dès le retour du réseau."),
                                    symbol: "wifi.slash")
                } else {
                    OperationNotice(title: String(localized: "Suivi interrompu : erreur du service"),
                                    detail: String(localized: "Ce n’est ni une annulation ni une confirmation. Le service a répondu par une erreur ; l’état sera relu automatiquement."),
                                    symbol: "exclamationmark.triangle")
                }
            }
            .accessibilityIdentifier("operation.interrupted")
        }
    }

    private var cell: some View {
        Text(verbatim: model.context.compartment)
            .font(.system(size: cellSize, weight: .bold, design: .rounded))
            .foregroundStyle(Color.brandAccent)
            // A cell code is a few characters: never truncated, never wrapped.
            .fixedSize()
            .accessibilityLabel(Text("Cellule \(model.context.compartment)"))
            .accessibilityIdentifier("operation.cell")
    }

    private var identity: some View {
        Text(verbatim: "\(model.context.assetName) · \(model.context.assetCode)")
            .font(.headline)
            .foregroundStyle(Color.brandText)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func countdown(_ step: OperationStep) -> some View {
        if let deadline = step.deadline {
            OperationCountdown(deadline: deadline, interrupted: isInterrupted)
        } else if step.canScan || step.awaitsDisplay, let expires = model.operation?.localProofExpiresAt {
            ProofCountdown(expiresAt: expires)
        }
    }

    @ViewBuilder
    private func actions(_ step: OperationStep) -> some View {
        switch step.ending {
        case nil:
            if step.canScan || step.awaitsDisplay {
                Button("Scanner le code") { model.isScanPresented = true }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!step.canScan)
                    .accessibilityIdentifier("operation.scan")
            }
        case .expired:
            // Short visible label, condensed at accessibility sizes like the
            // title; VoiceOver reads the full action.
            Button(action: restart) {
                Text("Recommencer")
                    .fontWidth(typeSize.isAccessibilitySize ? .condensed : .standard)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityLabel(model.kind == .checkout ? Text("Recommencer le retrait") : Text("Recommencer le retour"))
            .accessibilityHint(model.kind == .checkout ? Text("Relance la préparation du retrait.")
                                                       : Text("Relance la préparation du retour."))
            .accessibilityIdentifier("operation.restart")
        case .confirmed:
            Button("Voir mon activité", action: close)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("operation.done")
        case .failed, .anomaly, .unrecognized:
            Button("Voir mon activité", action: close)
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("operation.done")
        }
    }
}

private struct StepHeader: View {
    let step: OperationStep

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // At accessibility sizes the condensed width keeps long single
            // words such as « Déverrouillage » whole, without capping the size.
            Text(step.title)
                .font(.title.weight(.semibold).width(typeSize.isAccessibilitySize ? .condensed : .standard))
                .foregroundStyle(step.isFailure ? Color.errorText : Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("operation.title")
            if let instruction = step.instruction {
                Text(instruction)
                    .font(.body)
                    .foregroundStyle(Color.brandText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("operation.instruction")
            }
        }
    }
}

/// Counts down to the received `expiresAt` on the device clock. It never
/// decides an outcome: at zero it waits for the service's own state.
private struct OperationCountdown: View {
    let deadline: Date
    let interrupted: Bool

    /// The seconds last drawn, for the single accessibility element below.
    @State private var spokenSeconds: Int?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int(deadline.timeIntervalSince(context.date).rounded(.up)))
            VStack(alignment: .leading, spacing: 4) {
                // The operation's time limit, not how long the door stays
                // unlocked: it runs on through the physical steps (#247).
                Text("Délai de l’opération")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandMuted)
                Label {
                    Text(verbatim: Self.clock(seconds))
                        .font(.title2.monospacedDigit().weight(.semibold))
                } icon: {
                    Image(systemName: "timer")
                }
                .foregroundStyle(Color.brandText)
                if seconds == 0 {
                    Text("Échéance atteinte : en attente de confirmation du service.")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.brandText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(deadlineText)
                    .font(.footnote)
                    .foregroundStyle(Color.brandMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .onChange(of: seconds, initial: true) { old, value in
                spokenSeconds = value
                // Automatic announcements only at 30 s and 10 s (§7.3).
                if old != value, value == 30 || value == 10 {
                    AccessibilityNotification.Announcement(Self.spoken(value)).post()
                }
            }
        }
        // Outside the timeline: one element whose value changes, never a
        // second element exposing the ticking digits.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Délai de l’opération"))
        .accessibilityValue(spokenValue)
        .accessibilityHint(Text(deadlineText))
        .accessibilityIdentifier("operation.countdown")
    }

    private var spokenValue: Text {
        guard let seconds = spokenSeconds else { return Text(verbatim: "") }
        return seconds == 0 ? Text("Échéance atteinte : en attente de confirmation du service.")
            : Text(Self.spoken(seconds))
    }

    private var deadlineText: String {
        let time = AegisTime.laboratoryTime(deadline)
        return interrupted ? String(localized: "Échéance reçue : \(time)") : String(localized: "Échéance : \(time)")
    }

    static func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    static func spoken(_ seconds: Int) -> String {
        Duration.seconds(seconds).formatted(.units(allowed: [.minutes, .seconds], width: .wide))
    }
}

/// « Expire dans 0:47 », from `localProofExpiresAt`.
struct ProofCountdown: View {
    let expiresAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int(expiresAt.timeIntervalSince(context.date).rounded(.up)))
            Label {
                Text("Expire dans \(OperationCountdown.clock(seconds))")
            } icon: {
                Image(systemName: "timer")
            }
            .font(.title3.monospacedDigit().weight(.semibold))
            .foregroundStyle(Color.brandText)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Expire dans \(OperationCountdown.spoken(seconds))"))
            .accessibilityIdentifier("operation.proofCountdown")
        }
    }
}

private struct PhaseList: View {
    let step: OperationStep
    let interrupted: Bool

    var body: some View {
        CatalogCard {
            ForEach(Array(OperationStep.phaseNames.enumerated()), id: \.offset) { index, name in
                let phase = index + 1
                HStack(spacing: 12) {
                    Image(systemName: symbol(phase))
                        .foregroundStyle(color(phase))
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    Text(name)
                        .font(phase == step.phase ? .body.weight(.semibold) : .body)
                        .foregroundStyle(phase <= step.phase ? Color.brandText : Color.brandMuted)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(value(phase))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("operation.phases")
    }

    private func value(_ phase: Int) -> Text {
        if phase < step.phase { return Text("terminé") }
        if phase == step.phase {
            if step.isFailure { return Text(step.title) }
            return interrupted ? Text("dernier état reçu, suivi interrompu") : Text("en cours")
        }
        return Text("à venir")
    }

    private func symbol(_ phase: Int) -> String {
        if phase < step.phase { return "checkmark.circle.fill" }
        if phase == step.phase {
            if step.isFailure { return "exclamationmark.octagon.fill" }
            return interrupted ? "pause.circle" : "circle.dotted.circle"
        }
        return "circle"
    }

    private func color(_ phase: Int) -> Color {
        if phase < step.phase { return .readyIcon }
        if phase == step.phase {
            if step.isFailure { return .blockedIcon }
            return interrupted ? .unknownIcon : .statusProgressText
        }
        return .brandMuted
    }
}

/// Amber notice of the guided operation: the symbol above the text at
/// accessibility sizes, so the text keeps the full width.
struct OperationNotice: View {
    let title: String
    var detail: String?
    let symbol: String

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            Image(systemName: symbol)
                .foregroundStyle(Color.unknownIcon)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                if let detail { Text(detail).font(.subheadline) }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Color.statusUnknownText)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.statusUnknownFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
