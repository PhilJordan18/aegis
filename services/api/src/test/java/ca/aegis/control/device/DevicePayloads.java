package ca.aegis.control.device;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.json.JsonMapper;

/** Schema 3.0 hub messages of document 10, sections 8.1 and 13 to 15, for the demo locker and its two cells. */
final class DevicePayloads {

    static final UUID LOCKER = UUID.fromString("d46a74ae-39dc-460b-8af0-38fc791b376a");
    static final UUID CELL_A1 = UUID.fromString("1ae77ae3-8490-4f09-9412-a7816b77bff9");
    static final UUID CELL_A2 = UUID.fromString("5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10");
    static final String EVENTS = "aegis/v1/lockers/" + LOCKER + "/events";
    static final String STATUS = "aegis/v1/lockers/" + LOCKER + "/status";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** One boot of the hub: a session, a connection and a sequence counter. */
    static final class Session {

        final UUID deviceSessionId = UUID.randomUUID();
        final long bootCount;
        UUID connectionId = UUID.randomUUID();
        long sequence;

        Session(long bootCount) {
            this.bootCount = bootCount;
        }

        Map<String, Object> envelope(String type, Instant timestamp) {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("schemaVersion", "3.0");
            message.put("messageId", UUID.randomUUID().toString());
            message.put("type", type);
            message.put("lockerId", LOCKER.toString());
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
