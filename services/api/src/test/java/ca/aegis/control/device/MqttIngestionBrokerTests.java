package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.CELL_A1;
import static ca.aegis.control.device.DevicePayloads.CELL_A2;
import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.LOCKER;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * PHY-01 (#29) end to end through the development Mosquitto: the test publishes with the test hub account and the
 * application consumes with the backend account, on a persistent session of its own that the class discards at the
 * end. No message is retained, and the demo hub's account and topics are never used.
 */
@ExtendWith(OutputCaptureExtension.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MqttIngestionBrokerTests extends ApiIntegrationTest {

    private static final TestBroker BROKER = TestBroker.fromEnvironment();
    private static final String CLIENT_ID = "aegis-api-test-" + UUID.randomUUID();
    private static final AtomicLong BOOTS = new AtomicLong(1_000);
    private static final String LOCKER_STATUS = "/api/v1/lockers/" + LOCKER + "/status";
    private static volatile MqttIngestionClient started;

    @DynamicPropertySource
    static void broker(DynamicPropertyRegistry registry) {
        registry.add("aegis.mqtt.enabled", () -> "true");
        registry.add("aegis.mqtt.url", () -> BROKER.url);
        registry.add("aegis.mqtt.username", () -> TestBroker.API_USER);
        registry.add("aegis.mqtt.password", () -> BROKER.apiPassword);
        registry.add("aegis.mqtt.client-id", () -> CLIENT_ID);
    }

    @Autowired
    MqttIngestionClient subscriber;

    @Autowired
    JdbcClient jdbc;

    private DeviceTestSupport db;
    private TestBroker.Device hub;
    private Session session;

    @BeforeEach
    void connectedHubOnAFreshlyProvisionedDevice() throws Exception {
        started = subscriber;
        subscriber.awaitSubscribed(Duration.ofSeconds(20));
        db = new DeviceTestSupport(jdbc);
        db.provisionTestHub(clock.instant());
        hub = BROKER.device();
        session = new Session(BOOTS.incrementAndGet());
    }

    @AfterEach
    void disconnectHub() throws Exception {
        if (hub != null) {
            hub.close();
        }
    }

    @AfterAll
    static void discardTheSubscriberSession() {
        if (started != null) {
            started.stop();
            BROKER.discardSession(CLIENT_ID);
        }
    }

    /**
     * MEDIUM-1 of the #115 review: the database refuses one delivery long enough to exhaust its retries. It and the
     * delivery after it are held, then ingested exactly once and in order after the database recovers.
     */
    @Test
    void aDeliveryThatKeepsFailingIsHeldThenIngestedOnceInOrderAfterRecovery() {
        Map<String, Object> first = session.heartbeat(clock.instant(), "OPEN");
        Map<String, Object> second = session.heartbeat(clock.instant(), "CLOSED");
        long recoveriesBefore = subscriber.recoveries();
        jdbc.sql("""
                CREATE TABLE public.test_injected_failures (message_id uuid PRIMARY KEY);
                CREATE TABLE public.test_ingestion_order (n bigserial PRIMARY KEY, message_id uuid NOT NULL);
                CREATE FUNCTION public.test_inbound_insert() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM public.test_injected_failures WHERE message_id = NEW.message_id) THEN
                        RAISE EXCEPTION 'injected failure' USING ERRCODE = '08006';
                    END IF;
                    INSERT INTO public.test_ingestion_order (message_id) VALUES (NEW.message_id);
                    RETURN NEW;
                END $$;
                CREATE TRIGGER test_inbound_insert BEFORE INSERT ON aegis.inbound_device_messages
                    FOR EACH ROW EXECUTE FUNCTION public.test_inbound_insert();
                """).update();
        try {
            jdbc.sql("INSERT INTO public.test_injected_failures VALUES (CAST(:id AS uuid))")
                    .param("id", first.get("messageId")).update();
            hub.publish(STATUS, bytes(first));
            hub.publish(STATUS, bytes(second));

            DeviceTestSupport.await(() -> subscriber.recoveries() > recoveriesBefore
                    ? java.util.Optional.of(true) : java.util.Optional.empty(), "a recovery",
                    Duration.ofSeconds(30));
            assertEquals(0, db.messageCount(first.get("messageId")));
            assertEquals(0, db.messageCount(second.get("messageId")), "the next delivery waits for the first");

            jdbc.sql("DELETE FROM public.test_injected_failures").update();
            DeviceTestSupport.await(() -> db.message(second.get("messageId")), "the held deliveries",
                    Duration.ofSeconds(60));

            assertEquals(1, db.messageCount(first.get("messageId")));
            assertEquals(1, db.messageCount(second.get("messageId")));
            // The probe runs before ON CONFLICT, so it also sees redelivered duplicates that store nothing.
            List<String> attempts = jdbc.sql("""
                    SELECT message_id::text FROM public.test_ingestion_order GROUP BY message_id ORDER BY min(n)
                    """).query(String.class).list();
            assertEquals(List.of(first.get("messageId").toString(), second.get("messageId").toString()),
                    attempts.stream().filter(id -> id.equals(first.get("messageId"))
                            || id.equals(second.get("messageId"))).toList());
            attempts.forEach(id -> assertEquals(1, db.messageCount(id), id));
            assertEquals(second.get("sequence"), db.device().get("heartbeat_sequence"));
            assertEquals("CLOSED", db.cell(CELL_A1).get("door_state"));
        } finally {
            jdbc.sql("""
                    DROP TRIGGER IF EXISTS test_inbound_insert ON aegis.inbound_device_messages;
                    DROP FUNCTION IF EXISTS public.test_inbound_insert();
                    DROP TABLE IF EXISTS public.test_injected_failures, public.test_ingestion_order;
                    """).update();
        }
    }

    @Test
    void aValidHeartbeatMakesTheLockerOnlineButAnAvailabilityAloneDoesNot() throws Exception {
        String technician = accessToken(accounts.technician());
        publish(STATUS, session.availability(clock.instant(), "ONLINE", "CONNECTED"));
        assertEquals("UNKNOWN", read(statusOf(technician), "$.connectionStatus"));

        Map<String, Object> heartbeat = publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));

        assertEquals("PROCESSED", db.message(heartbeat.get("messageId")).orElseThrow().get("processing_status"));
        String body = statusOf(technician);
        assertEquals("ONLINE", read(body, "$.connectionStatus"));
        assertEquals(START.toString(), read(body, "$.lastSeenAt"));
        assertEquals(START.toString(), read(body, "$.evaluatedAt"));
        assertEquals(Map.of("connection_status", "CONNECTED", "rfid_reader_status", "HEALTHY",
                "door_state", "CLOSED", "lock_state", "LOCKED"), db.cell(CELL_A1));
        assertEquals("FAULTED", db.cell(CELL_A2).get("rfid_reader_status"), "a reader fault is visible");
        assertFalse(body.contains("raw") || body.contains("payload") || body.contains("sequence"), body);
    }

    @Test
    void aDuplicateIsStoredOnceAuditedAndLeavesTheProjectionUnchanged() {
        byte[] heartbeat = bytes(session.heartbeat(clock.instant(), "OPEN"));
        String messageId = JsonPath.read(new String(heartbeat, StandardCharsets.UTF_8), "$.messageId");
        hub.publish(STATUS, heartbeat);
        UUID stored = (UUID) db.awaitMessage(messageId).get("id");
        Map<String, Object> projection = db.device();

        clock.advance(Duration.ofSeconds(5));
        hub.publish(STATUS, heartbeat);
        DeviceTestSupport.await(() -> db.duplicateAudits(stored) == 1 ? java.util.Optional.of(true)
                : java.util.Optional.empty(), "duplicate audit");

        assertEquals(1, db.messageCount(messageId));
        assertEquals(projection, db.device());
    }

    @Test
    void schemaTwoAndInvalidPayloadsAreRejectedWithTheirCodeAndKeptAsEvidence() {
        Map<String, Object> schemaTwo = session.heartbeat(clock.instant(), "CLOSED");
        schemaTwo.put("schemaVersion", "2.0");
        byte[] schemaTwoBytes = bytes(schemaTwo);
        hub.publish(STATUS, schemaTwoBytes);
        Map<String, Object> rejected = db.awaitMessage(schemaTwo.get("messageId"));
        assertEquals("REJECTED", rejected.get("processing_status"));
        assertEquals("UNSUPPORTED_SCHEMA", rejected.get("processing_error"));
        assertEquals("2.0", rejected.get("schema_version"));
        assertEquals(false, rejected.get("parsed"));
        assertArrayEquals(schemaTwoBytes, (byte[]) rejected.get("raw_payload"));

        Map<String, Object> missing = session.heartbeat(clock.instant(), "CLOSED");
        missing.remove("deviceSessionId");
        assertRejected(STATUS, missing, "REQUIRED_FIELD_MISSING");
        assertRejected(EVENTS, session.heartbeat(clock.instant(), "CLOSED"), "MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC");
        Map<String, Object> foreign = session.restarted(clock.instant());
        foreign.put("lockerId", UUID.randomUUID().toString());
        assertRejected(EVENTS, foreign, "TOPIC_PAYLOAD_LOCKER_MISMATCH");

        assertEquals(ConnectionStatus.UNKNOWN.name(), db.device().get("connection_status"));
    }

    /** Kept as a log, not as a REJECTED row, pending the decision on documents 08 and 10 (section 19.2). */
    @Test
    void messagesWithoutTheColumnsOfARowOrAKnownCorrelationAreOnlyLogged(CapturedOutput output) {
        Map<String, Object> noTimestamp = session.restarted(clock.instant());
        noTimestamp.remove("timestamp");
        Map<String, Object> unknownType = session.restarted(clock.instant());
        unknownType.put("type", "LOCKER_EXPLODED");
        Map<String, Object> unknownCommand = session.envelope("COMMAND_ACKNOWLEDGED", clock.instant());
        unknownCommand.put("operationId", UUID.randomUUID().toString());
        unknownCommand.put("compartmentId", CELL_A1.toString());
        unknownCommand.put("commandMessageId", UUID.randomUUID().toString());
        unknownCommand.put("commandType", "UNLOCK_COMPARTMENT");
        Map<String, Object> unknownDisplay = session.envelope("ACCESS_CHALLENGE_DISPLAYED", clock.instant());
        unknownDisplay.put("operationId", UUID.randomUUID().toString());
        unknownDisplay.put("compartmentId", CELL_A1.toString());
        unknownDisplay.put("displayMessageId", UUID.randomUUID().toString());
        hub.publish(EVENTS, bytes(noTimestamp));
        hub.publish(EVENTS, bytes(unknownType));
        hub.publish(EVENTS, bytes(unknownCommand));
        hub.publish(EVENTS, bytes(unknownDisplay));
        hub.publish(EVENTS, bytes("{\"messageId\": \"" + UUID.randomUUID() + "\""));
        publish(EVENTS, session.deviceError(clock.instant(), "STORAGE_FAULT", "WARNING"));

        for (Map<String, Object> message : List.of(noTimestamp, unknownType, unknownCommand, unknownDisplay)) {
            assertEquals(0, db.messageCount(message.get("messageId")), message.get("type").toString());
        }
        assertLogged(output, noTimestamp, "REQUIRED_FIELD_MISSING");
        assertLogged(output, unknownType, "MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC");
        assertLogged(output, unknownCommand, "COMMAND_CORRELATION_INVALID");
        assertLogged(output, unknownDisplay, "COMMAND_CORRELATION_INVALID");
        assertTrue(output.getAll().contains("processingError=INVALID_JSON"));
        assertFalse(output.getAll().contains(unknownCommand.get("commandMessageId").toString()),
                "no payload value reaches the log");
    }

    @Test
    void anOlderOrOutOfOrderHeartbeatDoesNotRegressTheProjection() {
        Map<String, Object> older = session.heartbeat(clock.instant(), "CLOSED");
        Map<String, Object> newer = session.heartbeat(clock.instant(), "OPEN");
        publish(STATUS, newer);
        clock.advance(Duration.ofSeconds(2));
        publish(STATUS, older);

        assertEquals("PROCESSED", db.message(older.get("messageId")).orElseThrow().get("processing_status"));
        Map<String, Object> device = db.device();
        assertEquals(newer.get("sequence"), device.get("heartbeat_sequence"));
        assertEquals(START, ((java.sql.Timestamp) device.get("last_valid_heartbeat_at")).toInstant());
        assertEquals("OPEN", db.cell(CELL_A1).get("door_state"));
    }

    @Test
    void aClosedConnectionANewConnectionAndANewBootFollowTheSequenceRules() throws Exception {
        String admin = accessToken(accounts.admin());
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));
        publish(STATUS, session.availability(clock.instant(), "OFFLINE", "CONNECTION_LOST"));
        assertEquals("OFFLINE", read(statusOf(admin), "$.connectionStatus"));
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));
        assertEquals("OFFLINE", read(statusOf(admin), "$.connectionStatus"), "the closed connection stays closed");

        session.connectionId = UUID.randomUUID();
        publish(STATUS, session.availability(clock.instant(), "ONLINE", "CONNECTED"));
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));
        assertEquals("ONLINE", read(statusOf(admin), "$.connectionStatus"), "reconnection");

        Session reboot = new Session(BOOTS.incrementAndGet());
        publish(EVENTS, reboot.restarted(clock.instant()));
        assertEquals("OFFLINE", read(statusOf(admin), "$.connectionStatus"), "a new boot waits for its heartbeat");
        publish(STATUS, reboot.heartbeat(clock.instant(), "OPEN"));
        assertEquals("ONLINE", read(statusOf(admin), "$.connectionStatus"));
        session.sequence = 1_000;
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));

        Map<String, Object> device = db.device();
        assertEquals(reboot.deviceSessionId, device.get("device_session_id"));
        assertEquals(reboot.bootCount, device.get("boot_count"));
        assertEquals(2L, device.get("heartbeat_sequence"));
        assertEquals("OPEN", db.cell(CELL_A1).get("door_state"), "the previous boot no longer projects");
    }

    @Test
    void silenceOverThirtySecondsMakesTheLockerOfflineUntilHeartbeatsResume() throws Exception {
        String technician = accessToken(accounts.technician());
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));

        clock.advance(Duration.ofSeconds(30));
        assertEquals("ONLINE", read(statusOf(technician), "$.connectionStatus"));
        clock.advance(Duration.ofSeconds(1));
        String silent = statusOf(technician);
        assertEquals("OFFLINE", read(silent, "$.connectionStatus"));
        assertEquals(START.toString(), read(silent, "$.lastSeenAt"));

        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));
        String resumed = statusOf(technician);
        assertEquals("ONLINE", read(resumed, "$.connectionStatus"));
        assertEquals(START.plusSeconds(31).toString(), read(resumed, "$.lastSeenAt"));
    }

    @Test
    void heartbeatsAndHubEventsChangeNoLoanReservationOperationOrReadiness() throws Exception {
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        var holder = accounts.technician();
        String token = accessToken(holder);
        int address = 101 + (int) (BOOTS.get() % 70);
        UUID borrowed = fixtures.assetAt(LOCKER, address);
        UUID reserved = fixtures.assetAt(LOCKER, address + 70);
        UUID loan = fixtures.loan(borrowed, holder.id(), START.minusSeconds(600));
        UUID reservation = fixtures.reservation(reserved, accounts.technician().id(), "ACTIVE",
                START.minusSeconds(60), START.plusSeconds(1800));
        Map<String, Object> before = custody(loan, reservation, borrowed, reserved, token);

        publish(STATUS, session.heartbeat(clock.instant(), "OPEN"));
        publish(EVENTS, session.deviceError(clock.instant(), "LOCK_ACTUATOR_FAULT", "CRITICAL"));
        publish(EVENTS, session.deviceError(clock.instant(), "INBOUND_MESSAGE_INVALID", "WARNING"));
        publish(STATUS, session.availability(clock.instant(), "OFFLINE", "SHUTDOWN"));
        publish(EVENTS, new Session(BOOTS.incrementAndGet()).restarted(clock.instant()));

        assertEquals(before, custody(loan, reservation, borrowed, reserved, token));
        assertEquals(0L, jdbc.sql("""
                SELECT count(*) FROM aegis.physical_observations o
                JOIN aegis.inbound_device_messages m ON m.id = o.inbound_message_id
                JOIN aegis.locker_devices d ON d.id = m.locker_device_id
                WHERE d.locker_id = :locker
                """).param("locker", LOCKER).query(Long.class).single());
    }

    private Map<String, Object> custody(UUID loan, UUID reservation, UUID borrowed, UUID reserved, String token)
            throws Exception {
        return Map.of(
                "loan", jdbc.sql("SELECT * FROM aegis.loans WHERE id = :id").param("id", loan).query().singleRow(),
                "reservation", jdbc.sql("SELECT * FROM aegis.reservations WHERE id = :id").param("id", reservation)
                        .query().singleRow(),
                "operations", jdbc.sql("""
                        SELECT * FROM aegis.locker_operations WHERE asset_id IN (:borrowed, :reserved) ORDER BY id
                        """).param("borrowed", borrowed).param("reserved", reserved).query().listOfRows(),
                "borrowedReadiness", readiness(borrowed, token),
                "reservedReadiness", readiness(reserved, token));
    }

    private Object readiness(UUID asset, String token) throws Exception {
        String body = mvc.perform(get("/api/v1/assets/" + asset).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.readiness");
    }

    private void assertRejected(String topic, Map<String, Object> message, String code) {
        hub.publish(topic, bytes(message));
        Map<String, Object> row = db.awaitMessage(message.get("messageId"));
        assertEquals("REJECTED", row.get("processing_status"), code);
        assertEquals(code, row.get("processing_error"));
    }

    private static void assertLogged(CapturedOutput output, Map<String, Object> message, String code) {
        assertTrue(output.getAll().contains("messageId=" + message.get("messageId") + ", processingError=" + code),
                code);
    }

    /** Publishes and waits until the application has stored it, so the next read sees its effect. */
    private Map<String, Object> publish(String topic, Map<String, Object> message) {
        hub.publish(topic, bytes(message));
        db.awaitMessage(message.get("messageId"));
        return message;
    }

    private String statusOf(String token) throws Exception {
        return mvc.perform(get(LOCKER_STATUS).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static String read(String body, String path) {
        return JsonPath.read(body, path);
    }
}
