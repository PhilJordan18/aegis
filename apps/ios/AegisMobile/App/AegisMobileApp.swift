import SwiftUI

@main
struct AegisMobileApp: App {
    @State private var health = HealthViewModel(
        configuration: Result { () throws(APIConfiguration.Failure) in try APIConfiguration.resolve() })

    var body: some Scene {
        WindowGroup {
            HealthView(model: health)
        }
    }
}
