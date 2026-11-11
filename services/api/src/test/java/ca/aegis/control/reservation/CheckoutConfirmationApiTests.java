package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.device.DeviceMessageIngestion.Outcome;

/**
 * CHK-02 (#47): the stored acknowledgement, door sequence and RFID scan of an authorized checkout end it once, in
 * {@code CONFIRMED} with one loan, or in {@code EXPIRED} or {@code ANOMALY} without any; a terminal operation never
 * changes again. Philippe's rules of 11 November 2026: a healthy scan that still sees the expected tag after a valid
 * door sequence waits until {@code expiresAt}, then becomes {@code INCONSISTENT_PHYSICAL_STATE}; a {@code FAULTED} or
 * {@code UNKNOWN} reader after that sequence is {@code INCONSISTENT_PHYSICAL_STATE} at once.
 */
class CheckoutConfirmationApiTests extends HubChallengeApiTest {

    /** {@code expiresAt} of the authorized operation: authorized at START + 2 s, for 120 s. */
    static final Instant DEADLINE = START.plusSeconds(122);

    @Autowired
    CheckoutConfirmation confirmation;

    @Autowired
    TransactionTemplate transactions;

    UUID operation;
    UUID compartment;
    String tag;
    Instant closedAt;

    @Test
    void aCoherentProofConfirmsOnceWithOneLoan() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        assertEquals("DOOR_OPENED", fixtures.operationStatus(operation));
        door("DOOR_CLOSED");
        assertEquals("DOOR_OPENED", fixtures.operationStatus(operation));
        assertEquals(Outcome.ACCEPTED, scan("HEALTHY", Map.of()));

        assertConfirmed();
        Map<String, Object> loan = jdbc.sql("""
                SELECT asset_id, holder_user_id, status, checked_out_at, due_at FROM aegis.loans
                WHERE checkout_operation_id = :id
                """).param("id", operation).query().singleRow();
        assertEquals(asset, loan.get("asset_id"));
        assertEquals(technician.id(), loan.get("holder_user_id"));
        assertEquals("ACTIVE", loan.get("status"));
        assertEquals(UNTIL, ((java.sql.Timestamp) loan.get("due_at")).toInstant());
        assertEquals("FULFILLED", jdbc.sql("SELECT status FROM aegis.reservations WHERE id = :id")
                .param("id", reservation).query(String.class).single());
        Map<String, Object> times = jdbc.sql("""
                SELECT door_opened_at, observation_received_at, confirmed_at, terminal_at, failure_reason
                FROM aegis.locker_operations WHERE id = :id
                """).param("id", operation).query().singleRow();
        assertEquals(times.get("confirmed_at"), times.get("terminal_at"));
        assertEquals(null, times.get("failure_reason"));
        for (String type : List.of("DOOR_OPENED", "OBSERVATION_RECEIVED", "OPERATION_CONFIRMED",
                "RESERVATION_FULFILLED", "CHECKOUT_CONFIRMED")) {
            assertEquals(1L, audits(type), type);
        }
        JsonNode screen = open(displayRow(operation, "DISPLAY_OPERATION_STATUS"));
        assertEquals("CONFIRMED", screen.get("payload").get("status").asString());
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.inbound_device_messages
                WHERE operation_id = :id AND processing_status = 'RECEIVED'
                """, operation));
        mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CONFIRMED"));

        // Idempotency: another pass and a replayed evaluation change nothing.
        confirmation.run(1000);
        assertEquals(LockerOperationStatus.CONFIRMED, confirmation.evaluate(operation).orElseThrow());
        assertEquals(1L, loans());
        assertEquals(1L, audits("OPERATION_CONFIRMED"));
    }

    @Test
    void concurrentEvaluationsCreateASingleLoan() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        CountDownLatch held = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(6);
        try {
            // Holds the operation so that the ingestion's trigger and five passes all queue on its lock.
            Future<?> holder = pool.submit(() -> transactions.executeWithoutResult(status -> {
                jdbc.sql("SELECT id FROM aegis.locker_operations WHERE id = :id FOR UPDATE").param("id", operation)
                        .query(UUID.class).single();
                held.countDown();
                await(release);
            }));
            assertTrue(held.await(10, TimeUnit.SECONDS));
            List<Future<?>> racers = new ArrayList<>();
            racers.add(pool.submit(() -> scan("HEALTHY", Map.of())));
            for (int i = 0; i < 4; i++) {
                racers.add(pool.submit(() -> confirmation.evaluate(operation)));
            }
            Thread.sleep(300);
            release.countDown();
            holder.get(10, TimeUnit.SECONDS);
            for (Future<?> racer : racers) {
                racer.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertConfirmed();
        assertEquals(1L, loans());
        assertEquals(1L, audits("OPERATION_CONFIRMED"));
        assertEquals(1L, audits("CHECKOUT_CONFIRMED"));
    }

    @Test
    void anExpectedTagStillSeenWaitsThenEndsInconsistentAtTheDeadline() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        scan("HEALTHY", Map.of(tag, 5));

        assertEquals("OBSERVATION_RECEIVED", fixtures.operationStatus(operation));
        clock.set(DEADLINE.minusMillis(1));
        pass();
        assertEquals("OBSERVATION_RECEIVED", fixtures.operationStatus(operation));
        assertEquals(0L, anomalies());

        clock.set(DEADLINE);
        pass();
        assertAnomaly("INCONSISTENT_PHYSICAL_STATE", "EXPECTED_ASSET_STILL_PRESENT");
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.reservations WHERE id = :id")
                .param("id", reservation).query(String.class).single());

        // Irreversible: a later healthy scan without the tag proves nothing more and creates no loan.
        scan("HEALTHY", Map.of());
        pass();
        assertAnomaly("INCONSISTENT_PHYSICAL_STATE", "EXPECTED_ASSET_STILL_PRESENT");
        assertEquals(1L, audits("ANOMALY_CREATED"));
    }

    @Test
    void aFaultedReaderAfterTheDoorSequenceIsInconsistentAtOnce() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        scan("FAULTED", Map.of());

        assertTrue(clock.instant().isBefore(DEADLINE));
        assertAnomaly("INCONSISTENT_PHYSICAL_STATE", "READER_NOT_HEALTHY");
    }

    @Test
    void anUnknownReaderBeforeAnyScanAfterTheClosingIsInconsistentAtOnce() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        heartbeat("CONNECTED", "UNKNOWN", "OPEN", "UNLOCKED");
        door("DOOR_CLOSED");

        assertAnomaly("INCONSISTENT_PHYSICAL_STATE", "READER_NOT_HEALTHY");
    }

    @Test
    void aDoorLeftOpenEndsInAnAnomalyAtTheDeadline() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        clock.set(DEADLINE);
        pass();
        assertAnomaly("DOOR_NOT_CLOSED_BEFORE_EXPIRY", "DOOR_NOT_CLOSED");
    }

    @Test
    void aMissingScanIsNotAnInconsistencyButAnUndeterminedExecution() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        clock.set(DEADLINE.minusMillis(1));
        pass();
        clock.set(DEADLINE);
        pass();
        assertAnomaly("DEVICE_OFFLINE_DURING_OPERATION", "SCAN_MISSING");
    }

    @Test
    void aCommandNeverSentExpiresWithoutAnyPhysicalEffect() throws Exception {
        authorized();
        clock.set(DEADLINE);
        pass();
        assertEquals("EXPIRED", fixtures.operationStatus(operation));
        assertEquals("OPERATION_EXPIRED", failureReason());
        assertEquals("CANCELLED", jdbc.sql("SELECT status FROM aegis.command_outbox WHERE operation_id = :id")
                .param("id", operation).query(String.class).single());
        assertEquals(0L, anomalies());
        assertEquals(0L, loans());
        assertEquals(1L, audits("OPERATION_EXPIRED"));
        assertEquals("EXPIRED", open(displayRow(operation, "DISPLAY_OPERATION_STATUS")).get("payload").get("status")
                .asString());

        // A late acknowledgement then a door sequence cannot revive it.
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        scan("HEALTHY", Map.of());
        assertEquals("EXPIRED", fixtures.operationStatus(operation));
        assertEquals(0L, loans());
        assertEquals(1L, audits("OPERATION_EXPIRED"));
        // Kept as technical evidence, interpreted as ignored (document 05, section 5.6).
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.inbound_device_messages
                WHERE operation_id = :id AND processing_status = 'RECEIVED'
                """, operation));
    }

    @Test
    void anAcknowledgedCommandWithoutOpeningOnAHealthyClosedCellExpires() throws Exception {
        authorized();
        acknowledge();
        clock.set(DEADLINE);
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        pass();
        assertEquals("EXPIRED", fixtures.operationStatus(operation));
        assertEquals("OPERATION_EXPIRED", failureReason());
    }

    @Test
    void factsOfAnotherBootOrOperationProveNothing() throws Exception {
        authorized();
        acknowledge();
        Map<String, Object> stranger = envelope("DOOR_OPENED");
        stranger.put("operationId", UUID.randomUUID().toString());
        stranger.put("compartmentId", compartment.toString());
        stranger.put("doorState", "OPEN");
        assertEquals(Outcome.REJECTED, ingest(stranger));
        assertEquals("COMMAND_ACKNOWLEDGED", fixtures.operationStatus(operation));

        // A restart breaks the chain: the door sequence and scan of the new boot cannot complete the old one.
        boot(2);
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        scan("HEALTHY", Map.of());
        assertEquals("COMMAND_ACKNOWLEDGED", fixtures.operationStatus(operation));
        assertEquals(0L, loans());
        clock.set(DEADLINE);
        pass();
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals(0L, loans());
    }

    /** One scheduled pass, which also sweeps operations other tests left open, then this operation's status. */
    private void pass() {
        confirmation.run(1000);
    }

    private void authorized() throws Exception {
        operation = prepared();
        compartment = jdbc.sql("SELECT compartment_id FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(UUID.class).single();
        tag = jdbc.sql("""
                SELECT identifier_value FROM aegis.asset_identifiers WHERE asset_id = :asset AND active
                """).param("asset", asset).query(String.class).single();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        UUID challenge = (UUID) display.get("challenge_id");
        String secret = open(display).get("payload").get("token").asString();
        clock.advance(Duration.ofSeconds(2));
        report("ACCESS_CHALLENGE_DISPLAYED", operation, (UUID) display.get("message_id"), challenge, 1, null,
                session);
        mvc.perform(post("/api/v1/locker-operations/" + operation + "/authorize-local")
                .header(AUTHORIZATION, bearer(token)).header("Idempotency-Key", key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(jsonMapper.writeValueAsString(Map.of("challengeId", challenge.toString(), "token", secret))))
                .andExpect(status().isAccepted());
    }

    private void acknowledge() {
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> message = envelope("COMMAND_ACKNOWLEDGED");
        message.put("commandMessageId", jdbc.sql("SELECT message_id FROM aegis.command_outbox WHERE operation_id = :id")
                .param("id", operation).query(UUID.class).single().toString());
        message.put("operationId", operation.toString());
        message.put("compartmentId", compartment.toString());
        message.put("result", "ACCEPTED");
        ingest(message);
    }

    private void door(String type) {
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> message = envelope(type);
        message.put("operationId", operation.toString());
        message.put("compartmentId", compartment.toString());
        message.put("doorState", type.equals("DOOR_OPENED") ? "OPEN" : "CLOSED");
        assertEquals(Outcome.ACCEPTED, ingest(message));
        if (type.equals("DOOR_CLOSED")) {
            closedAt = clock.instant();
        }
    }

    /** A 3-second window that starts at the last closing, reported at its end. */
    private Outcome scan(String reader, Map<String, Integer> reads) {
        Instant started = closedAt;
        clock.set(started.plusSeconds(3));
        Map<String, Object> message = envelope("RFID_SCAN_COMPLETED");
        message.put("operationId", operation.toString());
        message.put("compartmentId", compartment.toString());
        message.put("windowStartedAt", started.toString());
        message.put("windowEndedAt", clock.instant().toString());
        message.put("readerStatus", reader);
        List<Map<String, Object>> identifiers = new ArrayList<>();
        reads.forEach((value, count) -> {
            Map<String, Object> identifier = new LinkedHashMap<>();
            identifier.put("identifierType", "RFID_UHF");
            identifier.put("identifierValue", value);
            identifier.put("readCount", count);
            identifiers.add(identifier);
        });
        message.put("observedIdentifiers", identifiers);
        return ingest(message);
    }

    private void assertConfirmed() {
        assertEquals("CONFIRMED", fixtures.operationStatus(operation));
        assertEquals(1L, loans());
        assertEquals(0L, anomalies());
    }

    private void assertAnomaly(String type, String finding) throws Exception {
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals(type, failureReason());
        assertEquals(0L, loans());
        Map<String, Object> anomaly = jdbc.sql("""
                SELECT type, severity, status, asset_id, compartment_id, details ->> 'finding' AS finding
                FROM aegis.anomalies WHERE locker_operation_id = :id
                """).param("id", operation).query().singleRow();
        assertEquals(type, anomaly.get("type"));
        assertEquals("HIGH", anomaly.get("severity"));
        assertEquals("OPEN", anomaly.get("status"));
        assertEquals(asset, anomaly.get("asset_id"));
        assertEquals(compartment, anomaly.get("compartment_id"));
        assertEquals(finding, anomaly.get("finding"));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id AND status = 'PENDING'
                """, operation));
        JsonNode screen = open(displayRow(operation, "DISPLAY_OPERATION_STATUS"));
        assertEquals("ANOMALY", screen.get("payload").get("status").asString());
        assertEquals(type, screen.get("payload").get("reasonCode").asString());
        assertFalse(screen.get("payload").has("token"));
        mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ANOMALY"));
    }

    private String failureReason() {
        return jdbc.sql("SELECT failure_reason FROM aegis.locker_operations WHERE id = :id").param("id", operation)
                .query(String.class).single();
    }

    private long loans() {
        return fixtures.count("SELECT count(*) FROM aegis.loans WHERE asset_id = :id", asset);
    }

    private long anomalies() {
        return fixtures.count("SELECT count(*) FROM aegis.anomalies WHERE locker_operation_id = :id", operation);
    }

    private long audits(String type) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events WHERE operation_id = :id AND event_type = :type
                """).param("id", operation).param("type", type).query(Long.class).single();
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
