package ca.aegis.control.command;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.command.CommandRefusedException.Reason;

/**
 * Writes the durable unlock intent of document 06, section 7.2 and document 08, section 9.1 in the transaction that
 * authorizes the operation. It refuses to run without one: an outbox row committed apart from its business decision
 * is exactly the inconsistency ADR-005 rules out. Nothing is published here; the {@link CommandDispatcher} only reads
 * committed rows.
 */
@Component
public class CommandOutbox {

    private final JdbcClient jdbc;
    private final JsonMapper jsonMapper;
    private final Clock clock;

    CommandOutbox(JdbcClient jdbc, JsonMapper jsonMapper, Clock clock) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
        this.clock = clock;
    }

    /**
     * Queues the single {@code UNLOCK_COMPARTMENT} of an {@code AUTHORIZED} operation whose local challenge is
     * consumed. The target is the compartment and locker the operation was authorized for, never a value from the
     * caller, and the command expires with the operation.
     *
     * @throws CommandRefusedException when the operation is unknown, not authorized, without a consumed challenge,
     *         already expired or already given its command; the caller's transaction then rolls back
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UnlockCommand enqueueUnlock(UUID operationId) {
        return enqueueUnlock(operationId, clock.instant());
    }

    /**
     * The same, issued at {@code decidedAt}: the single instant the authorizing transaction read from its clock
     * (document 06, section 3.2), so that the command and the authorization state the same time.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UnlockCommand enqueueUnlock(UUID operationId, Instant decidedAt) {
        // The row lock orders this command after any concurrent transition of the same operation.
        OperationTarget operation = jdbc.sql("""
                SELECT o.status, o.locker_id, o.compartment_id, o.expires_at,
                       EXISTS (SELECT 1 FROM aegis.local_access_challenges c
                               WHERE c.operation_id = o.id AND c.status = 'CONSUMED') AS challenge_consumed,
                       EXISTS (SELECT 1 FROM aegis.command_outbox x WHERE x.operation_id = o.id) AS command_exists
                FROM aegis.locker_operations o
                WHERE o.id = :id
                FOR NO KEY UPDATE OF o
                """)
                .param("id", operationId)
                .query((row, number) -> new OperationTarget(row.getString("status"),
                        row.getObject("locker_id", UUID.class), row.getObject("compartment_id", UUID.class),
                        row.getObject("expires_at", OffsetDateTime.class), row.getBoolean("challenge_consumed"),
                        row.getBoolean("command_exists")))
                .optional()
                .orElseThrow(() -> new CommandRefusedException(Reason.OPERATION_NOT_FOUND));
        if (operation.commandExists()) {
            throw new CommandRefusedException(Reason.COMMAND_ALREADY_ISSUED);
        }
        if (!"AUTHORIZED".equals(operation.status())) {
            throw new CommandRefusedException(Reason.OPERATION_NOT_AUTHORIZED);
        }
        if (!operation.challengeConsumed()) {
            throw new CommandRefusedException(Reason.LOCAL_CHALLENGE_NOT_CONSUMED);
        }
        Instant issuedAt = decidedAt.truncatedTo(ChronoUnit.MILLIS);
        // Truncating can only move the deadline earlier, never past the operation's own expiry.
        Instant expiresAt = operation.expiresAt().toInstant().truncatedTo(ChronoUnit.MILLIS);
        if (!issuedAt.isBefore(expiresAt)) {
            throw new CommandRefusedException(Reason.OPERATION_EXPIRED);
        }
        UnlockCommand command = new UnlockCommand(UUID.randomUUID(), operationId, operation.lockerId(),
                operation.compartmentId(), issuedAt, expiresAt, UnlockCommand.SCHEMA_VERSION);
        jdbc.sql("""
                INSERT INTO aegis.command_outbox
                    (message_id, operation_id, locker_id, compartment_id, command_type, topic, schema_version,
                     issued_at, expires_at, payload, next_attempt_at)
                VALUES (:messageId, :operationId, :lockerId, :compartmentId, :type, :topic, :schemaVersion,
                        :issuedAt, :expiresAt, CAST(:payload AS jsonb), :issuedAt)
                """)
                .param("messageId", command.messageId())
                .param("operationId", operationId)
                .param("lockerId", command.lockerId())
                .param("compartmentId", command.compartmentId())
                .param("type", UnlockCommand.TYPE)
                .param("topic", command.topic())
                .param("schemaVersion", command.schemaVersion())
                .param("issuedAt", utc(issuedAt))
                .param("expiresAt", utc(expiresAt))
                .param("payload", jsonMapper.writeValueAsString(command.payload()))
                .update();
        return command;
    }

    static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private record OperationTarget(String status, UUID lockerId, UUID compartmentId, OffsetDateTime expiresAt,
            boolean challengeConsumed, boolean commandExists) {
    }
}
