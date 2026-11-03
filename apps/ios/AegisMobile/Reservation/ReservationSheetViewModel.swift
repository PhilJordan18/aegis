import Foundation
import Observation

/// Reservation sheet (handoff `mobile-parcours` §5, doc 09 §14.1). The
/// technician picks `reservedUntil`; the server checks everything again,
/// including the hours, and its answer is the only outcome shown.
@MainActor
@Observable
final class ReservationSheetViewModel {
    /// The locker's current window, as read from `GET /lockers/{id}/status`.
    enum Hours: Equatable {
        case loading
        case open(closesAt: Date?)
        /// `open = false`: closed, or no usable schedule when `nextOpensAt` is nil.
        case closed(nextOpensAt: Date?)
        /// The status could not be read: no local bound but "after now", and
        /// the server judges the chosen time.
        case unavailable
    }

    enum Phase: Equatable {
        case editing
        case sending
        case failed(ReservationProblem)
        case created(ReservationView)
    }

    static let step: TimeInterval = 15 * 60
    /// The first choice leaves time to confirm before it is in the past.
    static let margin: TimeInterval = 5 * 60
    /// Default choice: the first one at least this far ahead.
    static let preferredLead: TimeInterval = 60 * 60

    let asset: TechnicianAsset
    private(set) var hours = Hours.loading
    private(set) var zone = AegisTime.laboratoryZone
    private(set) var choices: [Date] = []
    private(set) var phase = Phase.editing
    /// A new time is a new intent: it drops the key of the previous one.
    var reservedUntil: Date? {
        didSet {
            guard reservedUntil != oldValue, phase != .sending else { return }
            pendingKey = nil
            phase = .editing
        }
    }

    private var pendingKey: IdempotencyKey?
    private let service: any ReservationService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date

    init(asset: TechnicianAsset, service: any ReservationService, session: any SessionAccess,
         now: @escaping @Sendable () -> Date = Date.init) {
        self.asset = asset
        self.service = service
        self.session = session
        self.now = now
    }

    var isSending: Bool { phase == .sending }

    /// The closing hours are known to forbid any reservation now. An unknown
    /// window never disables the confirmation: the server decides.
    var canConfirm: Bool {
        guard reservedUntil != nil, !isSending else { return false }
        switch phase {
        case .created: return false
        default: break
        }
        if case .closed = hours { return false }
        return true
    }

    /// The key that the next confirmation sends; exposed for tests.
    var currentKey: IdempotencyKey? { pendingKey }

    func loadHours() async {
        guard hours == .loading || hours == .unavailable else { return }
        guard let lockerId = asset.placement?.lockerId else {
            apply(.unavailable)
            return
        }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        do throws(APIError) {
            let status = try await service.lockerStatus(id: lockerId, bearer: token)
            let window = status.currentWindow
            zone = window.zone ?? AegisTime.laboratoryZone
            apply(window.open ? .open(closesAt: window.closesAt) : .closed(nextOpensAt: window.nextOpensAt))
        } catch .cancelled {
            return
        } catch let .http(401, problem, _) {
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            // §8.10 / PHY-01: every failure, including the 404 of a route the
            // server does not have yet, means "hours unavailable", never closed.
            apply(.unavailable)
        }
    }

    /// Sends the reservation; a call made while one is in flight is ignored.
    func confirm() async {
        guard canConfirm, let until = reservedUntil else { return }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        let key = pendingKey ?? IdempotencyKey()
        pendingKey = key
        phase = .sending
        do throws(APIError) {
            let reservation = try await service.createReservation(assetId: asset.id, reservedUntil: until,
                                                                  key: key, bearer: token)
            pendingKey = nil
            phase = .created(reservation)
        } catch .cancelled {
            phase = .editing
        } catch let .http(401, problem, _) {
            phase = .editing
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            let problem = ReservationProblem(error, mutation: .create)
            if !problem.keepsKey { pendingKey = nil }
            phase = .failed(problem)
        }
    }

    private func apply(_ hours: Hours) {
        self.hours = hours
        let closesAt: Date? = if case let .open(closesAt) = hours { closesAt } else { nil }
        choices = if case .closed = hours { [] } else {
            Self.choices(after: now(), until: closesAt, zone: zone)
        }
        if let current = reservedUntil, choices.contains(current) { return }
        reservedUntil = Self.defaultChoice(choices, now: now())
    }

    /// Quarter hours from shortly after now up to the closing time when it is
    /// known, otherwise to the end of the locker's day: a comfort of entry
    /// only (`sections.md` U8), never a rule the server relies on.
    static func choices(after now: Date, until closesAt: Date?, zone: TimeZone) -> [Date] {
        let first = (((now.timeIntervalSince1970 + margin) / step).rounded(.up)) * step
        if let closesAt {
            // The server accepts an end equal to the closing time (§14.1, step 6).
            return stride(from: first, through: closesAt.timeIntervalSince1970, by: step)
                .map(Date.init(timeIntervalSince1970:))
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        return stride(from: first, to: nextDay.timeIntervalSince1970, by: step)
            .map(Date.init(timeIntervalSince1970:))
    }

    static func defaultChoice(_ choices: [Date], now: Date) -> Date? {
        choices.first { $0.timeIntervalSince(now) >= preferredLead } ?? choices.last
    }
}
