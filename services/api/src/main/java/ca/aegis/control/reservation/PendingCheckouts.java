package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.display.HubDisplayOutbox;
import ca.aegis.control.reservation.CheckoutAttemptRepository.PendingAttempt;

/**
 * Ends the checkout attempts of a reservation that never reached their authorization, in the transaction that ends the
 * reservation (document 06, sections 5.5 and 14.1; document 05, section 5.4). No lock command was ever issued for
 * them, so ending them is physically safe. Their pending challenge closes with them, its ciphertext is purged, and a
 * {@code DISPLAY_OPERATION_STATUS} clears the hub screen (document 10, section 27.3).
 */
@Component
class PendingCheckouts {

    /** Document 06, section 5.5. */
    static final String RESERVATION_CANCELLED = "RESERVATION_CANCELLED";
    /**
     * Document 05, section 5.4 ends the attempt when the reservation expires; no document names the
     * {@code failure_reason} that {@code ck_locker_operations_failure_reason} then requires.
     */
    static final String RESERVATION_EXPIRED = "RESERVATION_EXPIRED";

    private final CheckoutAttemptRepository attempts;
    private final LocalChallengeRepository challenges;
    private final HubDisplayOutbox display;
    private final AuditTrail audit;

    PendingCheckouts(CheckoutAttemptRepository attempts, LocalChallengeRepository challenges, HubDisplayOutbox display,
            AuditTrail audit) {
        this.attempts = attempts;
        this.challenges = challenges;
        this.display = display;
        this.audit = audit;
    }

    /** {@code FAILED} with {@link #RESERVATION_CANCELLED}, by the holder who cancels. */
    @Transactional(propagation = Propagation.MANDATORY)
    List<UUID> endForCancellation(UUID reservationId, UUID holder, Instant now) {
        return end(reservationId, holder, attempt -> LockerOperationStatus.FAILED, LocalChallengeStatus.INVALIDATED,
                AuditEventType.LOCAL_CHALLENGE_INVALIDATED, RESERVATION_CANCELLED, now);
    }

    /**
     * By the backend, with {@link #RESERVATION_EXPIRED}: an attempt waiting for its QR becomes {@code EXPIRED}; a
     * {@code REQUESTED} attempt becomes {@code FAILED}, the only end document 05, section 5.4 allows it.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    List<UUID> endForExpiry(UUID reservationId, Instant now) {
        return end(reservationId, null, PendingCheckouts::expiredEnd, LocalChallengeStatus.EXPIRED,
                AuditEventType.LOCAL_CHALLENGE_EXPIRED, RESERVATION_EXPIRED, now);
    }

    private static LockerOperationStatus expiredEnd(PendingAttempt attempt) {
        return attempt.status() == LockerOperationStatus.REQUESTED ? LockerOperationStatus.FAILED
                : LockerOperationStatus.EXPIRED;
    }

    private List<UUID> end(UUID reservationId, UUID actor, Function<PendingAttempt, LockerOperationStatus> terminalOf,
            LocalChallengeStatus closed, AuditEventType challengeType, String reason, Instant now) {
        List<PendingAttempt> pending = attempts.lockBeforeAuthorization(reservationId);
        for (PendingAttempt attempt : pending) {
            LockerOperationStatus terminal = terminalOf.apply(attempt);
            AuditEventType type = terminal == LockerOperationStatus.FAILED ? AuditEventType.OPERATION_FAILED
                    : AuditEventType.OPERATION_EXPIRED;
            Optional<UUID> challenge = challenges.lockPending(attempt.id());
            attempts.end(attempt, terminal, reason, now);
            audit.record(AuditEvent.transition(type, actor, AuditSubjectType.LOCKER_OPERATION, attempt.id(),
                    attempt.id(), attempt.status(), terminal, reason, Map.of("reservationId", reservationId), now));
            if (challenge.isPresent()) {
                challenges.close(challenge.get(), closed, now);
                int stopped = challenges.stopDisplay(challenge.get());
                // The caller's lockBeforeAuthorization holds the locker whose display revision this increments.
                boolean queued = display.enqueueStatus(attempt.id(), terminal.name(), reason, now).isPresent();
                audit.record(AuditEvent.transition(challengeType, actor, AuditSubjectType.LOCAL_ACCESS_CHALLENGE,
                        challenge.get(), attempt.id(), LocalChallengeStatus.PENDING, closed, reason,
                        Map.of("reservationId", reservationId, "displayInstructionsStopped", stopped,
                                "statusDisplayQueued", queued), now));
            }
        }
        return pending.stream().map(PendingAttempt::id).toList();
    }
}
