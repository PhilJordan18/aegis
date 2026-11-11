package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.expectProblem;
import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.device.DeviceMessageIngestion;
import ca.aegis.control.display.DisplayAad;
import ca.aegis.control.display.DisplayKeyRing;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * LOC-01 and the preparation of CHK-01 (#43, #46; document 09, section 15.1; document 06, sections 6.1 to 6.5;
 * document 10, section 27): the 202, the encrypted display instruction, the hub's display reports, and the end of an
 * unconsumed challenge. The test hub is brought online by real heartbeats through the ingestion, without a broker.
 */
@Import(PresentAssetsConfiguration.class)
class CheckoutPreparationApiTests extends ApiIntegrationTest {

    static final Instant UNTIL = Instant.parse("2026-09-28T15:30:00Z");

    @Autowired
    JdbcClient jdbc;

    @Autowired
    DeviceMessageIngestion ingestion;

    @Autowired
    LocalChallengeExpiry challengeExpiry;

    ReservationFixtures fixtures;
    TestAccount technician;
    String token;
    UUID locker;
    UUID asset;
    UUID reservation;
    UUID session;
    UUID connection;
    long sequence;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        technician = accounts.technician();
        token = accessToken(technician);
        locker = fixtures.scheduledLocker(accounts.admin().id());
        asset = fixtures.asset(locker);
        reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
        UUID device = fixtures.hub(locker);
        jdbc.sql("""
                UPDATE aegis.locker_devices SET provisioned_at = :past, device_session_id = NULL, boot_count = NULL
                WHERE id = :id
                """).param("past", ReservationFixtures.utc(ReservationFixtures.PAST)).param("id", device).update();
        boot(1);
    }

    @Test
    void preparationAnswers202WithoutSecretAndQueuesOnlyAnEncryptedDisplay() throws Exception {
        MvcResult result = checkout(key())
                .andExpect(status().isAccepted())
                .andExpect(header().string("Retry-After", "1"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.type").value("CHECKOUT"))
                .andExpect(jsonPath("$.status").value("AWAITING_LOCAL_PROOF"))
                .andExpect(jsonPath("$.requiredAction").value("SCAN_HUB_QR"))
                .andExpect(jsonPath("$.reservationId").value(reservation.toString()))
                .andExpect(jsonPath("$.localProofExpiresAt").value(START.plusSeconds(60).toString()))
                .andExpect(jsonPath("$.localProofDisplayedAt").value(nullValue()))
                .andExpect(jsonPath("$.authorizedAt").value(nullValue()))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        UUID operation = UUID.fromString(JsonPath.read(body, "$.id"));
        assertEquals("/api/v1/locker-operations/" + operation, result.getResponse().getHeader("Location"));

        // No unlock command exists before the local proof (document 06, section 6.3).
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id",
                operation));
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        assertEquals("PENDING", display.get("status"));
        assertEquals(DISPLAY_KEY_ID, display.get("encryption_key_id"));
        assertEquals(1L, ((Number) display.get("display_revision")).longValue());
        assertEquals("aegis/v1/lockers/" + locker + "/display", display.get("topic"));

        JsonNode message = open(display);
        assertEquals("3.0", message.get("schemaVersion").asString());
        assertEquals("DISPLAY_ACCESS_CHALLENGE", message.get("type").asString());
        assertEquals(session.toString(), message.get("targetDeviceSessionId").asString());
        assertEquals(1L, message.get("displayRevision").longValue());
        assertEquals(START.plusSeconds(60), Instant.parse(message.get("expiresAt").asString()));
        String secret = message.get("payload").get("token").asString();
        byte[] raw = Base64.getUrlDecoder().decode(secret);
        assertEquals(32, raw.length);
        assertFalse(secret.contains("="), "base64url without padding");
        byte[] hash = jdbc.sql("SELECT token_hash FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(byte[].class).single();
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(raw), hash);

        // The secret leaves the backend only inside the encrypted display: not in REST, audit or idempotency.
        assertFalse(body.contains(secret));
        String hex = java.util.HexFormat.of().formatHex(hash);
        for (String table : List.of("aegis.audit_events", "aegis.rest_idempotency_keys")) {
            assertEquals(0L, jdbc.sql("SELECT count(*) FROM " + table + " t WHERE t::text LIKE :secret OR t::text LIKE :hex")
                    .param("secret", "%" + secret + "%").param("hex", "%" + hex + "%").query(Long.class).single(),
                    table);
        }
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id IN (SELECT id FROM aegis.local_access_challenges WHERE operation_id = :id)
                  AND event_type = 'LOCAL_CHALLENGE_CREATED' AND result = 'ACCEPTED'
                """, operation));

        mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.status").value("AWAITING_LOCAL_PROOF"));
        String other = accessToken(accounts.technician());
        expectProblem(mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(other))),
                404, "RESOURCE_NOT_FOUND");
    }

    @Test
    void theSameKeyReplaysAndANewKeyFindsTheOperationInProgress() throws Exception {
        String key = key();
        String first = checkout(key).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        String replay = checkout(key).andExpect(status().isAccepted())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertEquals(jsonMapper.readTree(first), jsonMapper.readTree(replay));
        expectProblem(checkout(key()), 409, "LOCKER_OPERATION_IN_PROGRESS");
        assertEquals(1L, operations());
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.hub_display_outbox WHERE locker_id = :id",
                locker));
    }

    @Test
    void concurrentPreparationsCreateOneOperationOneChallengeAndOneRevision() throws Exception {
        int callers = 6;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        try {
            for (int i = 0; i < callers; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return checkout(key()).andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> result : results) {
                statuses.add(result.get(30, TimeUnit.SECONDS));
            }
            assertEquals(1, statuses.stream().filter(code -> code == 202).count(), statuses.toString());
            assertEquals(callers - 1, statuses.stream().filter(code -> code == 409).count(), statuses.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1L, operations());
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.local_access_challenges WHERE locker_id = :id",
                locker));
        assertEquals(1L, fixtures.count("SELECT display_revision FROM aegis.lockers WHERE id = :id", locker));
    }

    @Test
    void guardsRefuseWithoutCreatingAnything() throws Exception {
        // A silent hub: the heartbeat is older than the freshness window.
        clock.advance(Duration.ofMinutes(5));
        expectProblem(checkout(key()), 503, "LOCKER_OFFLINE");
        heartbeat("CONNECTED", "HEALTHY", "OPEN", "UNLOCKED");
        expectProblem(checkout(key()), 409, "COMPARTMENT_STATE_UNSAFE");
        heartbeat("CONNECTED", "FAULTED", "CLOSED", "LOCKED");
        expectProblem(checkout(key()), 503, "DEVICE_UNAVAILABLE");
        heartbeat("CONNECTED", "HEALTHY", "UNKNOWN", "LOCKED");
        expectProblem(checkout(key()), 422, "PHYSICAL_STATE_UNKNOWN");
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        String stranger = accessToken(accounts.technician());
        expectProblem(mvc.perform(post("/api/v1/reservations/" + reservation + "/checkout")
                .header(AUTHORIZATION, bearer(stranger)).header("Idempotency-Key", key())), 404,
                "RESOURCE_NOT_FOUND");
        assertEquals(0L, operations());
        assertEquals(0L, fixtures.count("SELECT display_revision FROM aegis.lockers WHERE id = :id", locker));
        checkout(key()).andExpect(status().isAccepted());
    }

    @Test
    void preparationsAreRateLimitedPerTechnicianAndLocker() throws Exception {
        for (int attempt = 0; attempt < 6; attempt++) {
            checkout(key()).andExpect(status().isAccepted());
            clock.advance(Duration.ofSeconds(61));
            heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
            challengeExpiry.run(100);
        }
        expectProblem(checkout(key()), 429, "RATE_LIMITED");
        assertEquals(6L, operations());
    }

    @Test
    void anExactDisplayReportSetsDisplayedAtOnceAndMismatchesChangeNothing() throws Exception {
        UUID operation = prepared();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        UUID messageId = (UUID) display.get("message_id");
        UUID challenge = (UUID) display.get("challenge_id");

        // Wrong revision, wrong challenge, other boot: not correlated.
        assertEquals(DeviceMessageIngestion.Outcome.REJECTED,
                report("ACCESS_CHALLENGE_DISPLAYED", operation, messageId, challenge, 2, null, session));
        assertEquals(DeviceMessageIngestion.Outcome.REJECTED,
                report("ACCESS_CHALLENGE_DISPLAYED", operation, messageId, UUID.randomUUID(), 1, null, session));
        assertNull(displayedAt(operation));

        clock.advance(Duration.ofSeconds(3));
        Map<String, Object> exact = reportMessage("ACCESS_CHALLENGE_DISPLAYED", operation, messageId, challenge, 1,
                null);
        assertEquals(DeviceMessageIngestion.Outcome.ACCEPTED, ingest(exact));
        assertEquals(START.plusSeconds(3), displayedAt(operation));
        assertEquals("ACKNOWLEDGED", displayRow(operation, "DISPLAY_ACCESS_CHALLENGE").get("status"));
        // A duplicate is answered as such; a second distinct report changes nothing.
        assertEquals(DeviceMessageIngestion.Outcome.DUPLICATE, ingest(exact));
        clock.advance(Duration.ofSeconds(3));
        report("ACCESS_CHALLENGE_DISPLAYED", operation, messageId, challenge, 1, null, session);
        assertEquals(START.plusSeconds(3), displayedAt(operation));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id IN (SELECT id FROM aegis.local_access_challenges WHERE operation_id = :id)
                  AND event_type = 'LOCAL_CHALLENGE_DISPLAYED'
                """, operation));
        mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(token)))
                .andExpect(jsonPath("$.localProofDisplayedAt").value(START.plusSeconds(3).toString()));
    }

    @Test
    void aReportAfterTheDeadlineIsNotADisplay() throws Exception {
        UUID operation = prepared();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        clock.advance(Duration.ofSeconds(60));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        assertEquals(DeviceMessageIngestion.Outcome.REJECTED, report("ACCESS_CHALLENGE_DISPLAYED", operation,
                (UUID) display.get("message_id"), (UUID) display.get("challenge_id"), 1, null, session));
        assertNull(displayedAt(operation));
    }

    @Test
    void aRejectionPurgesTheInstructionAndLeavesTheChallengeToItsExpiry() throws Exception {
        UUID operation = prepared();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        assertEquals(DeviceMessageIngestion.Outcome.ACCEPTED, report("DISPLAY_REJECTED", operation,
                (UUID) display.get("message_id"), (UUID) display.get("challenge_id"), 1, "SCREEN_UNAVAILABLE",
                session));
        Map<String, Object> rejected = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        assertEquals("REJECTED", rejected.get("status"));
        assertNull(rejected.get("encrypted_payload"));
        assertEquals("PENDING", challengeStatus(operation));
        assertEquals(DeviceMessageIngestion.Outcome.REJECTED, report("DISPLAY_REJECTED", operation,
                (UUID) display.get("message_id"), (UUID) display.get("challenge_id"), 1, "NOT_A_REASON", session));
    }

    @Test
    void anUnconsumedChallengeExpiresPurgesItsSecretAndClearsTheScreen() throws Exception {
        UUID operation = prepared();
        clock.advance(Duration.ofSeconds(59));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        challengeExpiry.run(100);
        assertEquals("AWAITING_LOCAL_PROOF", fixtures.operationStatus(operation));

        clock.advance(Duration.ofSeconds(1));
        challengeExpiry.run(100);
        assertEnded(operation, "EXPIRED", "EXPIRED", "LOCAL_PROOF_EXPIRED");
        // A second pass changes nothing: the terminal states are irreversible.
        challengeExpiry.run(100);
        assertEquals(1L, statusRows(operation));
        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));
    }

    @Test
    void aHubRestartInvalidatesTheChallenge() throws Exception {
        UUID operation = prepared();
        clock.advance(Duration.ofSeconds(5));
        boot(2);
        challengeExpiry.run(100);
        assertEnded(operation, "FAILED", "INVALIDATED", "HUB_RESTARTED");
        Map<String, Object> clear = displayRow(operation, "DISPLAY_OPERATION_STATUS");
        assertEquals(session, clear.get("target_device_session_id"));
    }

    @Test
    void aLostConnectionInvalidatesTheChallenge() throws Exception {
        UUID operation = prepared();
        clock.advance(Duration.ofSeconds(40));
        challengeExpiry.run(100);
        assertEnded(operation, "FAILED", "INVALIDATED", "LOCKER_OFFLINE");
    }

    @Test
    void cancellingTheReservationEndsThePreparationAndClearsTheScreen() throws Exception {
        UUID operation = prepared();
        mvc.perform(post("/api/v1/reservations/" + reservation + "/cancel").header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", key())).andExpect(status().isOk());
        assertEnded(operation, "FAILED", "INVALIDATED", "RESERVATION_CANCELLED");
    }

    private void assertEnded(UUID operation, String status, String challenge, String reason) throws Exception {
        assertEquals(status, fixtures.operationStatus(operation));
        assertEquals(challenge, challengeStatus(operation));
        assertEquals(reason, jdbc.sql("SELECT failure_reason FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(String.class).single());
        Map<String, Object> stopped = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        assertEquals("CANCELLED", stopped.get("status"));
        assertNull(stopped.get("encrypted_payload"));
        Map<String, Object> clear = displayRow(operation, "DISPLAY_OPERATION_STATUS");
        assertTrue(((Number) clear.get("display_revision")).longValue()
                > ((Number) stopped.get("display_revision")).longValue());
        JsonNode message = open(clear);
        assertEquals(status, message.get("payload").get("status").asString());
        assertEquals(reason, message.get("payload").get("reasonCode").asString());
        assertFalse(message.get("payload").has("token"));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id",
                operation));
        mvc.perform(get("/api/v1/locker-operations/" + operation).header(AUTHORIZATION, bearer(token)))
                .andExpect(jsonPath("$.status").value(status))
                .andExpect(jsonPath("$.requiredAction").value("NONE"))
                .andExpect(header().doesNotExist("Retry-After"));
    }

    private UUID prepared() throws Exception {
        String body = checkout(key()).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private ResultActions checkout(String key) throws Exception {
        return mvc.perform(post("/api/v1/reservations/" + reservation + "/checkout")
                .header(AUTHORIZATION, bearer(token)).header("Idempotency-Key", key));
    }

    private long operations() {
        return fixtures.count("SELECT count(*) FROM aegis.locker_operations WHERE reservation_id = :id", reservation);
    }

    private long statusRows(UUID operation) {
        return fixtures.count("""
                SELECT count(*) FROM aegis.hub_display_outbox
                WHERE operation_id = :id AND message_type = 'DISPLAY_OPERATION_STATUS'
                """, operation);
    }

    private String challengeStatus(UUID operation) {
        return jdbc.sql("SELECT status FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(String.class).single();
    }

    private Instant displayedAt(UUID operation) {
        return jdbc.sql("SELECT displayed_at FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(java.time.OffsetDateTime.class).optional()
                .map(java.time.OffsetDateTime::toInstant).orElse(null);
    }

    private Map<String, Object> displayRow(UUID operation, String type) {
        return jdbc.sql("""
                SELECT * FROM aegis.hub_display_outbox WHERE operation_id = :id AND message_type = :type
                ORDER BY display_revision DESC LIMIT 1
                """).param("id", operation).param("type", type).query().singleRow();
    }

    private JsonNode open(Map<String, Object> row) {
        DisplayKeyRing keys = DisplayKeyRing.parse(DISPLAY_KEY_ID + ":" + DISPLAY_KEY, DISPLAY_KEY_ID);
        byte[] plain = keys.open((String) row.get("encryption_key_id"), (byte[]) row.get("encrypted_payload"),
                DisplayAad.of((UUID) row.get("id"), (UUID) row.get("locker_id"), (UUID) row.get("operation_id"),
                        ((Number) row.get("display_revision")).longValue()));
        assertNotNull(plain);
        JsonNode message = jsonMapper.readTree(new String(plain, StandardCharsets.UTF_8));
        assertEquals(row.get("message_id").toString(), message.get("messageId").asString());
        return message;
    }

    /** A new boot of the test hub, then its first heartbeat. */
    private void boot(long bootCount) {
        session = UUID.randomUUID();
        connection = UUID.randomUUID();
        sequence = 0;
        bootCount(bootCount);
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
    }

    private long bootCount = 1;

    private void bootCount(long value) {
        bootCount = value;
    }

    private void heartbeat(String connectionStatus, String reader, String door, String lock) {
        Map<String, Object> message = envelope("HEARTBEAT");
        message.put("connectionId", connection.toString());
        message.put("firmwareVersion", "0.1.0-test");
        message.put("clockSynchronized", true);
        List<Map<String, Object>> cells = new ArrayList<>();
        jdbc.sql("SELECT id, local_address FROM aegis.compartments WHERE locker_id = :id ORDER BY local_address")
                .param("id", locker).query().listOfRows().forEach(row -> {
                    Map<String, Object> cell = new LinkedHashMap<>();
                    cell.put("compartmentId", row.get("id").toString());
                    cell.put("cellAddress", ((Number) row.get("local_address")).intValue());
                    cell.put("connectionStatus", connectionStatus);
                    cell.put("readerStatus", reader);
                    cell.put("doorState", door);
                    cell.put("lockState", lock);
                    cells.add(cell);
                });
        message.put("compartments", cells);
        assertEquals(DeviceMessageIngestion.Outcome.ACCEPTED,
                ingestion.ingest("aegis/v1/lockers/" + locker + "/status", bytes(message)));
    }

    private DeviceMessageIngestion.Outcome report(String type, UUID operation, UUID displayMessageId, UUID challenge,
            long revision, String reason, UUID from) {
        Map<String, Object> message = reportMessage(type, operation, displayMessageId, challenge, revision, reason);
        message.put("deviceSessionId", from.toString());
        return ingest(message);
    }

    private Map<String, Object> reportMessage(String type, UUID operation, UUID displayMessageId, UUID challenge,
            long revision, String reason) {
        Map<String, Object> message = envelope(type);
        message.put("operationId", operation.toString());
        message.put("compartmentId", jdbc.sql("SELECT compartment_id FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(UUID.class).single().toString());
        message.put("displayMessageId", displayMessageId.toString());
        if (challenge != null) {
            message.put("challengeId", challenge.toString());
        }
        message.put("displayRevision", revision);
        if (reason != null) {
            message.put("reason", reason);
        }
        return message;
    }

    private DeviceMessageIngestion.Outcome ingest(Map<String, Object> message) {
        return ingestion.ingest("aegis/v1/lockers/" + locker + "/events", bytes(message));
    }

    private Map<String, Object> envelope(String type) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("schemaVersion", "3.0");
        message.put("messageId", UUID.randomUUID().toString());
        message.put("type", type);
        message.put("lockerId", locker.toString());
        message.put("timestamp", clock.instant().toString());
        message.put("deviceSessionId", session.toString());
        message.put("bootCount", bootCount);
        message.put("sequence", ++sequence);
        return message;
    }

    private byte[] bytes(Map<String, Object> message) {
        return jsonMapper.writeValueAsString(message).getBytes(StandardCharsets.UTF_8);
    }
}
