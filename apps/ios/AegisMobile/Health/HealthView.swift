import SwiftUI

/// Technical connectivity check of FND-02B. It is not one of the approved
/// business sections; it only proves that the app reaches Aegis Control.
/// The caller provides the navigation container.
struct HealthView: View {
    let model: HealthViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Vérifie que l’application joint le service Aegis Control.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HealthStatusCard(state: model.state)

                actionButton

                if let host = model.serviceHost {
                    Label("Adresse : \(host)", systemImage: "server.rack")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("health.host")
                }
            }
            .padding(20)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background { BrandBackground() }
        .navigationTitle("Service Aegis")
        .task { await model.load() }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch model.state {
        case .failed(let failure) where failure.isRetryable:
            Button {
                Task { await model.load() }
            } label: {
                Label("Réessayer", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("health.retry")
        case .loaded:
            Button {
                Task { await model.load() }
            } label: {
                Label("Actualiser", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityIdentifier("health.refresh")
        case .idle, .loading, .failed:
            EmptyView()
        }
    }
}

private struct HealthStatusCard: View {
    let state: HealthViewModel.State

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch state {
            case .idle, .loading:
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Vérification du service…")
                        .font(.headline)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("health.loading")

            case .loaded(let health):
                loaded(health)

            case .failed(let failure):
                failed(failure)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .animation(.default, value: state)
    }

    @ViewBuilder
    private func loaded(_ health: SystemHealth) -> some View {
        switch health.status {
        case .up:
            StatusHeadline(title: "Service opérationnel", symbol: "checkmark.circle.fill", tint: .readyIcon)
                .accessibilityIdentifier("health.status")
        case .other(let raw):
            StatusHeadline(title: "État signalé : \(raw)", symbol: "exclamationmark.triangle.fill", tint: .unknownIcon)
                .accessibilityIdentifier("health.status")
            Text("Le service répond mais ne se déclare pas opérationnel.")
                .foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 10) {
            Fact(label: "Service", value: Text(health.service))
            Fact(label: "Version", value: Text(health.version))
            Fact(label: "Heure du service",
                 value: Text(health.timestamp, format: .dateTime.day().month().hour().minute().second()))
        }
        .font(.subheadline)
    }

    @ViewBuilder
    private func failed(_ failure: HealthFailure) -> some View {
        Group {
            switch failure {
            case .unreachable:
                StatusHeadline(title: "Service injoignable", symbol: "wifi.exclamationmark", tint: .blockedIcon)
                Text("Connexion au service impossible. Vérifiez le réseau.")
            case .unavailable(let status, let traceId):
                StatusHeadline(title: "Service indisponible", symbol: "exclamationmark.triangle.fill", tint: .blockedIcon)
                Text("Le service a répondu avec l’erreur \(status). Réessayez dans un instant.")
                if let traceId {
                    Text("Identifiant de suivi : \(traceId)")
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            case .unexpectedResponse:
                StatusHeadline(title: "Réponse inattendue", symbol: "exclamationmark.triangle.fill", tint: .blockedIcon)
                Text("Le service a répondu dans un format inattendu. Vérifiez l’adresse configurée.")
            case .misconfigured:
                StatusHeadline(title: "Adresse du service absente", symbol: "gearshape.fill", tint: .unknownIcon)
                Text("Cette version de l’application n’a pas d’adresse de service valide.")
            }
        }
        .accessibilityIdentifier("health.error")
    }
}

/// Label and value side by side, stacked at accessibility text sizes so
/// neither is squeezed.
private struct Fact: View {
    let label: LocalizedStringKey
    let value: Text

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        layout {
            Text(label)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 12) }
            value
                .foregroundStyle(.secondary)
                .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct StatusHeadline: View {
    let title: LocalizedStringKey
    let symbol: String
    let tint: Color

    var body: some View {
        Label {
            Text(title)
                .font(.title3.weight(.semibold))
        } icon: {
            Image(systemName: symbol)
                .foregroundStyle(tint)
        }
    }
}

/// Decorative blue–indigo depth of treatment A. Content always sits on an
/// opaque surface, and the glow disappears when transparency is reduced.
private struct BrandBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            Color.canvas
            if !reduceTransparency {
                RadialGradient(colors: [Color.glowBlue.opacity(0.35), .clear],
                               center: .topLeading, startRadius: 0, endRadius: 420)
                RadialGradient(colors: [Color.glowIndigo.opacity(0.25), .clear],
                               center: .topTrailing, startRadius: 0, endRadius: 360)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

#Preview("Chargement") {
    NavigationStack {
        HealthView(model: HealthViewModel(checker: PreviewHealthChecker(result: nil), serviceHost: "localhost"))
    }
}

#Preview("Erreur réseau") {
    NavigationStack {
        HealthView(model: HealthViewModel(
            checker: PreviewHealthChecker(result: .failure(.unreachable(.cannotConnectToHost))),
            serviceHost: "localhost"))
    }
}

#Preview("Opérationnel") {
    NavigationStack {
        HealthView(model: HealthViewModel(
            checker: PreviewHealthChecker(result: .success(SystemHealth(
                status: .up, service: "aegis-control", version: "0.1.0", timestamp: .now))),
            serviceHost: "localhost"))
    }
}

/// Preview double; `nil` keeps the request pending to show the loading state.
private struct PreviewHealthChecker: HealthChecking {
    let result: Result<SystemHealth, APIError>?

    func fetchHealth() async throws(APIError) -> SystemHealth {
        guard let result else {
            try? await Task.sleep(for: .seconds(3600))
            throw .cancelled
        }
        return try result.get()
    }
}
