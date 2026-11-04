package ca.aegis.control.command;

import static ca.aegis.control.command.CommandOutbox.utc;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;

/**
 * Applies a hub's {@code COMMAND_ACKNOWLEDGED} or {@code COMMAND_REJECTED} (document 10, section 10) to the command
 * and its operation, in the ingestion transaction that stores the inbound message (document 08, section 9.3). It
 * locks the operation then the command, as the dispatcher does, so the two never deadlock and an acknowledgement
 * that overtakes the dispatcher's mark is applied once: the late mark then finds a row it no longer owns.
 *
 * <p>The first report of a command decides it. A redelivered report, or the hub's answer to a redelivered command
 * (a new event {@code messageId}, the same {@code commandMessageId}), changes nothing: the hub's own journal prevents
 * a second actuation, and this method prevents a second transition.
 */
@Component
public class CommandAcknowledgements {

    public enum Kind {
        ACKNOWLEDGED,
        REJECTED
    }

    public enum Result {
        /** The command and, where its state allowed, the operation now reflect the report. */
        APPLIED,
        /** The command was already decided by an earlier report; nothing changed. */
        ALREADY_APPLIED,
        /** The report names another operation, locker or compartment than its command; nothing changed. */
        NOT_CORRELATED,
        /** An acknowledgement received outside its command's validity window; nothing changed (decision of #41). */
        OUTSIDE_VALIDITY_WINDOW,
        /**
         * An acknowledgement of a cancelled command or of a terminal operation: both are kept as they are, and one
         * {@code INCONSISTENT_PHYSICAL_STATE} anomaly asks for a manual inspection of the locker (decision of #41).
         */
        ANOMALY_RAISED,
        /** A rejection of a cancelled command or of a terminal operation: recorded, nothing to change. */
        TERMINAL_IGNORED
    }

    /**
     * Document 10, section 10.2: rejections the hub issues before any actuation, which leave the compartment locked.
     * {@code LOCK_ACTUATION_FAILED} and {@code PREVIOUS_EXECUTION_UNCERTAIN} are absent: the physical state is then
     * unknown, which is never a safe failure (document 05, section 5).
     */
    static final Set<String> SAFE_REJECTIONS = Set.of("INVALID_PAYLOAD", "UNSUPPORTED_SCHEMA", "WRONG_LOCKER",
            "UNKNOWN_COMPARTMENT", "CLOCK_NOT_SYNCHRONIZED", "COMMAND_EXPIRED", "LOCAL_OPERATION_IN_PROGRESS",
            "CELL_UNREACHABLE", "COMPARTMENT_DISABLED", "DOOR_STATE_UNSAFE", "POWER_STATE_UNSAFE",
            "INTERNAL_DEVICE_ERROR");

    private static final Logger log = LoggerFactory.getLogger(CommandAcknowledgements.class);
    private static final Set<String> TERMINAL = Set.of("CONFIRMED", "FAILED", "EXPIRED", "ANOMALY");

    private final JdbcClient jdbc;
    private final AuditTrail auditTrail;

    CommandAcknowledgements(JdbcClient jdbc, AuditTrail auditTrail) {
        this.jdbc = jdbc;
        this.auditTrail = auditTrail;
    }

    /**
     * @param report a report already stored as {@code inboundMessageId} in this transaction, whose
     *        {@code commandMessageId} references an outbox row ({@code fk_inbound_messages_command})
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Result apply(CommandReport report) {
        Optional<String> operationStatus = jdbc.sql(
                "SELECT status FROM aegis.locker_operations WHERE id = :id FOR UPDATE")
                .param("id", report.operationId()).query(String.class).optional();
        Optional<CommandRow> command = jdbc.sql("""
                SELECT id, operation_id, locker_id, compartment_id, status, issued_at, expires_at
                FROM aegis.command_outbox WHERE message_id = :messageId
                FOR UPDATE
                """).param("messageId", report.commandMessageId())
                .query((row, number) -> new CommandRow(row.getObject("id", UUID.class),
                        row.getObject("operation_id", UUID.class), row.getObject("locker_id", UUID.class),
                        row.getObject("compartment_id", UUID.class), row.getString("status"),
                        row.getObject("issued_at", java.time.OffsetDateTime.class).toInstant(),
                        row.getObject("expires_at", java.time.OffsetDateTime.class).toInstant()))
                .optional();
        if (command.isEmpty() || operationStatus.isEmpty() || !command.get().matches(report)) {
            log.warn("Command report not correlated with its command: inboundMessageId={}, commandMessageId={}",
                    report.inboundMessageId(), report.commandMessageId());
            return Result.NOT_CORRELATED;
        }
        CommandRow row = command.get();
        if (row.status().equals("ACKNOWLEDGED") || row.status().equals("REJECTED")) {
            return Result.ALREADY_APPLIED;
        }
        Instant at = report.receivedAt();
        if (row.status().equals("CANCELLED") || TERMINAL.contains(operationStatus.get())) {
            return reportAfterTheEnd(report, row, operationStatus.get(), at);
        }
        // The backend's reception instant, never the hub's clock, is compared with the command's own window.
        if (report.kind() == Kind.ACKNOWLEDGED && (at.isBefore(row.issuedAt()) || !at.isBefore(row.expiresAt()))) {
            log.warn("Command acknowledgement outside its validity window; operation unchanged: operationId={}, "
                    + "commandMessageId={}", report.operationId(), report.commandMessageId());
            return Result.OUTSIDE_VALIDITY_WINDOW;
        }
        // A report proves the command reached the hub, whatever the dispatcher recorded or failed to record.
        jdbc.sql("""
                UPDATE aegis.command_outbox
                SET status = :status, published_at = COALESCE(published_at, :at), acknowledged_at = :at,
                    claim_until = NULL
                WHERE id = :id
                """).param("id", row.id()).param("status", report.kind().name()).param("at", utc(at)).update();
        transitionOperation(report, row, operationStatus.get(), at);
        return Result.APPLIED;
    }

    private void transitionOperation(CommandReport report, CommandRow command, String status, Instant at) {
        Map<String, Object> details = Map.of("commandMessageId", report.commandMessageId(), "outcome",
                report.outcome());
        if (status.equals("AUTHORIZED")) {
            // The report overtook the dispatcher's mark: the command was sent, so the operation first records it.
            jdbc.sql("""
                    UPDATE aegis.locker_operations SET status = 'COMMAND_SENT', command_sent_at = :at
                    WHERE id = :id
                    """).param("id", report.operationId()).param("at", utc(at)).update();
            record(report, AuditEventType.COMMAND_SENT, "AUTHORIZED", "COMMAND_SENT", "SENT_BEFORE_MARK", details, at);
            status = "COMMAND_SENT";
        }
        if (!status.equals("COMMAND_SENT")) {
            // Further along than COMMAND_SENT: the single command of the operation was already reported on.
            auditTrail.recordAboutInboundMessage(new AuditEvent(eventType(report), null,
                    AuditSubjectType.COMMAND_OUTBOX, command.id(), report.operationId(), null, null,
                    AuditResult.ACCEPTED, "OPERATION_" + status, details, at), report.inboundMessageId());
            return;
        }
        if (report.kind() == Kind.ACKNOWLEDGED) {
            jdbc.sql("""
                    UPDATE aegis.locker_operations SET status = 'COMMAND_ACKNOWLEDGED', acknowledged_at = :at
                    WHERE id = :id
                    """).param("id", report.operationId()).param("at", utc(at)).update();
            record(report, AuditEventType.COMMAND_ACKNOWLEDGED, "COMMAND_SENT", "COMMAND_ACKNOWLEDGED", null,
                    details, at);
        } else if (SAFE_REJECTIONS.contains(report.outcome())) {
            String failure = "COMMAND_REJECTED_" + report.outcome();
            jdbc.sql("""
                    UPDATE aegis.locker_operations SET status = 'FAILED', terminal_at = :at, failure_reason = :failure
                    WHERE id = :id
                    """).param("id", report.operationId()).param("at", utc(at)).param("failure", failure).update();
            record(report, AuditEventType.COMMAND_REJECTED, "COMMAND_SENT", "FAILED", failure, details, at);
        } else {
            // LOCK_ACTUATION_FAILED, PREVIOUS_EXECUTION_UNCERTAIN or an unknown reason: the cell may have moved.
            auditTrail.recordAboutInboundMessage(new AuditEvent(AuditEventType.COMMAND_REJECTED, null,
                    AuditSubjectType.COMMAND_OUTBOX, command.id(), report.operationId(), null, null,
                    AuditResult.ACCEPTED, "PHYSICAL_STATE_UNCERTAIN", details, at), report.inboundMessageId());
            log.warn("Command rejected with an uncertain physical state; operation left for the anomaly handling: "
                    + "operationId={}, reason={}", report.operationId(), report.outcome());
        }
    }

    /**
     * Decision of #41, 4 November 2026: the operation and the command keep their final states. An acknowledgement
     * means the hub may have unlocked a cell that no live operation covers, so it opens one HIGH
     * {@code INCONSISTENT_PHYSICAL_STATE} anomaly; a repeated report finds it open and opens none
     * ({@code ux_anomalies_one_open_per_operation} is the final guard). The report alone never establishes a
     * checkout or a return.
     */
    private Result reportAfterTheEnd(CommandReport report, CommandRow command, String operationStatus, Instant at) {
        Map<String, Object> details = Map.of("commandMessageId", report.commandMessageId(), "outcome",
                report.outcome(), "operationStatus", operationStatus, "commandStatus", command.status());
        if (report.kind() == Kind.REJECTED) {
            return Result.TERMINAL_IGNORED;
        }
        Optional<UUID> anomaly = jdbc.sql("""
                INSERT INTO aegis.anomalies (type, severity, locker_operation_id, compartment_id, detected_at, details)
                VALUES ('INCONSISTENT_PHYSICAL_STATE', 'HIGH', :operation, :compartment, :at, CAST(:details AS jsonb))
                ON CONFLICT (locker_operation_id) WHERE locker_operation_id IS NOT NULL
                    AND status IN ('OPEN', 'ACKNOWLEDGED') DO NOTHING
                RETURNING id
                """).param("operation", report.operationId()).param("compartment", command.compartmentId())
                .param("at", utc(at)).param("details", """
                        {"reason": "COMMAND_ACKNOWLEDGED_AFTER_END", "commandMessageId": "%s"}"""
                        .formatted(report.commandMessageId()))
                .query(UUID.class).optional();
        if (anomaly.isPresent()) {
            auditTrail.recordAboutInboundMessage(new AuditEvent(AuditEventType.ANOMALY_CREATED, null,
                    AuditSubjectType.ANOMALY, anomaly.get(), report.operationId(), null, null, AuditResult.ACCEPTED,
                    "COMMAND_ACKNOWLEDGED_AFTER_END", details, at), report.inboundMessageId());
            log.warn("Hub acknowledged a command after its operation ended or the command was cancelled; anomaly "
                    + "opened for a locker inspection: operationId={}, anomalyId={}", report.operationId(),
                    anomaly.get());
        }
        return Result.ANOMALY_RAISED;
    }

    private void record(CommandReport report, AuditEventType type, String from, String to, String reason,
            Map<String, Object> details, Instant at) {
        auditTrail.recordAboutInboundMessage(new AuditEvent(type, null, AuditSubjectType.LOCKER_OPERATION,
                report.operationId(), report.operationId(), from, to, AuditResult.ACCEPTED, reason, details, at),
                report.inboundMessageId());
    }

    private static AuditEventType eventType(CommandReport report) {
        return report.kind() == Kind.ACKNOWLEDGED ? AuditEventType.COMMAND_ACKNOWLEDGED
                : AuditEventType.COMMAND_REJECTED;
    }

    /**
     * One stored report.
     *
     * @param outcome {@code result} of an acknowledgement ({@code ACCEPTED}, {@code ALREADY_APPLIED}) or
     *        {@code reason} of a rejection
     * @param receivedAt the backend's reception instant, never the hub's clock
     */
    public record CommandReport(UUID inboundMessageId, Kind kind, UUID commandMessageId, UUID operationId,
            UUID lockerId, UUID compartmentId, String outcome, Instant receivedAt) {

        private static final tools.jackson.databind.json.JsonMapper JSON =
                tools.jackson.databind.json.JsonMapper.builder().build();

        /**
         * A report as the ingestion stored it: its type and its parsed payload, whose {@code result} or
         * {@code reason} the ingestion has already validated against document 10, section 10.
         */
        public static CommandReport stored(UUID inboundMessageId, String messageType, UUID commandMessageId,
                UUID operationId, UUID lockerId, UUID compartmentId, String parsedPayload, Instant receivedAt) {
            Kind kind = messageType.equals("COMMAND_ACKNOWLEDGED") ? Kind.ACKNOWLEDGED : Kind.REJECTED;
            tools.jackson.databind.JsonNode payload = JSON.readTree(parsedPayload);
            String field = kind == Kind.ACKNOWLEDGED ? "result" : "reason";
            String outcome = payload.hasNonNull(field) ? payload.get(field).asString() : "UNKNOWN";
            return new CommandReport(inboundMessageId, kind, commandMessageId, operationId, lockerId, compartmentId,
                    outcome, receivedAt);
        }

        public CommandReport {
            Objects.requireNonNull(inboundMessageId, "inboundMessageId");
            Objects.requireNonNull(kind, "kind");
            Objects.requireNonNull(commandMessageId, "commandMessageId");
            Objects.requireNonNull(operationId, "operationId");
            Objects.requireNonNull(lockerId, "lockerId");
            Objects.requireNonNull(compartmentId, "compartmentId");
            Objects.requireNonNull(outcome, "outcome");
            Objects.requireNonNull(receivedAt, "receivedAt");
        }
    }

    private record CommandRow(UUID id, UUID operationId, UUID lockerId, UUID compartmentId, String status,
            Instant issuedAt, Instant expiresAt) {

        boolean matches(CommandReport report) {
            return operationId.equals(report.operationId()) && lockerId.equals(report.lockerId())
                    && compartmentId.equals(report.compartmentId());
        }
    }
}
