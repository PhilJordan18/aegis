package ca.aegis.control.audit;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The "filtered details" of document 09, section 19.1, under provisional rule D9 of the 11 November 2026 matrix
 * (#67): each event type exposes only the top-level keys its writers are known to put, and an unlisted type exposes
 * none, so a future writer cannot leak a new key by default. Below those keys, an identifier's raw {@code value}
 * (an RFID, NFC or QR content, document 07) is removed at any depth.
 */
final class AuditDetailsFilter {

    private static final Set<String> REMOVED_AT_ANY_DEPTH = Set.of("value");

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("ASSET_CREATED", Set.of("created")),
            Map.entry("ASSET_UPDATED", Set.of("changes", "revoked", "revokedAt")),
            Map.entry("ASSET_ARCHIVED", Set.of("archivedAt")),
            Map.entry("ASSET_IDENTIFIER_ASSIGNED", Set.of("assigned")),
            Map.entry("ASSET_PLACEMENT_CHANGED", Set.of("from", "to")),
            Map.entry("SCHEDULE_UPDATED", Set.of("previousScheduleId", "before", "after")),
            Map.entry("RESERVATION_CREATED", Set.of("assetId", "status", "reservedFrom", "reservedUntil")),
            Map.entry("RESERVATION_CANCELLED", Set.of("assetId", "cancelledAt", "reservedUntil", "endedOperationIds")),
            Map.entry("RESERVATION_EXPIRED", Set.of("assetId", "reservedUntil", "endedOperationIds")),
            Map.entry("LOCAL_CHALLENGE_EXPIRED", Set.of("reservationId", "displayInstructionsStopped")),
            Map.entry("LOCAL_CHALLENGE_INVALIDATED", Set.of("reservationId", "displayInstructionsStopped")),
            Map.entry("OPERATION_FAILED", Set.of("reservationId", "messageId")),
            Map.entry("OPERATION_EXPIRED", Set.of("reservationId", "messageId")),
            Map.entry("COMMAND_SENT", Set.of("messageId", "attempt", "commandMessageId", "outcome")),
            Map.entry("COMMAND_ACKNOWLEDGED", Set.of("commandMessageId", "outcome", "operationStatus",
                    "commandStatus")),
            Map.entry("COMMAND_REJECTED", Set.of("commandMessageId", "outcome", "operationStatus", "commandStatus")),
            Map.entry("ANOMALY_CREATED", Set.of("commandMessageId", "outcome")),
            Map.entry("ANOMALY_ACKNOWLEDGED", Set.of("type", "severity")),
            Map.entry("MQTT_MESSAGE_DUPLICATE_IGNORED", Set.of("lockerId", "messageType")));

    private AuditDetailsFilter() {
    }

    static Map<String, Object> filter(String eventType, Map<String, Object> details) {
        Set<String> allowed = ALLOWED.getOrDefault(eventType, Set.of());
        Map<String, Object> kept = new LinkedHashMap<>();
        details.forEach((key, value) -> {
            if (allowed.contains(key) && !REMOVED_AT_ANY_DEPTH.contains(key)) {
                kept.put(key, prune(value));
            }
        });
        return kept;
    }

    private static Object prune(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> kept = new LinkedHashMap<>();
            map.forEach((key, nested) -> {
                if (!REMOVED_AT_ANY_DEPTH.contains(key)) {
                    kept.put((String) key, prune(nested));
                }
            });
            return kept;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(AuditDetailsFilter::prune).toList();
        }
        return value;
    }
}
