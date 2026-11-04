import SwiftUI

/// What the asset sheet needs to offer a reservation and to point at
/// « Mon activité ». Built by `SignedInView`.
@MainActor
struct ReservationContext {
    let activity: ActivityViewModel
    let makeSheet: (TechnicianAsset) -> ReservationSheetViewModel
    /// The reservation was created: the sheet is closed, the activity opened.
    let reserved: (ReservationView) -> Void
    let showActivity: () -> Void
}

extension ReservationSheetViewModel: Identifiable {}

/// Reservation sheet (handoff `mobile-parcours` §5): equipment and cell →
/// « Réserver jusqu'à » → closing time → consequences of the time → locker
/// zone → the separate "no door opens" reminder → Confirm, pinned at the
/// bottom so it stays reachable at the largest text sizes.
struct ReservationSheetScreen: View {
    @Bindable var model: ReservationSheetViewModel
    let onCreated: (ReservationView) -> Void
    let onRefused: () -> Void
    let showActivity: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    equipment
                    timeCard
                    Label("La réservation n’ouvre aucune porte.", systemImage: "lock")
                        .font(.subheadline)
                        .foregroundStyle(Color.brandText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("reservation.noDoor")
                    if case let .failed(problem) = model.phase {
                        outcome(problem)
                    }
                }
                .padding(20)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandTop.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { confirmBar }
            .navigationTitle("Réserver")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.brandAccent)
                        .disabled(model.isSending)
                        .accessibilityIdentifier("reservation.close")
                }
            }
        }
        .interactiveDismissDisabled(model.isSending)
        .task { await model.loadHours() }
        .onChange(of: model.phase) { _, phase in
            switch phase {
            case let .created(reservation):
                onCreated(reservation)
            case let .failed(problem):
                AccessibilityNotification.Announcement(problem.message).post()
                if case .refused = problem { onRefused() }
            case .editing, .sending:
                break
            }
        }
    }

    private var equipment: some View {
        CatalogCard {
            Text(verbatim: model.asset.model.name)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: AssetPresentation.identityLine(for: model.asset))
                .font(.body.monospacedDigit())
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            FactRow(label: String(localized: "Cellule"), value: AssetPresentation.compartment(model.asset.placement))
        }
    }

    private var timeCard: some View {
        CatalogCard {
            Text("Réserver jusqu’à")
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .accessibilityAddTraits(.isHeader)
            if model.hours == .loading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Lecture des heures du casier…").foregroundStyle(Color.brandMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("reservation.hoursLoading")
            } else if !model.choices.isEmpty {
                Picker(selection: $model.reservedUntil) {
                    ForEach(model.choices, id: \.self) { choice in
                        Text(verbatim: AegisTime.laboratoryDayTime(choice, zone: model.zone)).tag(Optional(choice))
                    }
                } label: {
                    Text("Réserver jusqu’à")
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(Color.brandAccent)
                .disabled(model.isSending)
                .frame(minHeight: 44)
                .accessibilityIdentifier("reservation.until")
            }
            if let hoursNote {
                Text(hoursNote)
                    .font(.subheadline)
                    .foregroundStyle(Color.brandText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("reservation.hours")
            }
            Text("Retirez l’équipement avant cette heure. Elle sera aussi l’heure de retour prévue.")
                .font(.subheadline)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text("Heures du casier : \(AegisTime.zoneName(model.zone)).")
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var hoursNote: String? {
        switch model.hours {
        case .loading:
            return nil
        case let .open(closesAt?):
            return String(localized: "Fermeture du casier : \(AegisTime.laboratoryDayTime(closesAt, zone: model.zone)).")
        case .open(nil):
            return model.choices.isEmpty ? String(localized: "Aucune heure disponible aujourd’hui.") : nil
        case let .closed(nextOpensAt?):
            return String(localized: "Le casier est fermé. Réouverture à \(AegisTime.laboratoryDayTime(nextOpensAt, zone: model.zone)).")
        case .closed(nil):
            return String(localized: "Le casier est fermé. Aucun horaire d’ouverture.")
        case .unavailable:
            return model.choices.isEmpty
                ? String(localized: "Aucune heure disponible aujourd’hui.")
                : String(localized: "Heures d’ouverture indisponibles. Le service vérifiera l’heure choisie.")
        }
    }

    private func outcome(_ problem: ReservationProblem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(problem.message).font(.subheadline.weight(.semibold))
                    if let traceId = problem.traceId {
                        Text("Identifiant de suivi : \(traceId)").font(.footnote)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: problem == .unreachable ? "wifi.slash" : "exclamationmark.circle.fill")
            }
            .foregroundStyle(Color.errorText)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("reservation.problem")
            if problem.keepsKey {
                // The same intent: `confirm()` reuses its key.
                Button("Réessayer") { Task { await model.confirm() } }
                    .buttonStyle(CompactButtonStyle())
                    .accessibilityIdentifier("reservation.retry")
            } else if problem == .refused(.userHasReservation) {
                Button("Voir mon activité", action: showActivity)
                    .buttonStyle(CompactButtonStyle())
                    .accessibilityIdentifier("reservation.viewActivity")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var confirmBar: some View {
        Button {
            Task { await model.confirm() }
        } label: {
            HStack(spacing: 10) {
                if model.isSending { ProgressView().tint(Color.brandMuted) }
                Text(model.isSending ? String(localized: "Réservation…") : String(localized: "Confirmer la réservation"))
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!model.canConfirm)
        .accessibilityIdentifier("reservation.confirm")
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
        .background(Color.brandTop.ignoresSafeArea())
    }
}
