package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.HubDisplayOutbox;
import ca.aegis.control.reservation.CheckoutAttemptRepository.PendingAttempt;

/**
 * The end of a local challenge that nobody consumed, of a checkout or of a return, whose loan it leaves unchanged (document 05, sections 5.4 and 5.7; document 10, section 27.4):
 *
 * <ul>
 * <li>its deadline passed: the challenge and the operation become {@code EXPIRED};</li>
 * <li>the hub restarted (another {@code deviceSessionId}, or its device was disabled) or is no longer
 * {@code ONLINE}: the challenge becomes {@code INVALIDATED} and the operation {@code FAILED}.</li>
 * </ul>
 *
 * Each end purges the challenge's ciphertext and queues a {@code DISPLAY_OPERATION_STATUS} that clears the screen.
 * Each challenge is decided in a transaction of its own, under the locks of document 06, section 3.3, and at an instant
 * read after them. A separate step purges the ciphertext of expired status instructions, so that no key stays
 * referenced by a message that can no longer be shown.
 */
@Component
public class LocalChallengeExpiry {

    /** Reasons stored in {@code failure_reason}; document 05, section 5.4 names the cases, not the codes. */
    static final String LOCAL_PROOF_EXPIRED = "LOCAL_PROOF_EXPIRED";
    static final String HUB_RESTARTED = "HUB_RESTARTED";
    static final String LOCKER_OFFLINE = "LOCKER_OFFLINE";
    /** Document 06, section 6.5: the fifth wrong secret submitted by the initiator ends the attempt. */
    static final String LOCAL_PROOF_ATTEMPTS_EXHAUSTED = "LOCAL_PROOF_ATTEMPTS_EXHAUSTED";

    private static final Logger log = LoggerFactory.getLogger(LocalChallengeExpiry.class);

    private record Candidate(UUID challengeId, UUID operationId, UUID userId, UUID assetId, UUID reservationId,
            UUID loanId, UUID lockerId) {
    }

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final ReservationRepository reservations;
    private final ReturnRepository loans;
    private final ReservableAssets assets;
    private final PreparationRepository preparation;
    private final CheckoutAttemptRepository attempts;
    private final LocalChallengeRepository challenges;
    private final LockerAvailability availability;
    private final HubDisplayOutbox display;
    private final AuditTrail audit;
    private final Clock clock;

    LocalChallengeExpiry(JdbcClient jdbc, TransactionTemplate transactions, ReservationRepository reservations,
            ReturnRepository loans, ReservableAssets assets, PreparationRepository preparation, CheckoutAttemptRepository attempts,
            LocalChallengeRepository challenges, LockerAvailability availability, HubDisplayOutbox display,
            AuditTrail audit, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.reservations = reservations;
        this.loans = loans;
        this.assets = assets;
        this.preparation = preparation;
        this.attempts = attempts;
        this.challenges = challenges;
        this.availability = availability;
        this.display = display;
        this.audit = audit;
        this.clock = clock;
    }

    /** One pass: every pending challenge is checked once; returns the number ended. */
    public int run(int max) {
        int ended = 0;
        for (Candidate candidate : pending(max)) {
            try {
                if (Boolean.TRUE.equals(transactions.execute(status -> decide(candidate)))) {
                    ended++;
                }
            } catch (RuntimeException failure) {
                // One challenge must not stop the others; the next pass decides it again.
                log.error("Local challenge not decided: challengeId={}, cause={}", candidate.challengeId(),
                        failure.getClass().getSimpleName());
            }
        }
        transactions.executeWithoutResult(status -> purgeExpiredInstructions());
        return ended;
    }

    private List<Candidate> pending(int max) {
        return jdbc.sql("""
                SELECT c.id, c.operation_id, o.user_id, o.asset_id, o.reservation_id, o.loan_id, o.locker_id
                FROM aegis.local_access_challenges c
                JOIN aegis.locker_operations o ON o.id = c.operation_id
                WHERE c.status = 'PENDING'
                ORDER BY c.expires_at, c.id
                LIMIT :max
                """)
                .param("max", max)
                .query((row, number) -> new Candidate(row.getObject("id", UUID.class),
                        row.getObject("operation_id", UUID.class), row.getObject("user_id", UUID.class),
                        row.getObject("asset_id", UUID.class), row.getObject("reservation_id", UUID.class),
                        row.getObject("loan_id", UUID.class), row.getObject("locker_id", UUID.class)))
                .list();
    }

    private boolean decide(Candidate candidate) {
        reservations.lockUser(candidate.userId());
        assets.lockForCustody(candidate.assetId());
        // The reservation of a checkout, or the loan of a return, third (document 08, section 7.1).
        if (candidate.reservationId() != null) {
            reservations.lock(candidate.reservationId());
        } else {
            loans.lock(candidate.loanId());
        }
        preparation.lockLocker(candidate.lockerId());
        Optional<PendingAttempt> attempt = lockAwaitingAttempt(candidate.operationId(), candidate.lockerId());
        Optional<ChallengeState> challenge = attempt.flatMap(found -> lockPending(candidate.challengeId()));
        if (challenge.isEmpty()) {
            // Consumed, closed or ended by another transaction meanwhile.
            return false;
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        LocalChallengeStatus closed;
        LockerOperationStatus terminal;
        String reason;
        if (!now.isBefore(challenge.get().expiresAt())) {
            closed = LocalChallengeStatus.EXPIRED;
            terminal = LockerOperationStatus.EXPIRED;
            reason = LOCAL_PROOF_EXPIRED;
        } else if (!challenge.get().targetSession().equals(currentSession(candidate.lockerId()))) {
            closed = LocalChallengeStatus.INVALIDATED;
            terminal = LockerOperationStatus.FAILED;
            reason = HUB_RESTARTED;
        } else if (availability.of(candidate.lockerId(), now).status() != ConnectionStatus.ONLINE) {
            closed = LocalChallengeStatus.INVALIDATED;
            terminal = LockerOperationStatus.FAILED;
            reason = LOCKER_OFFLINE;
        } else {
            return false;
        }
        end(candidate.challengeId(), candidate.operationId(), source(candidate.reservationId(), candidate.loanId()),
                candidate.lockerId(), null, closed, terminal, reason, now);
        return true;
    }

    /**
     * Ends a locked {@code AWAITING_LOCAL_PROOF} attempt and its locked {@code PENDING} challenge without any opening:
     * purges the challenge's ciphertext, queues the status that clears the screen and audits both transitions. The
     * caller holds the locks of document 06, section 3.3 and read {@code now} after them. A challenge closed for
     * {@link #LOCAL_PROOF_ATTEMPTS_EXHAUSTED} records its fifth failed attempt with its closing.
     */
    void end(UUID challengeId, UUID operationId, Map<String, Object> source, UUID lockerId, UUID actorUserId,
            LocalChallengeStatus closed, LockerOperationStatus terminal, String reason, Instant now) {
        attempts.end(new PendingAttempt(operationId, lockerId, LockerOperationStatus.AWAITING_LOCAL_PROOF), terminal,
                reason, now);
        if (LOCAL_PROOF_ATTEMPTS_EXHAUSTED.equals(reason)) {
            challenges.exhaust(challengeId, now);
        } else {
            challenges.close(challengeId, closed, now);
        }
        int stopped = challenges.stopDisplay(challengeId);
        Optional<UUID> statusMessage = display.enqueueStatus(operationId, terminal.name(), reason, now);
        audit.record(AuditEvent.transition(terminal == LockerOperationStatus.EXPIRED
                ? AuditEventType.OPERATION_EXPIRED : AuditEventType.OPERATION_FAILED, actorUserId,
                AuditSubjectType.LOCKER_OPERATION, operationId, operationId,
                LockerOperationStatus.AWAITING_LOCAL_PROOF, terminal, reason,
                source, now));
        audit.record(AuditEvent.transition(closed == LocalChallengeStatus.EXPIRED
                ? AuditEventType.LOCAL_CHALLENGE_EXPIRED : AuditEventType.LOCAL_CHALLENGE_INVALIDATED, actorUserId,
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, challengeId, operationId,
                LocalChallengeStatus.PENDING, closed, reason, Map.of("displayInstructionsStopped", stopped,
                        "statusDisplayQueued", statusMessage.isPresent()), now));
    }

    /** The reservation of a checkout or the loan of a return, as audit details name it. */
    static Map<String, Object> source(UUID reservationId, UUID loanId) {
        return reservationId != null ? Map.of("reservationId", reservationId) : Map.of("loanId", loanId);
    }

    private record ChallengeState(Instant expiresAt, UUID targetSession) {
    }

    private Optional<PendingAttempt> lockAwaitingAttempt(UUID operationId, UUID lockerId) {
        return jdbc.sql("""
                SELECT id FROM aegis.locker_operations WHERE id = :id AND status = 'AWAITING_LOCAL_PROOF' FOR UPDATE
                """).param("id", operationId).query(UUID.class).optional()
                .map(id -> new PendingAttempt(id, lockerId, LockerOperationStatus.AWAITING_LOCAL_PROOF));
    }

    private Optional<ChallengeState> lockPending(UUID challengeId) {
        return jdbc.sql("""
                SELECT expires_at, target_device_session_id FROM aegis.local_access_challenges
                WHERE id = :id AND status = 'PENDING' FOR UPDATE
                """).param("id", challengeId)
                .query((row, number) -> new ChallengeState(
                        row.getObject("expires_at", OffsetDateTime.class).toInstant(),
                        row.getObject("target_device_session_id", UUID.class)))
                .optional();
    }

    /** The boot of the locker's active device; {@code null} once that device is disabled. */
    private UUID currentSession(UUID lockerId) {
        return preparation.activeDevice(lockerId).map(PreparationRepository.Device::deviceSessionId).orElse(null);
    }

    /**
     * A status instruction past its display deadline can no longer be shown (document 10, section 27.3): its
     * ciphertext is purged, and a sendable one becomes {@code CANCELLED} as {@code ck_display_sendable_payload}
     * requires, keeping {@code published_at}. A row under a live claim is left to its dispatcher.
     */
    private void purgeExpiredInstructions() {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        int purged = jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = CASE WHEN status IN ('PENDING', 'CLAIMED', 'DISPATCHED') THEN 'CANCELLED' ELSE status END,
                    claim_until = NULL,
                    encrypted_payload = NULL
                WHERE expires_at <= :now AND encrypted_payload IS NOT NULL
                  AND (status <> 'CLAIMED' OR claim_until < :now)
                """).param("now", now).update();
        if (purged > 0) {
            log.debug("Expired display instructions purged: {}", purged);
        }
    }
}
