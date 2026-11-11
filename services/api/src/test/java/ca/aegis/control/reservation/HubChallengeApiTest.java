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
 * A test hub brought online by real heartbeats through the ingestion, without a broker, and a technician's active
 * reservation of an asset placed in it (#43, #44, #46). Shared by the preparation and the local authorization tests.
 */
@Import(PresentAssetsConfiguration.class)
abstract class HubChallengeApiTest extends ApiIntegrationTest {

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

    void assertEnded(UUID operation, String status, String challenge, String reason) throws Exception {
        assertEquals(status, fixtures.operationStatus(operation));
        assertEquals(challenge, challengeStatus(operation));
        assertEquals(reason, jdbc.sql("SELECT failure_reason FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(String.class).single());
        Map<String, Object> stopped = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        // A displayed challenge keeps its acknowledgement; a sendable instruction is cancelled.
        assertTrue(List.of("CANCELLED", "ACKNOWLEDGED").contains(stopped.get("status")), stopped.toString());
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

    UUID prepared() throws Exception {
        String body = checkout(key()).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    ResultActions checkout(String key) throws Exception {
        return mvc.perform(post("/api/v1/reservations/" + reservation + "/checkout")
                .header(AUTHORIZATION, bearer(token)).header("Idempotency-Key", key));
    }

    long operations() {
        return fixtures.count("SELECT count(*) FROM aegis.locker_operations WHERE reservation_id = :id", reservation);
    }

    long statusRows(UUID operation) {
        return fixtures.count("""
                SELECT count(*) FROM aegis.hub_display_outbox
                WHERE operation_id = :id AND message_type = 'DISPLAY_OPERATION_STATUS'
                """, operation);
    }

    String challengeStatus(UUID operation) {
        return jdbc.sql("SELECT status FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(String.class).single();
    }

    Instant displayedAt(UUID operation) {
        return jdbc.sql("SELECT displayed_at FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(java.time.OffsetDateTime.class).optional()
                .map(java.time.OffsetDateTime::toInstant).orElse(null);
    }

    Map<String, Object> displayRow(UUID operation, String type) {
        return jdbc.sql("""
                SELECT * FROM aegis.hub_display_outbox WHERE operation_id = :id AND message_type = :type
                ORDER BY display_revision DESC LIMIT 1
                """).param("id", operation).param("type", type).query().singleRow();
    }

    JsonNode open(Map<String, Object> row) {
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
    void boot(long bootCount) {
        session = UUID.randomUUID();
        connection = UUID.randomUUID();
        sequence = 0;
        bootCount(bootCount);
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
    }

    long bootCount = 1;

    void bootCount(long value) {
        bootCount = value;
    }

    void heartbeat(String connectionStatus, String reader, String door, String lock) {
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

    DeviceMessageIngestion.Outcome report(String type, UUID operation, UUID displayMessageId, UUID challenge,
            long revision, String reason, UUID from) {
        Map<String, Object> message = reportMessage(type, operation, displayMessageId, challenge, revision, reason);
        message.put("deviceSessionId", from.toString());
        return ingest(message);
    }

    Map<String, Object> reportMessage(String type, UUID operation, UUID displayMessageId, UUID challenge,
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

    DeviceMessageIngestion.Outcome ingest(Map<String, Object> message) {
        return ingestion.ingest("aegis/v1/lockers/" + locker + "/events", bytes(message));
    }

    Map<String, Object> envelope(String type) {
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

    byte[] bytes(Map<String, Object> message) {
        return jsonMapper.writeValueAsString(message).getBytes(StandardCharsets.UTF_8);
    }
}
