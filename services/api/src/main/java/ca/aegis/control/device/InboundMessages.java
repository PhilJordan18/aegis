package ca.aegis.control.device;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.device.Inspection.Fact;
import ca.aegis.control.device.Inspection.Storable;
import ca.aegis.control.device.Inspection.Unstorable;
import ca.aegis.control.device.InboundMessageType.Presence;

/**
 * Validates a hub message against payload schema 3.0 (document 10, sections 3, 8.1, 13 to 15 and 20), without any
 * database access. Unknown fields are ignored, as a compatible minor version may add some (section 3.2).
 */
final class InboundMessages {

    static final int MAX_PAYLOAD_BYTES = 16 * 1024;
    static final long MAX_BOOT_COUNT = 4_294_967_295L;
    static final int MAX_DETAIL_LENGTH = 240;
    /** The hub-cell star has at most 247 addresses (document 08, ck_compartments_local_address). */
    static final int MAX_COMPARTMENTS = 247;
    static final Duration HEARTBEAT_MAX_AGE = Duration.ofSeconds(30);
    static final Duration MAX_CLOCK_LEAD = Duration.ofSeconds(5);

    private static final JsonMapper MAPPER = JsonMapper.builder(JsonFactory.builder()
                    .streamReadConstraints(StreamReadConstraints.builder()
                            .maxNestingDepth(8)
                            .maxStringLength(MAX_PAYLOAD_BYTES)
                            .maxNumberLength(32)
                            .build())
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    private static final Pattern SCHEMA_VERSION = Pattern.compile("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})");
    /** Stored as text: printable ASCII only, so that a hostile value cannot break the row. */
    private static final Pattern STORABLE_SCHEMA_VERSION = Pattern.compile("[\\x20-\\x7E]{1,32}");
    private static final Pattern INSTANT = Pattern.compile(
            "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z");

    private static final Set<String> CELL_CONNECTION = Set.of("CONNECTED", "DISCONNECTED", "UNKNOWN");
    private static final Set<String> READER = Set.of("HEALTHY", "FAULTED", "UNKNOWN");
    private static final Set<String> DOOR = Set.of("OPEN", "CLOSED", "UNKNOWN");
    private static final Set<String> LOCK = Set.of("LOCKED", "UNLOCKED", "UNKNOWN");
    private static final Set<String> ERROR_CODES = Set.of("CELL_COMMUNICATION_LOST", "RFID_READER_FAULT",
            "DOOR_SENSOR_FAULT", "LOCK_ACTUATOR_FAULT", "POWER_FAULT", "CLOCK_SYNC_LOST", "STORAGE_FAULT",
            "INBOUND_MESSAGE_INVALID");
    private static final Set<String> SEVERITIES = Set.of("WARNING", "CRITICAL");
    static final String INBOUND_MESSAGE_INVALID = "INBOUND_MESSAGE_INVALID";

    private InboundMessages() {
    }

    static Inspection inspect(InboundTopic topic, byte[] payload, Instant receivedAt) {
        if (payload.length > MAX_PAYLOAD_BYTES) {
            return new Unstorable(ProcessingError.PAYLOAD_TOO_LARGE, null);
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(payload);
        } catch (JacksonException | IllegalArgumentException unreadable) {
            return new Unstorable(ProcessingError.INVALID_JSON, null);
        }
        if (root == null || !root.isObject()) {
            return new Unstorable(ProcessingError.INVALID_JSON, null);
        }

        String messageIdText = text(root, "messageId");
        if (messageIdText == null) {
            return new Unstorable(ProcessingError.REQUIRED_FIELD_MISSING, null);
        }
        UUID messageId = Uuids.canonical(messageIdText).orElse(null);
        if (messageId == null) {
            return new Unstorable(ProcessingError.INVALID_UUID, null);
        }
        String typeText = text(root, "type");
        if (typeText == null) {
            return new Unstorable(ProcessingError.REQUIRED_FIELD_MISSING, messageId);
        }
        InboundMessageType type = InboundMessageType.of(typeText).orElse(null);
        if (type == null) {
            return new Unstorable(ProcessingError.MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC, messageId);
        }
        String schemaVersion = text(root, "schemaVersion");
        if (schemaVersion == null) {
            return new Unstorable(ProcessingError.REQUIRED_FIELD_MISSING, messageId);
        }
        if (!STORABLE_SCHEMA_VERSION.matcher(schemaVersion).matches() || schemaVersion.isBlank()) {
            return new Unstorable(ProcessingError.UNSUPPORTED_SCHEMA, messageId);
        }
        String timestampText = text(root, "timestamp");
        if (timestampText == null) {
            return new Unstorable(ProcessingError.REQUIRED_FIELD_MISSING, messageId);
        }
        Instant occurredAt = instant(timestampText);
        if (occurredAt == null) {
            return new Unstorable(ProcessingError.TIMESTAMP_INVALID, messageId);
        }

        try {
            Fact fact = accept(topic, root, type, schemaVersion, occurredAt, receivedAt);
            return new Storable(messageId, type, schemaVersion, occurredAt, null, fact);
        } catch (Rejection rejection) {
            return Storable.rejected(messageId, type, schemaVersion, occurredAt, rejection.error);
        }
    }

    /** Where a message claims to sit in its device's sequence. */
    record Position(UUID deviceSessionId, long bootCount, long sequence) {
    }

    /**
     * The position a stored payload claims, read with the same limits as {@link #inspect}; empty when it cannot be
     * read. A rejected message keeps only its raw payload, and this is what still orders it against accepted ones.
     */
    static Optional<Position> claimedPosition(byte[] payload) {
        if (payload == null || payload.length > MAX_PAYLOAD_BYTES) {
            return Optional.empty();
        }
        try {
            JsonNode root = MAPPER.readTree(payload);
            if (root == null || !root.isObject()) {
                return Optional.empty();
            }
            return Optional.of(new Position(requiredUuid(root, "deviceSessionId"),
                    integer(root, "bootCount", 1, MAX_BOOT_COUNT), integer(root, "sequence", 0, Long.MAX_VALUE)));
        } catch (JacksonException | IllegalArgumentException | Rejection unreadable) {
            return Optional.empty();
        }
    }

    private static Fact accept(InboundTopic topic, JsonNode root, InboundMessageType type, String schemaVersion,
            Instant occurredAt, Instant receivedAt) {
        Matcher version = SCHEMA_VERSION.matcher(schemaVersion);
        if (!version.matches() || !version.group(1).equals("3")) {
            throw new Rejection(ProcessingError.UNSUPPORTED_SCHEMA);
        }
        if (type.channel() != topic.channel()) {
            throw new Rejection(ProcessingError.MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC);
        }
        UUID lockerId = requiredUuid(root, "lockerId");
        if (!lockerId.equals(topic.lockerId())) {
            throw new Rejection(ProcessingError.TOPIC_PAYLOAD_LOCKER_MISMATCH);
        }
        UUID deviceSessionId = requiredUuid(root, "deviceSessionId");
        long bootCount = integer(root, "bootCount", 1, MAX_BOOT_COUNT);
        long sequence = integer(root, "sequence", 0, Long.MAX_VALUE);

        String errorCode = null;
        if (type == InboundMessageType.DEVICE_ERROR) {
            errorCode = deviceError(root);
        }
        UUID operationId = correlated(root, "operationId",
                INBOUND_MESSAGE_INVALID.equals(errorCode) ? Presence.FORBIDDEN : type.operationId());
        UUID compartmentId = correlated(root, "compartmentId", type.compartmentId());
        UUID commandMessageId = type.commandCorrelated() ? requiredUuid(root, "commandMessageId") : null;
        UUID displayMessageId = type.displayCorrelated() ? requiredUuid(root, "displayMessageId") : null;
        if (operationId != null && occurredAt.isAfter(receivedAt.plus(MAX_CLOCK_LEAD))) {
            throw new Rejection(ProcessingError.TIMESTAMP_OUT_OF_RANGE);
        }

        UUID connectionId = type.connectionScoped() ? requiredUuid(root, "connectionId") : null;
        String availabilityStatus = null;
        boolean heartbeatValid = false;
        List<CompartmentReport> compartments = List.of();
        RfidScan rfidScan = null;
        switch (type) {
            case HEARTBEAT -> {
                boolean clockSynchronized = bool(root, "clockSynchronized");
                compartments = compartments(root);
                heartbeatValid = clockSynchronized
                        && !occurredAt.isBefore(receivedAt.minus(HEARTBEAT_MAX_AGE))
                        && !occurredAt.isAfter(receivedAt.plus(MAX_CLOCK_LEAD));
            }
            case DEVICE_AVAILABILITY -> availabilityStatus = availability(root);
            case DOOR_OPENED -> requireValue(root, "doorState", "OPEN");
            case DOOR_CLOSED -> requireValue(root, "doorState", "CLOSED");
            case LOCK_UNLOCKED -> requireValue(root, "lockState", "UNLOCKED");
            case LOCK_LOCKED -> requireValue(root, "lockState", "LOCKED");
            case RFID_SCAN_COMPLETED -> rfidScan = rfidScan(root, occurredAt);
            default -> {
                // DEVICE_RESTARTED: a resetReason outside the list counts as UNKNOWN (section 13.1). The bodies of
                // the operational types are validated by the workflows that interpret them.
            }
        }
        String parsedJson = MAPPER.writeValueAsString(root);
        if (parsedJson.contains("\\u0000")) {
            parsedJson = null;
        }
        return new Fact(deviceSessionId, bootCount, sequence, connectionId, availabilityStatus, operationId,
                compartmentId, commandMessageId, displayMessageId, heartbeatValid, compartments, errorCode,
                parsedJson, rfidScan);
    }

    /**
     * Section 12.1. A scan the contract does not allow is rejected rather than kept as weaker evidence: its window
     * must end no later than the message and last at most ten seconds, and one identifier is reported once.
     */
    private static RfidScan rfidScan(JsonNode root, Instant occurredAt) {
        Instant started = requiredInstant(root, "windowStartedAt");
        Instant ended = requiredInstant(root, "windowEndedAt");
        if (ended.isBefore(started) || ended.isAfter(occurredAt)
                || Duration.between(started, ended).compareTo(RfidScan.MAX_WINDOW) > 0) {
            throw new Rejection(ProcessingError.TIMESTAMP_OUT_OF_RANGE);
        }
        String readerStatus = requiredValue(root, "readerStatus", READER);
        JsonNode array = value(root, "observedIdentifiers");
        if (array == null || !array.isArray() || array.size() > RfidScan.MAX_IDENTIFIERS) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        List<RfidScan.ObservedIdentifier> identifiers = new ArrayList<>(array.size());
        for (JsonNode entry : array) {
            if (!entry.isObject()) {
                throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
            }
            requiredValue(entry, "identifierType", Set.of(RfidScan.IDENTIFIER_TYPE));
            String value = text(entry, "identifierValue");
            // A control character cannot be an EPC, and PostgreSQL text refuses NUL: rejecting it here stores the
            // message REJECTED instead of failing the observation insert and losing the raw payload.
            if (value == null || value.isEmpty()
                    || value.codePointCount(0, value.length()) > RfidScan.MAX_IDENTIFIER_LENGTH
                    || value.codePoints().anyMatch(Character::isISOControl)) {
                throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
            }
            identifiers.add(new RfidScan.ObservedIdentifier(value,
                    (int) integer(entry, "readCount", 1, RfidScan.MAX_READ_COUNT)));
        }
        if (identifiers.stream().map(RfidScan.ObservedIdentifier::value).distinct().count() != identifiers.size()) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return new RfidScan(started, ended, readerStatus, identifiers);
    }

    private static Instant requiredInstant(JsonNode root, String field) {
        String text = text(root, field);
        if (text == null) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        Instant instant = instant(text);
        if (instant == null) {
            throw new Rejection(ProcessingError.TIMESTAMP_INVALID);
        }
        return instant;
    }

    private static String deviceError(JsonNode root) {
        String errorCode = requiredValue(root, "errorCode", ERROR_CODES);
        String severity = requiredValue(root, "severity", SEVERITIES);
        if (INBOUND_MESSAGE_INVALID.equals(errorCode) && !severity.equals("WARNING")) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        JsonNode detail = value(root, "detail");
        if (detail != null && (!detail.isString()
                || detail.stringValue().codePointCount(0, detail.stringValue().length()) > MAX_DETAIL_LENGTH)) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return errorCode;
    }

    private static String availability(JsonNode root) {
        String status = requiredValue(root, "status", Set.of("ONLINE", "OFFLINE"));
        String reason = requiredValue(root, "reason", Set.of("CONNECTED", "CONNECTION_LOST", "SHUTDOWN"));
        if (status.equals("ONLINE") != reason.equals("CONNECTED")) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return status;
    }

    private static List<CompartmentReport> compartments(JsonNode root) {
        JsonNode array = value(root, "compartments");
        if (array == null || !array.isArray() || array.size() > MAX_COMPARTMENTS) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        List<CompartmentReport> reports = new ArrayList<>(array.size());
        for (JsonNode cell : array) {
            if (!cell.isObject()) {
                throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
            }
            reports.add(new CompartmentReport(requiredUuid(cell, "compartmentId"),
                    (int) integer(cell, "cellAddress", 1, 247),
                    requiredValue(cell, "connectionStatus", CELL_CONNECTION),
                    requiredValue(cell, "readerStatus", READER),
                    requiredValue(cell, "doorState", DOOR),
                    requiredValue(cell, "lockState", LOCK)));
        }
        if (reports.stream().map(CompartmentReport::compartmentId).distinct().count() != reports.size()) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return List.copyOf(reports);
    }

    private static UUID correlated(JsonNode root, String field, Presence presence) {
        JsonNode node = value(root, field);
        if (node == null) {
            if (presence == Presence.REQUIRED) {
                throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
            }
            return null;
        }
        if (presence == Presence.FORBIDDEN) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return uuid(node);
    }

    private static UUID requiredUuid(JsonNode root, String field) {
        JsonNode node = value(root, field);
        if (node == null) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return uuid(node);
    }

    private static UUID uuid(JsonNode node) {
        if (!node.isString()) {
            throw new Rejection(ProcessingError.INVALID_UUID);
        }
        return Uuids.canonical(node.stringValue()).orElseThrow(() -> new Rejection(ProcessingError.INVALID_UUID));
    }

    private static long integer(JsonNode root, String field, long min, long max) {
        JsonNode node = value(root, field);
        if (node == null || !node.isIntegralNumber() || !node.canConvertToLong()
                || node.longValue() < min || node.longValue() > max) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return node.longValue();
    }

    private static boolean bool(JsonNode root, String field) {
        JsonNode node = value(root, field);
        if (node == null || !node.isBoolean()) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return node.booleanValue();
    }

    private static String requiredValue(JsonNode root, String field, Set<String> allowed) {
        String text = text(root, field);
        if (text == null || !allowed.contains(text)) {
            throw new Rejection(ProcessingError.REQUIRED_FIELD_MISSING);
        }
        return text;
    }

    private static void requireValue(JsonNode root, String field, String expected) {
        requiredValue(root, field, Set.of(expected));
    }

    /** A string field, or null when it is absent, JSON null or not a string. */
    private static String text(JsonNode root, String field) {
        JsonNode node = value(root, field);
        return node != null && node.isString() ? node.stringValue() : null;
    }

    /** A present, non-null field, or null. */
    private static JsonNode value(JsonNode root, String field) {
        JsonNode node = root.get(field);
        return node == null || node.isNull() ? null : node;
    }

    /** RFC 3339 in UTC with a mandatory second and a 1-3 digit fraction (document 10, section 3.3). */
    static Instant instant(String text) {
        if (!INSTANT.matcher(text).matches()) {
            return null;
        }
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException invalid) {
            return null;
        }
    }

    private static final class Rejection extends RuntimeException {

        private final ProcessingError error;

        Rejection(ProcessingError error) {
            super(error.name(), null, false, false);
            this.error = error;
        }
    }
}
