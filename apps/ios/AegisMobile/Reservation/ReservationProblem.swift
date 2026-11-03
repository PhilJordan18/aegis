import Foundation

/// Why a reservation mutation did not succeed (doc 09 §14.1, §14.4, §20.2,
/// §21). A 401 is not one: it ends the session.
enum ReservationProblem: Equatable, Sendable {
    /// No HTTP answer: the outcome is unknown, so a retry reuses the key.
    case unreachable
    /// 5xx, an unreadable answer or a key still in progress: the outcome is
    /// unknown too, and a retry reuses the key.
    case service(traceId: String?)
    /// A definitive answer: the next attempt is a new intent with a new key,
    /// and the resource is read again (§8.10 rule 5).
    case refused(Refusal)

    enum Mutation { case create, cancel }

    enum Refusal: Equatable, Sendable {
        case accessDenied
        case notReady(ReasonItem)
        case alreadyReserved
        case userHasReservation
        case openLoan
        case lockerClosed
        case endAfterClosing
        case endNotAfterNow
        case assetGone
        case notCancellable
        case reservationGone
        /// Any other refusal; only a clean trace id is kept.
        case other(traceId: String?)
    }

    init(_ error: APIError, mutation: Mutation) {
        switch error {
        case .unreachable, .cancelled:
            self = .unreachable
        case .invalidResponse:
            self = .service(traceId: nil)
        case let .http(status, problem, _):
            let traceId = problem?.traceId.flatMap(SessionModel.displayableTraceId)
            if status >= 500 || problem?.code == "IDEMPOTENCY_REQUEST_IN_PROGRESS" {
                self = .service(traceId: traceId)
            } else {
                self = .refused(Self.refusal(status: status, problem: problem, mutation: mutation, traceId: traceId))
            }
        }
    }

    var keepsKey: Bool {
        if case .refused = self { false } else { true }
    }

    private static func refusal(status: Int, problem: APIProblem?, mutation: Mutation, traceId: String?) -> Refusal {
        switch (mutation, status, problem?.code) {
        case (.create, 403, "ASSET_ACCESS_DENIED"): .accessDenied
        case (.create, 422, "ASSET_NOT_READY"): .notReady(mainReason(problem?.reasons ?? []))
        case (.create, 409, "ASSET_ALREADY_RESERVED"): .alreadyReserved
        case (.create, 409, "USER_ALREADY_HAS_ACTIVE_RESERVATION"): .userHasReservation
        case (.create, 409, "ASSET_HAS_OPEN_LOAN"): .openLoan
        case (.create, 422, "OUTSIDE_OPERATING_HOURS"): .lockerClosed
        case (.create, 422, "RESERVATION_END_AFTER_CLOSING"): .endAfterClosing
        case (.create, 400, "VALIDATION_ERROR")
            where problem?.violations?.contains { $0.field == "reservedUntil" } == true: .endNotAfterNow
        case (.create, 404, _): .assetGone
        // §14.4: FULFILLED or EXPIRED, an authorized checkout or a physical
        // uncertainty. The card is read again and follows its new actions.
        case (.cancel, 409, "RESERVATION_NOT_CANCELLABLE"): .notCancellable
        case (.cancel, 403, _), (.cancel, 404, _): .reservationGone
        default: .other(traceId: traceId)
        }
    }

    /// The first reason in the §1.3 order; an empty or unknown list stays
    /// "not ready" rather than guessing a reason.
    static func mainReason(_ raw: [String]) -> ReasonItem {
        let reasons = raw.map { ReadinessReason(rawValue: $0).map(ContractValue.known) ?? .unrecognized($0) }
        return ReasonItem.ordered(reasons).first ?? .unrecognized
    }

    var message: String {
        switch self {
        case .unreachable: String(localized: "Connexion au service impossible.")
        case .service: String(localized: "Le service n’a pas pu traiter la demande.")
        case let .refused(refusal): refusal.message
        }
    }

    var traceId: String? {
        switch self {
        case let .service(traceId), let .refused(.other(traceId)): traceId
        default: nil
        }
    }
}

extension ReservationProblem.Refusal {
    /// Approved texts of `sections.md` §4.1 and §4.2; the others are proposed.
    var message: String {
        switch self {
        case .accessDenied: String(localized: "Votre niveau d’accès ne permet pas cet équipement.")
        case let .notReady(reason): reason.reservationRefusal
        case .alreadyReserved: String(localized: "Quelqu’un vient de le réserver.")
        case .userHasReservation: String(localized: "Vous avez déjà une réservation active.")
        case .openLoan: String(localized: "Cet équipement est emprunté.")
        case .lockerClosed: String(localized: "Le casier est fermé.")
        case .endAfterClosing: String(localized: "Choisissez une heure avant la fermeture.")
        case .endNotAfterNow: String(localized: "Choisissez une heure plus tardive.")
        case .assetGone: String(localized: "Cet équipement n’est plus disponible.")
        case .notCancellable: String(localized: "Cette réservation ne peut plus être annulée.")
        case .reservationGone: String(localized: "Cette réservation n’est plus disponible.")
        case .other: String(localized: "Le service a refusé la demande.")
        }
    }
}
