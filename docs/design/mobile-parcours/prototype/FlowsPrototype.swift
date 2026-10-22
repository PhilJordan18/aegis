// Design prototype of the technician flows after sign-in (#35). Static
// presentation only: fictional data, no network, no camera, no locker.
// render.sh compiles it into a temporary copy of apps/ios (reusing the app's
// v3 colours and components) to produce ../captures/; it is never part of
// the application.
//
// Launch variables: AEGIS_PROTO_SCREEN (see Screen), AEGIS_PROTO_LANG (fr | en).

import SwiftUI

@main
struct FlowsPrototypeApp: App {
    private let environment = ProcessInfo.processInfo.environment

    var body: some Scene {
        WindowGroup {
            let lang = Lang(rawValue: environment["AEGIS_PROTO_LANG"] ?? "") ?? .fr
            FlowsRoot(screen: Screen(rawValue: environment["AEGIS_PROTO_SCREEN"] ?? "") ?? .catalogue,
                      t: Copy(lang: lang))
                .environment(\.locale, lang.locale)
                .environment(\.timeZone, TimeZone(identifier: "America/Toronto")!)
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
    case awaitingDisplay = "operation-code-en-attente"
    case scan
    case scanCameraDenied = "scan-camera-refusee"
    case authorized = "operation-autorisee"
    case unlockStarted = "operation-deverrouillage"
    case networkLost = "operation-reseau-perdu"
    case confirmed = "operation-confirmee"
    case returnDoorOpen = "retour-porte-ouverte"
    case expired = "operation-expiree"
    case anomaly = "operation-anomalie"

    var tab: FlowTab {
        switch self {
        case .catalogue, .catalogueLoading, .catalogueEmpty, .catalogueOffline,
             .assetReady, .assetBlocked, .reserve, .reserveClosed: .equipment
        default: .activity
        }
    }
}

fileprivate enum FlowTab: Hashable { case equipment, activity, account }

// MARK: - Root and tabs

fileprivate struct FlowsRoot: View {
    let screen: Screen
    let t: Copy

    var body: some View {
        switch screen {
        case .awaitingDisplay, .scan, .scanCameraDenied, .authorized, .unlockStarted,
             .networkLost, .confirmed, .returnDoorOpen, .expired, .anomaly:
            OperationScreen(screen: screen, t: t)
        default:
            TabView(selection: .constant(screen.tab)) {
                NavigationStack { equipmentContent }
                    .tabItem { Label(t.tabEquipment, systemImage: "shippingbox") }
                    .tag(FlowTab.equipment)
                NavigationStack { ActivityScreen(screen: screen, t: t) }
                    .tabItem { Label(t.tabActivity, systemImage: "checklist") }
                    .tag(FlowTab.activity)
                NavigationStack { Color.brandTop }
                    .tabItem { Label(t.tabAccount, systemImage: "person.crop.circle") }
                    .tag(FlowTab.account)
            }
        }
    }

    @ViewBuilder
    private var equipmentContent: some View {
        switch screen {
        case .assetReady, .assetBlocked, .reserve, .reserveClosed:
            AssetSheetScreen(screen: screen, t: t)
        default:
            CatalogueScreen(screen: screen, t: t)
        }
    }
}

// MARK: - Catalogue

fileprivate struct CatalogueScreen: View {
    let screen: Screen
    let t: Copy

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                FilterBar(t: t)
                if screen == .catalogueOffline {
                    NoticeBanner(message: t.offlineBanner, isError: true)
                }
                switch screen {
                case .catalogueLoading:
                    ForEach(0..<3, id: \.self) { _ in
                        AssetCard(status: .ready(t), title: "Multimètre 1", code: "MM-001 · Fluke 117",
                                  detail: t.inCompartment("A1"), detailSymbol: "mappin.and.ellipse")
                            .redacted(reason: .placeholder)
                    }
                    .accessibilityLabel(t.loadingAssets)
                case .catalogueEmpty:
                    EmptyState(symbol: "magnifyingglass", title: t.noMatch, action: t.clearFilters)
                default:
                    AssetCard(status: .ready(t), title: "Multimètre 1", code: "MM-001 · Fluke 117",
                              detail: t.inCompartment("A1"), detailSymbol: "mappin.and.ellipse")
                    AssetCard(status: .blocked(t), title: "Multimètre 2", code: "MM-002 · Fluke 117",
                              detail: t.calibrationExpired, detailSymbol: "exclamationmark.octagon.fill",
                              hint: t.chooseAnother)
                    AssetCard(status: .borrowed(t), title: "Pince ampèremétrique", code: "PA-004 · Klein CL800",
                              detail: t.unavailableUntilReturn, detailSymbol: "clock")
                    AssetCard(status: .unknown(t), title: "Thermomètre infrarouge", code: "TI-002 · Fluke 62 Max",
                              detail: t.presenceUnconfirmed, detailSymbol: "questionmark.diamond.fill",
                              hint: t.tryLater)
                    Text(screen == .catalogueOffline ? t.notRefreshed : t.evaluatedAt)
                        .font(.footnote)
                        .foregroundStyle(Color.brandMuted)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle(t.tabEquipment)
        .searchable(text: .constant(screen == .catalogueEmpty ? "oscilloscope" : ""),
                    placement: .navigationBarDrawer(displayMode: .always), prompt: t.searchPrompt)
    }
}

fileprivate struct FilterBar: View {
    let t: Copy

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: t.filterAll, symbol: nil, selected: true)
                FilterChip(title: t.statusReady, symbol: "checkmark.circle.fill", selected: false)
                FilterChip(title: t.statusBlocked, symbol: "minus.circle.fill", selected: false)
                FilterChip(title: t.statusUnknown, symbol: "questionmark.diamond.fill", selected: false)
            }
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
        .padding(.horizontal, 14)
        .frame(minHeight: 36)
        .foregroundStyle(selected ? Color.white : Color.brandText)
        .background(selected ? Color.accentColor : Color.brandPanel, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? Color.clear : Color.brandBorder))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

fileprivate struct AssetCard: View {
    let status: StatusChip
    let title: String
    let code: String
    let detail: String
    let detailSymbol: String
    var hint: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                status
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Color.brandMuted)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title).font(.title3.weight(.semibold)).foregroundStyle(Color.brandText)
                Text(verbatim: code).font(.subheadline.monospacedDigit()).foregroundStyle(Color.brandMuted)
            }
            Divider()
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(detail).foregroundStyle(Color.brandText)
                    if let hint { Text(hint).font(.footnote).foregroundStyle(Color.brandMuted) }
                }
            } icon: {
                Image(systemName: detailSymbol).foregroundStyle(status.kind.icon)
            }
            .font(.subheadline)
        }
        .padding(18)
        .background(Color.brandPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.brandBorder))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
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

    static func ready(_ t: Copy) -> StatusChip { .init(kind: .ready, text: t.statusReady, symbol: "checkmark.circle.fill") }
    static func blocked(_ t: Copy) -> StatusChip { .init(kind: .blocked, text: t.statusBlocked, symbol: "minus.circle.fill") }
    static func unknown(_ t: Copy) -> StatusChip { .init(kind: .unknown, text: t.statusUnknown, symbol: "questionmark.diamond.fill") }
    static func borrowed(_ t: Copy) -> StatusChip { .init(kind: .neutral, text: t.statusBorrowed, symbol: "arrow.up.forward.square") }
    static func reservedForYou(_ t: Copy) -> StatusChip { .init(kind: .mine, text: t.statusReservedForYou, symbol: "bookmark.fill") }
    static func borrowedByYou(_ t: Copy) -> StatusChip { .init(kind: .mine, text: t.statusBorrowedByYou, symbol: "person.crop.circle.badge.checkmark") }

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
    }
}

// MARK: - Asset sheet and reservation

fileprivate struct AssetSheetScreen: View {
    let screen: Screen
    let t: Copy

    private var ready: Bool { screen != .assetBlocked }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    ready ? StatusChip.ready(t) : StatusChip.blocked(t)
                    Text(verbatim: ready ? "Multimètre 1" : "Multimètre 2")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(Color.brandText)
                    Text(verbatim: ready ? "MM-001 · Fluke 117" : "MM-002 · Fluke 117")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(Color.brandMuted)
                }
                if !ready {
                    Card {
                        Text(t.reasonsTitle).font(.headline).foregroundStyle(Color.brandText)
                        ReasonRow(symbol: "exclamationmark.octagon.fill", kind: .blocked,
                                  title: t.calibrationExpired, hint: t.chooseAnother)
                        ReasonRow(symbol: "lock.fill", kind: .blocked,
                                  title: t.accessDenied, hint: t.askAccess)
                    }
                }
                Card {
                    Fact(label: t.calibration, value: ready ? t.calibrationValid : t.calibrationExpiredOn)
                    Divider()
                    Fact(label: t.requiredAccess, value: ready ? t.levelStandard : t.levelRestricted)
                    Divider()
                    Fact(label: t.compartment, value: ready ? "A1 · AEGIS-DEMO-01" : "A2 · AEGIS-DEMO-01")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(t.reserve) {}
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!ready)
                    if !ready {
                        Text(t.reserveImpossible).font(.footnote).foregroundStyle(Color.brandMuted)
                    }
                }
            }
            .padding(20)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: .constant(screen == .reserve || screen == .reserveClosed)) {
            ReserveSheet(closed: screen == .reserveClosed, t: t)
                .presentationDetents([.large])
        }
    }
}

fileprivate struct ReserveSheet: View {
    let closed: Bool
    let t: Copy

    /// 16:30, locker time (America/Toronto), for the static render.
    static let sampleReturn: Date = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 16, minute: 30))!
    }()

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(verbatim: "Multimètre 1 · MM-001").font(.headline).foregroundStyle(Color.brandText)
                Text(t.inCompartment("A1")).foregroundStyle(Color.brandMuted)
                if closed {
                    NoticeBanner(message: t.lockerClosed, isError: true)
                } else {
                    Card {
                        // Native time picker, bounded by currentWindow.closesAt in the app.
                        DatePicker(t.returnBy, selection: .constant(Self.sampleReturn),
                                   displayedComponents: .hourAndMinute)
                            .foregroundStyle(Color.brandText)
                        Divider()
                        Fact(label: t.lockerCloses, value: t.closingTime)
                    }
                    Label(t.reserveReminder, systemImage: "lock.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color.brandText)
                }
                Spacer()
                Button(t.confirmReservation) {}
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(closed)
            }
            .padding(20)
            .background(Color.brandPanel.ignoresSafeArea())
            .navigationTitle(t.reserve)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t.cancel) {} } }
        }
    }
}

// MARK: - My activity

fileprivate struct ActivityScreen: View {
    let screen: Screen
    let t: Copy

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch screen {
                case .activityEmpty:
                    EmptyState(symbol: "tray", title: t.noActivity, action: t.seeEquipment)
                case .activityReservation:
                    ActivityCard(chip: .reservedForYou(t), line: t.pickUpBefore, action: t.prepareCheckout,
                                 secondary: t.cancelReservation)
                case .activityLoanOverdue:
                    ActivityCard(chip: .borrowedByYou(t), line: t.overdueSince, action: t.returnEquipment,
                                 secondary: nil, warning: true)
                case .activityLockerOffline:
                    NoticeBanner(message: t.lockerOffline, isError: true)
                    ActivityCard(chip: .reservedForYou(t), line: t.pickUpBefore, action: t.prepareCheckout,
                                 secondary: t.cancelReservation)
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

fileprivate struct ActivityCard: View {
    let chip: StatusChip
    let line: String
    let action: String
    let secondary: String?
    var warning = false

    var body: some View {
        Card {
            chip
            Text(verbatim: "Multimètre 1").font(.title2.weight(.semibold)).foregroundStyle(Color.brandText)
            Text(verbatim: "MM-001 · A1").font(.subheadline.monospacedDigit()).foregroundStyle(Color.brandMuted)
            Label(line, systemImage: warning ? "exclamationmark.triangle.fill" : "clock")
                .font(.subheadline)
                .foregroundStyle(warning ? Color.errorText : Color.brandText)
            Button(action) {}.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            if let secondary {
                Button(secondary) {}.buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}

// MARK: - Guided operation

fileprivate struct OperationScreen: View {
    let screen: Screen
    let t: Copy

    /// Phases: 1 Request, 2 Locker code, 3 Authorization, 4 Command, 5 Door,
    /// 6 Verification; 7 means every phase is done (CONFIRMED only).
    private var phase: Int {
        switch screen {
        case .awaitingDisplay, .scan, .scanCameraDenied: 2
        case .authorized: 3
        case .unlockStarted: 4
        case .networkLost, .returnDoorOpen: 5
        case .confirmed: 7
        case .expired: 5
        case .anomaly: 6
        default: 1
        }
    }

    private var isReturn: Bool { screen == .returnDoorOpen }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Button(t.close) {}.font(.body.weight(.semibold))
                    Spacer()
                    Text(isReturn ? t.guidedReturn : t.guidedCheckout)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color.brandMuted)
                }
                if screen == .networkLost {
                    NoticeBanner(message: t.connectionLost, isError: true)
                }
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(verbatim: "A1")
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.brandAccent)
                        .accessibilityLabel(t.compartmentSpoken("A1"))
                    Text(verbatim: "Multimètre 1 · MM-001").font(.headline).foregroundStyle(Color.brandText)
                }
                StepHeader(screen: screen, t: t)
                if let countdown = countdown {
                    Label {
                        Text(countdown).font(.title3.monospacedDigit().weight(.semibold))
                    } icon: {
                        Image(systemName: "timer")
                    }
                    .foregroundStyle(Color.brandText)
                    .accessibilityLabel(t.remainingSpoken)
                }
                PhaseList(current: phase, failed: screen == .expired || screen == .anomaly, t: t)
                actions
            }
            .padding(20)
        }
        .background(Color.brandTop.ignoresSafeArea())
        .sheet(isPresented: .constant(screen == .scan || screen == .scanCameraDenied)) {
            ScanSheet(denied: screen == .scanCameraDenied, t: t)
        }
    }

    private var countdown: String? {
        switch screen {
        case .authorized: "1:58"
        case .unlockStarted: "1:41"
        case .networkLost, .returnDoorOpen: "1:12"
        default: nil
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch screen {
        case .awaitingDisplay:
            Button(t.scanCode) {}.buttonStyle(PrimaryButtonStyle()).disabled(true)
        case .confirmed:
            Button(t.seeActivity) {}.buttonStyle(PrimaryButtonStyle())
        case .expired:
            Button(t.prepareAgain) {}.buttonStyle(PrimaryButtonStyle())
        case .anomaly:
            Button(t.seeActivity) {}.buttonStyle(SecondaryButtonStyle())
        default:
            EmptyView()
        }
    }
}

fileprivate struct StepHeader: View {
    let screen: Screen
    let t: Copy

    var body: some View {
        let (title, instruction, kind): (String, String, StatusChip.Kind) = {
            switch screen {
            case .awaitingDisplay: (t.codeAppearing, t.approachScreen, .progress)
            case .scan, .scanCameraDenied: (t.scanTitle, t.noDoorOpen, .progress)
            case .authorized: (t.accessAuthorized, t.dontOpenYet, .progress)
            case .unlockStarted: (t.unlockStarted, t.openDoorAndTake, .progress)
            case .networkLost: (t.doorOpened, t.takeAndClose, .progress)
            case .returnDoorOpen: (t.doorOpened, t.depositAndClose, .progress)
            case .confirmed: (t.checkoutConfirmed, t.loanStarted, .ready)
            case .expired: (t.timeExceeded, t.noDoorOpenedRestart, .blocked)
            case .anomaly: (t.interventionRequired, t.dontRetryAdmin, .blocked)
            default: ("", "", .neutral)
            }
        }()
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title.weight(.semibold))
                .foregroundStyle(kind == .blocked ? Color.errorText : Color.brandText)
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
                .accessibilityValue(step < current ? t.stepDone : step == current ? t.stepCurrent : t.stepPending)
            }
        }
    }

    private func symbol(for step: Int) -> String {
        if step < current { return "checkmark.circle.fill" }
        if step == current { return failed ? "exclamationmark.octagon.fill" : "circle.dotted.circle" }
        return "circle"
    }

    private func color(for step: Int) -> Color {
        if step < current { return StatusChip.Kind.ready.icon }
        if step == current { return failed ? StatusChip.Kind.blocked.icon : StatusChip.Kind.progress.icon }
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

fileprivate enum Lang: String {
    case fr, en
    var locale: Locale { Locale(identifier: self == .fr ? "fr_CA" : "en_CA") }
}

fileprivate struct Copy {
    let lang: Lang
    private func t(_ fr: String, _ en: String) -> String { lang == .fr ? fr : en }

    var tabEquipment: String { t("Équipements", "Equipment") }
    var tabActivity: String { t("Mon activité", "My activity") }
    var tabAccount: String { t("Compte", "Account") }
    var searchPrompt: String { t("Code ou modèle", "Code or model") }
    var filterAll: String { t("Tous", "All") }
    var statusReady: String { t("Prêt", "Ready") }
    var statusBlocked: String { t("Bloqué", "Blocked") }
    var statusUnknown: String { t("À vérifier", "Needs checking") }
    var statusBorrowed: String { t("Emprunté", "Borrowed") }
    var statusReservedForYou: String { t("Réservé pour vous", "Reserved for you") }
    var statusBorrowedByYou: String { t("Emprunté par vous", "Borrowed by you") }
    func inCompartment(_ code: String) -> String { t("Disponible dans la cellule \(code)", "Available in compartment \(code)") }
    var calibrationExpired: String { t("Calibration expirée depuis le 8 sept. 2026", "Calibration expired since Sept. 8, 2026") }
    var chooseAnother: String { t("Choisissez un autre équipement.", "Choose another piece of equipment.") }
    var unavailableUntilReturn: String { t("Indisponible jusqu'au retour", "Unavailable until returned") }
    var presenceUnconfirmed: String { t("Présence non confirmée par le casier", "Presence not confirmed by the locker") }
    var tryLater: String { t("Réessayez plus tard.", "Try again later.") }
    var evaluatedAt: String { t("État évalué à 14 h 30, heure du casier.", "Status checked at 2:30 p.m., locker time.") }
    var notRefreshed: String { t("Informations non actualisées", "Information not refreshed") }
    var offlineBanner: String { t("Connexion au service impossible. Vérifiez le réseau.", "Can't reach the service. Check your network.") }
    var loadingAssets: String { t("Chargement des équipements", "Loading equipment") }
    var noMatch: String { t("Aucun équipement ne correspond.", "No equipment matches.") }
    var clearFilters: String { t("Effacer les filtres", "Clear filters") }
    var reasonsTitle: String { t("Pourquoi il est bloqué", "Why it is blocked") }
    var accessDenied: String { t("Niveau d'accès insuffisant", "Access level too low") }
    var askAccess: String { t("Demandez l'accès à un administrateur.", "Ask an administrator for access.") }
    var calibration: String { t("Calibration", "Calibration") }
    var calibrationValid: String { t("Valide jusqu'au 1er déc. 2026", "Valid until Dec. 1, 2026") }
    var calibrationExpiredOn: String { t("Expirée le 8 sept. 2026", "Expired on Sept. 8, 2026") }
    var requiredAccess: String { t("Niveau d'accès requis", "Required access level") }
    var levelStandard: String { t("Standard", "Standard") }
    var levelRestricted: String { t("Restreint", "Restricted") }
    var compartment: String { t("Cellule", "Compartment") }
    var reserve: String { t("Réserver", "Reserve") }
    var reserveImpossible: String { t("Réservation impossible : calibration expirée.", "Can't reserve: calibration expired.") }
    var returnBy: String { t("Heure de retour", "Return by") }
    var returnTime: String { t("16 h 30", "4:30 p.m.") }
    var lockerCloses: String { t("Fermeture du casier", "Locker closes") }
    var closingTime: String { t("18 h 00", "6:00 p.m.") }
    var reserveReminder: String { t("Retirez l'équipement avant cette heure; la réservation n'ouvre aucune porte.", "Pick up the equipment before this time; the reservation opens no door.") }
    var confirmReservation: String { t("Confirmer la réservation", "Confirm reservation") }
    var lockerClosed: String { t("Le casier est fermé. Réouverture à 7 h 00.", "The locker is closed. It reopens at 7:00 a.m.") }
    var cancel: String { t("Annuler", "Cancel") }
    var noActivity: String { t("Aucune réservation ni prêt en cours.", "No reservation or loan in progress.") }
    var seeEquipment: String { t("Voir les équipements", "See equipment") }
    var pickUpBefore: String { t("À retirer avant 16 h 30", "Pick up before 4:30 p.m.") }
    var prepareCheckout: String { t("Préparer le retrait", "Prepare checkout") }
    var cancelReservation: String { t("Annuler la réservation", "Cancel reservation") }
    var overdueSince: String { t("En retard depuis 16 h 30 — rapportez l'équipement.", "Overdue since 4:30 p.m. — bring the equipment back.") }
    var returnEquipment: String { t("Retourner l'équipement", "Return equipment") }
    var lockerOffline: String { t("Le casier est hors ligne. Réessayez plus tard.", "The locker is offline. Try again later.") }
    var close: String { t("Fermer", "Close") }
    var guidedCheckout: String { t("Retrait guidé", "Guided checkout") }
    var guidedReturn: String { t("Retour guidé", "Guided return") }
    var connectionLost: String { t("Connexion perdue. L'opération continue sur le casier; la progression reprendra dès le retour du réseau.", "Connection lost. The operation continues at the locker; progress resumes when the network is back.") }
    func compartmentSpoken(_ code: String) -> String { t("Cellule \(code)", "Compartment \(code)") }
    var remainingSpoken: String { t("Temps restant", "Time remaining") }
    var codeAppearing: String { t("Le code s'affiche sur le casier", "The code is appearing on the locker") }
    var approachScreen: String { t("Approchez-vous de l'écran du casier.", "Go to the locker screen.") }
    var scanTitle: String { t("Scannez le code du casier", "Scan the locker code") }
    var noDoorOpen: String { t("Aucune porte n'est ouverte.", "No door is open.") }
    var accessAuthorized: String { t("Accès autorisé", "Access authorized") }
    var dontOpenYet: String { t("Déverrouillage de A1 en préparation. N'ouvrez pas encore.", "Preparing to unlock A1. Don't open yet.") }
    var unlockStarted: String { t("Déverrouillage lancé", "Unlock started") }
    var openDoorAndTake: String { t("Ouvrez la porte A1 et retirez le multimètre. Si elle reste fermée, ne forcez pas et attendez le message suivant.", "Open door A1 and take the multimeter. If it stays shut, don't force it and wait for the next message.") }
    var doorOpened: String { t("Porte ouverte", "Door open") }
    var takeAndClose: String { t("Retirez l'équipement, puis refermez la porte.", "Take the equipment, then close the door.") }
    var depositAndClose: String { t("Déposez l'équipement, puis refermez la porte.", "Put the equipment back, then close the door.") }
    var checkoutConfirmed: String { t("Retrait confirmé", "Checkout confirmed") }
    var loanStarted: String { t("Le prêt est enregistré. Retour prévu à 16 h 30.", "The loan is recorded. Return due at 4:30 p.m.") }
    var timeExceeded: String { t("Délai dépassé", "Time limit reached") }
    var noDoorOpenedRestart: String { t("Aucune porte n'a été ouverte. Recommencez la préparation.", "No door was opened. Prepare again.") }
    var interventionRequired: String { t("Intervention requise", "Intervention required") }
    var dontRetryAdmin: String { t("Ne réessayez pas. Un administrateur doit vérifier la cellule A1.", "Don't try again. An administrator must check compartment A1.") }
    var scanCode: String { t("Scanner le code", "Scan the code") }
    var seeActivity: String { t("Voir mon activité", "See my activity") }
    var prepareAgain: String { t("Recommencer la préparation", "Prepare again") }
    var phases: [String] { lang == .fr
        ? ["Demande", "Code du casier", "Autorisation", "Commande", "Porte", "Vérification"]
        : ["Request", "Locker code", "Authorization", "Command", "Door", "Verification"] }
    var stepDone: String { t("terminé", "done") }
    var stepCurrent: String { t("en cours", "in progress") }
    var stepPending: String { t("à venir", "pending") }
    var cameraDenied: String { t("Autorisez l'appareil photo dans Réglages pour scanner le code.", "Allow the camera in Settings to scan the code.") }
    var openSettings: String { t("Ouvrir Réglages", "Open Settings") }
    var cameraSimulation: String { t("Simulation — aucune caméra", "Simulation — no camera") }
    var cameraPreviewSpoken: String { t("Aperçu de l'appareil photo", "Camera preview") }
    var expiresIn: String { t("Expire dans 0:47", "Expires in 0:47") }
    var scanReminder: String { t("Le scan n'ouvre rien tant que le serveur n'a pas autorisé.", "Scanning opens nothing until the server authorizes it.") }
}
