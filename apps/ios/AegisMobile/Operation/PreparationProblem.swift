import Foundation

/// Why preparing a checkout did not open a guided operation (doc 09 §15.1,
/// handoff `mobile-parcours` §7.1). A 401 is not one: it ends the session.
enum PreparationProblem: Equatable, Sendable {
    /// No HTTP answer: the outcome is unknown, so a new tap reuses the key.
    case unreachable
    /// 5xx other than a locker or cell fact, an unreadable answer or the same
    /// key still in progress: unknown too, and the key is kept.
    case service(traceId: String?)
    /// A definitive answer: the next tap is a new intent with a new key, and
    /// Mon activité is read again (§8.10 rule 5).
    case refused(Refusal)

    enum Refusal: Equatable, Sendable {
        case lockerBusy
        case lockerOffline
        case compartmentUnavailable
        case compartmentUnsafe
        case presenceUnknown
        case lockerClosed
        /// The reservation is no longer one that can be checked out.
        case noLongerPossible
        case accessDenied
        case rateLimited(retryAfter: Duration?)
        /// Any other refusal; only a clean trace id is kept.
        case other(traceId: String?)
    }

    init(_ error: APIError) {
        switch error {
        case .unreachable, .cancelled:
            self = .unreachable
        case .invalidResponse:
            self = .service(traceId: nil)
        case let .http(status, problem, retryAfter):
            let traceId = problem?.traceId.flatMap(SessionModel.displayableTraceId)
            switch (status, problem?.code) {
            case (409, "LOCKER_OPERATION_IN_PROGRESS"): self = .refused(.lockerBusy)
            case (503, "LOCKER_OFFLINE"): self = .refused(.lockerOffline)
            case (503, "DEVICE_UNAVAILABLE"): self = .refused(.compartmentUnavailable)
            case (409, "COMPARTMENT_STATE_UNSAFE"): self = .refused(.compartmentUnsafe)
            case (422, "PHYSICAL_STATE_UNKNOWN"): self = .refused(.presenceUnknown)
            case (422, "OUTSIDE_OPERATING_HOURS"): self = .refused(.lockerClosed)
            case (403, "ASSET_ACCESS_DENIED"): self = .refused(.accessDenied)
            case (429, _): self = .refused(.rateLimited(retryAfter: retryAfter))
            case (_, "IDEMPOTENCY_REQUEST_IN_PROGRESS"), (500..., _): self = .service(traceId: traceId)
            // The reservation ended, was fulfilled, or its asset left: §7.1
            // « Cette action n'est plus possible. », then a new read.
            case (409, "RESERVATION_NOT_CANCELLABLE"), (409, "ASSET_HAS_OPEN_LOAN"), (404, _):
                self = .refused(.noLongerPossible)
            default: self = .refused(.other(traceId: traceId))
            }
        }
    }

    var keepsKey: Bool {
        if case .refused = self { false } else { true }
    }

    var traceId: String? {
        switch self {
        case let .service(traceId), let .refused(.other(traceId)): traceId
        default: nil
        }
    }

    /// `compartment` is the cell code shown to the technician, such as A1.
    func message(compartment: String) -> String {
        switch self {
        case .unreachable: String(localized: "Connexion au service impossible.")
        case .service: String(localized: "Le service n’a pas pu traiter la demande.")
        case let .refused(refusal): refusal.message(compartment: compartment)
        }
    }
}

extension PreparationProblem.Refusal {
    /// Approved texts of handoff §7.1; the access and rate-limit texts reuse
    /// the approved reservation and sign-in sentences of the same meaning.
    func message(compartment: String) -> String {
        switch self {
        case .lockerBusy:
            String(localized: "Le casier est occupé par une autre opération. Réessayez dans un instant.")
        case .lockerOffline:
            String(localized: "Le casier est hors ligne. Réessayez plus tard.")
        case .compartmentUnavailable:
            String(localized: "La cellule \(compartment) est indisponible. Prévenez un administrateur.")
        case .compartmentUnsafe:
            String(localized: "La cellule \(compartment) n’est pas dans un état sûr. Prévenez un administrateur.")
        case .presenceUnknown:
            String(localized: "La présence de l’équipement n’est pas confirmée. Réessayez plus tard.")
        case .lockerClosed:
            String(localized: "Le casier est fermé.")
        case .noLongerPossible:
            String(localized: "Cette action n’est plus possible.")
        case .accessDenied:
            String(localized: "Votre niveau d’accès ne permet pas cet équipement.")
        case let .rateLimited(retryAfter?) where (1...3600).contains(retryAfter.components.seconds):
            String(localized: "Trop de tentatives. Réessayez dans \(SignInText.duration(retryAfter)).",
                   comment: "The argument is a localized duration, for example 55 seconds")
        case .rateLimited:
            String(localized: "Trop de tentatives. Réessayez plus tard.")
        case .other:
            String(localized: "Le service a refusé la demande.")
        }
    }
}
