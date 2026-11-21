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
 * unconsumed challenge.
 */
class CheckoutPreparationApiTests extends HubChallengeApiTest {

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
        // The first of the six, prepared at START, leaves the 10-minute window 234 s from now (START + 366 s).
        expectProblem(checkout(key()), 429, "LOCAL_PROOF_RATE_LIMITED")
                .andExpect(header().string("Retry-After", "234"));
        assertEquals(6L, operations());
    }

    /** Ends the open preparation at its deadline, as the expiry job does, and keeps the hub online. */
    private void expireOpenPreparation() {
        clock.advance(Duration.ofSeconds(61));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        challengeExpiry.run(100);
    }

    @Test
    void theLimitIsSixPerTenMinutesExactlyAndReplaysDoNotCount() throws Exception {
        String firstKey = key();
        String first = checkout(firstKey).andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        expireOpenPreparation();
        for (int attempt = 1; attempt < 6; attempt++) {
            checkout(key()).andExpect(status().isAccepted());
            expireOpenPreparation();
        }
        // A replay of a counted preparation answers its first response, never 429, and creates nothing.
        String replay = checkout(firstKey).andExpect(status().isAccepted())
                .andExpect(header().string("Idempotency-Replayed", "true")).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        assertEquals(jsonMapper.readTree(first), jsonMapper.readTree(replay));
        expectProblem(checkout(key()), 429, "LOCAL_PROOF_RATE_LIMITED")
                .andExpect(header().string("Retry-After", "234"));
        assertEquals(6L, operations());

        // One millisecond before the first preparation leaves the window, the limit still holds.
        clock.advance(Duration.ofMillis(233_999));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        expectProblem(checkout(key()), 429, "LOCAL_PROOF_RATE_LIMITED")
                .andExpect(header().string("Retry-After", "1"));
        clock.advance(Duration.ofMillis(1));
        checkout(key()).andExpect(status().isAccepted());
        assertEquals(7L, operations());
    }

    @Test
    void theLimitIsKeptPerTechnicianAndLocker() throws Exception {
        for (int attempt = 0; attempt < 6; attempt++) {
            checkout(key()).andExpect(status().isAccepted());
            expireOpenPreparation();
        }
        expectProblem(checkout(key()), 429, "LOCAL_PROOF_RATE_LIMITED");

        // Another technician on the same locker is not limited by this pair.
        TestAccount colleague = accounts.technician();
        UUID otherAsset = fixtures.asset(locker);
        UUID otherReservation = fixtures.reservation(otherAsset, colleague.id(), "ACTIVE", START.minusSeconds(600),
                UNTIL);
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        mvc.perform(post("/api/v1/reservations/" + otherReservation + "/checkout")
                .header(AUTHORIZATION, bearer(accessToken(colleague))).header("Idempotency-Key", key()))
                .andExpect(status().isAccepted());
        expireOpenPreparation();

        // The same technician on another locker is not limited either.
        mvc.perform(post("/api/v1/reservations/" + reservation + "/cancel").header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", key())).andExpect(status().isOk());
        UUID firstLocker = locker;
        locker = fixtures.scheduledLocker(accounts.admin().id());
        asset = fixtures.asset(locker);
        reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", clock.instant().minusSeconds(60), UNTIL);
        UUID device = fixtures.hub(locker);
        jdbc.sql("""
                UPDATE aegis.locker_devices SET provisioned_at = :past, device_session_id = NULL, boot_count = NULL
                WHERE id = :id
                """).param("past", ReservationFixtures.utc(ReservationFixtures.PAST)).param("id", device).update();
        boot(1);
        checkout(key()).andExpect(status().isAccepted());
        assertEquals(6L, fixtures.count("""
                SELECT count(*) FROM aegis.locker_operations WHERE locker_id = :id AND user_id = '"""
                + technician.id() + "'", firstLocker));
    }

    @Test
    void concurrentPreparationsAtTheBoundCountOnce() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            checkout(key()).andExpect(status().isAccepted());
            expireOpenPreparation();
        }
        int callers = 4;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<MvcResult>> results = new ArrayList<>();
        try {
            for (int i = 0; i < callers; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return checkout(key()).andReturn();
                }));
            }
            start.countDown();
            List<String> outcomes = new ArrayList<>();
            for (Future<MvcResult> result : results) {
                MvcResult done = result.get(30, TimeUnit.SECONDS);
                outcomes.add(done.getResponse().getStatus() == 202 ? "202"
                        : JsonPath.read(done.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.code"));
            }
            // The user lock serializes the count: the sixth is accepted once, the others see it.
            assertEquals(1, outcomes.stream().filter("202"::equals).count(), outcomes.toString());
            assertEquals(callers - 1, outcomes.stream().filter("LOCKER_OPERATION_IN_PROGRESS"::equals).count(),
                    outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(6L, operations());
        expireOpenPreparation();
        expectProblem(checkout(key()), 429, "LOCAL_PROOF_RATE_LIMITED");
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
}
