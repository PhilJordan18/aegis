package ca.aegis.control.command;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The {@code UNLOCK_COMPARTMENT} command of document 10, sections 8.2 and 9: exactly the eight contract fields, and
 * nothing about the user, the reservation, readiness or any secret. Every republication of a command rebuilds the same
 * payload from its outbox row, so its {@code messageId} and content never change across retries.
 */
public record UnlockCommand(UUID messageId, UUID operationId, UUID lockerId, UUID compartmentId, Instant issuedAt,
        Instant expiresAt, String schemaVersion) {

    public static final String TYPE = "UNLOCK_COMPARTMENT";
    /** Document 10, section 3.2: the backend producers of {@code commands} write schema 3.0 directly. */
    public static final String SCHEMA_VERSION = "3.0";

    public UnlockCommand {
        Objects.requireNonNull(messageId, "messageId");
        Objects.requireNonNull(operationId, "operationId");
        Objects.requireNonNull(lockerId, "lockerId");
        Objects.requireNonNull(compartmentId, "compartmentId");
        Objects.requireNonNull(issuedAt, "issuedAt");
        Objects.requireNonNull(expiresAt, "expiresAt");
        Objects.requireNonNull(schemaVersion, "schemaVersion");
        if (!expiresAt.isAfter(issuedAt)) {
            throw new IllegalArgumentException("A command expires after it is issued");
        }
    }

    /** Document 10, section 5: the lowercase canonical locker UUID, never a wildcard. */
    public String topic() {
        return topic(lockerId);
    }

    static String topic(UUID lockerId) {
        return "aegis/v1/lockers/" + lockerId + "/commands";
    }

    /** The payload fields in the order of the section 9 example; instants are UTC with at most three fraction digits. */
    public Map<String, String> payload() {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("schemaVersion", schemaVersion);
        payload.put("messageId", messageId.toString());
        payload.put("type", TYPE);
        payload.put("operationId", operationId.toString());
        payload.put("lockerId", lockerId.toString());
        payload.put("compartmentId", compartmentId.toString());
        payload.put("issuedAt", format(issuedAt));
        payload.put("expiresAt", format(expiresAt));
        return payload;
    }

    /**
     * Document 10, section 3.3: seconds are mandatory and a fraction has one to three digits. Instants are kept at
     * millisecond precision so that the stored row and the published payload state the same instant.
     */
    static String format(Instant instant) {
        return DateTimeFormatter.ISO_INSTANT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }
}
