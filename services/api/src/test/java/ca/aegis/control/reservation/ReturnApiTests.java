package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.expectProblem;
import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.device.DeviceMessageIngestion.Outcome;

/**
 * RET-01 (#50): the holder of an {@code ACTIVE} loan prepares a return with the same local proof as a checkout; the
 * loan becomes {@code RETURN_PENDING} only at the authorization, and an authorized return that ends without any
 * possible physical effect gives the loan back as {@code ACTIVE} (document 06, section 13.1). Any other end keeps it
 * {@code RETURN_PENDING} with an open anomaly. The physical proof that completes the loan comes with #51.
 */
class ReturnApiTests extends HubChallengeApiTest {

    /** {@code expiresAt} of the authorized return: authorized at START + 2 s, for 120 s. */
    static final Instant DEADLINE = START.plusSeconds(122);

    @Autowired
    CheckoutConfirmation confirmation;

    UUID loan;
    UUID operation;
    UUID compartment;
    String tag;
    Instant closedAt;

    @BeforeEach
    void borrowed() {
        // The base fixture reserved the asset; here it is already borrowed, so that reservation is over.
        jdbc.sql("""
                UPDATE aegis.reservations SET status = 'CANCELLED', cancelled_at = :now WHERE id = :id
                """).param("now", ReservationFixtures.utc(START.minusSeconds(300))).param("id", reservation).update();
        loan = fixtures.loan(asset, technician.id(), START.minusSeconds(1800));
    }

    @Test
    void thePreparationShowsAReturnChallengeAndLeavesTheLoanActive() throws Exception {
        loanView().andExpect(jsonPath("$.availableActions[0]").value("RETURN"));

        String body = prepare(key()).andExpect(status().isAccepted())
                .andExpect(jsonPath("$.type").value("RETURN"))
                .andExpect(jsonPath("$.status").value("AWAITING_LOCAL_PROOF"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        operation = UUID.fromString(JsonPath.read(body, "$.id"));

        Map<String, Object> row = jdbc.sql("""
                SELECT type, reservation_id, loan_id, asset_id, expected_asset_identifier_id FROM aegis.locker_operations
                WHERE id = :id
                """).param("id", operation).query().singleRow();
        assertEquals("RETURN", row.get("type"));
        assertNull(row.get("reservation_id"));
        assertEquals(loan, row.get("loan_id"));
        assertEquals(asset, row.get("asset_id"));
        assertNotNull(row.get("expected_asset_identifier_id"));
        assertEquals("ACTIVE", loanStatus());
        assertEquals(0L, commands());
        JsonNode challenge = open(displayRow(operation, "DISPLAY_ACCESS_CHALLENGE"));
        assertEquals("RETURN", challenge.get("payload").get("action").asString());
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'OPERATION_REQUESTED'
                """, operation));
        // An open operation on the locker: no second return is offered or accepted meanwhile.
        loanView().andExpect(jsonPath("$.availableActions").isEmpty());
        expectProblem(prepare(key()), 409, "LOCKER_OPERATION_IN_PROGRESS");
    }

    @Test
    void guardsRefuseWithoutCreatingAnything() throws Exception {
        String stranger = accessToken(accounts.technician());
        expectProblem(mvc.perform(post("/api/v1/loans/" + loan + "/return").header(AUTHORIZATION, bearer(stranger))
                .header("Idempotency-Key", key())), 404, "RESOURCE_NOT_FOUND");
        clock.advance(Duration.ofMinutes(5));
        expectProblem(prepare(key()), 503, "LOCKER_OFFLINE");
        heartbeat("CONNECTED", "HEALTHY", "OPEN", "UNLOCKED");
        expectProblem(prepare(key()), 409, "COMPARTMENT_STATE_UNSAFE");
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        jdbc.sql("UPDATE aegis.loans SET status = 'RETURN_PENDING', return_requested_at = :now WHERE id = :id")
                .param("now", ReservationFixtures.utc(clock.instant())).param("id", loan).update();
        expectProblem(prepare(key()), 409, "LOAN_NOT_RETURNABLE");
        loanView().andExpect(jsonPath("$.availableActions").isEmpty());
        assertEquals(0L, returns());
    }

    @Test
    void returnPreparationsShareTheRateLimit() throws Exception {
        for (int attempt = 0; attempt < 6; attempt++) {
            prepare(key()).andExpect(status().isAccepted());
            clock.advance(Duration.ofSeconds(61));
            heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
            challengeExpiry.run(100);
        }
        expectProblem(prepare(key()), 429, "LOCAL_PROOF_RATE_LIMITED").andExpect(header().exists("Retry-After"));
        // A challenge that expired unused never touched the loan.
        assertEquals("ACTIVE", loanStatus());
        assertEquals(6L, returns());
    }

    @Test
    void theAuthorizationStartsTheReturnAndQueuesOneUnlock() throws Exception {
        authorized();
        Map<String, Object> times = jdbc.sql("""
                SELECT o.status, o.authorized_at, o.expires_at, l.status AS loan_status, l.return_requested_at
                FROM aegis.locker_operations o JOIN aegis.loans l ON l.id = o.loan_id
                WHERE o.id = :id
                """).param("id", operation).query().singleRow();
        assertEquals("AUTHORIZED", times.get("status"));
        assertEquals("RETURN_PENDING", times.get("loan_status"));
        assertEquals(START.plusSeconds(2), instant(times.get("authorized_at")));
        assertEquals(DEADLINE, instant(times.get("expires_at")));
        assertEquals(START.plusSeconds(2), instant(times.get("return_requested_at")));
        assertEquals(1L, commands());
        assertEquals(1L, audits("LOAN_RETURN_STARTED"));
        loanView().andExpect(jsonPath("$.status").value("RETURN_PENDING"))
                .andExpect(jsonPath("$.currentOperationId").value(operation.toString()))
                .andExpect(jsonPath("$.availableActions").isEmpty());

        // Before the deadline nothing ends it: the proof that completes the loan comes with #51.
        clock.set(DEADLINE.minusMillis(1));
        confirmation.run(1000);
        assertEquals("AUTHORIZED", fixtures.operationStatus(operation));
    }

    @Test
    void aReturnNeverSentEndsSafelyAndTheLoanIsActiveAgain() throws Exception {
        authorized();
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertEquals("EXPIRED", fixtures.operationStatus(operation));
        assertEquals("OPERATION_EXPIRED", failureReason());
        assertSafelyReverted();
    }

    @Test
    void aSafeHubRefusalEndsFailedAndTheLoanIsActiveAgain() throws Exception {
        authorized();
        assertEquals(Outcome.ACCEPTED, reject("INVALID_PAYLOAD"));
        // The refusal is left to the deadline, which reverts the loan in the same transaction.
        assertEquals("AUTHORIZED", fixtures.operationStatus(operation));
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertEquals("FAILED", fixtures.operationStatus(operation));
        assertEquals("COMMAND_REJECTED_INVALID_PAYLOAD", failureReason());
        assertSafelyReverted();
    }

    @Test
    void anUncertainHubRefusalKeepsTheReturnPendingWithItsAnomaly() throws Exception {
        authorized();
        assertEquals(Outcome.ACCEPTED, reject("LOCK_ACTUATION_FAILED"));
        assertEquals(1L, openAnomalies());
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals("RETURN_PENDING", loanStatus());
        assertEquals(1L, openAnomalies());
        assertEquals(0L, audits("LOAN_RETURN_REVERTED_SAFE"));
    }

    @Test
    void anOpenedDoorKeepsTheReturnPendingWithAnAnomaly() throws Exception {
        authorized();
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        assertEquals("DOOR_OPENED", fixtures.operationStatus(operation));
        assertEquals("RETURN_PENDING", loanStatus());
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals("DEVICE_OFFLINE_DURING_OPERATION", failureReason());
        assertEquals("RETURN_PENDING", loanStatus());
        assertEquals(1L, openAnomalies());
        assertEquals(0L, audits("LOAN_RETURN_REVERTED_SAFE"));
        // Q2 of document 09: no new attempt on a RETURN_PENDING loan until its recovery is defined.
        loanView().andExpect(jsonPath("$.availableActions").isEmpty());
        expectProblem(prepare(key()), 409, "LOAN_NOT_RETURNABLE");
    }

    @Test
    void anExpiredChallengeNeverTouchesTheLoan() throws Exception {
        String body = prepare(key()).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        operation = UUID.fromString(JsonPath.read(body, "$.id"));
        clock.advance(Duration.ofSeconds(61));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        challengeExpiry.run(100);
        assertEquals("EXPIRED", fixtures.operationStatus(operation));
        assertEquals("ACTIVE", loanStatus());
        assertEquals(0L, commands());
        loanView().andExpect(jsonPath("$.availableActions[0]").value("RETURN"));
    }

    @Test
    void aStablePresenceAfterTheClosingCompletesTheLoanOnce() throws Exception {
        authorized();
        doorSequence();
        assertEquals("RETURN_PENDING", loanStatus());
        assertEquals(Outcome.ACCEPTED, scan(operation, "HEALTHY", Map.of(tag, 3)));

        assertEquals("CONFIRMED", fixtures.operationStatus(operation));
        Map<String, Object> row = jdbc.sql("""
                SELECT l.status, l.returned_at, l.return_operation_id, o.confirmed_at
                FROM aegis.loans l JOIN aegis.locker_operations o ON o.id = :operation WHERE l.id = :loan
                """).param("operation", operation).param("loan", loan).query().singleRow();
        assertEquals("COMPLETED", row.get("status"));
        assertEquals(operation, row.get("return_operation_id"));
        assertEquals(row.get("confirmed_at"), row.get("returned_at"));
        assertEquals(0L, openAnomalies());
        for (String type : List.of("DOOR_OPENED", "OBSERVATION_RECEIVED", "OPERATION_CONFIRMED", "LOAN_COMPLETED")) {
            assertEquals(1L, audits(type), type);
        }
        JsonNode screen = open(displayRow(operation, "DISPLAY_OPERATION_STATUS"));
        assertEquals("CONFIRMED", screen.get("payload").get("status").asString());
        assertFalse(screen.get("payload").has("token"));
        loanView().andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.currentOperationId").doesNotExist())
                .andExpect(jsonPath("$.availableActions").isEmpty());
        mvc.perform(get("/api/v1/me/loan").header(AUTHORIZATION, bearer(token))).andExpect(status().isNotFound());
        // Readiness is derived after the commit: the asset is in custody again and can be reserved.
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        mvc.perform(get("/api/v1/assets/" + asset).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.readiness.result").value("READY"));

        // Idempotency: replays and a later door sequence change nothing.
        confirmation.run(1000);
        assertEquals(LockerOperationStatus.CONFIRMED, confirmation.evaluate(operation).orElseThrow());
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        scan(operation, "HEALTHY", Map.of());
        assertEquals("CONFIRMED", fixtures.operationStatus(operation));
        assertEquals("COMPLETED", loanStatus());
        assertEquals(1L, audits("LOAN_COMPLETED"));
    }

    @Test
    void oneOrTwoReadsDoNotProveTheReturn() throws Exception {
        authorized();
        doorSequence();
        scan(operation, "HEALTHY", Map.of(tag, 2));
        assertEquals("OBSERVATION_RECEIVED", fixtures.operationStatus(operation));
        assertEquals("RETURN_PENDING", loanStatus());
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertReturnAnomaly("DEVICE_OFFLINE_DURING_OPERATION", "SCAN_NOT_CONCLUSIVE");
    }

    @Test
    void anAbsentTagWaitsThenEndsExpectedAssetNotObserved() throws Exception {
        authorized();
        doorSequence();
        scan(operation, "HEALTHY", Map.of());
        clock.set(DEADLINE.minusMillis(1));
        confirmation.run(1000);
        assertEquals("OBSERVATION_RECEIVED", fixtures.operationStatus(operation));
        clock.set(DEADLINE);
        confirmation.run(1000);
        assertReturnAnomaly("EXPECTED_ASSET_NOT_OBSERVED", "EXPECTED_ASSET_NOT_OBSERVED");
    }

    @Test
    void anotherAssetStablyReadInTheCellIsAnAnomalyAtOnce() throws Exception {
        authorized();
        doorSequence();
        scan(operation, "HEALTHY", Map.of("E2-FOREIGN-" + UUID.randomUUID(), 3));
        assertReturnAnomaly("UNEXPECTED_ASSET_OBSERVED", "UNEXPECTED_ASSET_OBSERVED");
    }

    @Test
    void aFaultedReaderAfterTheClosingIsInconsistentAtOnce() throws Exception {
        authorized();
        doorSequence();
        scan(operation, "FAULTED", Map.of());
        assertReturnAnomaly("INCONSISTENT_PHYSICAL_STATE", "READER_NOT_HEALTHY");
    }

    @Test
    void theTagReappearingWithoutAConfirmedReturnNeverCompletesTheLoan() throws Exception {
        compartment = jdbc.sql("""
                SELECT p.compartment_id FROM aegis.asset_placements p WHERE p.asset_id = :asset AND p.removed_at IS NULL
                """).param("asset", asset).query(UUID.class).single();
        tag = jdbc.sql("SELECT identifier_value FROM aegis.asset_identifiers WHERE asset_id = :asset AND active")
                .param("asset", asset).query(String.class).single();
        closedAt = clock.instant();
        // An inventory scan outside any operation sees the asset back in its cell.
        assertEquals(Outcome.ACCEPTED, scan(null, "HEALTHY", Map.of(tag, 5)));
        assertEquals("ACTIVE", loanStatus());

        // Within an authorized return, a presence with no door sequence proves nothing either.
        authorized();
        acknowledge();
        closedAt = clock.instant();
        scan(operation, "HEALTHY", Map.of(tag, 5));
        assertEquals("COMMAND_ACKNOWLEDGED", fixtures.operationStatus(operation));
        assertEquals("RETURN_PENDING", loanStatus());
        // So does a presence received at or after the deadline, even after a door sequence.
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
        // A window that starts 2 s before the deadline and is reported 1 s after it.
        Instant expiresAt = instant(jdbc.sql("SELECT expires_at FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(OffsetDateTime.class).single());
        clock.set(expiresAt.minusSeconds(2));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        closedAt = clock.instant();
        scan(operation, "HEALTHY", Map.of(tag, 5));
        assertEquals(expiresAt.plusSeconds(1), clock.instant());
        confirmation.run(1000);
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals("RETURN_PENDING", loanStatus());
        assertEquals(0L, audits("LOAN_COMPLETED"));
    }

    private void assertSafelyReverted() throws Exception {
        assertEquals("ACTIVE", loanStatus());
        assertEquals(0L, openAnomalies());
        assertEquals(1L, audits("LOAN_RETURN_REVERTED_SAFE"));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id AND status = 'PENDING'
                """, operation));
        // Nothing happened physically: the holder may try again while the hub is online.
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        loanView().andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.availableActions[0]").value("RETURN"));
        // A terminal return never changes again.
        confirmation.run(1000);
        assertEquals(1L, audits("LOAN_RETURN_REVERTED_SAFE"));
    }

    private ResultActions prepare(String key) throws Exception {
        return mvc.perform(post("/api/v1/loans/" + loan + "/return").header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", key));
    }

    private ResultActions loanView() throws Exception {
        return mvc.perform(get("/api/v1/loans/" + loan).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk());
    }

    private void authorized() throws Exception {
        String body = prepare(key()).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        operation = UUID.fromString(JsonPath.read(body, "$.id"));
        compartment = jdbc.sql("SELECT compartment_id FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(UUID.class).single();
        tag = jdbc.sql("SELECT identifier_value FROM aegis.asset_identifiers WHERE asset_id = :asset AND active")
                .param("asset", asset).query(String.class).single();
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
        Map<String, Object> message = commandReport("COMMAND_ACKNOWLEDGED");
        message.put("result", "ACCEPTED");
        assertEquals(Outcome.ACCEPTED, ingest(message));
    }

    private Outcome reject(String reason) {
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> message = commandReport("COMMAND_REJECTED");
        message.put("reason", reason);
        return ingest(message);
    }

    private Map<String, Object> commandReport(String type) {
        Map<String, Object> message = envelope(type);
        message.put("commandMessageId", jdbc.sql("SELECT message_id FROM aegis.command_outbox WHERE operation_id = :id")
                .param("id", operation).query(UUID.class).single().toString());
        message.put("operationId", operation.toString());
        message.put("compartmentId", compartment.toString());
        return message;
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

    /** A 3-second window that starts at the last closing, reported at its end, for this operation or none. */
    private Outcome scan(UUID forOperation, String reader, Map<String, Integer> reads) {
        Instant started = closedAt;
        clock.set(closedAt.plusSeconds(3));
        Map<String, Object> message = envelope("RFID_SCAN_COMPLETED");
        if (forOperation != null) {
            message.put("operationId", forOperation.toString());
        }
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

    private void doorSequence() {
        acknowledge();
        door("DOOR_OPENED");
        door("DOOR_CLOSED");
    }

    private void assertReturnAnomaly(String type, String finding) {
        assertEquals("ANOMALY", fixtures.operationStatus(operation));
        assertEquals(type, failureReason());
        assertEquals("RETURN_PENDING", loanStatus());
        Map<String, Object> anomaly = jdbc.sql("""
                SELECT type, status, details ->> 'finding' AS finding FROM aegis.anomalies
                WHERE locker_operation_id = :id
                """).param("id", operation).query().singleRow();
        assertEquals(type, anomaly.get("type"));
        assertEquals("OPEN", anomaly.get("status"));
        assertEquals(finding, anomaly.get("finding"));
        assertEquals(0L, audits("LOAN_COMPLETED"));
        assertEquals(0L, audits("LOAN_RETURN_REVERTED_SAFE"));
    }

    private String loanStatus() {
        return jdbc.sql("SELECT status FROM aegis.loans WHERE id = :id").param("id", loan).query(String.class)
                .single();
    }

    private String failureReason() {
        return jdbc.sql("SELECT failure_reason FROM aegis.locker_operations WHERE id = :id").param("id", operation)
                .query(String.class).single();
    }

    private long returns() {
        return fixtures.count("SELECT count(*) FROM aegis.locker_operations WHERE loan_id = :id", loan);
    }

    private long commands() {
        return fixtures.count("SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id", operation);
    }

    private long openAnomalies() {
        return fixtures.count("""
                SELECT count(*) FROM aegis.anomalies WHERE locker_operation_id = :id AND status = 'OPEN'
                """, operation);
    }

    private long audits(String type) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events WHERE operation_id = :id AND event_type = :type
                """).param("id", operation).param("type", type).query(Long.class).single();
    }

    private static Instant instant(Object value) {
        return value instanceof OffsetDateTime time ? time.toInstant() : ((java.sql.Timestamp) value).toInstant();
    }
}
