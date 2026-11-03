package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.reservation.CheckoutAttemptRepository.PendingAttempt;

/**
 * Ends the checkout attempts of a reservation that never reached their authorization, in the transaction that ends the
 * reservation (document 06, sections 5.5 and 14.1; document 05, section 5.4). No lock command was ever issued for
 * them, so ending them is physically safe.
 */
@Component
class PendingCheckouts {

    /** Document 06, section 5.5. */
    static final String RESERVATION_CANCELLED = "RESERVATION_CANCELLED";
    /**
     * Document 05, section 5.4 ends the attempt {@code EXPIRED} when the reservation ends; no document names the
     * {@code failure_reason} that {@code ck_locker_operations_failure_reason} then requires.
     */
    static final String RESERVATION_EXPIRED = "RESERVATION_EXPIRED";

    private final CheckoutAttemptRepository attempts;
    private final AuditTrail audit;

    PendingCheckouts(CheckoutAttemptRepository attempts, AuditTrail audit) {
        this.attempts = attempts;
        this.audit = audit;
    }

    /** {@code FAILED} with {@link #RESERVATION_CANCELLED}, by the holder who cancels. */
    @Transactional(propagation = Propagation.MANDATORY)
    List<UUID> endForCancellation(UUID reservationId, UUID holder, Instant now) {
        return end(reservationId, holder, LockerOperationStatus.FAILED, AuditEventType.OPERATION_FAILED,
                RESERVATION_CANCELLED, now);
    }

    /** {@code EXPIRED} with {@link #RESERVATION_EXPIRED}, by the backend. */
    @Transactional(propagation = Propagation.MANDATORY)
    List<UUID> endForExpiry(UUID reservationId, Instant now) {
        return end(reservationId, null, LockerOperationStatus.EXPIRED, AuditEventType.OPERATION_EXPIRED,
                RESERVATION_EXPIRED, now);
    }

    private List<UUID> end(UUID reservationId, UUID actor, LockerOperationStatus terminal, AuditEventType type,
            String reason, Instant now) {
        List<PendingAttempt> pending = attempts.lockBeforeAuthorization(reservationId);
        for (PendingAttempt attempt : pending) {
            attempts.end(attempt, terminal, reason, now);
            audit.record(AuditEvent.transition(type, actor, AuditSubjectType.LOCKER_OPERATION, attempt.id(),
                    attempt.id(), attempt.status(), terminal, reason, Map.of("reservationId", reservationId), now));
        }
        return pending.stream().map(PendingAttempt::id).toList();
    }
}
