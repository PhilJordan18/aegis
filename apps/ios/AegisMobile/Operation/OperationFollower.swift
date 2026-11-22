import Foundation
import Observation

/// Follows one locker operation by reading it until it is terminal, as
/// accepted in ADR-006 and doc 09 §15.4:
///
/// - about one read per second, paced by a longer `Retry-After` when sent;
/// - a single read in flight at a time;
/// - slower after a failure, and never faster than a server `Retry-After`;
/// - suspended in the background, read at once on return to the foreground;
/// - stopped at a terminal state, on 401 (the session ends, the operation goes
///   on) and on 404 (the activity must be read again).
///
/// Following only reads: it never prepares, authorizes or cancels anything,
/// and a client interruption suspends neither the server deadlines nor its
/// processing. The owner calls `stop()` when it no longer shows the operation.
@MainActor
@Observable
final class OperationFollower {
    enum Interruption: Equatable, Sendable {
        /// The last reads failed; reading goes on at a slower pace. The
        /// operation shown is the last one received.
        case readFailing(CatalogFailure)
        /// 404: the operation can no longer be read. Following stopped; the
        /// owner reads the reservation and the loan again, and never
        /// recreates an operation on its own.
        case notFound
        /// 401 or no token: following stopped and the session ends. The
        /// operation goes on server side; resuming means reading it again.
        case sessionEnded
    }

    static let interval: Duration = .seconds(1)
    /// The slowest pace after repeated failures.
    static let slowest: Duration = .seconds(15)

    /// The last operation received; nil until the first read of an operation
    /// given by its identifier only.
    private(set) var operation: LockerOperationView?
    private(set) var receivedAt: Date?
    private(set) var interruption: Interruption?
    private(set) var isSuspended = false
    /// A loop is reading or waiting for its next read.
    private(set) var isFollowing = false

    private(set) var operationId: UUID?
    private let service: any LockerOperationService
    private weak var session: (any SessionAccess)?
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void
    private var task: Task<Void, Never>?
    /// Bumped whenever a newer view or decision supersedes the running loop:
    /// a late answer of a superseded read is dropped, so the view shown never
    /// goes back to an older read.
    private var generation = 0

    init(service: any LockerOperationService, session: any SessionAccess,
         now: @escaping @Sendable () -> Date = Date.init,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.service = service
        self.session = session
        self.now = now
        self.sleep = sleep
    }

    /// Follows an operation just received from a preparation or an
    /// authorization: it is shown at once, and the next read waits for the
    /// usual interval (`Retry-After: 1`, §15.1).
    func follow(_ view: LockerOperationView) {
        operationId = view.id
        operation = view
        receivedAt = now()
        interruption = nil
        restart(readFirst: false)
    }

    /// Resumes an operation known only by its identifier, such as the
    /// `currentOperationId` of the reservation or the loan after a relaunch.
    /// It is read at once; no secret is needed or kept for this.
    func follow(id: UUID) {
        if id != operationId {
            operation = nil
            receivedAt = nil
        }
        operationId = id
        interruption = nil
        restart(readFirst: true)
    }

    /// The application is no longer active (ADR-006).
    func suspend() {
        guard !isSuspended else { return }
        isSuspended = true
        generation += 1
        task?.cancel()
        isFollowing = false
    }

    /// Back to the foreground: an immediate read, unless following ended.
    func resume() {
        guard isSuspended else { return }
        isSuspended = false
        guard canContinue else { return }
        restart(readFirst: true)
    }

    /// The owner no longer shows the operation. The server operation is
    /// neither cancelled nor changed.
    func stop() {
        generation += 1
        task?.cancel()
        isFollowing = false
        operationId = nil
    }

    /// Waits until the current loop ends: terminal, interrupted, suspended or
    /// stopped. For tests and owners that must sequence after following.
    func waitUntilIdle() async {
        while let current = task {
            await current.value
            if task == current { return }
        }
    }

    private var canContinue: Bool {
        guard operationId != nil, operation?.isTerminal != true else { return false }
        switch interruption {
        case .notFound, .sessionEnded: return false
        case .readFailing, nil: return true
        }
    }

    private func restart(readFirst: Bool) {
        generation += 1
        let previous = task
        previous?.cancel()
        guard !isSuspended, canContinue, let id = operationId else {
            isFollowing = false
            return
        }
        isFollowing = true
        let current = generation
        task = Task { [weak self] in
            // The cancelled loop may still have a read in flight: wait for it,
            // so that never two reads of this follower overlap.
            await previous?.value
            await self?.run(id: id, generation: current, readFirst: readFirst)
        }
    }

    private func run(id: UUID, generation current: Int, readFirst: Bool) async {
        var delay: Duration = readFirst ? .zero : Self.interval
        var failures = 0
        while current == generation, !Task.isCancelled {
            if delay > .zero {
                do { try await self.sleep(delay) } catch { return }
                guard current == generation, !Task.isCancelled else { return }
            }
            guard let token = session?.accessToken() else {
                end(.sessionEnded, generation: current)
                session?.handleMissingToken()
                return
            }
            let result = await Self.read(service, id: id, bearer: token)
            guard current == generation, !Task.isCancelled else { return }

            switch result {
            case let .success(received) where received.value.id == id:
                failures = 0
                operation = received.value
                receivedAt = now()
                interruption = nil
                if received.value.isTerminal {
                    end(nil, generation: current)
                    return
                }
                delay = max(Self.interval, received.retryAfter ?? Self.interval)
            case .success:
                // Another operation than the one asked for: never shown.
                failures += 1
                interruption = .readFailing(.service(traceId: nil))
                delay = Self.backoff(after: failures, retryAfter: nil)
            case .failure(.cancelled):
                return
            case let .failure(.http(401, problem, _)):
                end(.sessionEnded, generation: current)
                session?.handleUnauthorized(code: problem?.code)
                return
            case .failure(.http(404, _, _)):
                end(.notFound, generation: current)
                return
            case let .failure(error):
                failures += 1
                interruption = .readFailing(CatalogFailure(error))
                var retryAfter: Duration?
                if case let .http(_, _, serverDelay) = error { retryAfter = serverDelay }
                delay = Self.backoff(after: failures, retryAfter: retryAfter)
            }
        }
    }

    private func end(_ interruption: Interruption?, generation current: Int) {
        guard current == generation else { return }
        if let interruption { self.interruption = interruption }
        isFollowing = false
    }

    /// 2, 4, 8 then 15 seconds, or the server delay when it is longer.
    static func backoff(after failures: Int, retryAfter: Duration?) -> Duration {
        let doubled = Self.interval * (1 << min(failures, 4))
        return max(min(doubled, slowest), retryAfter ?? .zero)
    }

    private nonisolated static func read(_ service: any LockerOperationService, id: UUID,
                                         bearer token: String) async -> Result<Received<LockerOperationView>, APIError> {
        do {
            return .success(try await service.lockerOperation(id: id, bearer: token))
        } catch {
            return .failure(error)
        }
    }
}
