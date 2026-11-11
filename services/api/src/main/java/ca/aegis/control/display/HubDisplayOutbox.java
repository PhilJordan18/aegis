package ca.aegis.control.display;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.display.DisplayKeyRing.Sealed;

/**
 * Producer of {@code hub_display_outbox} (document 08, section 4.6; document 10, section 27). Each instruction is
 * written in the caller's business transaction, sealed with the active display key, and published later by
 * {@link DisplayDispatcher}, outside any transaction.
 *
 * <p>The stored ciphertext is the complete MQTT message, so the dispatcher publishes exactly what was sealed. The
 * token never reaches a column, a log, an audit row or a REST response in clear.
 */
@Component
public class HubDisplayOutbox {

    /** Document 10, section 27.1. */
    public static final String SCHEMA_VERSION = "3.0";
    public static final String CHALLENGE_TYPE = "DISPLAY_ACCESS_CHALLENGE";
    public static final String STATUS_TYPE = "DISPLAY_OPERATION_STATUS";
    /** Document 10, section 27.3. */
    static final Duration STATUS_DISPLAY_DURATION = Duration.ofSeconds(30);
    private static final DateTimeFormatter INSTANT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(ZoneOffset.UTC);

    /** The hub that must render an instruction: the active device of the locker and its current boot. */
    public record Target(UUID lockerId, UUID lockerDeviceId, UUID deviceSessionId) {

        public Target {
            Objects.requireNonNull(lockerId, "lockerId");
            Objects.requireNonNull(lockerDeviceId, "lockerDeviceId");
            Objects.requireNonNull(deviceSessionId, "deviceSessionId");
        }
    }

    private final JdbcClient jdbc;
    private final JsonMapper jsonMapper;
    private final DisplayEncryption encryption;

    HubDisplayOutbox(JdbcClient jdbc, JsonMapper jsonMapper, DisplayEncryption encryption) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
        this.encryption = encryption;
    }

    public static String topic(UUID lockerId) {
        return "aegis/v1/lockers/" + lockerId + "/display";
    }

    /** Document 10, section 3.3: UTC, with exactly three fraction digits. */
    public static String format(Instant instant) {
        return INSTANT.format(instant);
    }

    /**
     * Queues the {@code DISPLAY_ACCESS_CHALLENGE} of a challenge just created. The caller holds the locker lock (document
     * 10, section 27.4), so the revision allocated here is the next one of that locker, without a gap or a reuse.
     *
     * @param token the 32 random bytes of the challenge; this method never keeps them
     * @return the {@code messageId} of the instruction
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueueChallenge(Target target, UUID operationId, UUID compartmentId, String compartmentCode,
            UUID challengeId, String action, byte[] token, Instant issuedAt, Instant expiresAt) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("challengeId", challengeId.toString());
        payload.put("action", action);
        payload.put("compartmentCode", compartmentCode);
        payload.put("token", Base64.getUrlEncoder().withoutPadding().encodeToString(token));
        return insert(target, operationId, compartmentId, challengeId, CHALLENGE_TYPE, payload, issuedAt, expiresAt);
    }

    /**
     * Queues the {@code DISPLAY_OPERATION_STATUS} of an operation that has just reached a terminal state validated in
     * this transaction (document 06, section 6.6). Nothing is queued when the locker has no active device with a
     * known boot: no hub could render it, and a later boot clears its screen anyway. The caller holds the locker lock.
     *
     * @param reasonCode the stored {@code failure_reason}, or {@code null}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<UUID> enqueueStatus(UUID operationId, String status, String reasonCode, Instant now) {
        if (!encryption.enabled()) {
            return Optional.empty();
        }
        Optional<StatusSource> found = jdbc.sql("""
                SELECT o.locker_id, o.compartment_id, o.type, c.code, d.id AS device_id, d.device_session_id
                FROM aegis.locker_operations o
                JOIN aegis.compartments c ON c.id = o.compartment_id
                LEFT JOIN aegis.locker_devices d ON d.locker_id = o.locker_id AND d.disabled_at IS NULL
                WHERE o.id = :id
                """)
                .param("id", operationId)
                .query((row, number) -> new StatusSource(row.getObject("locker_id", UUID.class),
                        row.getObject("compartment_id", UUID.class), row.getString("type"), row.getString("code"),
                        row.getObject("device_id", UUID.class), row.getObject("device_session_id", UUID.class)))
                .optional();
        if (found.isEmpty() || found.get().deviceId() == null || found.get().deviceSessionId() == null) {
            return Optional.empty();
        }
        StatusSource source = found.get();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("action", source.type());
        payload.put("compartmentCode", source.compartmentCode());
        payload.put("status", status);
        payload.put("reasonCode", reasonCode);
        Instant issuedAt = now.truncatedTo(ChronoUnit.MILLIS);
        return Optional.of(insert(new Target(source.lockerId(), source.deviceId(), source.deviceSessionId()),
                operationId, source.compartmentId(), null, STATUS_TYPE, payload, issuedAt,
                issuedAt.plus(STATUS_DISPLAY_DURATION)));
    }

    private UUID insert(Target target, UUID operationId, UUID compartmentId, UUID challengeId, String type,
            Map<String, Object> payload, Instant issuedAt, Instant expiresAt) {
        DisplayKeyRing keys = encryption.keyRing();
        long revision = jdbc.sql("""
                UPDATE aegis.lockers SET display_revision = display_revision + 1 WHERE id = :id
                RETURNING display_revision
                """).param("id", target.lockerId()).query(Long.class).single();
        UUID id = UUID.randomUUID();
        UUID messageId = UUID.randomUUID();
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("schemaVersion", SCHEMA_VERSION);
        message.put("messageId", messageId.toString());
        message.put("type", type);
        message.put("lockerId", target.lockerId().toString());
        message.put("compartmentId", compartmentId.toString());
        message.put("operationId", operationId.toString());
        message.put("targetDeviceSessionId", target.deviceSessionId().toString());
        message.put("displayRevision", revision);
        message.put("issuedAt", format(issuedAt));
        message.put("expiresAt", format(expiresAt));
        message.put("payload", payload);
        byte[] plaintext = jsonMapper.writeValueAsString(message).getBytes(StandardCharsets.UTF_8);
        Sealed sealed;
        try {
            sealed = keys.seal(plaintext, DisplayAad.of(id, target.lockerId(), operationId, revision));
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
        jdbc.sql("""
                INSERT INTO aegis.hub_display_outbox
                    (id, message_id, operation_id, locker_id, locker_device_id, target_device_session_id,
                     challenge_id, message_type, display_revision, topic, schema_version, encrypted_payload,
                     encryption_key_id, issued_at, expires_at, next_attempt_at, created_at)
                VALUES (:id, :messageId, :operationId, :lockerId, :deviceId, :sessionId, :challengeId, :type,
                        :revision, :topic, :schemaVersion, :payload, :keyId, :issuedAt, :expiresAt, :issuedAt,
                        :issuedAt)
                """)
                .param("id", id)
                .param("messageId", messageId)
                .param("operationId", operationId)
                .param("lockerId", target.lockerId())
                .param("deviceId", target.lockerDeviceId())
                .param("sessionId", target.deviceSessionId())
                .param("challengeId", challengeId)
                .param("type", type)
                .param("revision", revision)
                .param("topic", topic(target.lockerId()))
                .param("schemaVersion", SCHEMA_VERSION)
                .param("payload", sealed.envelope())
                .param("keyId", sealed.keyId())
                .param("issuedAt", issuedAt.atOffset(ZoneOffset.UTC))
                .param("expiresAt", expiresAt.atOffset(ZoneOffset.UTC))
                .update();
        return messageId;
    }

    private record StatusSource(UUID lockerId, UUID compartmentId, String type, String compartmentCode,
            UUID deviceId, UUID deviceSessionId) {
    }
}
