package ca.aegis.control.audit;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * The "filtered details" of document 09, section 19.1, under rule D9 approved on 11 November 2026 (#67): an explicit
 * allowlist of scalar fields per event type. A field is exposed only when its full path is listed and its value is a
 * string, a number, a boolean or null; {@code []} in a path stands for every element of a list. An unlisted type,
 * path or non-scalar value is dropped, so a future writer cannot leak a new field by default. Nothing below lists an
 * identifier's raw {@code value} (document 07), a free-text description, reason or note, a secret, a hash or a payload.
 */
final class AuditDetailsFilter {

    private static final List<String> MODEL_FIELDS = List.of("name", "manufacturer", "modelNumber",
            "defaultCalibrationRequired");
    private static final List<String> ASSET_FIELDS = List.of("assetModelId", "assetCode", "serialNumber",
            "requiredAccessLevel", "operationalStatus", "calibrationRequired", "calibrationDueAt");
    private static final List<String> IDENTIFIER_FIELDS = List.of("assetId", "type");
    private static final List<String> PLACEMENT_FIELDS = List.of("placementId", "lockerId", "lockerCode",
            "compartmentId", "compartmentCode", "assignedAt");
    private static final List<String> SCHEDULE_FIELDS = List.of("timeZone", "windows[].dayOfWeek",
            "windows[].enabled", "windows[].opensAt", "windows[].closesAt");

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("ASSET_CREATED", paths(under("created", MODEL_FIELDS), under("created", ASSET_FIELDS))),
            Map.entry("ASSET_UPDATED", paths(changes(MODEL_FIELDS), changes(ASSET_FIELDS),
                    under("revoked", IDENTIFIER_FIELDS), List.of("revokedAt"))),
            Map.entry("ASSET_ARCHIVED", Set.of("archivedAt")),
            Map.entry("ASSET_IDENTIFIER_ASSIGNED", paths(under("assigned", IDENTIFIER_FIELDS))),
            Map.entry("ASSET_PLACEMENT_CHANGED", paths(under("from", PLACEMENT_FIELDS),
                    under("to", PLACEMENT_FIELDS))),
            Map.entry("SCHEDULE_UPDATED", paths(List.of("previousScheduleId"), under("before", SCHEDULE_FIELDS),
                    under("after", SCHEDULE_FIELDS))),
            Map.entry("RESERVATION_CREATED", Set.of("assetId", "status", "reservedFrom", "reservedUntil")),
            Map.entry("RESERVATION_CANCELLED", Set.of("assetId", "cancelledAt", "reservedUntil",
                    "endedOperationIds[]")),
            Map.entry("RESERVATION_FULFILLED", Set.of("assetId", "loanId")),
            Map.entry("RESERVATION_EXPIRED", Set.of("assetId", "reservedUntil", "endedOperationIds[]")),
            Map.entry("LOCAL_CHALLENGE_EXPIRED", Set.of("reservationId", "loanId",
                    "displayInstructionsStopped")),
            Map.entry("LOCAL_CHALLENGE_INVALIDATED", Set.of("reservationId", "loanId",
                    "displayInstructionsStopped")),
            Map.entry("OPERATION_FAILED", Set.of("reservationId", "loanId", "messageId")),
            Map.entry("OPERATION_EXPIRED", Set.of("reservationId", "loanId", "messageId", "finding")),
            Map.entry("DOOR_OPENED", Set.of("messageId")),
            Map.entry("OBSERVATION_RECEIVED", Set.of("messageId", "readerStatus")),
            Map.entry("OPERATION_CONFIRMED", Set.of("reservationId", "loanId", "acknowledgementMessageId",
                    "doorOpenedMessageId", "doorClosedMessageId", "scanMessageId")),
            Map.entry("CHECKOUT_CONFIRMED", Set.of("assetId", "reservationId", "status", "dueAt")),
            Map.entry("LOAN_RETURN_STARTED", Set.of("assetId", "returnRequestedAt")),
            Map.entry("LOAN_RETURN_REVERTED_SAFE", Set.of("assetId")),
            Map.entry("COMMAND_SENT", Set.of("messageId", "attempt", "commandMessageId", "outcome")),
            Map.entry("COMMAND_ACKNOWLEDGED", Set.of("commandMessageId", "outcome", "operationStatus",
                    "commandStatus")),
            Map.entry("COMMAND_REJECTED", Set.of("commandMessageId", "outcome", "operationStatus", "commandStatus")),
            Map.entry("ANOMALY_CREATED", Set.of("commandMessageId", "outcome", "anomalyType", "finding",
                    "anomalyCreated")),
            Map.entry("ANOMALY_ACKNOWLEDGED", Set.of("type", "severity")),
            Map.entry("MQTT_MESSAGE_DUPLICATE_IGNORED", Set.of("lockerId", "messageType")));

    private static final Object DROPPED = new Object();

    /** Every proper prefix of an allowed path of each type: the containers that may be walked into. */
    private static final Map<String, Set<String>> CONTAINERS = containers();

    private AuditDetailsFilter() {
    }

    static Map<String, Object> filter(String eventType, Map<String, Object> details) {
        Set<String> leaves = ALLOWED.getOrDefault(eventType, Set.of());
        Set<String> containers = CONTAINERS.getOrDefault(eventType, Set.of());
        Object kept = keep("", details, leaves, containers);
        @SuppressWarnings("unchecked")
        Map<String, Object> map = kept instanceof Map<?, ?> ? (Map<String, Object>) kept : Map.of();
        return map;
    }

    /** The allowed part of {@code value} at {@code path}, or {@link #DROPPED}. */
    private static Object keep(String path, Object value, Set<String> leaves, Set<String> containers) {
        if (value == null) {
            return leaves.contains(path) || containers.contains(path) ? null : DROPPED;
        }
        if (value instanceof Map<?, ?> map) {
            if (!path.isEmpty() && !containers.contains(path)) {
                return DROPPED;
            }
            Map<String, Object> kept = new LinkedHashMap<>();
            map.forEach((key, nested) -> {
                Object child = keep(path.isEmpty() ? (String) key : path + "." + key, nested, leaves, containers);
                if (child != DROPPED) {
                    kept.put((String) key, child);
                }
            });
            return kept;
        }
        if (value instanceof List<?> list) {
            String elements = path + "[]";
            if (!leaves.contains(elements) && !containers.contains(elements)) {
                return DROPPED;
            }
            return list.stream().map(item -> keep(elements, item, leaves, containers))
                    .filter(item -> item != DROPPED).toList();
        }
        boolean scalar = value instanceof String || value instanceof Number || value instanceof Boolean;
        return scalar && leaves.contains(path) ? value : DROPPED;
    }


    private static List<String> under(String prefix, List<String> fields) {
        return fields.stream().map(field -> prefix + "." + field).toList();
    }

    /** The {@code from} and {@code to} of each catalog field an update may change. */
    private static List<String> changes(List<String> fields) {
        return fields.stream().flatMap(field -> Stream.of("changes." + field + ".from", "changes." + field + ".to"))
                .toList();
    }

    @SafeVarargs
    private static Set<String> paths(List<String>... groups) {
        Set<String> all = new HashSet<>();
        for (List<String> group : groups) {
            all.addAll(group);
        }
        return Set.copyOf(all);
    }

    private static Map<String, Set<String>> containers() {
        Map<String, Set<String>> byType = new HashMap<>();
        ALLOWED.forEach((type, leaves) -> {
            Set<String> prefixes = new HashSet<>();
            for (String leaf : leaves) {
                for (int dot = leaf.indexOf('.'); dot >= 0; dot = leaf.indexOf('.', dot + 1)) {
                    String prefix = leaf.substring(0, dot);
                    prefixes.add(prefix);
                    if (prefix.endsWith("[]")) {
                        prefixes.add(prefix.substring(0, prefix.length() - 2));
                    }
                }
            }
            byType.put(type, Set.copyOf(prefixes));
        });
        return Map.copyOf(byType);
    }
}
