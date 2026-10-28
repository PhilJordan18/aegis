import SwiftUI

struct AssetRoute: Hashable {
    let id: UUID
}

/// Équipements tab (handoff `mobile-parcours` §3): search, readiness filters,
/// cards, evaluation footer, pull to refresh. The asset sheet is pushed on the
/// same native stack.
struct CatalogScreen: View {
    @Bindable var model: CatalogViewModel
    let makeSheet: (UUID) -> AssetSheetViewModel
    private static let minimumRefresh = Duration.milliseconds(800)

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    FilterBar(selection: model.filter) { model.select($0) }
                    content
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle("Équipements")
            .searchable(text: $model.searchText, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text("Code ou modèle"))
            .onSubmit(of: .search) { model.submitSearch() }
            .onChange(of: model.searchText) { model.searchTextChanged() }
            .refreshable {
                let started = ContinuousClock.now
                // An unstructured task: the refresh must not be cancelled by
                // the list updating under the indicator.
                await Task { await model.reload() }.value
                // An instant answer (offline) ending the refresh during the
                // pull's own bounce left the list offset on iOS 26.
                try? await Task.sleep(until: started + Self.minimumRefresh, clock: .continuous)
            }
            .task(id: model.criteria) { await model.loadIfNeeded() }
            .navigationDestination(for: AssetRoute.self) { route in
                AssetSheetScreen(model: makeSheet(route.id))
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.display {
        case .loading:
            VStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Chargement des équipements"))
            .accessibilityIdentifier("catalog.loading")
        case let .failed(failure):
            FailureNotice(failure: failure, isRetrying: model.isLoading) {
                Task { await model.reload() }
            }
        case let .content(snapshot):
            if let failure = snapshot.refreshFailure {
                FailureNotice(failure: failure, receivedAt: snapshot.receivedAt, isRetrying: model.isLoading) {
                    Task { await model.reload() }
                }
            }
            if snapshot.items.isEmpty {
                EmptyCatalog(filtered: snapshot.criteria.isFiltered, clear: model.clearCriteria)
            } else {
                ForEach(snapshot.items) { asset in
                    NavigationLink(value: AssetRoute(id: asset.id)) {
                        AssetCardView(asset: asset, stale: snapshot.isStale)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if asset.id == snapshot.items.last?.id { Task { await model.loadMore() } }
                    }
                }
                footer(snapshot)
            }
        }
    }

    @ViewBuilder
    private func footer(_ snapshot: CatalogSnapshot) -> some View {
        if model.isLoadingMore {
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityLabel(Text("Chargement des équipements"))
        } else if let failure = model.loadMoreFailure {
            FailureNotice(failure: failure) { Task { await model.loadMore() } }
        }
        // A stale list has no current evaluation to state (handoff §3).
        if !snapshot.isStale, let evaluatedAt = AssetPresentation.oldestEvaluation(snapshot.items) {
            Text("État évalué à \(AegisTime.laboratoryTime(evaluatedAt)), heure du casier.")
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityIdentifier("catalog.footer")
        }
    }
}

/// Chips of at least 44 pt; at accessibility sizes a native menu keeps every
/// filter one tap away (handoff §2).
struct FilterBar: View {
    let selection: ReadinessFilter
    let select: (ReadinessFilter) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            Menu {
                ForEach(ReadinessFilter.allCases, id: \.self) { filter in
                    Button { select(filter) } label: {
                        if selection == filter {
                            Label(Self.name(filter), systemImage: "checkmark")
                        } else {
                            Text(Self.name(filter))
                        }
                    }
                    .accessibilityAddTraits(selection == filter ? .isSelected : [])
                }
            } label: {
                Label {
                    // Wraps instead of truncating "Filtre : À vérifier" at AX5.
                    Text("Filtre : \(Self.name(selection))")
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.brandAccent)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .accessibilityIdentifier("catalog.filterMenu")
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ReadinessFilter.allCases, id: \.self) { filter in
                        Button { select(filter) } label: {
                            FilterChip(title: Self.name(filter), symbol: Self.symbol(filter),
                                       selected: selection == filter)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selection == filter ? .isSelected : [])
                        .accessibilityIdentifier("catalog.filter.\(filter.rawValue)")
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    static func name(_ filter: ReadinessFilter) -> String {
        switch filter {
        case .all: String(localized: "Tous")
        case .ready: String(localized: "Prêt")
        case .blocked: String(localized: "Bloqué")
        case .needsChecking: String(localized: "À vérifier")
        }
    }

    static func symbol(_ filter: ReadinessFilter) -> String? {
        switch filter {
        case .all: nil
        case .ready: AssetStatus.ready.symbol
        case .blocked: AssetStatus.blocked.symbol
        case .needsChecking: AssetStatus.needsChecking.symbol
        }
    }
}

private struct FilterChip: View {
    let title: String
    let symbol: String?
    let selected: Bool

    var body: some View {
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).accessibilityHidden(true) }
            Text(title)
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .foregroundStyle(selected ? Color.white : Color.brandText)
        .background(selected ? Color.accentColor : Color.brandPanel, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? Color.clear : Color.brandBorder))
        .contentShape(Capsule())
    }
}

/// One card: status, identity (model, code), then the main reason or the cell.
struct AssetCardView: View {
    let asset: TechnicianAsset
    let stale: Bool

    var body: some View {
        let status = AssetStatus(asset)
        let detail = AssetPresentation.detail(for: asset)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                StatusChip(status: status, stale: stale)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Color.brandMuted)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                // Names and codes entered by an administrator are never translated.
                Text(verbatim: asset.model.name)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.brandText)
                Text(verbatim: AssetPresentation.identityLine(for: asset))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color.brandMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Divider()
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(detail.text).foregroundStyle(stale ? Color.brandMuted : Color.brandText)
                        if let guidance = detail.guidance {
                            Text(guidance).font(.footnote).foregroundStyle(Color.brandMuted)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: detail.symbol)
                        .foregroundStyle(stale ? AssetStatus.Tone.neutral.icon : status.tone.icon)
                }
                .font(.subheadline)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spokenLabel(asset: asset, status: status, stale: stale, detail: detail))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("asset.card.\(asset.assetCode)")
    }

    /// "Prêt, Multimètre 1, MM-001, Disponible dans la cellule A1" (handoff §3).
    static func spokenLabel(asset: TechnicianAsset, status: AssetStatus, stale: Bool, detail: CardDetail?) -> String {
        var parts = [StatusChip.spoken(status, stale: stale), asset.model.name, asset.assetCode]
        if let detail {
            parts.append(detail.text)
            if let guidance = detail.guidance { parts.append(guidance.replacingOccurrences(of: "\n", with: ", ")) }
        }
        return parts.joined(separator: ", ")
    }
}

private struct EmptyCatalog: View {
    let filtered: Bool
    let clear: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: filtered ? "magnifyingglass" : "shippingbox")
                .font(.largeTitle)
                .foregroundStyle(Color.brandMuted)
                .accessibilityHidden(true)
            Text(filtered ? "Aucun équipement ne correspond." : "Aucun équipement n’est encore disponible.")
                .font(.headline)
                .foregroundStyle(Color.brandText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("catalog.empty")
            if filtered {
                Button("Effacer les filtres", action: clear)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("catalog.clearFilters")
            }
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
        .onAppear {
            AccessibilityNotification.Announcement(filtered
                ? String(localized: "Aucun équipement ne correspond.")
                : String(localized: "Aucun équipement n’est encore disponible.")).post()
        }
    }
}
