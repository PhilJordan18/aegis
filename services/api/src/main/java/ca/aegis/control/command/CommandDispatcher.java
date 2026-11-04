package ca.aegis.control.command;

import static ca.aegis.control.command.CommandOutbox.utc;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandPublisher.CommandPublicationException;

/**
 * The dispatcher of document 06, section 7.3 and document 08, section 9.2. Each command goes through three short
 * transactions with the publication between them, so no transaction is ever open while the broker is awaited:
 *
 * <ol>
 * <li>claim: {@code FOR UPDATE SKIP LOCKED} takes one due row and leases it; another dispatcher skips it, and sees
 * it again only once the lease has ended;</li>
 * <li>publish the payload rebuilt from the row, with its unchanged {@code messageId};</li>
 * <li>mark: under the locks of the operation then the command, only if this claim still owns the row.</li>
 * </ol>
 *
 * <p>{@code attempt_count} is the fencing token of a claim: every claim increments it, so a dispatcher whose lease
 * ended and whose row another dispatcher re-claimed can no longer mark, release or cancel that row.
 *
 * <p>The window between a publication and its mark is not closed, and cannot be without a commit shared by
 * PostgreSQL and the broker. A crash or a lease that ends inside it leaves the row {@code CLAIMED}; once the lease
 * has ended the row is claimed again and the same command is published again. Delivery is therefore at least once:
 * the stable {@code messageId} and {@code operationId} let the hub refuse a second actuation (document 10, section
 * 16.1), and the fencing token keeps the operation from advancing twice.
 */
public class CommandDispatcher {

    public enum Outcome {
        /** No command was due. */
        IDLE,
        /** Published and marked {@code DISPATCHED} by this claim. */
        PUBLISHED,
        /** Published, but another claim or an acknowledgement owned the row by the time of the mark. */
        PUBLISHED_UNMARKED,
        /** Not accepted by the broker; released for a later attempt with the same {@code messageId}. */
        RETRY_SCHEDULED,
        /** Expired or for a terminal operation: cancelled without publication. */
        CANCELLED
    }

    private static final Logger log = LoggerFactory.getLogger(CommandDispatcher.class);
    private static final Duration MAX_RETRY_DELAY = Duration.ofSeconds(30);
    private static final String FAILURE_REASON_NOT_PUBLISHED = "COMMAND_NOT_PUBLISHED_BEFORE_EXPIRY";
    /**
     * Prefix of {@code last_error} once an attempt may have reached the broker: V007 has no column for it, and the
     * prefix survives the later attempts until the command is marked or cancelled.
     */
    static final String UNCERTAIN = "PUBLICATION_UNCERTAIN ";

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final AuditTrail auditTrail;
    private final Clock clock;
    private final CommandPublisher publisher;
    private final Duration lease;

    CommandDispatcher(JdbcClient jdbc, TransactionTemplate transactions, AuditTrail auditTrail, Clock clock,
            CommandPublisher publisher, Duration lease) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.auditTrail = auditTrail;
        this.clock = clock;
        this.publisher = publisher;
        this.lease = lease;
    }

    /** Dispatches due commands one by one until none is due or {@code max} were handled. */
    public int dispatchDue(int max) {
        int handled = 0;
        while (handled < max && dispatchNext() != Outcome.IDLE) {
            handled++;
        }
        return handled;
    }

    public Outcome dispatchNext() {
        Optional<Claim> claimed = transactions.execute(status -> claim());
        if (claimed.isEmpty()) {
            return Outcome.IDLE;
        }
        Claim claim = claimed.get();
        Instant now = clock.instant();
        if (claim.operationTerminal() || !now.isBefore(claim.command().expiresAt())) {
            transactions.executeWithoutResult(status -> cancel(claim));
            return Outcome.CANCELLED;
        }
        // Document 08, section 8.3: the stored payload is published, unchanged, at every attempt.
        byte[] payload = claim.payload().getBytes(StandardCharsets.UTF_8);
        try {
            publisher.publish(claim.command().topic(), payload);
        } catch (CommandPublicationException failure) {
            log.warn("Unlock command not confirmed by the broker ({}, mayHaveBeenPublished={}); retrying later: "
                    + "messageId={}, attempt={}", failure.getMessage(), failure.mayHaveBeenPublished(),
                    claim.command().messageId(), claim.attempt());
            transactions.executeWithoutResult(status -> release(claim, failure));
            return Outcome.RETRY_SCHEDULED;
        }
        return Boolean.TRUE.equals(transactions.execute(status -> markDispatched(claim)))
                ? Outcome.PUBLISHED : Outcome.PUBLISHED_UNMARKED;
    }

    /** Section 9.2, with the dispatcher's clock instead of {@code now()} so that expiry and lease share one time. */
    private Optional<Claim> claim() {
        Instant now = clock.instant();
        Optional<Claim> claim = jdbc.sql("""
                WITH candidate AS (
                    SELECT id
                    FROM aegis.command_outbox
                    WHERE (status = 'PENDING' OR (status = 'CLAIMED' AND claim_until < :now))
                      AND next_attempt_at <= :now
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE aegis.command_outbox AS command
                SET status = 'CLAIMED',
                    attempt_count = command.attempt_count + 1,
                    claimed_at = :now,
                    claim_until = :claimUntil,
                    -- A lease that ended without a mark or a release: that claim may have published.
                    last_error = CASE WHEN command.status = 'CLAIMED' THEN :leaseLost ELSE command.last_error END
                FROM candidate
                WHERE command.id = candidate.id
                RETURNING command.id, command.message_id, command.operation_id, command.locker_id,
                          command.compartment_id, command.schema_version, command.issued_at, command.expires_at,
                          command.attempt_count, command.payload::text AS payload,
                          command.last_error LIKE :uncertain AS publication_uncertain,
                          (SELECT o.status IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')
                           FROM aegis.locker_operations o WHERE o.id = command.operation_id) AS operation_terminal
                """)
                .param("now", utc(now))
                .param("claimUntil", utc(now.plus(lease)))
                .param("leaseLost", UNCERTAIN + "LEASE_ENDED_WITHOUT_MARK")
                .param("uncertain", UNCERTAIN + "%")
                .query((row, number) -> new Claim(row.getObject("id", UUID.class),
                        new UnlockCommand(row.getObject("message_id", UUID.class),
                                row.getObject("operation_id", UUID.class), row.getObject("locker_id", UUID.class),
                                row.getObject("compartment_id", UUID.class),
                                row.getObject("issued_at", OffsetDateTime.class).toInstant(),
                                row.getObject("expires_at", OffsetDateTime.class).toInstant(),
                                row.getString("schema_version")),
                        row.getString("payload"), row.getInt("attempt_count"),
                        row.getBoolean("publication_uncertain"), row.getBoolean("operation_terminal")))
                .optional();
        claim.ifPresent(c -> {
            if (c.attempt() > 1) {
                // A previous claim may have published: this attempt republishes the same messageId.
                log.info("Unlock command claimed again: messageId={}, attempt={}", c.command().messageId(),
                        c.attempt());
            }
        });
        return claim;
    }

    /** Locks the operation, then the command: the same order as any other writer of both rows. */
    private Optional<OperationState> lockOperation(Claim claim) {
        return jdbc.sql("SELECT status, type FROM aegis.locker_operations WHERE id = :id FOR UPDATE")
                .param("id", claim.command().operationId())
                .query((row, number) -> new OperationState(row.getString("status"), row.getString("type")))
                .optional();
    }

    private boolean ownsRow(Claim claim) {
        return jdbc.sql("""
                SELECT id FROM aegis.command_outbox
                WHERE id = :id AND status = 'CLAIMED' AND attempt_count = :attempt
                FOR UPDATE
                """).param("id", claim.id()).param("attempt", claim.attempt()).query(UUID.class).optional()
                .isPresent();
    }

    private boolean markDispatched(Claim claim) {
        Optional<String> operationStatus = lockOperation(claim).map(OperationState::status);
        if (!ownsRow(claim)) {
            log.info("Unlock command published without a mark: another claim or an acknowledgement owns it: "
                    + "messageId={}, attempt={}", claim.command().messageId(), claim.attempt());
            return false;
        }
        Instant now = clock.instant();
        jdbc.sql("""
                UPDATE aegis.command_outbox
                SET status = 'DISPATCHED', published_at = :now, claim_until = NULL, last_error = NULL
                WHERE id = :id
                """).param("id", claim.id()).param("now", utc(now)).update();
        Map<String, Object> details = Map.of("messageId", claim.command().messageId(), "attempt", claim.attempt());
        if (operationStatus.filter("AUTHORIZED"::equals).isPresent()) {
            jdbc.sql("""
                    UPDATE aegis.locker_operations
                    SET status = 'COMMAND_SENT', command_sent_at = :now
                    WHERE id = :id AND status = 'AUTHORIZED'
                    """).param("id", claim.command().operationId()).param("now", utc(now)).update();
            auditTrail.record(new AuditEvent(AuditEventType.COMMAND_SENT, null, AuditSubjectType.LOCKER_OPERATION,
                    claim.command().operationId(), claim.command().operationId(), "AUTHORIZED", "COMMAND_SENT",
                    AuditResult.ACCEPTED, null, details, now));
        } else {
            // The command left the backend even though the operation moved on meanwhile: record the fact only.
            auditTrail.record(new AuditEvent(AuditEventType.COMMAND_SENT, null, AuditSubjectType.COMMAND_OUTBOX,
                    claim.id(), claim.command().operationId(), null, null, AuditResult.ACCEPTED,
                    "OPERATION_NOT_AUTHORIZED", details, now));
        }
        return true;
    }

    /**
     * The uncertainty of an earlier attempt is kept: {@code last_error} then keeps its {@link #UNCERTAIN} prefix even
     * when a later attempt is refused before sending, so the deadline never mistakes a possible publication for none.
     */
    private void release(Claim claim, CommandPublicationException failure) {
        lockOperation(claim);
        if (!ownsRow(claim)) {
            return;
        }
        Instant now = clock.instant();
        boolean uncertain = claim.publicationUncertain() || failure.mayHaveBeenPublished();
        jdbc.sql("""
                UPDATE aegis.command_outbox
                SET status = 'PENDING', claim_until = NULL, next_attempt_at = :next, last_error = :reason
                WHERE id = :id
                """).param("id", claim.id()).param("next", utc(now.plus(retryDelay(claim.attempt()))))
                .param("reason", (uncertain ? UNCERTAIN : "") + failure.getMessage()).update();
    }

    /**
     * Document 05, section 5: an operation still {@code AUTHORIZED} at its deadline expires, and its command is
     * forbidden. That is a safe failure only if no earlier attempt can have published; after an uncertain attempt
     * the operation is left as it is, for the reconciliation of the acknowledgement and timeout handling. Only a
     * checkout expires here: a return also reverts its loan (document 05, section 4.3), which belongs to the
     * operation expiry of document 06, section 14.2.
     */
    private void cancel(Claim claim) {
        Optional<OperationState> operation = lockOperation(claim);
        if (!ownsRow(claim)) {
            return;
        }
        Instant now = clock.instant();
        boolean neverPublished = !claim.publicationUncertain();
        String reason = claim.operationTerminal() ? "OPERATION_TERMINAL"
                : neverPublished ? "COMMAND_EXPIRED" : UNCERTAIN + "COMMAND_EXPIRED";
        jdbc.sql("""
                UPDATE aegis.command_outbox SET status = 'CANCELLED', claim_until = NULL, last_error = :reason
                WHERE id = :id
                """).param("id", claim.id()).param("reason", reason).update();
        boolean authorizedCheckout = operation
                .filter(o -> "AUTHORIZED".equals(o.status()) && "CHECKOUT".equals(o.type())).isPresent();
        if (neverPublished && authorizedCheckout) {
            jdbc.sql("""
                    UPDATE aegis.locker_operations
                    SET status = 'EXPIRED', terminal_at = :now, failure_reason = :failure
                    WHERE id = :id AND status = 'AUTHORIZED'
                    """).param("id", claim.command().operationId()).param("now", utc(now))
                    .param("failure", FAILURE_REASON_NOT_PUBLISHED).update();
            auditTrail.record(new AuditEvent(AuditEventType.OPERATION_EXPIRED, null,
                    AuditSubjectType.LOCKER_OPERATION, claim.command().operationId(), claim.command().operationId(),
                    "AUTHORIZED", "EXPIRED", AuditResult.ACCEPTED, FAILURE_REASON_NOT_PUBLISHED,
                    Map.of("messageId", claim.command().messageId()), now));
        } else if (!claim.operationTerminal()) {
            log.warn("Unlock command expired; operation left for the operation expiry (mayHaveBeenPublished={}, "
                    + "type={}): messageId={}, attempt={}", !neverPublished,
                    operation.map(OperationState::type).orElse(null), claim.command().messageId(), claim.attempt());
        }
    }

    /** Doubles from 1 s up to 30 s; the deadline of the command, not this delay, ends the retries. */
    static Duration retryDelay(int attempt) {
        Duration delay = Duration.ofSeconds(1L << Math.min(Math.max(attempt - 1, 0), 5));
        return delay.compareTo(MAX_RETRY_DELAY) > 0 ? MAX_RETRY_DELAY : delay;
    }

    private record Claim(UUID id, UnlockCommand command, String payload, int attempt, boolean publicationUncertain,
            boolean operationTerminal) {
    }

    private record OperationState(String status, String type) {
    }
}
