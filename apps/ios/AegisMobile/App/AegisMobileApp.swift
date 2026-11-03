import SwiftUI

@main
struct AegisMobileApp: App {
    @State private var dependencies = AppDependencies.make()

    var body: some Scene {
        WindowGroup {
            RootView(dependencies: dependencies)
        }
    }
}

/// Composition root: the real network and Keychain, replaced only by the
/// Debug-only UI-test hooks of `UITestHooks`.
@MainActor
struct AppDependencies {
    enum StartScreen { case session, health }

    let health: HealthViewModel
    /// Nil when the build has no usable API address.
    let session: SessionModel?
    let catalog: (any AssetCatalogService)?
    let startScreen: StartScreen
    let initialFocus: SessionModel.Field?
    let initialTab: SignedInView.Tab

    static func make() -> AppDependencies {
        let configuration = Result { () throws(APIConfiguration.Failure) in try APIConfiguration.resolve() }
        var transport: any HTTPTransport = URLSessionTransport()
        var store: any SessionStore = KeychainSessionStore()
        var startScreen = StartScreen.session
        var initialFocus: SessionModel.Field?
        var initialTab = SignedInView.Tab.equipment
        #if DEBUG
        let hooks = UITestHooks(environment: ProcessInfo.processInfo.environment)
        hooks.apply(transport: &transport, store: &store, startScreen: &startScreen, focus: &initialFocus,
                    tab: &initialTab)
        #endif

        let client = (try? configuration.get()).map { APIClient(configuration: $0, transport: transport) }
        let session = client.map { SessionModel(auth: $0, store: store) }
        return AppDependencies(health: HealthViewModel(configuration: configuration, transport: transport),
                               session: session, catalog: client, startScreen: startScreen,
                               initialFocus: initialFocus, initialTab: initialTab)
    }
}

struct RootView: View {
    let dependencies: AppDependencies

    var body: some View {
        if let session = dependencies.session, let catalog = dependencies.catalog,
           dependencies.startScreen == .session {
            SessionRootView(session: session, health: dependencies.health, catalog: catalog,
                            initialFocus: dependencies.initialFocus, initialTab: dependencies.initialTab)
        } else {
            NavigationStack { HealthView(model: dependencies.health) }
        }
    }
}

struct SessionRootView: View {
    let session: SessionModel
    let health: HealthViewModel
    let catalog: any AssetCatalogService
    let initialFocus: SessionModel.Field?
    let initialTab: SignedInView.Tab

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch session.phase {
            case .restoring:
                RestoringView()
            case .signIn:
                SignInView(session: session, initialFocus: initialFocus)
            case .resumeOffline:
                OfflineResumeView(session: session)
            case let .signedIn(profile):
                // A new identity per account: no list of a previous session survives.
                SignedInView(session: session, profile: profile, health: health, catalog: catalog,
                             initialTab: initialTab)
                    .id(profile.id)
            case let .wrongRole(email, isAdministrator):
                WrongRoleView(session: session, email: email, isAdministrator: isAdministrator)
            }
        }
        .task { await session.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { session.checkExpiry() }
        }
    }
}

/// Signed-in technician. The approved navigation has three tabs; « Mon
/// activité » arrives with RES-01/RES-02 (#37, #38) and is not shown empty.
struct SignedInView: View {
    enum Tab: Hashable { case equipment, account }

    let session: SessionModel
    let profile: UserProfile
    let health: HealthViewModel
    let catalogService: any AssetCatalogService

    @State private var catalog: CatalogViewModel
    @State private var tab: Tab

    init(session: SessionModel, profile: UserProfile, health: HealthViewModel,
         catalog: any AssetCatalogService, initialTab: Tab) {
        self.session = session
        self.profile = profile
        self.health = health
        catalogService = catalog
        _catalog = State(initialValue: CatalogViewModel(service: catalog, session: session))
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        TabView(selection: $tab) {
            CatalogScreen(model: catalog, makeSheet: makeSheet)
                .tabItem { Label("Équipements", systemImage: "shippingbox") }
                .tag(Tab.equipment)
            AccountView(session: session, profile: profile, health: health)
                .tabItem { Label("Compte", systemImage: "person.crop.circle") }
                .tag(Tab.account)
        }
    }

    private func makeSheet(_ id: UUID) -> AssetSheetViewModel {
        let initial = catalog.item(id).map {
            AssetSheetViewModel.Content(asset: $0.asset, receivedAt: $0.snapshot.receivedAt,
                                        refreshFailure: $0.snapshot.refreshFailure)
        }
        return AssetSheetViewModel(assetId: id, initial: initial, service: catalogService, session: session)
    }
}
