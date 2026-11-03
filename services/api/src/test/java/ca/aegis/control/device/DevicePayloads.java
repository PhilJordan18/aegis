package ca.aegis.control.device;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.json.JsonMapper;

/**
 * Schema 3.0 hub messages of document 10, sections 8.1 and 13 to 15, for the fictitious test hub of
 * {@code infra/mqtt/acl}. The tests never use the demo hub's identity: a development API sharing the broker would
 * take their messages as its demo locker's.
 */
final class DevicePayloads {

    static final UUID LOCKER = UUID.fromString("f08e3bc1-a0c6-4870-a6f6-55d9e9ddd502");
    static final UUID CELL_A1 = UUID.fromString("f6e3bedc-19de-42df-b5e2-3b3dffab33fe");
    static final UUID CELL_A2 = UUID.fromString("ff3341eb-6202-4597-b35c-6266ff9e51a7");
    static final String EVENTS = "aegis/v1/lockers/" + LOCKER + "/events";
    static final String STATUS = "aegis/v1/lockers/" + LOCKER + "/status";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** One boot of the hub: a session, a connection and a sequence counter. */
    static final class Session {

        final UUID lockerId;
        final UUID deviceSessionId = UUID.randomUUID();
        final long bootCount;
        UUID connectionId = UUID.randomUUID();
        long sequence;

        Session(long bootCount) {
            this(bootCount, LOCKER);
        }

        /** A session of another locker, for tests that call the ingestion directly rather than through the broker. */
        Session(long bootCount, UUID lockerId) {
            this.bootCount = bootCount;
            this.lockerId = lockerId;
        }

        Map<String, Object> envelope(String type, Instant timestamp) {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("schemaVersion", "3.0");
            message.put("messageId", UUID.randomUUID().toString());
            message.put("type", type);
            message.put("lockerId", lockerId.toString());
            message.put("timestamp", timestamp.toString());
            message.put("deviceSessionId", deviceSessionId.toString());
            message.put("bootCount", bootCount);
            message.put("sequence", ++sequence);
            return message;
        }

        Map<String, Object> heartbeat(Instant timestamp, String doorA1) {
            Map<String, Object> message = envelope("HEARTBEAT", timestamp);
            message.put("connectionId", connectionId.toString());
            message.put("firmwareVersion", "0.1.0-sim");
            message.put("clockSynchronized", true);
            message.put("compartments", List.of(
                    cell(CELL_A1, 1, "CONNECTED", "HEALTHY", doorA1, "LOCKED"),
                    cell(CELL_A2, 2, "CONNECTED", "FAULTED", "CLOSED", "LOCKED")));
            return message;
        }

        Map<String, Object> heartbeat(Instant timestamp, List<Map<String, Object>> compartments) {
            Map<String, Object> message = envelope("HEARTBEAT", timestamp);
            message.put("connectionId", connectionId.toString());
            message.put("firmwareVersion", "0.1.0-sim");
            message.put("clockSynchronized", true);
            message.put("compartments", compartments);
            return message;
        }

        /** {@code DOOR_OPENED} or {@code DOOR_CLOSED} outside any operation. */
        Map<String, Object> door(String type, Instant timestamp, UUID compartmentId) {
            Map<String, Object> message = envelope(type, timestamp);
            message.put("compartmentId", compartmentId.toString());
            message.put("doorState", type.equals("DOOR_OPENED") ? "OPEN" : "CLOSED");
            return message;
        }

        /**
         * {@code RFID_SCAN_COMPLETED} outside any operation (section 12.1); {@code reads} maps each observed UHF
         * identifier to its read count, in order.
         */
        Map<String, Object> scan(Instant timestamp, UUID compartmentId, String readerStatus, Instant windowStartedAt,
                Instant windowEndedAt, Map<String, Integer> reads) {
            Map<String, Object> message = envelope("RFID_SCAN_COMPLETED", timestamp);
            message.put("compartmentId", compartmentId.toString());
            message.put("windowStartedAt", windowStartedAt.toString());
            message.put("windowEndedAt", windowEndedAt.toString());
            message.put("readerStatus", readerStatus);
            List<Map<String, Object>> identifiers = new ArrayList<>();
            reads.forEach((value, count) -> {
                Map<String, Object> identifier = new LinkedHashMap<>();
                identifier.put("identifierType", "RFID_UHF");
                identifier.put("identifierValue", value);
                identifier.put("readCount", count);
                identifiers.add(identifier);
            });
            message.put("observedIdentifiers", identifiers);
            return message;
        }

        Map<String, Object> availability(Instant timestamp, String status, String reason) {
            Map<String, Object> message = envelope("DEVICE_AVAILABILITY", timestamp);
            message.put("connectionId", connectionId.toString());
            message.put("status", status);
            message.put("reason", reason);
            return message;
        }

        Map<String, Object> restarted(Instant timestamp) {
            Map<String, Object> message = envelope("DEVICE_RESTARTED", timestamp);
            message.put("firmwareVersion", "0.1.0-sim");
            message.put("resetReason", "POWER_ON");
            return message;
        }

        Map<String, Object> deviceError(Instant timestamp, String code, String severity) {
            Map<String, Object> message = envelope("DEVICE_ERROR", timestamp);
            message.put("errorCode", code);
            message.put("severity", severity);
            message.put("detail", "commands: retained message, 0 unreported");
            return message;
        }
    }

    private DevicePayloads() {
    }

    static Map<String, Object> cell(UUID id, int address, String connection, String reader, String door,
            String lock) {
        Map<String, Object> cell = new LinkedHashMap<>();
        cell.put("compartmentId", id.toString());
        cell.put("cellAddress", address);
        cell.put("connectionStatus", connection);
        cell.put("readerStatus", reader);
        cell.put("doorState", door);
        cell.put("lockState", lock);
        return cell;
    }

    static byte[] bytes(Map<String, Object> message) {
        return JSON.writeValueAsString(message).getBytes(StandardCharsets.UTF_8);
    }

    static byte[] bytes(String json) {
        return json.getBytes(StandardCharsets.UTF_8);
    }
}
