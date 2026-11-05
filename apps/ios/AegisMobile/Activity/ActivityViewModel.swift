import Foundation
import Observation

/// The last result of one read: the value of the last success with its
/// reception time, and the failure of the last attempt if it failed.
struct ActivityReading<Value: Equatable & Sendable>: Equatable, Sendable {
    /// Nil when there is none, or before the first success.
    var value: Value?
    /// Nil until a read succeeded.
    var receivedAt: Date?
    var failure: CatalogFailure?

    var isKnown: Bool { receivedAt != nil }
    /// A value is shown that the last read could not confirm.
    var isStale: Bool { isKnown && failure != nil }
}

/// « Mon activité » (handoff `mobile-parcours` §6): the technician's active
/// reservation and open loan. Actions follow the last successful read only
/// (doc 09 §8.10); nothing here derives an action, a status or an expiry.
@MainActor
@Observable
final class ActivityViewModel {
    enum Feedback: Equatable {
        case created(ReservationView)
        case cancelled
        case cancelFailed(ReservationProblem)
    }

    private(set) var reservation = ActivityReading<ReservationView>()
    private(set) var loan = ActivityReading<LoanView>()
    private(set) var isLoading = false
    private(set) var isCancelling = false
    /// What the screen confirms or refuses after the last mutation; cleared
    /// by the next read the technician starts.
    private(set) var feedback: Feedback?
    /// A pending VoiceOver announcement, posted once by the screen.
    var announcement: String?

    private var cancelKey: (reservationId: UUID, key: IdempotencyKey)?
    private let service: any ActivityService & ReservationService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date

    init(service: any ActivityService & ReservationService, session: any SessionAccess,
         now: @escaping @Sendable () -> Date = Date.init) {
        self.service = service
        self.session = session
        self.now = now
    }

    var hasRead: Bool { reservation.isKnown || loan.isKnown || reservation.failure != nil || loan.failure != nil }

    /// The reservation whose actions may be offered: read fresh and active.
    var actionableReservation: ReservationView? {
        guard !reservation.isStale, let value = reservation.value else { return nil }
        return value
    }

    var canCancel: Bool {
        !isCancelling && actionableReservation?.actions.contains(.cancel) == true
    }

    /// Both reads succeeded and found nothing (§6 « Aucune activité »).
    var isEmpty: Bool {
        reservation.isKnown && loan.isKnown && reservation.value == nil && loan.value == nil
            && reservation.failure == nil && loan.failure == nil
    }

    func loadIfNeeded() async {
        guard !hasRead else { return }
        await load()
    }

    /// Reads both resources together. A call made while a read is in flight
    /// is ignored.
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        let service = service
        async let reservationRead = Self.capture { () async throws(APIError) in
            try await service.currentReservation(bearer: token)
        }
        async let loanRead = Self.capture { () async throws(APIError) in try await service.currentLoan(bearer: token) }
        let (reservationResult, loanResult) = await (reservationRead, loanRead)

        for result in [reservationResult.map { _ in () }, loanResult.map { _ in () }] {
            if case let .failure(.http(401, problem, _)) = result {
                session?.handleUnauthorized(code: problem?.code)
                return
            }
        }
        if case .failure(.cancelled) = reservationResult { return }
        let receivedAt = now()
        Self.apply(reservationResult, to: &reservation, at: receivedAt)
        Self.apply(loanResult, to: &loan, at: receivedAt)
    }

    /// Technician-started refresh: clears the last confirmation or refusal.
    func refresh() async {
        feedback = nil
        await load()
    }

    /// A reservation the sheet just created: shown at once, then confirmed by
    /// the next read like any other.
    func accept(created reservation: ReservationView) {
        self.reservation = ActivityReading(value: reservation, receivedAt: now())
        feedback = .created(reservation)
        announcement = Self.confirmation(reservation)
    }

    /// `POST /reservations/{id}/cancel` (§14.4), then the card is read again.
    func cancel() async {
        guard canCancel, let reservation = actionableReservation else { return }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        let key = cancelKey?.reservationId == reservation.id ? cancelKey!.key : IdempotencyKey()
        cancelKey = (reservation.id, key)
        isCancelling = true
        do throws(APIError) {
            _ = try await service.cancelReservation(id: reservation.id, key: key, bearer: token)
            cancelKey = nil
            feedback = .cancelled
            announcement = String(localized: "Réservation annulée.")
            isCancelling = false
            await load()
        } catch .cancelled {
            isCancelling = false
        } catch let .http(401, problem, _) {
            isCancelling = false
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            let problem = ReservationProblem(error, mutation: .cancel)
            if !problem.keepsKey { cancelKey = nil }
            feedback = .cancelFailed(problem)
            announcement = problem.message
            isCancelling = false
            // §8.10 rule 5: after a refusal the card follows a new read.
            if case .refused = problem { await load() }
        }
    }

    static func confirmation(_ reservation: ReservationView) -> String {
        String(localized: "Réservation confirmée jusqu’à \(AegisTime.laboratoryTime(reservation.reservedUntil))")
    }

    private static func apply<Value>(_ result: Result<Value?, APIError>, to reading: inout ActivityReading<Value>,
                                     at receivedAt: Date) {
        switch result {
        case let .success(value):
            reading = ActivityReading(value: value, receivedAt: receivedAt)
        case let .failure(error):
            reading.failure = CatalogFailure(error)
        }
    }

    private nonisolated static func capture<Value: Sendable>(
        _ operation: @Sendable () async throws(APIError) -> Value
    ) async -> Result<Value, APIError> {
        do {
            return .success(try await operation())
        } catch {
            return .failure(error)
        }
    }
}
