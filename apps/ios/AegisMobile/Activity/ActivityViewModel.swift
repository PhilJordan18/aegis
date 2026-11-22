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
        case preparationFailed(PreparationProblem, compartment: String)
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

    private(set) var isPreparing = false
    /// The guided operation on screen; nil once hidden.
    private(set) var guided: GuidedOperation?
    /// The last read of the reservation's or the loan's `currentOperationId`,
    /// kept only to tell an operation in progress from a finished attempt.
    /// Nil when there is none or when it could not be read.
    private(set) var currentOperation: LockerOperationView?
    /// Device memory of the last preparation refused with `503 LOCKER_OFFLINE`
    /// (handoff §6 variant A): in memory only, it never decides a button.
    private(set) var offlineAttemptAt: Date?

    private var cancelKey: (reservationId: UUID, key: IdempotencyKey)?
    private var checkoutKey: (reservationId: UUID, key: IdempotencyKey)?
    private let service: any ActivityService & ReservationService
    private let operations: any LockerOperationService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void

    init(service: any ActivityService & ReservationService, operations: any LockerOperationService,
         session: any SessionAccess, now: @escaping @Sendable () -> Date = Date.init,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.service = service
        self.operations = operations
        self.session = session
        self.now = now
        self.sleep = sleep
    }

    var hasRead: Bool { reservation.isKnown || loan.isKnown || reservation.failure != nil || loan.failure != nil }

    /// The reservation whose actions may be offered: read fresh and active.
    var actionableReservation: ReservationView? {
        guard !reservation.isStale, let value = reservation.value else { return nil }
        return value
    }

    var canCancel: Bool {
        !isCancelling && !isPreparing && actionableReservation?.actions.contains(.cancel) == true
    }

    /// `CHECKOUT` in the last fresh read, and no operation known to be under
    /// way (§6). The server still decides: a refusal is shown and read again.
    var canPrepareCheckout: Bool {
        !isPreparing && !isCancelling && !operationInProgress
            && actionableReservation?.actions.contains(.checkout) == true
    }

    /// The reservation or loan points to an operation that is not known to be
    /// finished. « Reprendre » reads it again; it never triggers anything.
    var resumableOperationId: UUID? {
        guard let id = reservation.value?.currentOperationId ?? loan.value?.currentOperationId else { return nil }
        if currentOperation?.id == id, currentOperation?.isTerminal == true { return nil }
        return id
    }

    /// The last read of the current operation says it is not terminal.
    var operationInProgress: Bool {
        guard let id = resumableOperationId, let currentOperation, currentOperation.id == id else { return false }
        return !currentOperation.isTerminal
    }

    /// A finished checkout attempt of the active reservation (§6 variant B).
    var finishedAttempt: LockerOperationView? {
        guard let operation = currentOperation, operation.isTerminal,
              operation.id == reservation.value?.currentOperationId else { return nil }
        return operation
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
        await readCurrentOperation(bearer: token)
    }

    /// After a relaunch or a reconnection, the reservation and the loan are
    /// read first, then their `currentOperationId` once (§15.4). A failed
    /// read leaves the state unknown: « Reprendre » stays offered.
    private func readCurrentOperation(bearer token: String) async {
        guard let id = reservation.value?.currentOperationId ?? loan.value?.currentOperationId else {
            currentOperation = nil
            return
        }
        if guided != nil { return }
        let operations = operations
        let result = await Self.capture { () async throws(APIError) in
            try await operations.lockerOperation(id: id, bearer: token)
        }
        switch result {
        case let .success(received) where received.value.id == id:
            currentOperation = received.value
        case let .failure(.http(401, problem, _)):
            session?.handleUnauthorized(code: problem?.code)
        default:
            if currentOperation?.id != id { currentOperation = nil }
        }
    }

    /// « Préparer le retrait » (§15.1). A new tap after an unknown outcome is
    /// the same intent and reuses its key; after a server answer it is a new
    /// one. Only a 202 opens the guided operation.
    func prepareCheckout() async {
        guard canPrepareCheckout, let reservation = actionableReservation else { return }
        guard let token = session?.accessToken() else {
            session?.handleMissingToken()
            return
        }
        let key = checkoutKey?.reservationId == reservation.id ? checkoutKey!.key : IdempotencyKey()
        checkoutKey = (reservation.id, key)
        feedback = nil
        isPreparing = true
        let context = GuidedOperation.Context(reservation.asset)
        do throws(APIError) {
            let view = try await operations.prepareCheckout(reservationId: reservation.id, key: key, bearer: token)
            checkoutKey = nil
            offlineAttemptAt = nil
            isPreparing = false
            present(kind: .checkout, context: context) { $0.start(view) }
        } catch .cancelled {
            isPreparing = false
        } catch let .http(401, problem, _) {
            isPreparing = false
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            let problem = PreparationProblem(error)
            if !problem.keepsKey { checkoutKey = nil }
            if problem == .refused(.lockerOffline) { offlineAttemptAt = now() }
            feedback = .preparationFailed(problem, compartment: context.compartment)
            announcement = problem.message(compartment: context.compartment)
            isPreparing = false
            if case .refused = problem { await load() }
        }
    }

    /// « Reprendre »: follows the current operation again from its identifier.
    func resumeOperation() {
        guard let id = resumableOperationId else { return }
        let kind: OperationStep.Kind = reservation.value?.currentOperationId == id ? .checkout : .return
        guard let asset = kind == .checkout ? reservation.value?.asset : loan.value?.asset else { return }
        present(kind: kind, context: GuidedOperation.Context(asset)) { $0.resume(id: id) }
    }

    /// « Fermer » and « Voir mon activité »: the tracking is hidden, the
    /// operation is neither cancelled nor changed, and the card is read again.
    func hideOperation() async {
        guard let guided else { return }
        if let last = guided.operation { currentOperation = last }
        guided.hide()
        self.guided = nil
        await load()
    }

    /// « Recommencer » after `EXPIRED`: a new preparation, only if the fresh
    /// read still lists `CHECKOUT`.
    func restartCheckout() async {
        await hideOperation()
        if canPrepareCheckout { await prepareCheckout() }
    }

    private func present(kind: OperationStep.Kind, context: GuidedOperation.Context,
                         _ begin: (GuidedOperation) -> Void) {
        guard let session else { return }
        let guided = GuidedOperation(kind: kind, context: context, service: operations, session: session, now: now,
                                     sleep: sleep)
        begin(guided)
        self.guided = guided
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
