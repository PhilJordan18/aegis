import SwiftUI

struct HistoryRoute: Hashable {}

private enum HistoryItemRoute: Hashable {
    case reservation(UUID)
    case loan(UUID)
}

/// « Historique » (#233): the technician's own reservations and loans, read
/// only. Nothing here acts on a record; Mon activité keeps the actions.
struct HistoryScreen: View {
    @State private var model: HistoryViewModel

    init(make: @MainActor () -> HistoryViewModel) {
        _model = State(initialValue: make())
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                Picker("Afficher", selection: $model.kind) {
                    Text("Réservations").tag(HistoryViewModel.Kind.reservations)
                    Text("Prêts").tag(HistoryViewModel.Kind.loans)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("history.kind")
                switch model.kind {
                case .reservations:
                    HistoryListContent(list: model.reservations, kind: .reservations) { reservation in
                        NavigationLink(value: HistoryItemRoute.reservation(reservation.id)) {
                            HistoryRow(status: HistoryStatus.name(reservation.status),
                                       asset: reservation.asset,
                                       date: String(localized: "Réservée le \(AegisTime.laboratoryDateTime(reservation.createdAt))"))
                        }
                        .buttonStyle(.plain)
                    }
                case .loans:
                    HistoryListContent(list: model.loans, kind: .loans) { loan in
                        NavigationLink(value: HistoryItemRoute.loan(loan.id)) {
                            HistoryRow(status: HistoryStatus.name(loan.status), asset: loan.asset,
                                       date: String(localized: "Emprunté le \(AegisTime.laboratoryDateTime(loan.checkedOutAt))"))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle("Historique")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await Task { await model.reload() }.value }
        .task(id: model.kind) { await model.loadIfNeeded() }
        .navigationDestination(for: HistoryItemRoute.self) { route in
            switch route {
            case let .reservation(id):
                if let reservation = model.reservations.item(id) {
                    ReservationRecordScreen(reservation: reservation, receivedAt: model.reservations.receivedAt)
                }
            case let .loan(id):
                if let loan = model.loans.item(id) {
                    LoanRecordScreen(loan: loan, receivedAt: model.loans.receivedAt)
                }
            }
        }
    }
}

private struct HistoryListContent<Item: Identifiable & Equatable & Decodable & Sendable, Row: View>: View where Item.ID == UUID {
    let list: HistoryList<Item>
    let kind: HistoryViewModel.Kind
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        switch list.display {
        case .loading:
            VStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Chargement de l’historique"))
            .accessibilityIdentifier("history.loading")
        case let .failed(failure):
            FailureNotice(failure: failure, isRetrying: list.isLoading,
                          retry: { Task { await list.reload() } },
                          title: HistoryStatus.title(failure), identifier: "history")
        case let .content(items, receivedAt, stale):
            if let stale {
                FailureNotice(failure: stale, receivedAt: receivedAt, isRetrying: list.isLoading,
                              retry: { Task { await list.reload() } },
                              title: HistoryStatus.title(stale), identifier: "history")
            }
            if items.isEmpty {
                empty
            } else {
                ForEach(items) { item in
                    row(item)
                        .onAppear {
                            if item.id == items.last?.id { Task { await list.loadMore() } }
                        }
                }
                footer
            }
        }
    }

    private var empty: some View {
        let message = kind == .reservations
            ? String(localized: "Aucune réservation dans votre historique.")
            : String(localized: "Aucun prêt dans votre historique.")
        return VStack(spacing: 14) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.largeTitle)
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
            Text(message)
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("history.empty")
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var footer: some View {
        if list.isLoadingMore {
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityLabel(Text("Chargement de l’historique"))
                .accessibilityIdentifier("history.loadingMore")
        } else if let failure = list.loadMoreFailure {
            FailureNotice(failure: failure, retry: { Task { await list.loadMore() } },
                          title: HistoryStatus.title(failure), identifier: "history.more")
        }
    }
}

/// One record: state, equipment, then the date it began.
private struct HistoryRow: View {
    let status: String
    let asset: AssetSummary
    let date: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(status)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandText)
                // Names and codes entered by an administrator are never translated.
                Text(verbatim: asset.model.name)
                    .font(.headline)
                    .foregroundStyle(Color.brandText)
                Text(verbatim: AssetPresentation.identityLine(code: asset.assetCode, model: asset.model))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color.brandMuted)
                Text(date)
                    .font(.subheadline)
                    .foregroundStyle(Color.brandMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([status, asset.model.name, asset.assetCode, date].joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("history.row.\(asset.assetCode)")
    }
}

/// A reservation as the list read it.
private struct ReservationRecordScreen: View {
    let reservation: ReservationView
    let receivedAt: Date?

    var body: some View {
        RecordScreen(status: HistoryStatus.name(reservation.status), asset: reservation.asset,
                     reference: Reference(label: String(localized: "Référence de la réservation"), id: reservation.id),
                     receivedAt: receivedAt) {
            FactRow(label: String(localized: "Réservée le"),
                    value: AegisTime.laboratoryDateTime(reservation.createdAt))
            FactRow(label: String(localized: "Début"), value: AegisTime.laboratoryDateTime(reservation.reservedFrom))
            FactRow(label: String(localized: "Fin"), value: AegisTime.laboratoryDateTime(reservation.reservedUntil))
            if let fulfilledAt = reservation.fulfilledAt {
                FactRow(label: String(localized: "Retirée le"), value: AegisTime.laboratoryDateTime(fulfilledAt))
            }
            if let cancelledAt = reservation.cancelledAt {
                FactRow(label: String(localized: "Annulée le"), value: AegisTime.laboratoryDateTime(cancelledAt))
            }
            if let expiredAt = reservation.expiredAt {
                FactRow(label: String(localized: "Expirée le"), value: AegisTime.laboratoryDateTime(expiredAt))
            }
        }
    }
}

/// A loan as the list read it. `overdue` is the server's.
private struct LoanRecordScreen: View {
    let loan: LoanView
    let receivedAt: Date?

    var body: some View {
        RecordScreen(status: HistoryStatus.name(loan.status), asset: loan.asset,
                     reference: Reference(label: String(localized: "Référence du prêt"), id: loan.id),
                     receivedAt: receivedAt) {
            FactRow(label: String(localized: "Emprunté le"), value: AegisTime.laboratoryDateTime(loan.checkedOutAt))
            FactRow(label: String(localized: "Échéance"), value: AegisTime.laboratoryDateTime(loan.dueAt))
            if let returnRequestedAt = loan.returnRequestedAt {
                FactRow(label: String(localized: "Retour demandé le"),
                        value: AegisTime.laboratoryDateTime(returnRequestedAt))
            }
            if let returnedAt = loan.returnedAt {
                FactRow(label: String(localized: "Rendu le"), value: AegisTime.laboratoryDateTime(returnedAt))
            }
            if loan.overdue {
                Label("En retard", systemImage: "clock.badge.exclamationmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandText)
                    .accessibilityIdentifier("history.record.overdue")
            }
        }
    }
}

/// The record's id, the one a manager looks up under §17
/// (`/admin/reservations/{id}` or `/admin/loans/{id}`).
private struct Reference {
    let label: String
    let id: UUID

    /// As the service writes it, so it can be compared character by character.
    var text: String { id.uuidString.lowercased() }
}

private struct RecordScreen<Facts: View>: View {
    let status: String
    let asset: AssetSummary
    let reference: Reference
    let receivedAt: Date?
    @ViewBuilder let facts: Facts

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CatalogCard {
                    Text(status)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.brandText)
                        .accessibilityIdentifier("history.record.status")
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: asset.model.name)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.brandText)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("history.record.asset")
                        Text(verbatim: AssetPresentation.identityLine(code: asset.assetCode, model: asset.model))
                            .font(.body.monospacedDigit())
                            .foregroundStyle(Color.brandMuted)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Divider()
                    facts
                    // §29: the placement is the asset's current one.
                    FactRow(label: String(localized: "Cellule actuelle"),
                            value: AssetPresentation.compartment(asset.placement))
                    Divider()
                    // Always stacked: 36 characters never fit beside a label.
                    VStack(alignment: .leading, spacing: 4) {
                        Text(reference.label)
                            .foregroundStyle(Color.brandText)
                        Text(verbatim: reference.text)
                            .font(.body.monospaced())
                            .foregroundStyle(Color.brandMuted)
                            .textSelection(.enabled)
                        Text("À communiquer à un gestionnaire pour retrouver ce dossier.")
                            .font(.footnote)
                            .foregroundStyle(Color.brandMuted)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("history.record.reference")
                }
                Text("Consultation seulement. Les actions restent dans Mon activité.")
                    .font(.footnote)
                    .foregroundStyle(Color.brandMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("history.record.readOnly")
                if let receivedAt {
                    Text("Historique lu à \(AegisTime.deviceTime(receivedAt)).")
                        .font(.footnote)
                        .foregroundStyle(Color.brandMuted)
                        .accessibilityIdentifier("history.record.readAt")
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle(Text(verbatim: asset.model.name))
        .navigationBarTitleDisplayMode(.inline)
    }
}

enum HistoryStatus {
    static func name(_ status: ContractValue<ReservationStatus>) -> String {
        switch status.known {
        case .active: String(localized: "Réservation en cours")
        case .fulfilled: String(localized: "Retirée")
        case .cancelled: String(localized: "Annulée")
        case .expired: String(localized: "Expirée")
        case nil: String(localized: "État non reconnu")
        }
    }

    static func name(_ status: ContractValue<LoanStatus>) -> String {
        switch status.known {
        case .active: String(localized: "Prêt en cours")
        case .returnPending: String(localized: "Retour en cours")
        case .completed: String(localized: "Rendu")
        case nil: String(localized: "État non reconnu")
        }
    }

    static func title(_ failure: CatalogFailure) -> String {
        switch failure {
        case .unreachable: String(localized: "Connexion au service impossible. Vérifiez le réseau.")
        case .service: String(localized: "Le service n’a pas pu charger votre historique.")
        case .forbidden: String(localized: "Votre compte n’a pas accès à cet historique.")
        }
    }
}
