import Foundation
import Observation

/// Submits the proof read from the hub QR (`authorize-local`, doc 09 §15.5)
/// with one `Idempotency-Key` per intent.
///
/// - A code that does not belong to the displayed operation is never sent.
/// - While a submission is in flight, further readings are ignored: the
///   camera delivers the same code many times.
/// - When the outcome is unknown (no answer, 5xx, unreadable answer), the
///   proof and its key are kept in memory for « Réessayer », which replays the
///   same request; reading the same code again is the same intent too.
/// - A server answer, accepted or refused, drops the secret: a refusal needs
///   a new scan with a new key (handoff `mobile-parcours` §7.2).
///
/// An authorization only means the operation may proceed; the physical
/// outcome is read by `OperationFollower`.
@MainActor
@Observable
final class LocalProofSubmission {
    enum Outcome: Equatable, Sendable {
        /// 202: the operation as the server authorized it (`WAIT`).
        case authorized(LockerOperationView)
        /// The scanned code was not sent.
        case rejected(LocalAccessCodeRejection)
        /// A definitive server refusal; the secret is dropped.
        case refused(Refusal)
        /// The outcome is unknown; « Réessayer » sends the same request.
        case unknown(CatalogFailure)
        /// 401: the session ends and the secret is dropped.
        case sessionEnded
    }

    /// §15.5 refusals. Codes not listed are the existing business guards.
    enum Refusal: Equatable, Sendable {
        case malformed
        case invalid
        case notDisplayed
        case contextMismatch
        case alreadyUsed
        case invalidated
        case expired
        case rateLimited(retryAfter: Duration?)
        case operationNotFound
        case lockerOffline
        /// Any other refusal; only the stable code and a clean trace id are kept.
        case other(code: String?, traceId: String?)
    }

    private(set) var isSubmitting = false
    private(set) var outcome: Outcome?

    private struct Attempt {
        let operationId: UUID
        let proof: LocalProof
        let key: IdempotencyKey
    }

    /// The only place the secret lives, and only while the outcome is unknown.
    private var pending: Attempt?
    /// Once authorized, nothing more is sent for this operation.
    private var authorizedOperationId: UUID?
    private let service: any LockerOperationService
    private weak var session: (any SessionAccess)?

    init(service: any LockerOperationService, session: any SessionAccess) {
        self.service = service
        self.session = session
    }

    /// « Réessayer » is offered only for an unknown outcome.
    var canRetry: Bool { pending != nil && !isSubmitting }

    /// After a refusal or the end of the session, readings are ignored until
    /// the technician asks to scan again: an automatic resubmission of the
    /// same wrong code would use up the attempts of §15.5.
    var awaitsNewScan: Bool {
        switch outcome {
        case .refused, .sessionEnded: true
        default: false
        }
    }

    /// A text read by the scanner while `operation` is displayed.
    func submit(scanned text: String, for operation: LockerOperationView) async {
        guard !isSubmitting, !awaitsNewScan, operation.awaitsLocalProof,
              authorizedOperationId != operation.id else { return }
        switch LocalAccessCode.proof(from: text, for: operation) {
        case let .failure(rejection):
            outcome = .rejected(rejection)
        case let .success(proof):
            let key = pending.flatMap { $0.operationId == operation.id && $0.proof == proof ? $0.key : nil }
                ?? IdempotencyKey()
            await send(Attempt(operationId: operation.id, proof: proof, key: key))
        }
    }

    /// « Réessayer » after an unknown outcome: the same key and body.
    func retry() async {
        guard !isSubmitting, let pending else { return }
        await send(pending)
    }

    /// The technician asks to scan again after a refusal or a rejected code.
    /// Any unknown outcome is kept: its key still belongs to that intent.
    func scanAgain() {
        if pending == nil { outcome = nil }
    }

    /// The scan sheet closed or the operation is no longer awaiting a proof.
    func discard() {
        pending = nil
        outcome = nil
    }

    private func send(_ attempt: Attempt) async {
        guard let token = session?.accessToken() else {
            pending = nil
            outcome = .sessionEnded
            session?.handleMissingToken()
            return
        }
        pending = attempt
        isSubmitting = true
        defer { isSubmitting = false }
        do throws(APIError) {
            let view = try await service.authorizeLocal(operationId: attempt.operationId, proof: attempt.proof,
                                                        key: attempt.key, bearer: token)
            pending = nil
            authorizedOperationId = attempt.operationId
            outcome = .authorized(view)
        } catch .cancelled {
            // The owner went away; the follower reads what the server decided.
            pending = nil
        } catch let .http(401, problem, _) {
            pending = nil
            outcome = .sessionEnded
            session?.handleUnauthorized(code: problem?.code)
        } catch {
            if let refusal = Self.refusal(error) {
                pending = nil
                outcome = .refused(refusal)
            } else {
                outcome = .unknown(CatalogFailure(error))
            }
        }
    }

    /// Nil when the outcome is unknown: no answer, 5xx other than an offline
    /// locker, an unreadable answer or the same key still being processed.
    static func refusal(_ error: APIError) -> Refusal? {
        guard case let .http(status, problem, retryAfter) = error else { return nil }
        switch (status, problem?.code) {
        case (400, "LOCAL_PROOF_MALFORMED"): return .malformed
        case (403, "LOCAL_PROOF_INVALID"): return .invalid
        case (409, "LOCAL_PROOF_NOT_DISPLAYED"): return .notDisplayed
        case (409, "LOCAL_PROOF_CONTEXT_MISMATCH"): return .contextMismatch
        case (409, "LOCAL_PROOF_ALREADY_USED"): return .alreadyUsed
        case (409, "LOCAL_PROOF_INVALIDATED"): return .invalidated
        case (410, "LOCAL_PROOF_EXPIRED"): return .expired
        case (429, _): return .rateLimited(retryAfter: retryAfter)
        case (404, "OPERATION_NOT_FOUND"): return .operationNotFound
        case (503, "LOCKER_OFFLINE"): return .lockerOffline
        case (_, "IDEMPOTENCY_REQUEST_IN_PROGRESS"), (500..., _): return nil
        default:
            return .other(code: problem?.code,
                          traceId: problem?.traceId.flatMap(SessionModel.displayableTraceId))
        }
    }
}
