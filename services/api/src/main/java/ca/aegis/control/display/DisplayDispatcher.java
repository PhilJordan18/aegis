package ca.aegis.control.display;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.command.CommandPublisher;
import ca.aegis.control.command.CommandPublisher.CommandPublicationException;

/**
 * The dispatcher of {@code hub_display_outbox} (document 06, section 6.4; document 08, section 9.2), built like the
 * unlock command dispatcher: a short claim, the publication outside any transaction, then a mark fenced by
 * {@code attempt_count}. The payload is decrypted only between the claim and the publication, in memory, and its
 * plaintext is cleared once published.
 *
 * <p>An instruction is never published once its display has expired, nor for a challenge no longer {@code PENDING}:
 * it is cancelled and its ciphertext purged. A payload that cannot be opened (retired key, modified bytes, other
 * row) is cancelled too and never published; the challenge then expires without being displayed.
 */
public class DisplayDispatcher {

    public enum Outcome {
        IDLE,
        PUBLISHED,
        PUBLISHED_UNMARKED,
        RETRY_SCHEDULED,
        CANCELLED,
        /** The stored payload failed to open; nothing was published. */
        REFUSED
    }

    private static final Logger log = LoggerFactory.getLogger(DisplayDispatcher.class);
    private static final Duration MAX_RETRY_DELAY = Duration.ofSeconds(30);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final CommandPublisher publisher;
    private final DisplayEncryption encryption;
    private final Duration lease;

    DisplayDispatcher(JdbcClient jdbc, TransactionTemplate transactions, Clock clock, CommandPublisher publisher,
            DisplayEncryption encryption, Duration lease) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.clock = clock;
        this.publisher = publisher;
        this.encryption = encryption;
        this.lease = lease;
    }

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
        if (!clock.instant().isBefore(claim.expiresAt()) || claim.challengeClosed()) {
            transactions.executeWithoutResult(status -> close(claim, "CANCELLED",
                    claim.challengeClosed() ? "CHALLENGE_CLOSED" : "DISPLAY_EXPIRED"));
            return Outcome.CANCELLED;
        }
        byte[] message;
        try {
            message = encryption.configuredKeys()
                    .orElseThrow(() -> new DisplayPayloadException(DisplayPayloadException.Reason.KEY_NOT_CONFIGURED))
                    .open(claim.keyId(), claim.envelope(),
                            DisplayAad.of(claim.id(), claim.lockerId(), claim.operationId(), claim.revision()));
        } catch (DisplayPayloadException refused) {
            log.error("Display instruction refused before publication: reason={}, messageId={}, keyId={}",
                    refused.reason(), claim.messageId(), claim.keyId());
            transactions.executeWithoutResult(status -> close(claim, "CANCELLED",
                    "DISPLAY_PAYLOAD_" + refused.reason().name()));
            return Outcome.REFUSED;
        }
        try {
            publisher.publish(claim.topic(), message);
        } catch (CommandPublicationException failure) {
            log.warn("Display instruction not confirmed by the broker ({}); retrying later: messageId={}, attempt={}",
                    failure.getMessage(), claim.messageId(), claim.attempt());
            transactions.executeWithoutResult(status -> release(claim, failure));
            return Outcome.RETRY_SCHEDULED;
        } finally {
            Arrays.fill(message, (byte) 0);
        }
        return Boolean.TRUE.equals(transactions.execute(status -> markDispatched(claim)))
                ? Outcome.PUBLISHED : Outcome.PUBLISHED_UNMARKED;
    }

    private Optional<Claim> claim() {
        Instant now = clock.instant();
        return jdbc.sql("""
                WITH candidate AS (
                    SELECT id
                    FROM aegis.hub_display_outbox
                    WHERE (status = 'PENDING' OR (status = 'CLAIMED' AND claim_until < :now))
                      AND next_attempt_at <= :now
                    ORDER BY locker_id, display_revision
                    FOR NO KEY UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE aegis.hub_display_outbox AS display
                SET status = 'CLAIMED', attempt_count = display.attempt_count + 1, claim_until = :claimUntil
                FROM candidate
                WHERE display.id = candidate.id
                RETURNING display.id, display.message_id, display.operation_id, display.locker_id,
                          display.display_revision, display.topic, display.encrypted_payload,
                          display.encryption_key_id, display.expires_at, display.attempt_count,
                          (display.challenge_id IS NOT NULL AND NOT EXISTS (
                               SELECT 1 FROM aegis.local_access_challenges c
                               WHERE c.id = display.challenge_id AND c.status = 'PENDING')) AS challenge_closed
                """)
                .param("now", utc(now))
                .param("claimUntil", utc(now.plus(lease)))
                .query((row, number) -> new Claim(row.getObject("id", UUID.class),
                        row.getObject("message_id", UUID.class), row.getObject("operation_id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getLong("display_revision"),
                        row.getString("topic"), row.getBytes("encrypted_payload"),
                        row.getString("encryption_key_id"),
                        row.getObject("expires_at", OffsetDateTime.class).toInstant(), row.getInt("attempt_count"),
                        row.getBoolean("challenge_closed")))
                .optional();
    }

    private boolean ownsRow(Claim claim) {
        return jdbc.sql("""
                SELECT id FROM aegis.hub_display_outbox
                WHERE id = :id AND status = 'CLAIMED' AND attempt_count = :attempt
                FOR NO KEY UPDATE
                """).param("id", claim.id()).param("attempt", claim.attempt()).query(UUID.class).optional()
                .isPresent();
    }

    private boolean markDispatched(Claim claim) {
        if (!ownsRow(claim)) {
            log.info("Display instruction published without a mark: another claim, an acknowledgement or a purge "
                    + "owns it: messageId={}, attempt={}", claim.messageId(), claim.attempt());
            return false;
        }
        jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'DISPATCHED', published_at = :now, claim_until = NULL, last_error = NULL
                WHERE id = :id
                """).param("id", claim.id()).param("now", utc(clock.instant())).update();
        return true;
    }

    private void release(Claim claim, CommandPublicationException failure) {
        if (!ownsRow(claim)) {
            return;
        }
        jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'PENDING', claim_until = NULL, next_attempt_at = :next, last_error = :reason
                WHERE id = :id
                """).param("id", claim.id())
                .param("next", utc(clock.instant().plus(retryDelay(claim.attempt()))))
                .param("reason", failure.getMessage()).update();
    }

    /** Ends a claimed instruction without publishing it, and purges its ciphertext. */
    private void close(Claim claim, String status, String reason) {
        if (!ownsRow(claim)) {
            return;
        }
        jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = :status, claim_until = NULL, encrypted_payload = NULL, last_error = :reason
                WHERE id = :id
                """).param("id", claim.id()).param("status", status).param("reason", reason).update();
    }

    static Duration retryDelay(int attempt) {
        Duration delay = Duration.ofSeconds(1L << Math.min(Math.max(attempt - 1, 0), 5));
        return delay.compareTo(MAX_RETRY_DELAY) > 0 ? MAX_RETRY_DELAY : delay;
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private record Claim(UUID id, UUID messageId, UUID operationId, UUID lockerId, long revision, String topic,
            byte[] envelope, String keyId, Instant expiresAt, int attempt, boolean challengeClosed) {
    }
}
