package ca.aegis.control.reservation;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * The checkout attempts of a reservation ({@code locker_operations} of type {@code CHECKOUT}, document 08, section
 * 4.6), as the cancellation and the expiry of that reservation see them. Every caller already holds the asset and the
 * reservation locks, which the preparation and the local authorization of a checkout take too (document 08, section
 * 7.3): no attempt of the reservation can start or become authorized while the caller decides.
 */
@Repository
class CheckoutAttemptRepository {

    /** A checkout attempt still before its authorization, which the reservation ends with it. */
    record PendingAttempt(UUID id, UUID lockerId, LockerOperationStatus status) {
    }

    /**
     * An attempt in {@code ANOMALY} whose physical outcome stays uncertain: its anomaly is not {@code RESOLVED}
     * (document 09, section 8.10). An {@code ANOMALY} attempt without any anomaly row breaks document 08, section 7.5,
     * and counts as uncertain too. Every writer of an attempt's anomalies must take the asset lock first, as the
     * order of document 08, section 7.1 requires; the caller holds it, so this read sees a settled state.
     */
    private static final String UNCERTAIN = """
            (o.status = 'ANOMALY'
             AND (EXISTS (SELECT 1 FROM aegis.anomalies a
                          WHERE a.locker_operation_id = o.id AND a.status IN ('OPEN', 'ACKNOWLEDGED'))
                  OR NOT EXISTS (SELECT 1 FROM aegis.anomalies a WHERE a.locker_operation_id = o.id)))
            """;
    /**
     * An attempt that was ever authorized, whatever its outcome, or an uncertain one. Document 09, section 8.10, open
     * question Q1, read literally: the reservation can no longer be cancelled.
     */
    private static final String EVER_AUTHORIZED_OR_UNCERTAIN = "(o.authorized_at IS NOT NULL OR " + UNCERTAIN + ")";
    /**
     * An authorized attempt not yet classified, or an uncertain one (document 06, section 14.1): the expiry of the
     * reservation waits for it.
     */
    private static final String AUTHORIZED_OPEN_OR_UNCERTAIN = """
            ((o.authorized_at IS NOT NULL AND o.status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY'))
             OR """ + UNCERTAIN + ")";
    private static final String BEFORE_AUTHORIZATION = "status IN ('REQUESTED', 'AWAITING_LOCAL_PROOF')";

    private final JdbcClient jdbc;

    CheckoutAttemptRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    boolean blocksCancellation(UUID reservationId) {
        return exists(EVER_AUTHORIZED_OR_UNCERTAIN, reservationId);
    }

    boolean defersExpiry(UUID reservationId) {
        return exists(AUTHORIZED_OPEN_OR_UNCERTAIN, reservationId);
    }

    /**
     * Locks the lockers of the attempts still before authorization, then those attempts, in the order of document 08,
     * section 7.1, and returns them as read under lock. {@code ux_locker_operations_one_open_per_locker} keeps this to
     * at most one attempt per locker.
     */
    List<PendingAttempt> lockBeforeAuthorization(UUID reservationId) {
        List<UUID> lockers = jdbc.sql("SELECT DISTINCT locker_id FROM aegis.locker_operations WHERE type = 'CHECKOUT' "
                + "AND reservation_id = :id AND " + BEFORE_AUTHORIZATION + " ORDER BY locker_id")
                .param("id", reservationId).query(UUID.class).list();
        if (lockers.isEmpty()) {
            return List.of();
        }
        jdbc.sql("SELECT id FROM aegis.lockers WHERE id IN (:ids) ORDER BY id FOR UPDATE")
                .param("ids", lockers).query(UUID.class).list();
        return jdbc.sql("SELECT id, locker_id, status FROM aegis.locker_operations WHERE type = 'CHECKOUT' "
                + "AND reservation_id = :id AND " + BEFORE_AUTHORIZATION + " ORDER BY id FOR UPDATE")
                .param("id", reservationId)
                .query((row, number) -> new PendingAttempt(row.getObject("id", UUID.class),
                        row.getObject("locker_id", UUID.class),
                        LockerOperationStatus.valueOf(row.getString("status"))))
                .list();
    }

    /** Ends a locked attempt that is still before authorization; no lock command was ever issued for it. */
    void end(PendingAttempt attempt, LockerOperationStatus terminal, String reason, Instant now) {
        int ended = jdbc.sql("""
                UPDATE aegis.locker_operations SET status = :status, terminal_at = :now, failure_reason = :reason
                WHERE id = :id AND status IN ('REQUESTED', 'AWAITING_LOCAL_PROOF')
                """)
                .param("status", terminal.name())
                .param("now", now.atOffset(ZoneOffset.UTC))
                .param("reason", reason)
                .param("id", attempt.id())
                .update();
        if (ended != 1) {
            throw new IllegalStateException("A locked checkout attempt changed state: " + attempt.id());
        }
    }

    private boolean exists(String condition, UUID reservationId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM aegis.locker_operations o WHERE o.type = 'CHECKOUT' "
                + "AND o.reservation_id = :id AND " + condition + ")")
                .param("id", reservationId).query(Boolean.class).single();
    }
}
