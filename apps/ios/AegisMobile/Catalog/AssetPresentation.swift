import Foundation

/// Status shown for an asset (`sections.md` §1.2). A presentation of the
/// fields the server sent; it never evaluates readiness.
enum AssetStatus: Hashable, Sendable {
    case ready
    case blocked
    case needsChecking
    case borrowed
    case alreadyReserved
    case unavailable
    /// The readiness result is a value this client does not know: never ready.
    case unrecognized

    init(_ asset: TechnicianAsset) {
        // §1.2 defensive rule: a borrowed asset is never shown as ready,
        // whatever readiness value is received.
        if asset.availability == .known(.borrowed) {
            self = .borrowed
            return
        }
        switch asset.readiness.result {
        case .known(.ready):
            self = .ready
        case .known(.unknown):
            self = .needsChecking
        case .known(.blocked) where asset.readiness.reasons.contains(.known(.notAvailable)):
            switch asset.availability {
            case .known(.reserved): self = .alreadyReserved
            case .known(.unavailable): self = .unavailable
            default: self = .blocked
            }
        case .known(.blocked):
            self = .blocked
        case .unrecognized:
            self = .unrecognized
        }
    }

    enum Tone: Hashable, Sendable { case ready, blocked, unknown, neutral }

    var tone: Tone {
        switch self {
        case .ready: .ready
        case .blocked: .blocked
        case .needsChecking: .unknown
        case .borrowed, .alreadyReserved, .unavailable, .unrecognized: .neutral
        }
    }

    /// SF Symbol paired with the text; the status is never colour alone.
    var symbol: String {
        switch self {
        case .ready: "checkmark.circle.fill"
        case .blocked: "minus.circle.fill"
        case .needsChecking: "questionmark.diamond.fill"
        case .borrowed: "arrow.up.forward.square"
        case .alreadyReserved: "bookmark.slash"
        case .unavailable: "nosign"
        case .unrecognized: "questionmark.circle"
        }
    }

    var label: String {
        switch self {
        case .ready: String(localized: "Prêt")
        case .blocked: String(localized: "Bloqué")
        case .needsChecking: String(localized: "À vérifier")
        case .borrowed: String(localized: "Emprunté")
        case .alreadyReserved: String(localized: "Déjà réservé")
        case .unavailable: String(localized: "Indisponible")
        case .unrecognized: String(localized: "État indisponible")
        }
    }
}

/// One reason of `readiness.reasons`, ordered by `sections.md` §1.3.
enum ReasonItem: Hashable, Sendable {
    case known(ReadinessReason)
    case unrecognized

    /// The first of the sorted list is the main reason shown on the card.
    static func ordered(_ reasons: [ContractValue<ReadinessReason>]) -> [ReasonItem] {
        var seen = Set<ReasonItem>()
        return reasons
            .map { $0.known.map(ReasonItem.known) ?? .unrecognized }
            .filter { seen.insert($0).inserted }
            .sorted { $0.rank < $1.rank }
    }

    var rank: Int {
        switch self {
        case .known(.notAvailable): 1
        case .known(.notPresent): 2
        case .known(.damaged): 3
        case .known(.maintenance): 4
        case .known(.calibrationExpired): 5
        case .known(.accessDenied): 6
        case .known(.unknownPhysicalState): 7
        case .unrecognized: 8
        }
    }

    var symbol: String {
        switch self {
        case .known(.notAvailable): "clock"
        case .known(.notPresent): "square.dashed"
        case .known(.damaged): "exclamationmark.triangle.fill"
        case .known(.maintenance): "wrench.and.screwdriver.fill"
        case .known(.calibrationExpired): "exclamationmark.octagon.fill"
        case .known(.accessDenied): "lock.fill"
        case .known(.unknownPhysicalState): "questionmark.diamond.fill"
        case .unrecognized: "questionmark.circle"
        }
    }

    func title(for asset: TechnicianAsset) -> String {
        switch self {
        case .known(.notAvailable):
            switch asset.availability {
            case .known(.reserved): String(localized: "Déjà réservé")
            case .known(.borrowed): String(localized: "Emprunté")
            case .known(.unavailable): String(localized: "Indisponible")
            default: String(localized: "Non disponible")
            }
        case .known(.notPresent): String(localized: "Absent de sa cellule")
        case .known(.damaged): String(localized: "Endommagé")
        case .known(.maintenance): String(localized: "En maintenance")
        case .known(.calibrationExpired):
            if let dueAt = asset.calibration.dueAt {
                String(localized: "Calibration expirée depuis le \(AegisTime.laboratoryDateTime(dueAt))")
            } else {
                String(localized: "Calibration expirée")
            }
        case .known(.accessDenied): String(localized: "Niveau d’accès insuffisant")
        case .known(.unknownPhysicalState): String(localized: "Présence non confirmée par le casier")
        case .unrecognized: String(localized: "État indisponible")
        }
    }

    /// The actionable next step of §1.3.
    var guidance: String {
        switch self {
        case .known(.notAvailable), .known(.maintenance), .known(.calibrationExpired):
            String(localized: "Choisissez un autre équipement.")
        case .known(.notPresent), .known(.damaged):
            String(localized: "Prévenez un administrateur.")
        case .known(.accessDenied):
            String(localized: "Demandez l’accès à un administrateur.")
        case .known(.unknownPhysicalState):
            String(localized: "Réessayez plus tard.")
        case .unrecognized:
            String(localized: "Cette version de l’application ne reconnaît pas cette information.")
        }
    }
}

/// The line under the identity on a catalogue card: the main reason or the cell.
struct CardDetail: Hashable, Sendable {
    let symbol: String
    let text: String
    var guidance: String?
}

enum AssetPresentation {
    static func detail(for asset: TechnicianAsset) -> CardDetail? {
        let status = AssetStatus(asset)
        switch status {
        case .ready:
            guard let placement = asset.placement else { return nil }
            let text = asset.availability == .known(.available)
                ? String(localized: "Disponible dans la cellule \(placement.compartmentCode)")
                : String(localized: "Cellule \(placement.compartmentCode)")
            return CardDetail(symbol: "mappin.and.ellipse", text: text)
        case .borrowed:
            return CardDetail(symbol: "clock", text: String(localized: "Indisponible jusqu’au retour"))
        case .alreadyReserved:
            return CardDetail(symbol: "clock", text: String(localized: "Indisponible pour le moment"),
                              guidance: String(localized: "Choisissez un autre équipement."))
        case .unavailable:
            return CardDetail(symbol: "nosign", text: String(localized: "Retiré de la circulation par l’administration"),
                              guidance: String(localized: "Choisissez un autre équipement."))
        case .needsChecking:
            return CardDetail(symbol: "questionmark.diamond.fill",
                              text: String(localized: "Présence non confirmée par le casier"),
                              guidance: String(localized: "Réessayez plus tard."))
        case .blocked, .unrecognized:
            let reasons = ReasonItem.ordered(asset.readiness.reasons)
            guard let main = reasons.first else {
                return status == .unrecognized
                    ? CardDetail(symbol: "questionmark.circle", text: ReasonItem.unrecognized.guidance)
                    : nil
            }
            var guidance = main.guidance
            if reasons.count > 1 {
                guidance = String(localized: "+ \(reasons.count - 1) autre raison") + "\n" + guidance
            }
            return CardDetail(symbol: main.symbol, text: main.title(for: asset), guidance: guidance)
        }
    }

    /// "MM-001 · Fluke 117": code, then manufacturer and model number when known.
    static func identityLine(for asset: TechnicianAsset) -> String {
        let model = [asset.model.manufacturer, asset.model.modelNumber]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return model.isEmpty ? asset.assetCode : "\(asset.assetCode) · \(model)"
    }

    static func calibration(_ calibration: CalibrationView) -> String {
        let due = calibration.dueAt.map { AegisTime.laboratoryDateTime($0) }
        switch calibration.status {
        case .known(.notRequired): return String(localized: "Non requise")
        case .known(.valid):
            return due.map { String(localized: "Valide jusqu’au \($0)") } ?? String(localized: "Valide")
        case .known(.expired):
            return due.map { String(localized: "Expirée le \($0)") } ?? String(localized: "Expirée")
        case .known(.unknown): return String(localized: "Inconnue")
        case .unrecognized: return String(localized: "État indisponible")
        }
    }

    static func accessLevel(_ level: ContractValue<AssetAccessLevel>) -> String {
        switch level {
        case .known(.standard): String(localized: "Standard")
        case .known(.restricted): String(localized: "Restreint")
        case .unrecognized: String(localized: "État indisponible")
        }
    }

    static func compartment(_ placement: PlacementSummary?) -> String {
        guard let placement else { return String(localized: "Aucun placement connu") }
        return "\(placement.compartmentCode) · \(placement.lockerCode)"
    }

    /// Oldest evaluation among the shown items: the footer never claims a
    /// fresher state than the least recent card.
    static func oldestEvaluation(_ items: [TechnicianAsset]) -> Date? {
        items.map(\.readiness.evaluatedAt).min()
    }
}

/// Time formatting choices, aligned with Aegis Manager (CAT-01):
/// - calibration due instants are business times, shown with date, time and
///   zone in the P0 laboratory zone `America/Toronto` (decision of the
///   contract owner, 22 October 2026), never truncated to a date;
/// - the evaluation footer says "heure du casier": the P0 locker is in that
///   laboratory, and the API exposes no locker zone on an asset;
/// - the reception time of the last data is a technical instant of the
///   device, shown in the device zone.
/// Language, 12/24 h and patterns always follow the device settings.
enum AegisTime {
    static let laboratoryZone = TimeZone(identifier: "America/Toronto")!

    static func laboratoryDateTime(_ date: Date, locale: Locale = .autoupdatingCurrent) -> String {
        date.formatted(Date.FormatStyle(locale: locale, timeZone: laboratoryZone)
            .day().month(.abbreviated).year()
            .hour().minute()
            .timeZone(.specificName(.short)))
    }

    static func laboratoryTime(_ date: Date, locale: Locale = .autoupdatingCurrent) -> String {
        date.formatted(Date.FormatStyle(locale: locale, timeZone: laboratoryZone)
            .hour().minute().timeZone(.specificName(.short)))
    }

    /// Device zone; the day is added when it is not today.
    static func deviceTime(_ date: Date, now: Date = .now, locale: Locale = .autoupdatingCurrent,
                           timeZone: TimeZone = .autoupdatingCurrent) -> String {
        var calendar = Calendar.current
        calendar.timeZone = timeZone
        let style = Date.FormatStyle(locale: locale, timeZone: timeZone)
        let time = style.hour().minute().timeZone(.specificName(.short))
        return calendar.isDate(date, inSameDayAs: now)
            ? date.formatted(time)
            : date.formatted(time.day().month(.abbreviated))
    }
}
