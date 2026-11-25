import Foundation
import Testing
@testable import AegisMobile

/// `authorize-local` (doc 09 §15.5, handoff `mobile-parcours` §7.2): one key
/// per intent, the same request on « Réessayer », nothing sent for a code of
/// another context, and the secret dropped once the server answered.
@MainActor
struct LocalProofSubmissionTests {
    let session = StubSessionAccess()

    private func submission(_ service: ScriptedOperationService) -> LocalProofSubmission {
        LocalProofSubmission(service: service, session: session)
    }

    private static var proof: LocalProof { try! LocalAccessCode.parse(OperationFixtures.uri()).get().proof }

    @Test func aCodeOfTheDisplayedOperationIsAuthorizedOnce() async {
        let service = ScriptedOperationService(authorizations: [.success(OperationFixtures.authorized)])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        #expect(submission.outcome == .authorized(OperationFixtures.authorized))
        #expect(service.authorizations.count == 1)
        #expect(service.authorizations.first?.operationId == OperationFixtures.id)
        #expect(service.authorizations.first?.proof == Self.proof)
        #expect(!submission.canRetry)
        #expect(!submission.isSubmitting)
    }

    @Test(arguments: [
        ("https://example.com", .notAegis),
        (OperationFixtures.uri(v: "2"), .unsupportedVersion),
        (OperationFixtures.uri(token: "short"), .malformed),
        (OperationFixtures.uri(lockerId: OperationFixtures.otherLockerId), .wrongContext),
    ] as [(String, LocalAccessCodeRejection)])
    func aCodeThatIsNotThisOperationsIsNeverSent(text: String, rejection: LocalAccessCodeRejection) async {
        let service = ScriptedOperationService()
        let submission = submission(service)

        await submission.submit(scanned: text, for: OperationFixtures.awaiting)

        #expect(submission.outcome == .rejected(rejection))
        #expect(service.authorizations.isEmpty)
    }

    @Test(arguments: ["AUTHORIZED", "COMMAND_SENT", "CONFIRMED", "EXPIRED", "QUARANTINED"])
    func nothingIsSentUnlessTheOperationAwaitsAProof(status: String) async {
        let service = ScriptedOperationService()
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(),
                                for: OperationFixtures.view(status: status, requiredAction: "WAIT"))

        #expect(submission.outcome == nil)
        #expect(service.authorizations.isEmpty)
    }

    /// No answer: the outcome is unknown, so « Réessayer » and a new reading
    /// of the same code replay the same key and body.
    @Test func anUnknownOutcomeKeepsTheKeyForTheSameIntent() async throws {
        let service = ScriptedOperationService(authorizations: [
            .failure(.unreachable(.timedOut)),
            .failure(.http(status: 502, problem: nil)),
            .success(OperationFixtures.authorized),
        ])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        #expect(submission.outcome == .unknown(.unreachable))
        #expect(submission.canRetry)

        await submission.retry()
        #expect(submission.outcome == .unknown(.service(traceId: nil)))
        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        #expect(submission.outcome == .authorized(OperationFixtures.authorized))
        let sent = service.authorizations
        #expect(sent.count == 3)
        #expect(Set(sent.map(\.key)).count == 1)
        #expect(sent.allSatisfy { $0.proof == Self.proof && $0.operationId == OperationFixtures.id })
        #expect(!submission.canRetry)
    }

    @Test func aKeyStillInProgressIsAnUnknownOutcome() async {
        let service = ScriptedOperationService(authorizations: [
            .failure(ActivityDoubles.refusal(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS")),
        ])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        #expect(submission.canRetry)
        #expect(submission.outcome == .unknown(.service(traceId: "trace-1")))
    }

    @Test func aDifferentCodeAfterAnUnknownOutcomeIsANewIntent() async {
        let service = ScriptedOperationService(authorizations: [.failure(.unreachable(.timedOut))])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        await submission.submit(scanned: OperationFixtures.uri(token: OperationFixtures.otherToken),
                                for: OperationFixtures.awaiting)

        let sent = service.authorizations
        #expect(sent.count == 2)
        #expect(sent[0].key != sent[1].key)
        #expect(sent[1].proof.token == OperationFixtures.otherToken)
    }

    /// A refusal drops the secret; repeated camera readings are ignored until
    /// the technician scans again, then a new key is drawn.
    @Test func aRefusalNeedsANewScanWithANewKey() async {
        let service = ScriptedOperationService(authorizations: [
            .failure(ActivityDoubles.refusal(403, "LOCAL_PROOF_INVALID")),
            .success(OperationFixtures.authorized),
        ])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        #expect(submission.outcome == .refused(.invalid))
        #expect(!submission.canRetry)
        #expect(submission.awaitsNewScan)

        await submission.retry()
        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        #expect(service.authorizations.count == 1)

        submission.scanAgain()
        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        let sent = service.authorizations
        #expect(sent.count == 2)
        #expect(sent[0].key != sent[1].key)
        #expect(submission.outcome == .authorized(OperationFixtures.authorized))
    }

    @Test(arguments: [
        (400, "LOCAL_PROOF_MALFORMED", .malformed),
        (403, "LOCAL_PROOF_INVALID", .invalid),
        (409, "LOCAL_PROOF_NOT_DISPLAYED", .notDisplayed),
        (409, "LOCAL_PROOF_CONTEXT_MISMATCH", .contextMismatch),
        (409, "LOCAL_PROOF_ALREADY_USED", .alreadyUsed),
        (409, "LOCAL_PROOF_INVALIDATED", .invalidated),
        (410, "LOCAL_PROOF_EXPIRED", .expired),
        (404, "OPERATION_NOT_FOUND", .operationNotFound),
        (503, "LOCKER_OFFLINE", .lockerOffline),
        (409, "OUTSIDE_OPERATING_HOURS", .other(code: "OUTSIDE_OPERATING_HOURS", traceId: "trace-1")),
    ] as [(Int, String, LocalProofSubmission.Refusal)])
    func everyRefusalOfTheContractIsRecognized(status: Int, code: String, refusal: LocalProofSubmission.Refusal) {
        #expect(LocalProofSubmission.refusal(ActivityDoubles.refusal(status, code)) == refusal)
    }

    @Test func aRateLimitKeepsTheServerDelay() {
        let limited = APIError.http(status: 429, problem: SessionFixtures.problem(429, "LOCAL_PROOF_RATE_LIMITED"),
                                    retryAfter: .seconds(42))

        #expect(LocalProofSubmission.refusal(limited) == .rateLimited(retryAfter: .seconds(42)))
    }

    @Test(arguments: [
        APIError.unreachable(.networkConnectionLost),
        .invalidResponse,
        .http(status: 500, problem: nil),
        .http(status: 503, problem: SessionFixtures.problem(503, "SERVICE_UNAVAILABLE")),
    ])
    func anUnknownOutcomeIsNeverARefusal(error: APIError) {
        #expect(LocalProofSubmission.refusal(error) == nil)
    }

    @Test func anExpiredSessionDropsTheSecret() async {
        let service = ScriptedOperationService(authorizations: [
            .failure(.http(status: 401, problem: SessionFixtures.problem(401, "AUTH_TOKEN_EXPIRED"))),
        ])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        #expect(submission.outcome == .sessionEnded)
        #expect(session.unauthorizedCodes == ["AUTH_TOKEN_EXPIRED"])
        #expect(!submission.canRetry)
    }

    @Test func withoutATokenNothingIsSent() async {
        session.token = nil
        let service = ScriptedOperationService()
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)

        #expect(service.authorizations.isEmpty)
        #expect(session.missingTokenCalls == 1)
        #expect(submission.outcome == .sessionEnded)
    }

    @Test func readingsDuringASubmissionAreIgnored() async {
        let service = ScriptedOperationService(authorizations: [.success(OperationFixtures.authorized)])
        let gate = Gate()
        service.authorizeGate = gate
        let submission = submission(service)

        let first = Task { await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting) }
        #expect(await waitUntil { service.authorizations.count == 1 })
        #expect(submission.isSubmitting)
        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        await submission.retry()
        #expect(service.authorizations.count == 1)

        await gate.open()
        await first.value
        #expect(submission.outcome == .authorized(OperationFixtures.authorized))
        #expect(service.authorizations.count == 1)
    }

    @Test func discardingForgetsTheSecret() async {
        let service = ScriptedOperationService(authorizations: [.failure(.unreachable(.timedOut))])
        let submission = submission(service)

        await submission.submit(scanned: OperationFixtures.uri(), for: OperationFixtures.awaiting)
        #expect(submission.canRetry)
        submission.discard()

        #expect(!submission.canRetry)
        #expect(submission.outcome == nil)
        await submission.retry()
        #expect(service.authorizations.count == 1)
    }
}
