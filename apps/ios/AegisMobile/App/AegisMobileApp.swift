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
    let startScreen: StartScreen
    let initialFocus: SessionModel.Field?

    static func make() -> AppDependencies {
        let configuration = Result { () throws(APIConfiguration.Failure) in try APIConfiguration.resolve() }
        var transport: any HTTPTransport = URLSessionTransport()
        var store: any SessionStore = KeychainSessionStore()
        var startScreen = StartScreen.session
        var initialFocus: SessionModel.Field?
        #if DEBUG
        let hooks = UITestHooks(environment: ProcessInfo.processInfo.environment)
        hooks.apply(transport: &transport, store: &store, startScreen: &startScreen, focus: &initialFocus)
        #endif

        let session = (try? configuration.get()).map {
            SessionModel(auth: APIClient(configuration: $0, transport: transport), store: store)
        }
        return AppDependencies(health: HealthViewModel(configuration: configuration, transport: transport),
                               session: session, startScreen: startScreen, initialFocus: initialFocus)
    }
}

struct RootView: View {
    let dependencies: AppDependencies

    var body: some View {
        if let session = dependencies.session, dependencies.startScreen == .session {
            SessionRootView(session: session, health: dependencies.health,
                            initialFocus: dependencies.initialFocus)
        } else {
            NavigationStack { HealthView(model: dependencies.health) }
        }
    }
}

struct SessionRootView: View {
    let session: SessionModel
    let health: HealthViewModel
    let initialFocus: SessionModel.Field?

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
                AccountView(session: session, profile: profile, health: health)
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
