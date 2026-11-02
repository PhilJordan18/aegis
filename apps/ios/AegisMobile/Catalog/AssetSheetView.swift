import SwiftUI

/// Asset sheet (handoff `mobile-parcours` §4): status and identity, every
/// reason with its next step, calibration, required access level, cell.
/// Reservation belongs to RES-01 (#37): no Reserve button is shown yet.
struct AssetSheetScreen: View {
    @State private var model: AssetSheetViewModel
    @Environment(\.dismiss) private var dismiss

    init(model: AssetSheetViewModel) {
        _model = State(initialValue: model)
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
                    AssetSheetContent(content: content)
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

    var body: some View {
        let asset = content.asset
        let status = AssetStatus(asset)
        let reasons = ReasonItem.ordered(asset.readiness.reasons)
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

private extension AssetStatus {
    var reasonTone: AssetStatus.Tone { self == .needsChecking ? .unknown : .blocked }
}
