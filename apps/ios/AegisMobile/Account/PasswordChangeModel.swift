import Foundation
import Observation

/// Sends a password change for the signed-in account. `SessionModel`
/// conforms; tests replace it.
@MainActor
protocol PasswordChanging: AnyObject {
    func changePassword(current: String, new: String) async -> PasswordChangeResult
}

extension SessionModel: PasswordChanging {}

/// « Changer le mot de passe » (#234, doc 09 §10.7). The three fields live in
/// memory only, are never stored or logged, and are cleared when the form
/// closes or the change ends. The confirmation is checked here and never sent.
///
/// Two steps: the current password alone, then the new one with its
/// confirmation. On one screen, iOS takes the current password field for a
/// new one: it offers a strong password there and writes it into the
/// current and new fields instead of the new one and its confirmation.
@MainActor
@Observable
final class PasswordChangeModel {
    /// §10.7, counted in UTF-8 bytes as the server counts them.
    static let maximumBytes = 72
    static let minimumNewBytes = 12

    enum FieldError: Equatable {
        case currentMissing
        case currentTooLong
        case currentRejected
        case newTooShort
        case newTooLong
        case sameAsCurrent
        case confirmationMismatch
    }

    enum Message: Equatable {
        case invalid
        case rateLimited(retryAfter: Duration?)
        case unavailable
        case refused
        case notSent
        case serviceError(traceId: String?)
    }

    /// The current password is asked first; the change is sent from `.new`.
    enum Step: Equatable { case current, new }

    var current = ""
    var new = ""
    var confirmation = ""
    private(set) var currentError: FieldError?
    private(set) var newError: FieldError?
    private(set) var confirmationError: FieldError?
    private(set) var message: Message?
    var step: Step = .current
    private(set) var isSubmitting = false
    private(set) var retryAvailableAt: Date?

    private weak var session: (any PasswordChanging)?
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void
    private var unlockTask: Task<Void, Never>?

    init(session: any PasswordChanging, now: @escaping @Sendable () -> Date = Date.init,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.session = session
        self.now = now
        self.sleep = sleep
    }

    var isRateLimited: Bool {
        guard let retryAvailableAt else { return false }
        return retryAvailableAt > now()
    }

    var canSubmit: Bool { !isSubmitting && !isRateLimited }

    /// Leaves the first step once the current password is plausible. Nothing
    /// is sent: only the change itself can tell whether it is correct.
    func proceed() {
        currentError = Self.validateCurrent(current)
        if currentError == nil { step = .new }
    }

    /// Sends the change once. A second call while one is in flight, or
    /// before the server's delay has passed, sends nothing.
    func submit() async {
        guard canSubmit, let session else { return }
        message = nil
        currentError = Self.validateCurrent(current)
        newError = Self.validateNew(new, current: current)
        confirmationError = confirmation == new ? nil : .confirmationMismatch
        guard currentError == nil else { step = .current; return }
        guard newError == nil, confirmationError == nil else { return }

        isSubmitting = true
        let result = await session.changePassword(current: current, new: new)
        isSubmitting = false
        switch result {
        case .changed, .sessionEnded:
            clear()
        case .currentRejected:
            current = ""
            currentError = .currentRejected
            step = .current
        case .reused:
            newError = .sameAsCurrent
        case .invalid:
            message = .invalid
        case let .rateLimited(retryAfter):
            message = .rateLimited(retryAfter: retryAfter)
            if let retryAfter { lock(for: retryAfter) }
        case .unavailable:
            message = .unavailable
        case .refused:
            message = .refused
        case .notSent:
            message = .notSent
        case let .serviceError(traceId):
            message = .serviceError(traceId: traceId)
        }
    }

    /// Editing a field withdraws its error until the next submission.
    enum Field { case current, new, confirmation }

    func edited(_ field: Field) {
        switch field {
        case .current: currentError = nil
        case .new: newError = nil
        case .confirmation: confirmationError = nil
        }
    }

    /// Wipes the three secrets; called when the form closes.
    func clear() {
        current = ""
        clearNew()
        step = .current
    }

    /// Wipes the new password and its confirmation when their step closes.
    func clearNew() {
        new = ""
        confirmation = ""
    }

    private func lock(for delay: Duration) {
        retryAvailableAt = now().addingTimeInterval(TimeInterval(delay.components.seconds))
        unlockTask?.cancel()
        unlockTask = Task { [weak self, sleep] in
            try? await sleep(delay)
            guard !Task.isCancelled else { return }
            self?.retryAvailableAt = nil
            if case .rateLimited = self?.message { self?.message = nil }
        }
    }

    static func validateCurrent(_ value: String) -> FieldError? {
        if value.isEmpty { return .currentMissing }
        if value.utf8.count > maximumBytes { return .currentTooLong }
        return nil
    }

    static func validateNew(_ value: String, current: String) -> FieldError? {
        if value.utf8.count < minimumNewBytes { return .newTooShort }
        if value.utf8.count > maximumBytes { return .newTooLong }
        if value == current { return .sameAsCurrent }
        return nil
    }
}
