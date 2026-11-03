import SwiftUI

/// Asset sheet (handoff `mobile-parcours` §4): status and identity, every
/// reason with its next step, calibration, required access level, cell, then
/// Reserve, enabled only for a fresh `READY` readiness.
struct AssetSheetScreen: View {
    @State private var model: AssetSheetViewModel
    let reservations: ReservationContext?
    @State private var reservationSheet: ReservationSheetViewModel?
    @Environment(\.dismiss) private var dismiss

    init(model: AssetSheetViewModel, reservations: ReservationContext? = nil) {
        _model = State(initialValue: model)
        self.reservations = reservations
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                switch model.display {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .accessibilityLabel(Text("Chargement de l’équipement"))
                case let .failed(failure):
                    FailureNotice(failure: failure, isRetrying: model.isLoading) {
                        Task { await model.load() }
                    }
                case .notFound:
                    notFound
                case let .content(content):
                    let own = ownStatus(content.asset)
                    AssetSheetContent(content: content, mine: own)
                    if let reservations {
                        ReserveSection(content: content, mine: own,
                                       reserve: { reservationSheet = reservations.makeSheet(content.asset) },
                                       showActivity: reservations.showActivity)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await Task { await model.load() }.value }
        .task { await model.load() }
        .sheet(item: $reservationSheet) { sheet in
            ReservationSheetScreen(
                model: sheet,
                onCreated: { reservation in
                    reservationSheet = nil
                    reservations?.reserved(reservation)
                    Task { await model.load() }
                },
                onRefused: { Task { await model.load() } },
                showActivity: {
                    reservationSheet = nil
                    reservations?.showActivity()
                })
        }
    }

    /// The technician's own reservation or loan, as `GET /me/…` last named it.
    private func ownStatus(_ asset: TechnicianAsset) -> AssetStatus? {
        guard let activity = reservations?.activity else { return nil }
        if activity.reservation.value?.asset.id == asset.id { return .reservedForYou }
        if activity.loan.value?.asset.id == asset.id { return .borrowedByYou }
        return nil
    }

    private var notFound: some View {
        VStack(spacing: 14) {
            Image(systemName: "shippingbox")
                .font(.largeTitle)
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
            Text("Cet équipement n’est plus disponible.")
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("asset.notFound")
            Button("Retour à la liste") { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("asset.backToList")
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
        .onAppear {
            AccessibilityNotification.Announcement(String(localized: "Cet équipement n’est plus disponible.")).post()
        }
    }
}

private struct AssetSheetContent: View {
    let content: AssetSheetViewModel.Content
    /// Replaces the asset status: its reasons describe the reservation or
    /// loan of the technician, not a refusal.
    var mine: AssetStatus?

    var body: some View {
        let asset = content.asset
        let status = mine ?? AssetStatus(asset)
        let reasons = mine == nil ? ReasonItem.ordered(asset.readiness.reasons) : []
        VStack(alignment: .leading, spacing: 8) {
            StatusChip(status: status, stale: content.isStale)
            Text(verbatim: asset.model.name)
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("asset.name")
            Text(verbatim: AssetPresentation.identityLine(for: asset))
                .font(.body.monospacedDigit())
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        if content.isStale {
            StaleNote(receivedAt: content.receivedAt)
        }
        if status != .ready, !reasons.isEmpty {
            CatalogCard {
                // « À vérifier » is not a refusal: its reasons have no "blocked" heading.
                if status != .needsChecking {
                    Text("Pourquoi il est bloqué")
                        .font(.headline)
                        .foregroundStyle(Color.brandText)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(reasons, id: \.self) { reason in
                    ReasonRow(symbol: reason.symbol, tone: content.isStale ? .neutral : status.reasonTone,
                              title: reason.title(for: asset), guidance: reason.guidance)
                }
            }
        }
        CatalogCard {
            FactRow(label: String(localized: "Calibration"), value: AssetPresentation.calibration(asset.calibration))
            Divider()
            FactRow(label: String(localized: "Niveau d’accès requis"),
                    value: AssetPresentation.accessLevel(asset.requiredAccessLevel))
            Divider()
            FactRow(label: String(localized: "Cellule"), value: AssetPresentation.compartment(asset.placement))
        }
    }
}

/// Reserve, or the way to the technician's own activity. Only an affordance:
/// the server checks everything again (handoff §4).
private struct ReserveSection: View {
    let content: AssetSheetViewModel.Content
    let mine: AssetStatus?
    let reserve: () -> Void
    let showActivity: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if mine != nil {
                Button("Voir mon activité", action: showActivity)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("asset.viewActivity")
            } else {
                Button("Réserver", action: reserve)
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(reason != nil)
                    .accessibilityIdentifier("asset.reserve")
                if let reason {
                    Text(reason)
                        .font(.subheadline)
                        .foregroundStyle(Color.brandMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("asset.reserveReason")
                }
            }
        }
        .padding(.top, 6)
    }

    /// Why Reserve is disabled; nil when it is offered.
    private var reason: String? {
        if content.isStale { return String(localized: "Réservation possible après actualisation de la fiche.") }
        let asset = content.asset
        if AssetStatus(asset) == .ready { return nil }
        return (ReasonItem.ordered(asset.readiness.reasons).first ?? .unrecognized).reservationRefusal
    }
}

private extension AssetStatus {
    var reasonTone: AssetStatus.Tone { self == .needsChecking ? .unknown : .blocked }
}
