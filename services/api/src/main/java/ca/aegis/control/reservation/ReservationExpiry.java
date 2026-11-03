package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.reservation.ReservationRepository.Due;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;

/**
 * Server-side expiry of a reservation (document 06, section 14.1; document 05, sections 3.3, 3.4 and 8), run by
 * {@link ReservationExpiryJob} and again at the start of the reservation actions of a technician.
 * <p>
 * Each reservation is decided in its own short transaction, which locks the asset, then the reservation, then the
 * lockers and attempts it ends (document 06, section 3.3), and checks again under those locks that the reservation is
 * still {@code ACTIVE} and due. A crash before commit therefore leaves the reservation, its attempts and its audit as
 * they were, and the next pass decides again; two workers never both expire it. Nothing outside PostgreSQL is awaited.
 * <p>
 * Expiry is deferred while a checkout attempt is authorized and not yet classified, or physically uncertain: the
 * physical outcome decides first. An attempt still waiting for its local proof does not defer it and ends with it. A
 * {@code FULFILLED} reservation is never expired, so a borrowed asset is never freed by this path; the asset's
 * availability is derived again from the stored custody on the next read.
 */
@Service
class ReservationExpiry {

    /** The decision taken for one reservation. */
    enum Outcome {
        EXPIRED,
        /** An authorized or physically uncertain checkout attempt holds the reservation until it is classified. */
        DEFERRED,
        /** Not {@code ACTIVE}, or not due yet, once its locks were held. */
        UNCHANGED,
        /** Another transaction held the asset, or the decision failed and was rolled back; a later pass decides. */
        SKIPPED
    }

    private static final Logger log = LoggerFactory.getLogger(ReservationExpiry.class);

    private final ReservationRepository reservations;
    private final CheckoutAttemptRepository attempts;
    private final PendingCheckouts pendingCheckouts;
    private final ReservableAssets assets;
    private final AuditTrail audit;
    private final TransactionTemplate transactions;
    private final Clock clock;

    ReservationExpiry(ReservationRepository reservations, CheckoutAttemptRepository attempts,
            PendingCheckouts pendingCheckouts, ReservableAssets assets, AuditTrail audit,
            PlatformTransactionManager transactionManager, Clock clock) {
        this.reservations = reservations;
        this.attempts = attempts;
        this.pendingCheckouts = pendingCheckouts;
        this.assets = assets;
        this.audit = audit;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        this.clock = clock;
    }

    /**
     * One pass of the job over every reservation due at the start of the pass, read in pages of {@code pageSize}
     * along {@code (reserved_until, id)}, each decided in its own transaction. An asset held by another transaction
     * is skipped rather than awaited ({@code SKIP LOCKED}). A reservation that is deferred, skipped or whose decision
     * fails is passed over, so it never holds back the later ones; the keyset only moves forward, so the pass ends.
     *
     * @return the number of reservations expired by this pass
     */
    int expireDue(int pageSize) {
        if (pageSize < 1) {
            throw new IllegalArgumentException("A pass needs a positive page size: " + pageSize);
        }
        Instant now = now();
        int expired = 0;
        Due after = null;
        List<Due> page;
        do {
            page = reservations.dueAfter(now, after, pageSize);
            for (Due due : page) {
                if (expireIsolated(due.id(), now) == Outcome.EXPIRED) {
                    expired++;
                }
            }
            after = page.isEmpty() ? after : page.getLast();
        } while (page.size() == pageSize);
        return expired;
    }

    /**
     * A failure is logged with the reservation id and the exception type only, since a database message may quote
     * row values; its transaction is rolled back and a later pass decides again.
     */
    private Outcome expireIsolated(UUID reservationId, Instant now) {
        try {
            return expire(reservationId, now, false);
        } catch (RuntimeException failure) {
            log.warn("Expiry of reservation {} failed ({}); a later pass retries it", reservationId,
                    failure.getClass().getName());
            return Outcome.SKIPPED;
        }
    }

    /**
     * The re-evaluation at the start of an action of {@code userId} on {@code assetId} (document 06, section 14): the
     * due reservations of that technician or that asset are expired first, waiting for their locks, so that the
     * action meets the current state rather than the scheduler's last pass. It runs before, never inside, the action's
     * own transaction, so that a refusal of the action does not roll the expiry back.
     */
    void expireDueBefore(UUID userId, UUID assetId) {
        Instant now = now();
        reservations.dueOf(userId, assetId, now).forEach(id -> expire(id, now, true));
    }

    /**
     * Decides one reservation at {@code now} or later. It joins the caller's transaction if there is one, so a test
     * can roll a whole decision back.
     *
     * @param now the instant the caller observed; the decision uses the later of it and the clock read under the
     *            locks, since a transaction that held them may have committed an attempt or a challenge after
     *            {@code now}, and no date written here may precede them
     * @param wait whether to wait for the asset lock, or to skip an asset that another transaction holds
     */
    Outcome expire(UUID reservationId, Instant now, boolean wait) {
        return transactions.execute(status -> decide(reservationId, now, wait));
    }

    private Outcome decide(UUID reservationId, Instant observed, boolean wait) {
        UUID assetId = reservations.assetOf(reservationId).orElse(null);
        if (assetId == null) {
            return Outcome.UNCHANGED;
        }
        boolean locked = wait ? assets.lockForCustody(assetId) : assets.tryLockForCustody(assetId);
        if (!locked) {
            return Outcome.SKIPPED;
        }
        ReservationRow reservation = reservations.lock(reservationId).orElseThrow();
        Instant underLocks = now();
        Instant now = underLocks.isAfter(observed) ? underLocks : observed;
        if (reservation.status() != ReservationStatus.ACTIVE || now.isBefore(reservation.reservedUntil())) {
            return Outcome.UNCHANGED;
        }
        if (attempts.defersExpiry(reservationId)) {
            log.debug("Expiry of reservation {} deferred by a checkout attempt", reservationId);
            return Outcome.DEFERRED;
        }

        List<UUID> endedAttempts = pendingCheckouts.endForExpiry(reservationId, now);
        reservations.expire(reservationId, now);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("assetId", assetId);
        details.put("reservedUntil", reservation.reservedUntil());
        details.put("endedOperationIds", endedAttempts);
        audit.record(AuditEvent.transition(AuditEventType.RESERVATION_EXPIRED, null, AuditSubjectType.RESERVATION,
                reservationId, null, ReservationStatus.ACTIVE, ReservationStatus.EXPIRED, null,
                details, now));
        log.info("Reservation {} expired", reservationId);
        return Outcome.EXPIRED;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
