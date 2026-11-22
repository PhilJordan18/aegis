import Foundation
import Observation

/// One guided checkout or return on screen (handoff `mobile-parcours` §7):
/// it follows the operation (ADR-006) and submits the scanned code, and
/// nothing else. It never prepares, cancels or concludes an operation:
/// closing it only hides the tracking.
@MainActor
@Observable
final class GuidedOperation: Identifiable {
    struct Context: Equatable, Sendable {
        let assetName: String
        let assetCode: String
        /// The cell code shown in very large type, such as A1.
        let compartment: String

        init(_ asset: AssetSummary) {
            assetName = asset.model.name
            assetCode = asset.assetCode
            compartment = asset.placement?.compartmentCode ?? "—"
        }
    }

    /// The identity of one presentation of the guided screen.
    let id = UUID()
    let kind: OperationStep.Kind
    let context: Context
    let follower: OperationFollower
    let submission: LocalProofSubmission

    /// The scan sheet is shown. It only makes sense while the server asks for
    /// the code, so it is never shown in another state.
    private var scanOpen = false
    /// The operation whose scan sheet already opened on its own once.
    private var autoOpenedFor: UUID?

    init(kind: OperationStep.Kind, context: Context, service: any LockerOperationService,
         session: any SessionAccess, now: @escaping @Sendable () -> Date = Date.init,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.kind = kind
        self.context = context
        follower = OperationFollower(service: service, session: session, now: now, sleep: sleep)
        submission = LocalProofSubmission(service: service, session: session)
    }

    var operation: LockerOperationView? { follower.operation }

    var step: OperationStep {
        var interrupted = false
        if case .readFailing = follower.interruption { interrupted = true }
        return OperationStep(follower.operation, kind: kind, compartment: context.compartment,
                             assetName: context.assetName, interrupted: interrupted)
    }

    var isScanPresented: Bool {
        get { scanOpen && step.canScan }
        set {
            scanOpen = newValue
            if !newValue, !submission.isSubmitting { submission.discard() }
        }
    }

    /// Shows a just-prepared operation, then reads it (§15.1 `Retry-After: 1`).
    func start(_ view: LockerOperationView) {
        follower.follow(view)
        operationChanged()
    }

    /// « Reprendre »: reads the operation again; nothing is triggered.
    func resume(id: UUID) {
        follower.follow(id: id)
    }

    /// The sheet opens on its own once the code is displayed, then only on
    /// « Scanner le code ». A state that no longer awaits the code forgets
    /// any secret still held.
    func operationChanged() {
        guard let operation = follower.operation else { return }
        if step.canScan, autoOpenedFor != operation.id {
            autoOpenedFor = operation.id
            scanOpen = true
        }
        if !operation.awaitsLocalProof, !submission.isSubmitting {
            scanOpen = false
            submission.discard()
        }
    }

    /// A code read by the camera or, in development builds only, typed in the
    /// test field; both go through the same parser and API call.
    func submit(scanned text: String) async {
        guard let operation = follower.operation else { return }
        await submission.submit(scanned: text, for: operation)
        switch submission.outcome {
        case let .authorized(view):
            scanOpen = false
            start(view)
        case .refused(.expired), .refused(.invalidated), .refused(.alreadyUsed), .refused(.operationNotFound):
            // The server state moved: read it now rather than at the next tick.
            follower.follow(id: operation.id)
        default:
            break
        }
    }

    /// « Fermer »: hides the tracking; the operation goes on server side.
    func hide() {
        follower.stop()
        scanOpen = false
        submission.discard()
    }

    func suspend() { follower.suspend() }

    func resumeForeground() { follower.resume() }
}
