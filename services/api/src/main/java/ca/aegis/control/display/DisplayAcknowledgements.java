package ca.aegis.control.display;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;

/**
 * Applies the hub's display reports of document 10, section 27.2 in the transaction that stores them. A report is
 * applied only if it matches its instruction exactly: same locker, operation, target boot, revision and, for a
 * challenge, same {@code challengeId}. A PUBACK is never a display acknowledgement.
 *
 * <ul>
 * <li>{@code ACCESS_CHALLENGE_DISPLAYED} sets {@code displayedAt} of a {@code PENDING} challenge received before its
 * expiry, once; a duplicate or a late report changes nothing.</li>
 * <li>{@code DISPLAY_REJECTED} stops the distribution of its instruction and purges its ciphertext.
 * {@code STALE_DISPLAY_REVISION} is information only (section 27.4). No rejection ends the challenge: without a
 * display, the challenge cannot be consumed (document 06, section 6.5), and its expiry ends it.</li>
 * </ul>
 */
@Component
public class DisplayAcknowledgements {

    public enum Outcome {
        APPLIED,
        ALREADY_APPLIED,
        NOT_CORRELATED,
        MALFORMED,
        OUTSIDE_VALIDITY_WINDOW,
        TERMINAL_IGNORED
    }

    /** A stored display report, with the boot it came from. */
    public record DisplayReport(UUID inboundMessageId, boolean displayed, UUID displayMessageId, UUID operationId,
            UUID lockerId, UUID deviceSessionId, String parsedJson, Instant receivedAt) {
    }

    static final Set<String> REJECTION_REASONS = Set.of("SCREEN_UNAVAILABLE", "TARGET_SESSION_MISMATCH",
            "DISPLAY_EXPIRED", "STALE_DISPLAY_REVISION", "INVALID_DISPLAY_PAYLOAD");
    private static final Logger log = LoggerFactory.getLogger(DisplayAcknowledgements.class);

    private final JdbcClient jdbc;
    private final JsonMapper jsonMapper;
    private final AuditTrail audit;

    DisplayAcknowledgements(JdbcClient jdbc, JsonMapper jsonMapper, AuditTrail audit) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
        this.audit = audit;
    }

    private record Instruction(UUID id, UUID operationId, UUID lockerId, UUID targetSession, UUID challengeId,
            String type, long revision, String status) {
    }

    private record Challenge(String status, Instant expiresAt, Instant displayedAt) {
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Outcome apply(DisplayReport report) {
        JsonNode root;
        try {
            root = jsonMapper.readTree(report.parsedJson());
        } catch (RuntimeException unreadable) {
            return Outcome.MALFORMED;
        }
        Optional<Long> revision = revision(root);
        Optional<UUID> challengeId = uuid(root, "challengeId");
        String reason = report.displayed() ? null : text(root, "reason");
        if (revision.isEmpty() || (!report.displayed() && !REJECTION_REASONS.contains(reason))) {
            return Outcome.MALFORMED;
        }
        // The challenge, then its instruction: the order of document 06, section 3.3, after the operation.
        Optional<Instruction> found = instruction(report.displayMessageId());
        if (found.isEmpty()) {
            return Outcome.NOT_CORRELATED;
        }
        Instruction instruction = found.get();
        boolean challengeType = HubDisplayOutbox.CHALLENGE_TYPE.equals(instruction.type());
        boolean correlated = instruction.lockerId().equals(report.lockerId())
                && instruction.operationId().equals(report.operationId())
                && instruction.targetSession().equals(report.deviceSessionId())
                && instruction.revision() == revision.get()
                && (challengeType ? challengeId.filter(instruction.challengeId()::equals).isPresent()
                        : challengeId.isEmpty())
                && (challengeType || !report.displayed());
        if (!correlated) {
            return Outcome.NOT_CORRELATED;
        }
        return report.displayed() ? displayed(instruction, report) : rejected(instruction, reason, report);
    }

    private Outcome displayed(Instruction instruction, DisplayReport report) {
        Challenge challenge = lockChallenge(instruction.challengeId());
        if (challenge.displayedAt() != null) {
            return Outcome.ALREADY_APPLIED;
        }
        if (!"PENDING".equals(challenge.status())) {
            return Outcome.TERMINAL_IGNORED;
        }
        if (!report.receivedAt().isBefore(challenge.expiresAt())) {
            return Outcome.OUTSIDE_VALIDITY_WINDOW;
        }
        jdbc.sql("""
                UPDATE aegis.local_access_challenges SET displayed_at = :at
                WHERE id = :id AND status = 'PENDING' AND displayed_at IS NULL
                """).param("id", instruction.challengeId()).param("at", utc(report.receivedAt())).update();
        lockInstruction(instruction.id());
        jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'ACKNOWLEDGED', acknowledged_at = :at, claim_until = NULL
                WHERE id = :id AND status IN ('PENDING', 'CLAIMED', 'DISPATCHED')
                """).param("id", instruction.id()).param("at", utc(report.receivedAt())).update();
        audit.record(new AuditEvent(AuditEventType.LOCAL_CHALLENGE_DISPLAYED, null,
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, instruction.challengeId(), instruction.operationId(), null,
                null, AuditResult.ACCEPTED, null, Map.of("displayMessageId", report.displayMessageId(),
                        "displayRevision", instruction.revision(), "inboundMessageId", report.inboundMessageId()),
                report.receivedAt()));
        return Outcome.APPLIED;
    }

    private Outcome rejected(Instruction instruction, String reason, DisplayReport report) {
        if (instruction.challengeId() != null) {
            lockChallenge(instruction.challengeId());
        }
        lockInstruction(instruction.id());
        int stopped = jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'REJECTED', claim_until = NULL, encrypted_payload = NULL, last_error = :reason
                WHERE id = :id AND status IN ('PENDING', 'CLAIMED', 'DISPATCHED')
                """).param("id", instruction.id()).param("reason", "DISPLAY_REJECTED " + reason).update();
        log.warn("Display instruction rejected by the hub: lockerId={}, messageId={}, type={}, reason={}",
                instruction.lockerId(), report.displayMessageId(), instruction.type(), reason);
        return stopped == 1 ? Outcome.APPLIED : Outcome.ALREADY_APPLIED;
    }

    private Optional<Instruction> instruction(UUID messageId) {
        return jdbc.sql("""
                SELECT id, operation_id, locker_id, target_device_session_id, challenge_id, message_type,
                       display_revision, status
                FROM aegis.hub_display_outbox WHERE message_id = :id
                """)
                .param("id", messageId)
                .query((row, number) -> new Instruction(row.getObject("id", UUID.class),
                        row.getObject("operation_id", UUID.class), row.getObject("locker_id", UUID.class),
                        row.getObject("target_device_session_id", UUID.class),
                        row.getObject("challenge_id", UUID.class), row.getString("message_type"),
                        row.getLong("display_revision"), row.getString("status")))
                .optional();
    }

    private Challenge lockChallenge(UUID challengeId) {
        return jdbc.sql("""
                SELECT status, expires_at, displayed_at FROM aegis.local_access_challenges WHERE id = :id
                FOR NO KEY UPDATE
                """)
                .param("id", challengeId)
                .query((row, number) -> new Challenge(row.getString("status"),
                        row.getObject("expires_at", OffsetDateTime.class).toInstant(),
                        Optional.ofNullable(row.getObject("displayed_at", OffsetDateTime.class))
                                .map(OffsetDateTime::toInstant).orElse(null)))
                .single();
    }

    private void lockInstruction(UUID id) {
        jdbc.sql("SELECT id FROM aegis.hub_display_outbox WHERE id = :id FOR NO KEY UPDATE").param("id", id)
                .query(UUID.class).single();
    }

    private static Optional<Long> revision(JsonNode root) {
        JsonNode value = root.get("displayRevision");
        return value != null && value.isIntegralNumber() && value.canConvertToLong() && value.longValue() > 0
                ? Optional.of(value.longValue()) : Optional.empty();
    }

    private static Optional<UUID> uuid(JsonNode root, String field) {
        String value = text(root, field);
        if (value == null) {
            return Optional.empty();
        }
        try {
            UUID parsed = UUID.fromString(value);
            // Document 10, section 3.4: the canonical lowercase form only.
            return parsed.toString().equals(value) ? Optional.of(parsed) : Optional.empty();
        } catch (IllegalArgumentException invalid) {
            return Optional.empty();
        }
    }

    private static String text(JsonNode root, String field) {
        JsonNode value = root.get(field);
        return value != null && value.isString() ? value.asString() : null;
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
