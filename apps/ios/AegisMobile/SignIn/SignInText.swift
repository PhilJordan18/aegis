import Foundation

/// Localized sign-in messages: one short sentence each, built from codes, never
/// from server text. Shared by the visible banner and VoiceOver announcements.
enum SignInText {
    static func message(for notice: SignInNotice) -> String {
        switch notice {
        case .rejected:
            String(localized: "Adresse courriel ou mot de passe incorrect.")
        case let .rateLimited(retryAfter?):
            String(localized: "Trop de tentatives. Réessayez dans \(duration(retryAfter)).",
                   comment: "The argument is a localized duration, for example 55 seconds")
        case .rateLimited(nil):
            String(localized: "Trop de tentatives. Réessayez plus tard.")
        case .unreachable:
            String(localized: "Connexion au service impossible. Vérifiez le réseau.")
        case let .serviceError(traceId?):
            String(localized: "Le service n’a pas pu traiter la connexion. Identifiant de suivi : \(traceId)")
        case .serviceError(nil):
            String(localized: "Le service n’a pas pu traiter la connexion. Réessayez dans un instant.")
        case .invalidFields:
            String(localized: "Vérifiez les champs indiqués.")
        case .storageFailed:
            String(localized: "La session n’a pas pu être enregistrée sur cet appareil. Réessayez.")
        case .expired:
            String(localized: "Votre session a expiré. Vos réservations et prêts sont conservés.")
        case .invalidSession:
            String(localized: "Votre session n’est plus valide. Reconnectez-vous.")
        case .signedOut:
            String(localized: "Vous êtes déconnecté.")
        }
    }

    static func isError(_ notice: SignInNotice) -> Bool {
        switch notice {
        case .expired, .invalidSession, .signedOut: false
        default: true
        }
    }

    static func message(for error: FieldError) -> String {
        switch error {
        case .emailMissing: String(localized: "Saisissez votre adresse courriel.")
        case .emailInvalid: String(localized: "Saisissez une adresse courriel valide.")
        case .emailTooLong: String(localized: "L’adresse courriel est trop longue.")
        case .passwordMissing: String(localized: "Saisissez votre mot de passe.")
        case .passwordRejected: String(localized: "Vérifiez votre mot de passe.")
        }
    }

    /// Native, pluralized duration in the app's locale: "55 secondes", "1 second".
    static func duration(_ value: Duration) -> String {
        value.formatted(.units(allowed: [.minutes, .seconds], width: .wide))
    }
}
