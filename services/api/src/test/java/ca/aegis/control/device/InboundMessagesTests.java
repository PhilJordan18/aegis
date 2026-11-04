package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.device.Inspection.Storable;
import ca.aegis.control.device.Inspection.Unstorable;

/** Document 10, sections 3, 13, 15.3, 19 to 21, on schema 3.0, without a database. */
class InboundMessagesTests {

    private static final Instant NOW = Instant.parse("2026-09-28T13:00:00Z");
    private static final InboundTopic STATUS_TOPIC = InboundTopic.parse(STATUS).orElseThrow();
    private static final InboundTopic EVENTS_TOPIC = InboundTopic.parse(EVENTS).orElseThrow();

    private final Session session = new Session(7);

    @Test
    void aValidHeartbeatIsAcceptedWithItsCells() {
        Storable heartbeat = storable(STATUS_TOPIC, session.heartbeat(NOW, "CLOSED"));

        assertNull(heartbeat.rejection());
        assertTrue(heartbeat.fact().heartbeatValid());
        assertEquals(2, heartbeat.fact().compartments().size());
        assertEquals(session.connectionId, heartbeat.fact().connectionId());
        assertNotNull(heartbeat.fact().parsedJson());
    }

    @Test
    void aHeartbeatOutsideTheClockWindowOrUnsynchronizedIsKeptButNotValid() {
        assertFalse(storable(STATUS_TOPIC, session.heartbeat(NOW.minusSeconds(31), "CLOSED")).fact()
                .heartbeatValid());
        assertTrue(storable(STATUS_TOPIC, session.heartbeat(NOW.minusSeconds(30), "CLOSED")).fact()
                .heartbeatValid());
        assertTrue(storable(STATUS_TOPIC, session.heartbeat(NOW.plusSeconds(5), "CLOSED")).fact()
                .heartbeatValid());
        assertFalse(storable(STATUS_TOPIC, session.heartbeat(NOW.plusSeconds(6), "CLOSED")).fact()
                .heartbeatValid());
        Map<String, Object> unsynchronized = session.heartbeat(NOW, "CLOSED");
        unsynchronized.put("clockSynchronized", false);
        assertFalse(storable(STATUS_TOPIC, unsynchronized).fact().heartbeatValid());
    }

    @Test
    void anotherMajorIsRejectedAsUnsupportedSchemaButStorable() {
        for (String version : new String[] {"2.0", "4.0", "3", "3.0.1", "03.0"}) {
            Map<String, Object> heartbeat = session.heartbeat(NOW, "CLOSED");
            heartbeat.put("schemaVersion", version);
            assertEquals(ProcessingError.UNSUPPORTED_SCHEMA, storable(STATUS_TOPIC, heartbeat).rejection(), version);
        }
        Map<String, Object> minor = session.heartbeat(NOW, "CLOSED");
        minor.put("schemaVersion", "3.7");
        minor.put("futureField", "ignored");
        assertNull(storable(STATUS_TOPIC, minor).rejection());
    }

    @Test
    void topicMatrixAndLockerIdentityAreEnforced() {
        assertEquals(ProcessingError.MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC,
                storable(EVENTS_TOPIC, session.heartbeat(NOW, "CLOSED")).rejection());
        assertEquals(ProcessingError.MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC,
                storable(STATUS_TOPIC, session.restarted(NOW)).rejection());
        Map<String, Object> foreign = session.heartbeat(NOW, "CLOSED");
        foreign.put("lockerId", UUID.randomUUID().toString());
        assertEquals(ProcessingError.TOPIC_PAYLOAD_LOCKER_MISMATCH, storable(STATUS_TOPIC, foreign).rejection());
        assertTrue(InboundTopic.parse("aegis/v1/lockers/" + DevicePayloads.LOCKER + "/commands").isEmpty());
        assertTrue(InboundTopic.parse("aegis/v1/lockers/D46A74AE-39DC-460B-8AF0-38FC791B376A/status").isEmpty());
    }

    @Test
    void envelopeFieldsAreValidated() {
        Map<String, Object> noSession = session.heartbeat(NOW, "CLOSED");
        noSession.remove("deviceSessionId");
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(STATUS_TOPIC, noSession).rejection());
        Map<String, Object> badBoot = session.heartbeat(NOW, "CLOSED");
        badBoot.put("bootCount", 0);
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(STATUS_TOPIC, badBoot).rejection());
        Map<String, Object> noConnection = session.heartbeat(NOW, "CLOSED");
        noConnection.remove("connectionId");
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(STATUS_TOPIC, noConnection).rejection());
        Map<String, Object> badDoor = session.heartbeat(NOW, "CLOSED");
        badDoor.put("compartments", java.util.List.of(DevicePayloads.cell(DevicePayloads.CELL_A1, 1, "CONNECTED",
                "HEALTHY", "AJAR", "LOCKED")));
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(STATUS_TOPIC, badDoor).rejection());
        Map<String, Object> badUuid = session.heartbeat(NOW, "CLOSED");
        badUuid.put("deviceSessionId", "not-a-uuid");
        assertEquals(ProcessingError.INVALID_UUID, storable(STATUS_TOPIC, badUuid).rejection());
        Map<String, Object> incoherent = session.availability(NOW, "ONLINE", "SHUTDOWN");
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(STATUS_TOPIC, incoherent).rejection());
    }

    @Test
    void inboundMessageInvalidIsAcceptedAsATechnicalFactWithoutOperation() {
        Storable report = storable(EVENTS_TOPIC, session.deviceError(NOW, "INBOUND_MESSAGE_INVALID", "WARNING"));
        assertNull(report.rejection());
        assertNull(report.fact().operationId());
        assertEquals("INBOUND_MESSAGE_INVALID", report.fact().errorCode());

        Map<String, Object> critical = session.deviceError(NOW, "INBOUND_MESSAGE_INVALID", "CRITICAL");
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(EVENTS_TOPIC, critical).rejection());
        Map<String, Object> withOperation = session.deviceError(NOW, "INBOUND_MESSAGE_INVALID", "WARNING");
        withOperation.put("operationId", UUID.randomUUID().toString());
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(EVENTS_TOPIC, withOperation).rejection());
        Map<String, Object> longDetail = session.deviceError(NOW, "INBOUND_MESSAGE_INVALID", "WARNING");
        longDetail.put("detail", "x".repeat(241));
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(EVENTS_TOPIC, longDetail).rejection());
        Map<String, Object> unknownCode = session.deviceError(NOW, "OVERHEAT", "WARNING");
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(EVENTS_TOPIC, unknownCode).rejection());
    }

    @Test
    void aFutureTimestampIsOutOfRangeOnlyForAnOperationMessage() {
        Map<String, Object> error = session.deviceError(NOW.plusSeconds(60), "LOCK_ACTUATOR_FAULT", "CRITICAL");
        assertNull(storable(EVENTS_TOPIC, error).rejection());
        error.put("operationId", UUID.randomUUID().toString());
        assertEquals(ProcessingError.TIMESTAMP_OUT_OF_RANGE, storable(EVENTS_TOPIC, error).rejection());
    }

    @Test
    void aValidRfidScanOutsideAnOperationCarriesItsWindowReaderAndIdentifiers() {
        Map<String, Object> scan = session.scan(NOW, DevicePayloads.CELL_A1, "HEALTHY", NOW.minusSeconds(4),
                NOW.minusSeconds(1), reads("E2-A", 5, "E2-B", 1));
        Storable stored = storable(EVENTS_TOPIC, scan);

        assertNull(stored.rejection());
        assertNull(stored.fact().operationId());
        RfidScan fact = stored.fact().rfidScan();
        assertEquals(NOW.minusSeconds(4), fact.windowStartedAt());
        assertEquals(NOW.minusSeconds(1), fact.windowEndedAt());
        assertTrue(fact.healthy());
        assertTrue(fact.coversStableWindow());
        assertEquals(java.util.List.of(new RfidScan.ObservedIdentifier("E2-A", 5),
                new RfidScan.ObservedIdentifier("E2-B", 1)), fact.identifiers());

        Storable empty = storable(EVENTS_TOPIC, session.scan(NOW, DevicePayloads.CELL_A1, "FAULTED",
                NOW.minusSeconds(1), NOW, Map.of()));
        assertNull(empty.rejection());
        assertFalse(empty.fact().rfidScan().healthy());
        assertFalse(empty.fact().rfidScan().coversStableWindow());
    }

    /** Section 12.1 bounds; a scan the contract does not allow is rejected, not kept as weaker evidence. */
    @Test
    void anRfidScanOutsideTheContractIsRejected() {
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.remove("compartmentId"));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.remove("windowStartedAt"));
        assertScanRejected(ProcessingError.TIMESTAMP_INVALID, scan -> scan.put("windowEndedAt", "yesterday"));
        assertScanRejected(ProcessingError.TIMESTAMP_OUT_OF_RANGE,
                scan -> scan.put("windowEndedAt", NOW.minusSeconds(5).toString()));
        assertScanRejected(ProcessingError.TIMESTAMP_OUT_OF_RANGE,
                scan -> scan.put("windowEndedAt", NOW.plusSeconds(1).toString()));
        assertScanRejected(ProcessingError.TIMESTAMP_OUT_OF_RANGE,
                scan -> scan.put("windowStartedAt", NOW.minusSeconds(12).toString()));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.put("readerStatus", "BROKEN"));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.remove("observedIdentifiers"));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.put("observedIdentifiers", "E2"));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING,
                scan -> identifier(scan).put("identifierType", "NFC"));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> identifier(scan).put("identifierValue", ""));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING,
                scan -> identifier(scan).put("identifierValue", "x".repeat(256)));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> identifier(scan).put("readCount", 0));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> identifier(scan).put("readCount", 65_536));
        assertScanRejected(ProcessingError.REQUIRED_FIELD_MISSING, scan -> scan.put("observedIdentifiers",
                java.util.List.of(identifier(scan), identifier(scan))));
        Map<String, Integer> many = new java.util.LinkedHashMap<>();
        for (int i = 0; i < 33; i++) {
            many.put("E2-" + i, 3);
        }
        assertEquals(ProcessingError.REQUIRED_FIELD_MISSING, storable(EVENTS_TOPIC, session.scan(NOW,
                DevicePayloads.CELL_A1, "HEALTHY", NOW.minusSeconds(3), NOW, many)).rejection());
        many.remove("E2-0");
        assertNull(storable(EVENTS_TOPIC, session.scan(NOW, DevicePayloads.CELL_A1, "HEALTHY", NOW.minusSeconds(10),
                NOW, many)).rejection(), "32 identifiers over ten seconds is the contract's limit");
    }

    private void assertScanRejected(ProcessingError expected, java.util.function.Consumer<Map<String, Object>> edit) {
        Map<String, Object> scan = session.scan(NOW, DevicePayloads.CELL_A1, "HEALTHY", NOW.minusSeconds(3), NOW,
                reads("E2-A", 3));
        edit.accept(scan);
        assertEquals(expected, storable(EVENTS_TOPIC, scan).rejection(), scan.toString());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> identifier(Map<String, Object> scan) {
        return ((java.util.List<Map<String, Object>>) scan.get("observedIdentifiers")).get(0);
    }

    private static Map<String, Integer> reads(Object... valuesAndCounts) {
        Map<String, Integer> reads = new java.util.LinkedHashMap<>();
        for (int i = 0; i < valuesAndCounts.length; i += 2) {
            reads.put((String) valuesAndCounts[i], (Integer) valuesAndCounts[i + 1]);
        }
        return reads;
    }

    /** Kept as a log, not as a REJECTED row, pending the decision on documents 08 and 10 (section 19.2). */
    @Test
    void messagesWithoutTheColumnsOfARowAreUnstorable() {
        assertUnstorable(ProcessingError.INVALID_JSON, "{not json");
        assertUnstorable(ProcessingError.INVALID_JSON, "[1, 2]");
        assertUnstorable(ProcessingError.INVALID_JSON, "{\"a\": 1, \"a\": 2}");
        assertUnstorable(ProcessingError.PAYLOAD_TOO_LARGE, "{\"pad\": \"" + "x".repeat(16 * 1024) + "\"}");
        assertUnstorable(ProcessingError.REQUIRED_FIELD_MISSING, without("messageId"));
        assertUnstorable(ProcessingError.INVALID_UUID, with("messageId", "1234"));
        assertUnstorable(ProcessingError.REQUIRED_FIELD_MISSING, without("type"));
        assertUnstorable(ProcessingError.MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC, with("type", "LOCKER_EXPLODED"));
        assertUnstorable(ProcessingError.REQUIRED_FIELD_MISSING, without("schemaVersion"));
        assertUnstorable(ProcessingError.UNSUPPORTED_SCHEMA, with("schemaVersion", " "));
        assertUnstorable(ProcessingError.REQUIRED_FIELD_MISSING, without("timestamp"));
        assertUnstorable(ProcessingError.TIMESTAMP_INVALID, with("timestamp", "2026-09-28 13:00:00"));
        assertUnstorable(ProcessingError.TIMESTAMP_INVALID, with("timestamp", "2026-09-28T13:00:00+01:00"));
    }

    private String without(String field) {
        Map<String, Object> heartbeat = session.heartbeat(NOW, "CLOSED");
        heartbeat.remove(field);
        return new String(bytes(heartbeat));
    }

    private String with(String field, String value) {
        Map<String, Object> heartbeat = session.heartbeat(NOW, "CLOSED");
        heartbeat.put(field, value);
        return new String(bytes(heartbeat));
    }

    private static void assertUnstorable(ProcessingError expected, String json) {
        Unstorable unstorable = assertInstanceOf(Unstorable.class,
                InboundMessages.inspect(STATUS_TOPIC, bytes(json), NOW), json.length() > 80 ? "large" : json);
        assertEquals(expected, unstorable.error(), json.length() > 80 ? json.substring(0, 80) : json);
    }

    private static Storable storable(InboundTopic topic, Map<String, Object> message) {
        return assertInstanceOf(Storable.class, InboundMessages.inspect(topic, bytes(message), NOW));
    }
}
