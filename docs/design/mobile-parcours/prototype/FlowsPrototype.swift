// Design prototype of the technician flows after sign-in (#35). Presentation
// only: fictional data, no network, no camera, no locker. Navigation is live
// (catalogue to asset and back, reservation sheet, filters, closing and
// resuming the guided operation) so the flow can be tried by hand.
// render.sh compiles it into a temporary copy of apps/ios (reusing the app's
// v3 colours and components) to produce ../captures/; it is never part of
// the application.
//
// Launch variable: AEGIS_PROTO_SCREEN (see Screen). The language and the
// formats follow the device settings; business times use the locker time zone.

import SwiftUI

@main
struct FlowsPrototypeApp: App {
    private let environment = ProcessInfo.processInfo.environment

    var body: some Scene {
        WindowGroup {
            FlowsRoot(screen: Screen(rawValue: environment["AEGIS_PROTO_SCREEN"] ?? "") ?? .catalogue,
                      t: Copy(lang: Locale.preferredLanguages.first?.hasPrefix("en") == true ? .en : .fr))
        }
    }
}

fileprivate enum Screen: String {
    case catalogue
    case catalogueLoading = "catalogue-chargement"
    case catalogueEmpty = "catalogue-vide"
    case catalogueOffline = "catalogue-hors-ligne"
    case assetReady = "fiche-prete"
    case assetBlocked = "fiche-bloquee"
    case reserve = "reserver"
    case reserveClosed = "reserver-casier-ferme"
    case activityEmpty = "activite-vide"
    case activityReservation = "activite-reservation"
    case activityLoanOverdue = "activite-pret-retard"
    case activityLockerOffline = "activite-casier-hors-ligne"
    case activityCheckoutRetry = "activite-retrait-a-reessayer"
    case activityOperation = "activite-operation-en-cours"
    case awaitingDisplay = "operation-code-en-attente"
    case scan
    case scanCameraDenied = "scan-camera-refusee"
    case authorized = "operation-autorisee"
    case unlockStarted = "operation-deverrouillage"
    case networkLost = "operation-reseau-perdu"
    case networkLostDeadline = "operation-reseau-perdu-echeance"
    case confirmed = "operation-confirmee"
    case returnDoorOpen = "retour-porte-ouverte"
    case expired = "operation-expiree"
    case anomaly = "operation-anomalie"

    var isOperation: Bool {
        switch self {
        case .awaitingDisplay, .scan, .scanCameraDenied, .authorized, .unlockStarted,
             .networkLost, .networkLostDeadline, .confirmed, .returnDoorOpen, .expired, .anomaly: true
        default: false
        }
    }

    var isTerminal: Bool { self == .confirmed || self == .expired || self == .anomaly }

    var tab: FlowTab {
        switch self {
        case .catalogue, .catalogueLoading, .catalogueEmpty, .catalogueOffline,
             .assetReady, .assetBlocked, .reserve, .reserveClosed: .equipment
        default: .activity
        }
    }

    var assetPath: [AssetRef] {
        switch self {
        case .assetReady, .reserve, .reserveClosed: [.ready]
        case .assetBlocked: [.blocked]
        default: []
        }
    }
}

fileprivate enum FlowTab: Hashable { case equipment, activity, account }
fileprivate enum AssetRef: Hashable { case ready, blocked }
fileprivate enum Filter: Hashable, CaseIterable { case all, ready, blocked, unknown }

// MARK: - Sample data and locker time

/// Fictional instants. Business times are shown in the locker time zone
/// (`currentWindow.timeZone`), with its abbreviation, in the user's format.
fileprivate enum Sample {
    static let zone = TimeZone(identifier: "America/Toronto")!

    static func at(_ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    static let evaluatedAt = at(10, 22, 14, 30)
    static let lockerLastSeen = at(10, 22, 14, 28)
    static let lastAttempt = at(10, 22, 14, 32)
    static let operationDeadline = at(10, 22, 14, 36)
    static let pickUpBy = at(10, 22, 16, 30)
    static let overdueSince = at(10, 22, 16, 30)
    static let closesAt = at(10, 22, 18, 0)
    static let reopensAt = at(10, 23, 7, 0)
    static let calibrationExpired = at(9, 8, 12, 0)
    static let calibrationValid = at(12, 1, 12, 0)

    /// "16:30 HAE" in fr_CA, "4:30 PM EDT" in en_CA.
    static func time(_ date: Date) -> String {
        let clock = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: zone))
        let abbreviation = date.formatted(Date.FormatStyle(timeZone: zone).timeZone(.specificName(.short)))
        return "\(clock)\u{00A0}\(abbreviation)"
    }

    static func zoneName(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(timeZone: zone).timeZone(.specificName(.long)))
    }

    static func day(_ date: Date) -> String {
        // Kept on one line: « 8 sept. 2026 » never splits after the day.
        date.formatted(Date.FormatStyle(timeZone: zone).day().month(.abbreviated).year())
            .replacingOccurrences(of: " ", with: "\u{00A0}")
    }

    static func spoken(seconds: Int) -> String {
        Duration.seconds(seconds).formatted(.units(allowed: [.minutes, .seconds], width: .wide))
    }
}

// MARK: - Root and tabs

fileprivate struct FlowsRoot: View {
    let screen: Screen
    let t: Copy

    @State private var tab: FlowTab
    @State private var path: [AssetRef]
    @State private var operationShown: Bool
    /// After Close, My activity shows the operation as still running.
    @State private var operationHidden = false

    init(screen: Screen, t: Copy) {
        self.screen = screen
        self.t = t
        _tab = State(initialValue: screen.tab)
        _path = State(initialValue: screen.assetPath)
        _operationShown = State(initialValue: screen.isOperation)
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $path) {
                CatalogueScreen(screen: screen, t: t)
                    .navigationDestination(for: AssetRef.self) { asset in
                        AssetSheetScreen(asset: asset, screen: screen, t: t)
                    }
            }
            .tabItem { Label(t.tabEquipment, systemImage: "shippingbox") }
            .tag(FlowTab.equipment)
            NavigationStack {
                ActivityScreen(screen: activityScreen, t: t) { operationShown = true }
            }
            .tabItem { Label(t.tabActivity, systemImage: "checklist") }
            .tag(FlowTab.activity)
            NavigationStack { Color.brandTop.ignoresSafeArea() }
                .tabItem { Label(t.tabAccount, systemImage: "person.crop.circle") }
                .tag(FlowTab.account)
        }
        .fullScreenCover(isPresented: $operationShown) {
            OperationScreen(screen: screen.isOperation ? screen : .unlockStarted, t: t) {
                operationShown = false
                operationHidden = true
                tab = .activity
            }
        }
    }

    private var activityScreen: Screen {
        if operationHidden || (screen.isOperation && !screen.isTerminal) { return .activityOperation }
        return screen
    }
}

// MARK: - Catalogue

fileprivate struct CatalogueScreen: View {
    let screen: Screen
    let t: Copy

    private var offline: Bool { screen == .catalogueOffline }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                FilterBar(t: t)
                if offline {
                    OfflineNotice(t: t)
                }
                switch screen {
                case .catalogueLoading:
                    VStack(spacing: 14) {
                        ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(t.loadingAssets)
                case .catalogueEmpty:
                    EmptyState(symbol: "magnifyingglass", title: t.noMatch, action: t.clearFilters)
                default:
                    NavigationLink(value: AssetRef.ready) {
                        AssetCard(status: .ready(t), stale: offline, t: t, title: "Multimètre 1",
                                  code: "MM-001 · Fluke 117", detail: t.inCompartment("A1"),
                                  detailSymbol: "mappin.and.ellipse")
                    }
                    .buttonStyle(.plain)
                    NavigationLink(value: AssetRef.blocked) {
                        AssetCard(status: .blocked(t), stale: offline, t: t, title: "Multimètre 2",
                                  code: "MM-002 · Fluke 117",
                                  detail: t.calibrationExpiredOn(Sample.day(Sample.calibrationExpired)),
                                  detailSymbol: "exclamationmark.octagon.fill", hint: t.chooseAnother)
                    }
                    .buttonStyle(.plain)
                    // Only the ready and blocked sheets are prototyped.
                    AssetCard(status: .borrowed(t), stale: offline, t: t, title: "Pince ampèremétrique",
                              code: "PA-004 · Klein CL800", detail: t.unavailableUntilReturn, detailSymbol: "clock")
                    AssetCard(status: .unknown(t), stale: offline, t: t, title: "Thermomètre infrarouge",
                              code: "TI-002 · Fluke 62 Max", detail: t.presenceUnconfirmed,
                              detailSymbol: "questionmark.diamond.fill", hint: t.tryLater)
                    if !offline {
                        Text(t.evaluatedAt(Sample.time(Sample.evaluatedAt)))
                            .font(.footnote)
                            .foregroundStyle(Color.brandMuted)
                            .padding(.top, 4)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .refreshable {}
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle(t.tabEquipment)
        .searchable(text: .constant(screen == .catalogueEmpty ? "oscilloscope" : ""),
                    placement: .navigationBarDrawer(displayMode: .always), prompt: t.searchPrompt)
    }
}

/// Above the cards, so the age of the list is read before any status.
fileprivate struct OfflineNotice: View {
    let t: Copy

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t.offlineBanner).font(.subheadline.weight(.semibold))
                    Text(t.notRefreshedSince(Sample.time(Sample.evaluatedAt))).font(.subheadline)
                }
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "wifi.slash")
            }
            .foregroundStyle(Color.errorText)
            .accessibilityElement(children: .combine)
            Button(t.retry) {}
                .buttonStyle(CompactButtonStyle())
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

fileprivate struct FilterBar: View {
    let t: Copy
    @State private var filter = Filter.all
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            // Chips would scroll off screen one at a time: a native menu keeps
            // every filter one tap away.
            Menu {
                Picker(t.filterTitle, selection: $filter) {
                    ForEach(Filter.allCases, id: \.self) { Text(t.filterName($0)).tag($0) }
                }
            } label: {
                Label(t.filterMenu(t.filterName(filter)), systemImage: "line.3.horizontal.decrease.circle")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.brandAccent)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Filter.allCases, id: \.self) { item in
                        Button { filter = item } label: {
                            FilterChip(title: t.filterName(item), symbol: symbol(item), selected: filter == item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(filter == item ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func symbol(_ filter: Filter) -> String? {
        switch filter {
        case .all: nil
        case .ready: "checkmark.circle.fill"
        case .blocked: "minus.circle.fill"
        case .unknown: "questionmark.diamond.fill"
        }
    }
}

fileprivate struct FilterChip: View {
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

fileprivate struct AssetCard: View {
    let status: StatusChip
    var stale = false
    let t: Copy
    let title: String
    let code: String
    let detail: String
    let detailSymbol: String
    var hint: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                stale ? status.lastKnown(t) : status
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Color.brandMuted)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                // User-entered names and models are never translated.
                Text(verbatim: title).font(.title3.weight(.semibold)).foregroundStyle(Color.brandText)
                Text(verbatim: code).font(.subheadline.monospacedDigit()).foregroundStyle(Color.brandMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
            Divider()
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(detail).foregroundStyle(stale ? Color.brandMuted : Color.brandText)
                    if let hint { Text(hint).font(.footnote).foregroundStyle(Color.brandMuted) }
                }
            } icon: {
                Image(systemName: detailSymbol)
                    .foregroundStyle(stale ? StatusChip.Kind.neutral.icon : status.kind.icon)
            }
            .font(.subheadline)
        }
        .padding(18)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Neutral placeholder: no status colour, so nothing looks evaluated yet.
fileprivate struct SkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Capsule().fill(placeholder).frame(width: 92, height: 30)
            VStack(alignment: .leading, spacing: 8) {
                bar(width: 190, height: 20)
                bar(width: 140, height: 14)
            }
            Divider()
            bar(width: nil, height: 14)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
    }

    private var placeholder: Color { Color.brandMuted.opacity(0.16) }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(placeholder)
            .frame(maxWidth: width ?? .infinity, alignment: .leading)
            .frame(height: height)
    }
}

// MARK: - Status chip

fileprivate struct StatusChip: View {
    enum Kind {
        case ready, blocked, unknown, mine, progress, neutral

        var foreground: Color {
            switch self {
            case .ready: dynamic(0x0B6B3F, 0x6FE3A8)
            case .blocked: dynamic(0xA3161A, 0xFFA59E)
            case .unknown: dynamic(0x7A4B00, 0xFFD27A)
            case .mine: dynamic(0x3726B8, 0xC2BCFF)
            case .progress: dynamic(0x1A45CC, 0xA9C0FF)
            case .neutral: dynamic(0x3A4560, 0xC8CFE6)
            }
        }

        var background: Color {
            switch self {
            case .ready: dynamic(0xE1F4EA, 0x0E2E2A)
            case .blocked: dynamic(0xFCE7E6, 0x3A1424)
            case .unknown: dynamic(0xFFF0D1, 0x33280F)
            case .mine: dynamic(0xECEAFF, 0x221D5C)
            case .progress: dynamic(0xE6EDFF, 0x16255A)
            case .neutral: dynamic(0xE7EBF3, 0x1A2447)
            }
        }

        var icon: Color {
            switch self {
            case .ready: dynamic(0x12824D, 0x4ED393)
            case .blocked: dynamic(0xC8262B, 0xFF7A70)
            case .unknown: dynamic(0xA86400, 0xFFC247)
            case .mine: dynamic(0x4B3BD9, 0xA69CFF)
            case .progress: dynamic(0x1F4FE6, 0x93B1FF)
            case .neutral: dynamic(0x58627C, 0xA4AFCC)
            }
        }
    }

    let kind: Kind
    let text: String
    let symbol: String
    var spoken: String? = nil

    static func ready(_ t: Copy) -> StatusChip { .init(kind: .ready, text: t.statusReady, symbol: "checkmark.circle.fill") }
    static func blocked(_ t: Copy) -> StatusChip { .init(kind: .blocked, text: t.statusBlocked, symbol: "minus.circle.fill") }
    static func unknown(_ t: Copy) -> StatusChip { .init(kind: .unknown, text: t.statusUnknown, symbol: "questionmark.diamond.fill") }
    static func borrowed(_ t: Copy) -> StatusChip { .init(kind: .neutral, text: t.statusBorrowed, symbol: "arrow.up.forward.square") }
    static func reservedForYou(_ t: Copy) -> StatusChip { .init(kind: .mine, text: t.statusReservedForYou, symbol: "bookmark.fill") }
    static func borrowedByYou(_ t: Copy) -> StatusChip { .init(kind: .mine, text: t.statusBorrowedByYou, symbol: "person.crop.circle.badge.checkmark") }
    static func checkoutInProgress(_ t: Copy) -> StatusChip { .init(kind: .progress, text: t.checkoutInProgress, symbol: "arrow.triangle.2.circlepath") }

    /// The status received at the last reading, unchanged, in neutral colours
    /// and named as such: nothing looks freshly confirmed while offline.
    func lastKnown(_ t: Copy) -> StatusChip {
        .init(kind: .neutral, text: t.lastKnown(text), symbol: symbol, spoken: t.lastKnownSpoken(text))
    }

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: symbol).foregroundStyle(kind.icon)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(kind.foreground)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(kind.background, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken ?? text)
    }
}

// MARK: - Asset sheet and reservation

fileprivate struct AssetSheetScreen: View {
    let asset: AssetRef
    let screen: Screen
    let t: Copy

    @State private var reserving: Bool

    init(asset: AssetRef, screen: Screen, t: Copy) {
        self.asset = asset
        self.screen = screen
        self.t = t
        _reserving = State(initialValue: screen == .reserve || screen == .reserveClosed)
    }

    private var ready: Bool { asset == .ready }
    private var stale: Bool { screen == .catalogueOffline }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    let chip = ready ? StatusChip.ready(t) : StatusChip.blocked(t)
                    stale ? chip.lastKnown(t) : chip
                    Text(verbatim: ready ? "Multimètre 1" : "Multimètre 2")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Color.brandText)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: ready ? "MM-001 · Fluke 117" : "MM-002 · Fluke 117")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(Color.brandMuted)
                }
                if stale {
                    NoticeBanner(message: t.notRefreshedSince(Sample.time(Sample.evaluatedAt)), isError: false)
                }
                if !ready {
                    Card {
                        Text(t.reasonsTitle).font(.headline).foregroundStyle(Color.brandText)
                        ReasonRow(symbol: "exclamationmark.octagon.fill", kind: .blocked,
                                  title: t.calibrationExpiredOn(Sample.day(Sample.calibrationExpired)),
                                  hint: t.chooseAnother)
                        ReasonRow(symbol: "lock.fill", kind: .blocked, title: t.accessDenied, hint: t.askAccess)
                    }
                }
                Card {
                    Fact(label: t.calibration,
                         value: ready ? t.validUntil(Sample.day(Sample.calibrationValid))
                                      : t.expiredOn(Sample.day(Sample.calibrationExpired)))
                    Divider()
                    Fact(label: t.requiredAccess, value: ready ? t.levelStandard : t.levelRestricted)
                    Divider()
                    Fact(label: t.compartment, value: ready ? "A1 · AEGIS-DEMO-01" : "A2 · AEGIS-DEMO-01")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(t.reserve) { reserving = true }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!ready || stale)
                    if !ready {
                        Text(t.reserveImpossible).font(.footnote).foregroundStyle(Color.brandMuted)
                    } else if stale {
                        Text(t.reserveNeedsRefresh).font(.footnote).foregroundStyle(Color.brandMuted)
                    }
                }
            }
            .padding(20)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $reserving) {
            ReserveSheet(closed: screen == .reserveClosed, t: t) { reserving = false }
                .presentationDetents([.large])
        }
    }
}

fileprivate struct ReserveSheet: View {
    let closed: Bool
    let t: Copy
    let cancel: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(verbatim: "Multimètre 1 · MM-001").font(.headline).foregroundStyle(Color.brandText)
                    Text(t.inCompartment("A1")).foregroundStyle(Color.brandMuted)
                    if closed {
                        NoticeBanner(message: t.lockerClosed(Sample.time(Sample.reopensAt)), isError: true)
                    } else {
                        Card {
                            // Native picker in the locker time zone, bounded by
                            // currentWindow.closesAt in the app.
                            DatePicker(t.reserveUntil, selection: .constant(Sample.pickUpBy),
                                       displayedComponents: .hourAndMinute)
                                .environment(\.timeZone, Sample.zone)
                                .foregroundStyle(Color.brandText)
                            Divider()
                            Fact(label: t.lockerCloses, value: Sample.time(Sample.closesAt))
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            // reservedUntil becomes Loan.dueAt on checkout (06 §11.1).
                            Text(t.reserveUntilExplained)
                                .font(.subheadline)
                                .foregroundStyle(Color.brandText)
                            Text(t.lockerZoneNote(Sample.zoneName(Sample.pickUpBy)))
                                .font(.footnote)
                                .foregroundStyle(Color.brandMuted)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        Label(t.reserveUnlocksNothing, systemImage: "lock.fill")
                            .font(.subheadline)
                            .foregroundStyle(Color.brandText)
                    }
                }
                .padding(20)
            }
            .safeAreaInset(edge: .bottom) {
                Button(t.confirmReservation) {}
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(closed)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Color.brandPanel)
            }
            .background(Color.brandPanel.ignoresSafeArea())
            .navigationTitle(t.reserve)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t.cancel, action: cancel) } }
            .tint(Color.brandAccent)
        }
    }
}

// MARK: - My activity

fileprivate struct ActivityScreen: View {
    let screen: Screen
    let t: Copy
    let resume: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch screen {
                case .activityEmpty:
                    EmptyState(symbol: "tray", title: t.noActivity, action: t.seeEquipment)
                case .activityReservation:
                    ActivityCard(chip: .reservedForYou(t), line: t.pickUpBefore(Sample.time(Sample.pickUpBy))) {
                        Button(t.prepareCheckout) {}.buttonStyle(PrimaryButtonStyle())
                        Button(t.cancelReservation) {}.buttonStyle(SecondaryButtonStyle())
                    }
                case .activityLoanOverdue:
                    ActivityCard(chip: .borrowedByYou(t), line: t.overdueSince(Sample.time(Sample.overdueSince)),
                                 warning: true) {
                        Button(t.returnEquipment) {}.buttonStyle(PrimaryButtonStyle())
                    }
                case .activityLockerOffline:
                    // The server does not offer checkout now: the action stays
                    // visible, disabled, with its reason and a way to check again.
                    ActivityCard(chip: .reservedForYou(t), line: t.pickUpBefore(Sample.time(Sample.pickUpBy))) {
                        InlineNotice(title: t.checkoutUnavailable,
                                     detail: t.lockerLastSeen(Sample.time(Sample.lockerLastSeen)),
                                     symbol: "wifi.exclamationmark", kind: .unknown)
                        // Disabled, not hidden: the reason sits right above it.
                        Button {} label: { Label(t.prepareCheckout, systemImage: "lock.fill") }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(true)
                        Button {} label: { Label(t.refresh, systemImage: "arrow.clockwise") }
                            .buttonStyle(PrimaryButtonStyle())
                        Button(t.cancelReservation) {}.buttonStyle(TextButtonStyle())
                    }
                case .activityCheckoutRetry:
                    // The server still offers checkout after a 503 LOCKER_OFFLINE:
                    // a new attempt, named as such.
                    ActivityCard(chip: .reservedForYou(t), line: t.pickUpBefore(Sample.time(Sample.pickUpBy))) {
                        InlineNotice(title: t.lastAttemptOffline(Sample.time(Sample.lastAttempt)),
                                     detail: t.retryExplained, symbol: "wifi.exclamationmark", kind: .unknown)
                        Button(t.retryCheckout) {}.buttonStyle(PrimaryButtonStyle())
                        Button(t.cancelReservation) {}.buttonStyle(SecondaryButtonStyle())
                    }
                case .activityOperation:
                    ActivityCard(chip: .checkoutInProgress(t), line: t.trackingHidden, symbol: "eye.slash") {
                        Button(t.resume, action: resume).buttonStyle(PrimaryButtonStyle())
                    }
                default:
                    EmptyView()
                }
            }
            .padding(20)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle(t.tabActivity)
    }
}

fileprivate struct ActivityCard<Actions: View>: View {
    let chip: StatusChip
    let line: String
    var symbol = "clock"
    var warning = false
    @ViewBuilder let actions: Actions

    var body: some View {
        Card {
            chip
            Text(verbatim: "Multimètre 1").font(.title2.weight(.semibold)).foregroundStyle(Color.brandText)
            Text(verbatim: "MM-001 · A1").font(.subheadline.monospacedDigit()).foregroundStyle(Color.brandMuted)
            Label(line, systemImage: warning ? "exclamationmark.triangle.fill" : symbol)
                .font(.subheadline)
                .foregroundStyle(warning ? Color.errorText : Color.brandText)
            VStack(spacing: 10) { actions }.padding(.top, 6)
        }
    }
}

fileprivate struct InlineNotice: View {
    let title: String
    let detail: String
    let symbol: String
    let kind: StatusChip.Kind

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // At accessibility sizes the icon column would take a third of the width.
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            Image(systemName: symbol).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.subheadline)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .font(.subheadline)
        .foregroundStyle(kind.foreground)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(kind.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Guided operation

fileprivate struct OperationScreen: View {
    let screen: Screen
    let t: Copy
    let close: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var cellSize: CGFloat = 64

    /// Phases: 1 Request, 2 Locker code, 3 Authorization, 4 Command, 5 Door,
    /// 6 Verification; 7 means every phase is done (CONFIRMED only).
    private var phase: Int {
        switch screen {
        case .awaitingDisplay, .scan, .scanCameraDenied: 2
        case .authorized: 3
        case .unlockStarted: 4
        case .networkLost, .networkLostDeadline, .returnDoorOpen: 5
        case .confirmed: 7
        case .expired: 5
        case .anomaly: 6
        default: 1
        }
    }

    private var isReturn: Bool { screen == .returnDoorOpen }
    private var interrupted: Bool { screen == .networkLost || screen == .networkLostDeadline }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if typeSize.isAccessibilitySize {
                        // Cell, state and instruction first; the explanation,
                        // identity and phases follow.
                        cell
                        StepHeader(screen: screen, t: t)
                        interruption
                        countdownView
                        identity
                    } else {
                        interruption
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            cell
                            identity
                        }
                        StepHeader(screen: screen, t: t)
                        countdownView
                    }
                    PhaseList(current: phase, failed: screen == .expired || screen == .anomaly,
                              interrupted: interrupted, t: t)
                    actions
                    if !screen.isTerminal {
                        Text(t.closeExplained)
                            .font(.footnote)
                            .foregroundStyle(Color.brandMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
            }
            .background(Color.brandTop.ignoresSafeArea())
            .navigationTitle(isReturn ? t.guidedReturn : t.guidedCheckout)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t.close, action: close)
                        .accessibilityHint(screen.isTerminal ? "" : t.closeHint)
                }
            }
            .sheet(isPresented: .constant(screen == .scan || screen == .scanCameraDenied)) {
                ScanSheet(denied: screen == .scanCameraDenied, t: t)
            }
        }
        // Text-level accent: #8CAEFF on the dark background, not the fill accent.
        .tint(Color.brandAccent)
    }

    @ViewBuilder
    private var interruption: some View {
        if interrupted {
            InlineNotice(title: t.trackingInterrupted, detail: t.connectionLostExplained,
                         symbol: "wifi.slash", kind: .unknown)
        }
    }

    private var cell: some View {
        Text(verbatim: "A1")
            .font(.system(size: cellSize, weight: .bold, design: .rounded))
            .foregroundStyle(Color.brandAccent)
            .accessibilityLabel(t.compartmentSpoken("A1"))
    }

    private var identity: some View {
        Text(verbatim: "Multimètre 1 · MM-001")
            .font(.headline)
            .foregroundStyle(Color.brandText)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var countdownView: some View {
        switch screen {
        case .authorized: Countdown(seconds: 118, interrupted: false, t: t)
        case .unlockStarted: Countdown(seconds: 101, interrupted: false, t: t)
        case .networkLost: Countdown(seconds: 72, interrupted: true, t: t)
        case .networkLostDeadline: Countdown(seconds: 0, interrupted: true, t: t)
        case .returnDoorOpen: Countdown(seconds: 72, interrupted: false, t: t)
        default: EmptyView()
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch screen {
        case .awaitingDisplay:
            Button(t.scanCode) {}.buttonStyle(PrimaryButtonStyle()).disabled(true)
        case .confirmed:
            Button(t.seeActivity, action: close).buttonStyle(PrimaryButtonStyle())
        case .expired:
            // Short visible label, condensed at accessibility sizes like the
            // title, keeps the word whole at AX5 without capping the size; the
            // title and instruction above give the context.
            Button {} label: {
                Text(t.prepareAgain).fontWidth(typeSize.isAccessibilitySize ? .condensed : .standard)
            }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityLabel(t.prepareAgainSpoken)
                .accessibilityHint(t.prepareAgainHint)
        case .anomaly:
            Button(t.seeActivity, action: close).buttonStyle(SecondaryButtonStyle())
        default:
            EmptyView()
        }
    }
}

/// Counts down to the received `expiresAt` on the device clock. It never
/// decides an outcome: at zero it waits for the service's own state.
fileprivate struct Countdown: View {
    let seconds: Int
    let interrupted: Bool
    let t: Copy

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t.timeRemaining)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.brandMuted)
            Label {
                Text(verbatim: String(format: "%d:%02d", seconds / 60, seconds % 60))
                    .font(.title2.monospacedDigit().weight(.semibold))
            } icon: {
                Image(systemName: "timer")
            }
            .foregroundStyle(Color.brandText)
            if seconds == 0 {
                Text(t.deadlineReached)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(deadlineText)
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(t.timeRemaining)
        .accessibilityValue(seconds == 0 ? t.deadlineReached : Sample.spoken(seconds: seconds))
        .accessibilityHint(deadlineText)
    }

    private var deadlineText: String {
        let time = Sample.time(Sample.operationDeadline)
        return interrupted ? t.deadlineReceived(time) : t.deadline(time)
    }
}

fileprivate struct StepHeader: View {
    let screen: Screen
    let t: Copy

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let (title, instruction, kind): (String, String, StatusChip.Kind) = {
            switch screen {
            case .awaitingDisplay: (t.codeAppearing, t.approachScreen, .progress)
            case .scan, .scanCameraDenied: (t.scanTitle, t.noDoorOpen, .progress)
            case .authorized: (t.accessAuthorized, t.dontOpenYet, .progress)
            case .unlockStarted: (t.unlockStarted, t.openDoorAndTake("Multimètre 1"), .progress)
            case .networkLost, .networkLostDeadline: (t.lastStatusReceived(t.doorOpenLowercase), t.takeAndClose, .progress)
            case .returnDoorOpen: (t.doorOpened, t.depositAndClose, .progress)
            case .confirmed: (t.checkoutConfirmed, t.loanStarted(Sample.time(Sample.pickUpBy)), .ready)
            case .expired: (t.timeExceeded, t.noDoorOpenedRestart, .blocked)
            case .anomaly: (t.interventionRequired, t.dontRetryAdmin, .blocked)
            default: ("", "", .neutral)
            }
        }()
        VStack(alignment: .leading, spacing: 8) {
            // At accessibility sizes the condensed width keeps long single
            // words such as « Déverrouillage » whole, without capping the size.
            Text(title)
                .font(.title.weight(.semibold).width(typeSize.isAccessibilitySize ? .condensed : .standard))
                .foregroundStyle(kind == .blocked ? Color.errorText : Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(instruction).font(.body).foregroundStyle(Color.brandText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

fileprivate struct PhaseList: View {
    let current: Int
    let failed: Bool
    let interrupted: Bool
    let t: Copy

    var body: some View {
        Card {
            ForEach(Array(t.phases.enumerated()), id: \.offset) { index, name in
                let step = index + 1
                HStack(spacing: 12) {
                    Image(systemName: symbol(for: step))
                        .foregroundStyle(color(for: step))
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    Text(name)
                        .font(step == current ? .body.weight(.semibold) : .body)
                        .foregroundStyle(step <= current ? Color.brandText : Color.brandMuted)
                    Spacer()
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(value(for: step))
            }
        }
    }

    private func value(for step: Int) -> String {
        if step < current { return t.stepDone }
        if step == current { return interrupted ? t.stepLastReceived : t.stepCurrent }
        return t.stepPending
    }

    private func symbol(for step: Int) -> String {
        if step < current { return "checkmark.circle.fill" }
        if step == current {
            if failed { return "exclamationmark.octagon.fill" }
            return interrupted ? "pause.circle" : "circle.dotted.circle"
        }
        return "circle"
    }

    private func color(for step: Int) -> Color {
        if step < current { return StatusChip.Kind.ready.icon }
        if step == current {
            if failed { return StatusChip.Kind.blocked.icon }
            return interrupted ? StatusChip.Kind.unknown.icon : StatusChip.Kind.progress.icon
        }
        return Color.brandMuted
    }
}

fileprivate struct ScanSheet: View {
    let denied: Bool
    let t: Copy

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                if denied {
                    Image(systemName: "camera.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Color.brandMuted)
                        .accessibilityHidden(true)
                    Text(t.cameraDenied).font(.title3.weight(.semibold)).foregroundStyle(Color.brandText)
                    Button(t.openSettings) {}.buttonStyle(PrimaryButtonStyle())
                } else {
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color(white: 0.08))
                            .frame(height: 300)
                            .overlay {
                                ViewfinderCorners()
                                    .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                                    .frame(width: 190, height: 190)
                            }
                        Text(t.cameraSimulation)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Color(red: 0.56, green: 0.07, blue: 0.47), in: Capsule())
                            .padding(12)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(t.cameraPreviewSpoken)
                    Label(t.expiresIn, systemImage: "timer")
                        .font(.title3.monospacedDigit().weight(.semibold))
                        .foregroundStyle(Color.brandText)
                    Label(t.noDoorOpen, systemImage: "lock.fill")
                        .font(.headline)
                        .foregroundStyle(Color.brandText)
                    Text(t.scanReminder).font(.subheadline).foregroundStyle(Color.brandMuted)
                }
                Spacer()
            }
            .padding(20)
            .background(Color.brandPanel.ignoresSafeArea())
            .navigationTitle(t.scanTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t.cancel) {} } }
        }
        .tint(Color.brandAccent)
    }
}

// MARK: - Shared pieces

fileprivate struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
    }
}

fileprivate struct Fact: View {
    let label: String
    let value: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                Text(label).foregroundStyle(Color.brandText)
                Spacer()
                Text(value).foregroundStyle(Color.brandMuted).multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).foregroundStyle(Color.brandText)
                Text(value).foregroundStyle(Color.brandMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

fileprivate struct ReasonRow: View {
    let symbol: String
    let kind: StatusChip.Kind
    let title: String
    let hint: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Color.brandText)
                Text(hint).font(.footnote).foregroundStyle(Color.brandMuted)
            }
        } icon: {
            Image(systemName: symbol).foregroundStyle(kind.icon)
        }
        .accessibilityElement(children: .combine)
    }
}

fileprivate struct EmptyState: View {
    let symbol: String
    let title: String
    let action: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(Color.brandMuted).accessibilityHidden(true)
            Text(title).font(.headline).foregroundStyle(Color.brandText).multilineTextAlignment(.center)
            Button(action) {}.buttonStyle(SecondaryButtonStyle())
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}

/// Bordered action that fits inside a notice; 44 pt minimum target.
fileprivate struct CompactButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.brandAccent)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(Color.brandPanel, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.fieldEdge))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// Low-emphasis action under the primary pair.
fileprivate struct TextButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.brandAccent)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// Four corner brackets of a scanner viewfinder.
fileprivate struct ViewfinderCorners: Shape {
    func path(in rect: CGRect) -> Path {
        let length = rect.width * 0.22
        var path = Path()
        for (corner, dx, dy) in [(CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0),
                                 (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0),
                                 (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0),
                                 (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0)] {
            path.move(to: CGPoint(x: corner.x + dx * length, y: corner.y))
            path.addLine(to: corner)
            path.addLine(to: CGPoint(x: corner.x, y: corner.y + dy * length))
        }
        return path
    }
}

fileprivate func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                       blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    })
}

// MARK: - Copy (FR reference from sections.md where approved, EN proposed)

/// Stand-in for the String Catalog: follows the device language. Times come
/// already formatted in the locker time zone and the device format.
fileprivate enum Lang { case fr, en }

fileprivate struct Copy {
    let lang: Lang
    /// French puts a non-breaking space before a colon, so it never starts a line.
    private func t(_ fr: String, _ en: String) -> String {
        lang == .fr ? fr.replacingOccurrences(of: " :", with: "\u{00A0}:") : en
    }

    var tabEquipment: String { t("Équipements", "Equipment") }
    var tabActivity: String { t("Mon activité", "My activity") }
    var tabAccount: String { t("Compte", "Account") }
    var searchPrompt: String { t("Code ou modèle", "Code or model") }
    var filterTitle: String { t("Filtre", "Filter") }
    func filterMenu(_ name: String) -> String { t("Filtre : \(name)", "Filter: \(name)") }
    func filterName(_ filter: Filter) -> String {
        switch filter {
        case .all: t("Tous", "All")
        case .ready: statusReady
        case .blocked: statusBlocked
        case .unknown: statusUnknown
        }
    }
    var statusReady: String { t("Prêt", "Ready") }
    var statusBlocked: String { t("Bloqué", "Blocked") }
    var statusUnknown: String { t("À vérifier", "Needs checking") }
    var statusBorrowed: String { t("Emprunté", "Borrowed") }
    var statusReservedForYou: String { t("Réservé pour vous", "Reserved for you") }
    var statusBorrowedByYou: String { t("Emprunté par vous", "Borrowed by you") }
    var checkoutInProgress: String { t("Retrait en cours", "Checkout in progress") }
    func lastKnown(_ status: String) -> String { t("Dernier état : \(status)", "Last known: \(status)") }
    func lastKnownSpoken(_ status: String) -> String {
        t("Dernier état connu, non actualisé : \(status)", "Last known status, not up to date: \(status)")
    }
    func inCompartment(_ code: String) -> String { t("Disponible dans la cellule \(code)", "Available in compartment \(code)") }
    func calibrationExpiredOn(_ day: String) -> String { t("Calibration expirée depuis le \(day)", "Calibration expired on \(day)") }
    var chooseAnother: String { t("Choisissez un autre équipement.", "Choose another piece of equipment.") }
    var unavailableUntilReturn: String { t("Indisponible jusqu'au retour", "Unavailable until returned") }
    var presenceUnconfirmed: String { t("Présence non confirmée par le casier", "Presence not confirmed by the locker") }
    var tryLater: String { t("Réessayez plus tard.", "Try again later.") }
    func evaluatedAt(_ time: String) -> String { t("État évalué à \(time), heure du casier.", "Status checked at \(time), locker time.") }
    func notRefreshedSince(_ time: String) -> String {
        t("Informations non actualisées depuis \(time).", "Not up to date since \(time).")
    }
    var offlineBanner: String { t("Connexion au service impossible. Vérifiez le réseau.", "Can't reach the service. Check your network.") }
    var retry: String { t("Réessayer", "Try again") }
    var refresh: String { t("Actualiser", "Refresh") }
    var loadingAssets: String { t("Chargement des équipements", "Loading equipment") }
    var noMatch: String { t("Aucun équipement ne correspond.", "No equipment matches.") }
    var clearFilters: String { t("Effacer les filtres", "Clear filters") }
    var reasonsTitle: String { t("Pourquoi il est bloqué", "Why it's blocked") }
    var accessDenied: String { t("Niveau d'accès insuffisant", "Access level too low") }
    var askAccess: String { t("Demandez l'accès à un administrateur.", "Ask an administrator for access.") }
    var calibration: String { t("Calibration", "Calibration") }
    func validUntil(_ day: String) -> String { t("Valide jusqu'au \(day)", "Valid until \(day)") }
    func expiredOn(_ day: String) -> String { t("Expirée le \(day)", "Expired on \(day)") }
    var requiredAccess: String { t("Niveau d'accès requis", "Required access level") }
    var levelStandard: String { t("Standard", "Standard") }
    var levelRestricted: String { t("Restreint", "Restricted") }
    var compartment: String { t("Cellule", "Compartment") }
    var reserve: String { t("Réserver", "Reserve") }
    var reserveImpossible: String { t("Réservation impossible : calibration expirée.", "Can't reserve: calibration expired.") }
    var reserveNeedsRefresh: String {
        t("Réservation possible après actualisation de la fiche.", "You can reserve once this page is up to date.")
    }
    var reserveUntil: String { t("Réserver jusqu'à", "Reserve until") }
    var lockerCloses: String { t("Fermeture du casier", "Locker closes") }
    func lockerZoneNote(_ zone: String) -> String {
        t("Heures du casier : \(zone).", "Locker time: \(zone).")
    }
    var reserveUntilExplained: String {
        t("Retirez l'équipement avant cette heure. Elle sera aussi l'heure de retour prévue.",
          "Pick up the equipment before this time. It will also be the expected return time.")
    }
    var reserveUnlocksNothing: String {
        t("La réservation n'ouvre aucune porte.", "Reserving does not unlock the compartment.")
    }
    var confirmReservation: String { t("Confirmer la réservation", "Confirm reservation") }
    func lockerClosed(_ time: String) -> String { t("Le casier est fermé. Réouverture à \(time).", "The locker is closed. It reopens at \(time).") }
    var cancel: String { t("Annuler", "Cancel") }
    var noActivity: String { t("Aucune réservation ni prêt en cours.", "No reservation or loan in progress.") }
    var seeEquipment: String { t("Voir les équipements", "Browse equipment") }
    func pickUpBefore(_ time: String) -> String { t("À retirer avant \(time)", "Pick up before \(time)") }
    var prepareCheckout: String { t("Préparer le retrait", "Prepare checkout") }
    var cancelReservation: String { t("Annuler la réservation", "Cancel reservation") }
    func overdueSince(_ time: String) -> String {
        t("En retard depuis \(time) — rapportez l'équipement.", "Overdue since \(time). Please bring the equipment back.")
    }
    var returnEquipment: String { t("Retourner l'équipement", "Return equipment") }
    var checkoutUnavailable: String {
        t("Retrait indisponible : le casier est hors ligne.", "Checkout unavailable: the locker is offline.")
    }
    func lockerLastSeen(_ time: String) -> String {
        t("Dernier signal du casier à \(time). Actualisez pour vérifier à nouveau.",
          "Locker last seen at \(time). Refresh to check again.")
    }
    func lastAttemptOffline(_ time: String) -> String {
        t("Essai de \(time) : le casier était hors ligne.", "Attempt at \(time): the locker was offline.")
    }
    var retryExplained: String {
        t("Vous pouvez faire une nouvelle tentative. Aucune porte ne s'ouvre sans le code du casier.",
          "You can try again. No door opens without the locker code.")
    }
    var retryCheckout: String { t("Nouvelle tentative de retrait", "Try checkout again") }
    var trackingHidden: String {
        t("Suivi masqué. L'opération n'est pas annulée.", "Tracking hidden. The operation is not cancelled.")
    }
    var resume: String { t("Reprendre", "Resume") }
    var close: String { t("Fermer", "Close") }
    var closeHint: String { t("Masque le suivi sans annuler l'opération.", "Hides tracking without cancelling the operation.") }
    var closeExplained: String {
        t("Fermer masque ce suivi sans annuler l'opération. Reprenez-le depuis Mon activité.",
          "Close hides this tracking without cancelling the operation. Resume it from My activity.")
    }
    var guidedCheckout: String { t("Retrait guidé", "Guided checkout") }
    var guidedReturn: String { t("Retour guidé", "Guided return") }
    var trackingInterrupted: String { t("Suivi interrompu : connexion perdue", "Tracking interrupted: connection lost") }
    var connectionLostExplained: String {
        t("Ce n'est ni une annulation ni une confirmation. L'état sera relu dès le retour du réseau.",
          "This neither cancels nor confirms the operation. Its status will be read again when the network is back.")
    }
    func lastStatusReceived(_ status: String) -> String { t("Dernier état reçu : \(status)", "Last status received: \(status)") }
    var doorOpenLowercase: String { t("porte ouverte", "door open") }
    var timeRemaining: String { t("Temps restant", "Time remaining") }
    func deadline(_ time: String) -> String { t("Échéance : \(time)", "Deadline: \(time)") }
    func deadlineReceived(_ time: String) -> String { t("Échéance reçue : \(time)", "Deadline received: \(time)") }
    var deadlineReached: String {
        t("Échéance atteinte : en attente de confirmation du service.", "Deadline reached: waiting for the service to confirm.")
    }
    func compartmentSpoken(_ code: String) -> String { t("Cellule \(code)", "Compartment \(code)") }
    var codeAppearing: String { t("Le code s'affiche sur le casier", "Code appearing on the locker") }
    var approachScreen: String { t("Approchez-vous de l'écran du casier.", "Stand in front of the locker screen.") }
    var scanTitle: String { t("Scannez le code du casier", "Scan the locker code") }
    var noDoorOpen: String { t("Aucune porte n'est ouverte.", "No door is open.") }
    var accessAuthorized: String { t("Accès autorisé", "Access authorized") }
    var dontOpenYet: String { t("Déverrouillage de A1 en préparation. N'ouvrez pas encore.", "Preparing to unlock A1. Don't open yet.") }
    var unlockStarted: String { t("Déverrouillage lancé", "Unlock started") }
    func openDoorAndTake(_ name: String) -> String {
        t("Ouvrez la porte A1 et retirez «\u{00A0}\(name)\u{00A0}». Si elle reste fermée, ne forcez pas et attendez le message suivant.",
          "Open door A1 and take “\(name)”. If it stays shut, don't force it; wait for the next message.")
    }
    var doorOpened: String { t("Porte ouverte", "Door open") }
    var takeAndClose: String { t("Retirez l'équipement, puis refermez la porte.", "Take the equipment, then close the door.") }
    var depositAndClose: String { t("Déposez l'équipement, puis refermez la porte.", "Put the equipment back, then close the door.") }
    var checkoutConfirmed: String { t("Retrait confirmé", "Checkout confirmed") }
    func loanStarted(_ time: String) -> String { t("Le prêt est enregistré. Retour prévu à \(time).", "The loan is recorded. Due back at \(time).") }
    var timeExceeded: String { t("Délai dépassé", "Time limit reached") }
    var noDoorOpenedRestart: String { t("Aucune porte n'a été ouverte. Recommencez la préparation.", "No door was opened. Start the checkout again.") }
    var interventionRequired: String { t("Intervention requise", "Intervention required") }
    var dontRetryAdmin: String { t("Ne réessayez pas. Un administrateur doit vérifier la cellule A1.", "Don't try again. An administrator must check compartment A1.") }
    var scanCode: String { t("Scanner le code", "Scan the code") }
    var seeActivity: String { t("Voir mon activité", "View my activity") }
    var prepareAgain: String { t("Recommencer", "Start again") }
    var prepareAgainSpoken: String { t("Recommencer le retrait", "Start the checkout again") }
    var prepareAgainHint: String {
        t("Relance la préparation du retrait.", "Starts checkout preparation again.")
    }
    var phases: [String] { lang == .fr
        ? ["Demande", "Code du casier", "Autorisation", "Commande", "Porte", "Vérification"]
        : ["Request", "Locker code", "Authorization", "Command", "Door", "Verification"] }
    var stepDone: String { t("terminé", "done") }
    var stepCurrent: String { t("en cours", "in progress") }
    var stepPending: String { t("à venir", "pending") }
    var stepLastReceived: String { t("dernier état reçu, suivi interrompu", "last status received, tracking interrupted") }
    var cameraDenied: String { t("Autorisez l'appareil photo dans Réglages pour scanner le code.", "Allow camera access in Settings to scan the code.") }
    var openSettings: String { t("Ouvrir Réglages", "Open Settings") }
    var cameraSimulation: String { t("Simulation — aucune caméra", "Simulation — no camera") }
    var cameraPreviewSpoken: String { t("Aperçu de l'appareil photo", "Camera preview") }
    var expiresIn: String { t("Expire dans 0:47", "Expires in 0:47") }
    var scanReminder: String { t("Le scan n'ouvre rien tant que le serveur n'a pas autorisé.", "Scanning unlocks nothing until the server authorizes it.") }
}
