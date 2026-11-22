import SwiftUI

/// « Mon activité » (handoff `mobile-parcours` §6): one state card per active
/// reservation or loan. Prepare checkout follows `CHECKOUT`, Cancel follows
/// `CANCEL` and Return equipment follows `RETURN` of the last fresh read.
/// « Reprendre » is local: it reads the current operation again.
struct ActivityScreen: View {
    let model: ActivityViewModel
    let browseEquipment: () -> Void
    @State private var confirmingCancel = false
    private static let minimumRefresh = Duration.milliseconds(800)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let feedback = model.feedback { FeedbackNote(feedback: feedback) }
                    reservationNotice
                    content
                    loanNotice
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle("Mon activité")
            .refreshable {
                let started = ContinuousClock.now
                await Task { await model.refresh() }.value
                try? await Task.sleep(until: started + Self.minimumRefresh, clock: .continuous)
            }
            .task { await model.loadIfNeeded() }
            .fullScreenCover(item: Binding(get: { model.guided }, set: { _ in })) { guided in
                GuidedOperationScreen(model: guided,
                                      close: { Task { await model.hideOperation() } },
                                      restart: { Task { await model.restartOperation() } })
            }
            .task(id: model.announcement) {
                guard let announcement = model.announcement else { return }
                // Posted once the tab is on screen, so VoiceOver does not drop it.
                try? await Task.sleep(for: .milliseconds(600))
                AccessibilityNotification.Announcement(announcement).post()
                model.announcement = nil
            }
        }
    }

    @ViewBuilder
    private var reservationNotice: some View {
        if let failure = model.reservation.failure {
            FailureNotice(failure: failure, receivedAt: model.reservation.isStale ? model.reservation.receivedAt : nil,
                          isRetrying: model.isLoading, retry: { Task { await model.refresh() } },
                          title: Self.title(failure), identifier: "activity")
        }
    }

    /// The loan section's failure, below the confirmation and the reservation
    /// or its known absence, which a loan read never outranks (#38). When
    /// both reads failed, the notice above already covers the loan.
    @ViewBuilder
    private var loanNotice: some View {
        if model.reservation.failure == nil, let failure = model.loan.failure {
            FailureNotice(failure: failure, receivedAt: model.loan.isStale ? model.loan.receivedAt : nil,
                          isRetrying: model.isLoading, retry: { Task { await model.refresh() } },
                          title: String(localized: "Le prêt en cours n’a pas pu être vérifié."),
                          identifier: "activity.loan")
        }
    }

    @ViewBuilder
    private var content: some View {
        if !model.hasRead {
            SkeletonCard()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Chargement de votre activité"))
                .accessibilityIdentifier("activity.loading")
        }
        if let reservation = model.reservation.value {
            reservationCard(reservation)
        }
        if let loan = model.loan.value {
            LoanCard(model: model, loan: loan, stale: model.loan.isStale)
        }
        if model.isEmpty {
            empty(String(localized: "Aucune réservation ni prêt en cours."))
        } else if model.reservation.isKnown, model.reservation.value == nil, model.reservation.failure == nil,
                  model.loan.value == nil {
            // The loan could not be read: only the reservation is known to be absent.
            empty(String(localized: "Aucune réservation en cours."))
        }
    }

    private func reservationCard(_ reservation: ReservationView) -> some View {
        let stale = model.reservation.isStale
        let inProgress = model.isInProgress(reservation.currentOperationId)
        return CatalogCard {
            if inProgress {
                OperationChip(kind: .checkout)
            } else {
                StatusChip(status: .reservedForYou, stale: stale)
            }
            AssetHeading(asset: reservation.asset)
            Divider()
            FactRow(label: String(localized: "Cellule"), value: AssetPresentation.compartment(reservation.asset.placement))
            Text("À retirer avant \(AegisTime.laboratoryTime(reservation.reservedUntil))")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("activity.reservation.until")
            if inProgress {
                Label("Suivi masqué. L’opération n’est pas annulée.", systemImage: "eye.slash")
                    .font(.subheadline)
                    .foregroundStyle(Color.brandText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("activity.operation.hidden")
            }
            checkoutSection(reservation, stale: stale)
            if model.isCancelling {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Annulation…").foregroundStyle(Color.brandMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("activity.cancelling")
            } else if model.canCancel {
                Button { confirmingCancel = true } label: {
                    Text("Annuler la réservation").frame(minHeight: 44)
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.brandAccent)
                .accessibilityIdentifier("activity.cancel")
            }
            Button("Actualiser") { Task { await model.refresh() } }
                .buttonStyle(CompactButtonStyle())
                .allowsHitTesting(!model.isLoading)
                .accessibilityIdentifier("activity.refresh")
        }
        // A container, so the identifier does not replace its children's.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.reservation")
        .confirmationDialog(
            String(localized: "Annuler la réservation de \(reservation.asset.model.name) ?"),
            isPresented: $confirmingCancel, titleVisibility: .visible
        ) {
            Button("Annuler la réservation", role: .destructive) { Task { await model.cancel() } }
                .accessibilityIdentifier("activity.cancel.confirm")
            Button("Garder la réservation", role: .cancel) {}
        }
    }

    /// §6: the notice that explains the button, then the button. Prepare
    /// follows `CHECKOUT`; « Reprendre » appears whenever an operation may be
    /// under way, since it only reads.
    @ViewBuilder
    private func checkoutSection(_ reservation: ReservationView, stale: Bool) -> some View {
        let listed = !stale && reservation.actions.contains(.checkout)
        let resumable = model.isResumable(reservation.currentOperationId)
        let explanation = String(localized: "Vous pouvez faire une nouvelle tentative. Aucune porte ne s’ouvre sans le code du casier.")
        if listed, let finished = model.finishedAttempt {
            let step = OperationStep(finished, kind: .checkout, compartment: GuidedOperation.Context(reservation.asset).compartment,
                                     assetName: reservation.asset.model.name)
            OperationNotice(title: step.title, detail: explanation, symbol: "arrow.counterclockwise")
                .accessibilityIdentifier("activity.checkout.notice")
        } else if listed, let attempt = model.offlineAttemptAt {
            OperationNotice(title: String(localized: "Essai de \(AegisTime.laboratoryTime(attempt)) : le casier était hors ligne."),
                            detail: explanation, symbol: "wifi.exclamationmark")
                .accessibilityIdentifier("activity.checkout.notice")
        } else if !stale, !listed, !resumable, reservation.status == .known(.active) {
            OperationNotice(title: String(localized: "Retrait indisponible pour le moment. Actualisez pour vérifier à nouveau."),
                            symbol: "lock.fill")
                .accessibilityIdentifier("activity.checkout.notice")
        }
        if resumable, let id = reservation.currentOperationId {
            Button("Reprendre") { model.resumeOperation(id) }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("activity.resume")
        } else if listed {
            Button { Task { await model.prepareCheckout() } } label: {
                HStack(spacing: 8) {
                    if model.preparing == .checkout { ProgressView().tint(.white) }
                    if model.finishedAttempt != nil || model.offlineAttemptAt != nil {
                        Text("Nouvelle tentative de retrait")
                    } else {
                        Text("Préparer le retrait")
                    }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canPrepareCheckout)
            .accessibilityIdentifier("activity.checkout")
        } else {
            Button {} label: { Label("Préparer le retrait", systemImage: "lock.fill") }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(true)
                .accessibilityIdentifier("activity.checkout")
        }
    }

    private func empty(_ message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "checklist")
                .font(.largeTitle)
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
            Text(message)
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("activity.empty")
            Button("Voir les équipements", action: browseEquipment)
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("activity.browse")
        }
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity)
    }

    static func title(_ failure: CatalogFailure) -> String {
        switch failure {
        case .unreachable: String(localized: "Connexion au service impossible. Vérifiez le réseau.")
        case .service: String(localized: "Le service n’a pas pu charger votre activité.")
        case .forbidden: String(localized: "Votre compte n’a pas accès à cette activité.")
        }
    }
}

private struct AssetHeading: View {
    let asset: AssetSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: asset.model.name)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: AssetPresentation.identityLine(code: asset.assetCode, model: asset.model))
                .font(.body.monospacedDigit())
                .foregroundStyle(Color.brandMuted)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// An open loan (handoff §6): Return equipment follows `RETURN`; « Reprendre »
/// appears whenever its return may be under way, since it only reads.
private struct LoanCard: View {
    let model: ActivityViewModel
    let loan: LoanView
    let stale: Bool

    var body: some View {
        let inProgress = model.isInProgress(loan.currentOperationId)
        CatalogCard {
            if inProgress {
                OperationChip(kind: .return)
            } else {
                StatusChip(status: .borrowedByYou, stale: stale)
            }
            AssetHeading(asset: loan.asset)
            Divider()
            FactRow(label: String(localized: "Cellule"), value: AssetPresentation.compartment(loan.asset.placement))
            Group {
                if loan.status == .known(.returnPending) {
                    Text("Retour en attente de vérification.")
                } else if loan.overdue {
                    Label {
                        Text("En retard depuis \(AegisTime.laboratoryTime(loan.dueAt)) — rapportez l’équipement.")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.blockedIcon)
                    }
                } else {
                    Text("Retour prévu à \(AegisTime.laboratoryTime(loan.dueAt))")
                }
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.brandText)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("activity.loan.due")
            if inProgress {
                Label("Suivi masqué. L’opération n’est pas annulée.", systemImage: "eye.slash")
                    .font(.subheadline)
                    .foregroundStyle(Color.brandText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("activity.loan.operation.hidden")
            }
            returnSection
            Button("Actualiser") { Task { await model.refresh() } }
                .buttonStyle(CompactButtonStyle())
                .allowsHitTesting(!model.isLoading)
                .accessibilityIdentifier("activity.loan.refresh")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.loan")
    }

    /// §6 « Prêt actif », « Retour indisponible » and « Retour en attente »:
    /// the notice that explains the button, then the button. A
    /// `RETURN_PENDING` loan without an operation offers no business action.
    @ViewBuilder
    private var returnSection: some View {
        let listed = !stale && loan.actions.contains(.return)
        let resumable = model.isResumable(loan.currentOperationId)
        let active = loan.status == .known(.active)
        if !stale, !listed, !resumable, active {
            OperationNotice(title: String(localized: "Retour indisponible pour le moment. Actualisez pour vérifier à nouveau."),
                            symbol: "lock.fill")
                .accessibilityIdentifier("activity.return.notice")
        }
        if resumable, let id = loan.currentOperationId {
            Button("Reprendre") { model.resumeOperation(id) }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("activity.loan.resume")
        } else if listed {
            Button { Task { await model.prepareReturn() } } label: {
                HStack(spacing: 8) {
                    if model.preparing == .return { ProgressView().tint(.white) }
                    Text("Retourner l’équipement")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canPrepareReturn)
            .accessibilityIdentifier("activity.return")
        } else if active {
            Button {} label: { Label("Retourner l’équipement", systemImage: "lock.fill") }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(true)
                .accessibilityIdentifier("activity.return")
        }
    }
}

private struct FeedbackNote: View {
    let feedback: ActivityViewModel.Feedback

    var body: some View {
        let (text, isError) = content
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(isError ? Color.errorText : Color.brandText)
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Color.errorFill : Color.brandField,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activity.feedback")
    }

    private var content: (String, Bool) {
        switch feedback {
        case let .created(reservation): (ActivityViewModel.confirmation(reservation), false)
        case .cancelled: (String(localized: "Réservation annulée."), false)
        case let .cancelFailed(problem): (problem.message, true)
        case let .preparationFailed(problem, compartment): (problem.message(compartment: compartment), true)
        }
    }
}

/// « Retrait en cours » / « Retour en cours »: the progress tone, symbol and
/// text (handoff §2, §6).
private struct OperationChip: View {
    let kind: OperationStep.Kind

    var body: some View {
        Label {
            kind == .checkout ? Text("Retrait en cours") : Text("Retour en cours")
        } icon: {
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(Color.statusProgressText)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Color.statusProgressText)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.statusProgressFill, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activity.operation.status")
    }
}
