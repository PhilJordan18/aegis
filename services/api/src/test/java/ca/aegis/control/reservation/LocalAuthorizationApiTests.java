package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.expectProblem;
import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

/**
 * CHK-01 local authorization (#44; document 06, section 6.5; document 09, section 15.5): one consumption, one
 * {@code AUTHORIZED} transition and one durable unlock command per challenge, whatever the replays, concurrent scans,
 * other accounts, wrong secrets and deadlines.
 */
class LocalAuthorizationApiTests extends HubChallengeApiTest {

    UUID operation;
    UUID challenge;
    String secret;

    /** A prepared checkout whose challenge the hub reported displayed 2 seconds later. */
    private void displayed() throws Exception {
        operation = prepared();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        challenge = (UUID) display.get("challenge_id");
        secret = open(display).get("payload").get("token").asString();
        clock.advance(Duration.ofSeconds(2));
        report("ACCESS_CHALLENGE_DISPLAYED", operation, (UUID) display.get("message_id"), challenge, 1, null,
                session);
    }

    @Test
    void theRightSecretAuthorizesOnceAndQueuesOneUnlockWithoutLeakingTheSecret() throws Exception {
        displayed();
        MvcResult result = authorize(key(), challenge, secret, token)
                .andExpect(status().isAccepted())
                .andExpect(header().string("Location", "/api/v1/locker-operations/" + operation))
                .andExpect(header().string("Retry-After", "1"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.status").value("AUTHORIZED"))
                .andExpect(jsonPath("$.requiredAction").value("WAIT"))
                .andExpect(jsonPath("$.authorizedAt").value(START.plusSeconds(2).toString()))
                .andExpect(jsonPath("$.expiresAt").value(START.plusSeconds(122).toString()))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertFalse(body.contains(secret));

        Map<String, Object> row = jdbc.sql("""
                SELECT status, consumed_at = closed_at AS same, failed_attempts FROM aegis.local_access_challenges
                WHERE id = :id
                """).param("id", challenge).query().singleRow();
        assertEquals("CONSUMED", row.get("status"));
        assertEquals(Boolean.TRUE, row.get("same"));
        assertEquals(1L, commands());
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.command_outbox x JOIN aegis.locker_operations o ON o.id = x.operation_id
                WHERE x.operation_id = :id AND x.command_type = 'UNLOCK_COMPARTMENT'
                  AND x.compartment_id = o.compartment_id AND x.locker_id = o.locker_id
                  AND x.expires_at = o.expires_at
                """, operation));
        // The QR ciphertext is purged once consumed (ADR-015, rule 7).
        assertNull(displayRow(operation, "DISPLAY_ACCESS_CHALLENGE").get("encrypted_payload"));
        assertEquals(1L, audits("OPERATION_AUTHORIZED"));
        assertEquals(1L, audits("LOCAL_CHALLENGE_CONSUMED"));
        assertSecretAbsent();
    }

    @Test
    void replaysReturnTheSameAnswerAndANewKeyNeverUnlocksTwice() throws Exception {
        displayed();
        String key = key();
        String first = authorize(key, challenge, secret, token).andExpect(status().isAccepted()).andReturn()
                .getResponse().getContentAsString(StandardCharsets.UTF_8);
        String replay = authorize(key, challenge, secret, token).andExpect(status().isAccepted())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertEquals(jsonMapper.readTree(first), jsonMapper.readTree(replay));
        // The same key with another body is refused; a new key finds the challenge consumed.
        expectProblem(authorize(key, challenge, wrong(), token), 409, "IDEMPOTENCY_KEY_REUSED");
        expectProblem(authorize(key(), challenge, secret, token), 409, "LOCAL_PROOF_ALREADY_USED");
        assertEquals(1L, commands());
        assertEquals(1L, audits("OPERATION_AUTHORIZED"));
    }

    @Test
    void concurrentScansConsumeTheChallengeOnce() throws Exception {
        displayed();
        int callers = 6;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<MvcResult>> results = new ArrayList<>();
        try {
            for (int i = 0; i < callers; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return authorize(key(), challenge, secret, token).andReturn();
                }));
            }
            start.countDown();
            List<String> outcomes = new ArrayList<>();
            for (Future<MvcResult> result : results) {
                MvcResult done = result.get(30, TimeUnit.SECONDS);
                outcomes.add(done.getResponse().getStatus() == 202 ? "202"
                        : JsonPath.read(done.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.code"));
            }
            assertEquals(1, outcomes.stream().filter("202"::equals).count(), outcomes.toString());
            assertEquals(callers - 1, outcomes.stream().filter("LOCAL_PROOF_ALREADY_USED"::equals).count(),
                    outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1L, commands());
        assertEquals("AUTHORIZED", fixtures.operationStatus(operation));
    }

    @Test
    void anotherAccountCanNeitherConsumeNorExhaustTheChallenge() throws Exception {
        displayed();
        String stranger = accessToken(accounts.technician());
        for (int attempt = 0; attempt < 6; attempt++) {
            expectProblem(authorize(key(), challenge, wrong(), stranger), 404, "OPERATION_NOT_FOUND");
        }
        expectProblem(authorize(key(), challenge, secret, stranger), 404, "OPERATION_NOT_FOUND");
        assertEquals(0, failedAttempts());
        assertEquals("PENDING", challengeStatus(operation));
        assertEquals(0L, audits("LOCAL_CHALLENGE_REJECTED"));
        authorize(key(), challenge, secret, token).andExpect(status().isAccepted());
    }

    @Test
    void wrongSecretsCountOnceEachAndTheFifthEndsTheAttempt() throws Exception {
        displayed();
        String refusedKey = key();
        String refused = wrong();
        expectProblem(authorize(refusedKey, challenge, refused, token), 403, "LOCAL_PROOF_INVALID")
                .andExpect(header().string("Cache-Control", "no-store"));
        // The refusal committed: its replay answers the same problem without counting it again.
        expectProblem(authorize(refusedKey, challenge, refused, token), 403, "LOCAL_PROOF_INVALID")
                .andExpect(header().string("Idempotency-Replayed", "true"));
        assertEquals(1, failedAttempts());
        for (int attempt = 2; attempt <= 4; attempt++) {
            expectProblem(authorize(key(), challenge, wrong(), token), 403, "LOCAL_PROOF_INVALID");
            assertEquals(attempt, failedAttempts());
            assertEquals("PENDING", challengeStatus(operation));
        }
        expectProblem(authorize(key(), challenge, wrong(), token), 403, "LOCAL_PROOF_INVALID");
        assertEquals(5, failedAttempts());
        assertEnded(operation, "FAILED", "INVALIDATED", "LOCAL_PROOF_ATTEMPTS_EXHAUSTED");
        assertEquals(5L, audits("LOCAL_CHALLENGE_REJECTED"));

        // The right secret no longer opens anything, and the terminal state stays.
        expectProblem(authorize(key(), challenge, secret, token), 409, "LOCAL_PROOF_INVALIDATED");
        challengeExpiry.run(100);
        assertEquals(1L, statusRows(operation));
        assertEquals(0L, commands());
        assertSecretAbsent();
    }

    @Test
    void aScanBeforeTheDisplayAcknowledgementChangesNothing() throws Exception {
        operation = prepared();
        Map<String, Object> display = displayRow(operation, "DISPLAY_ACCESS_CHALLENGE");
        challenge = (UUID) display.get("challenge_id");
        secret = open(display).get("payload").get("token").asString();
        expectProblem(authorize(key(), challenge, secret, token), 409, "LOCAL_PROOF_NOT_DISPLAYED");
        expectProblem(authorize(key(), challenge, wrong(), token), 409, "LOCAL_PROOF_NOT_DISPLAYED");
        assertEquals(0, failedAttempts());
        assertEquals("PENDING", challengeStatus(operation));
        report("ACCESS_CHALLENGE_DISPLAYED", operation, (UUID) display.get("message_id"), challenge, 1, null,
                session);
        authorize(key(), challenge, secret, token).andExpect(status().isAccepted());
    }

    @Test
    void aScanAtTheDeadlineExpiresTheAttempt() throws Exception {
        displayed();
        clock.advance(Duration.ofSeconds(58));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        String key = key();
        expectProblem(authorize(key, challenge, secret, token), 410, "LOCAL_PROOF_EXPIRED");
        assertEnded(operation, "EXPIRED", "EXPIRED", "LOCAL_PROOF_EXPIRED");
        expectProblem(authorize(key, challenge, secret, token), 410, "LOCAL_PROOF_EXPIRED")
                .andExpect(header().string("Idempotency-Replayed", "true"));
        expectProblem(authorize(key(), challenge, secret, token), 410, "LOCAL_PROOF_EXPIRED");
        assertEquals(1L, statusRows(operation));
    }

    @Test
    void aScanAfterAHubRestartInvalidatesTheAttempt() throws Exception {
        displayed();
        boot(2);
        expectProblem(authorize(key(), challenge, secret, token), 409, "LOCAL_PROOF_INVALIDATED");
        assertEnded(operation, "FAILED", "INVALIDATED", "HUB_RESTARTED");
    }

    @Test
    void contextAndFormatErrorsChangeNothing() throws Exception {
        displayed();
        expectProblem(authorize(key(), UUID.randomUUID(), secret, token), 409, "LOCAL_PROOF_CONTEXT_MISMATCH");
        expectProblem(authorize(key(), UUID.randomUUID(), secret, token, UUID.randomUUID()), 404,
                "OPERATION_NOT_FOUND");
        for (String body : List.of("", "{}", "[]", "not json", "{\"challengeId\":\"" + challenge + "\"}",
                "{\"challengeId\":\"" + challenge + "\",\"token\":\"short\"}",
                "{\"challengeId\":\"nope\",\"token\":\"" + secret + "\"}",
                "{\"challengeId\":\"" + challenge + "\",\"token\":\"" + secret + "\",\"extra\":1}",
                "{\"challengeId\":\"" + challenge + "\",\"token\":\"" + secret + "=\"}",
                "{\"challengeId\":\"" + challenge + "\",\"token\":\"" + secret + "\"," + "\"x\":\""
                        + "a".repeat(600) + "\"}")) {
            expectProblem(mvc.perform(post("/api/v1/locker-operations/" + operation + "/authorize-local")
                    .header(AUTHORIZATION, bearer(token)).header("Idempotency-Key", key())
                    .contentType(MediaType.APPLICATION_JSON).content(body)), 400, "LOCAL_PROOF_MALFORMED");
        }
        assertEquals(0, failedAttempts());
        assertEquals("PENDING", challengeStatus(operation));
        assertEquals(0L, commands());
        authorize(key(), challenge, secret, token).andExpect(status().isAccepted());
    }

    @Test
    void everyGuardIsEvaluatedAgainAtTheScan() throws Exception {
        displayed();
        heartbeat("CONNECTED", "HEALTHY", "OPEN", "UNLOCKED");
        expectProblem(authorize(key(), challenge, secret, token), 409, "COMPARTMENT_STATE_UNSAFE");
        heartbeat("CONNECTED", "FAULTED", "CLOSED", "LOCKED");
        expectProblem(authorize(key(), challenge, secret, token), 503, "DEVICE_UNAVAILABLE");
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        jdbc.sql("UPDATE aegis.assets SET operational_status = 'MAINTENANCE' WHERE id = :id").param("id", asset)
                .update();
        expectProblem(authorize(key(), challenge, secret, token), 422, "ASSET_NOT_READY");
        jdbc.sql("UPDATE aegis.assets SET operational_status = 'SERVICEABLE' WHERE id = :id").param("id", asset)
                .update();
        // A hub whose last heartbeat is older than the freshness window is offline.
        clock.advance(Duration.ofSeconds(31));
        expectProblem(authorize(key(), challenge, secret, token), 503, "LOCKER_OFFLINE");
        assertEquals(0, failedAttempts());
        assertEquals("PENDING", challengeStatus(operation));
        assertEquals("AWAITING_LOCAL_PROOF", fixtures.operationStatus(operation));
        assertEquals(0L, commands());
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        authorize(key(), challenge, secret, token).andExpect(status().isAccepted());
    }

    @Test
    void availableActionsFollowTheTableOfSection810() throws Exception {
        actions().andExpect(jsonPath("$.availableActions", containsInAnyOrder("CHECKOUT", "CANCEL")));
        heartbeat("CONNECTED", "HEALTHY", "OPEN", "UNLOCKED");
        actions().andExpect(jsonPath("$.availableActions", contains("CANCEL")));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        clock.advance(Duration.ofSeconds(31));
        actions().andExpect(jsonPath("$.availableActions", contains("CANCEL")));
        heartbeat("CONNECTED", "HEALTHY", "CLOSED", "LOCKED");
        displayed();
        // An attempt awaiting its proof holds the locker: only the cancellation remains.
        actions().andExpect(jsonPath("$.availableActions", contains("CANCEL")))
                .andExpect(jsonPath("$.currentOperationId").value(operation.toString()));
        authorize(key(), challenge, secret, token).andExpect(status().isAccepted());
        actions().andExpect(jsonPath("$.availableActions", empty()));
    }

    private ResultActions actions() throws Exception {
        return mvc.perform(get("/api/v1/reservations/" + reservation).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk());
    }

    private ResultActions authorize(String key, UUID challengeId, String value, String bearerToken) throws Exception {
        return authorize(key, challengeId, value, bearerToken, operation);
    }

    private ResultActions authorize(String key, UUID challengeId, String value, String bearerToken, UUID target)
            throws Exception {
        return mvc.perform(post("/api/v1/locker-operations/" + target + "/authorize-local")
                .header(AUTHORIZATION, bearer(bearerToken)).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(jsonMapper.writeValueAsString(Map.of("challengeId", challengeId.toString(), "token", value))));
    }

    /** A well-formed token that is not the challenge's. */
    private static String wrong() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private int failedAttempts() {
        return jdbc.sql("SELECT failed_attempts FROM aegis.local_access_challenges WHERE id = :id")
                .param("id", challenge).query(Integer.class).single();
    }

    private long commands() {
        return fixtures.count("SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :id", operation);
    }

    private long audits(String type) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events WHERE operation_id = :id AND event_type = :type
                """).param("id", operation).param("type", type).query(Long.class).single();
    }

    /** Document 09, section 21: the secret is in no audit row, no idempotency row, no error response. */
    private void assertSecretAbsent() {
        byte[] hash = jdbc.sql("SELECT token_hash FROM aegis.local_access_challenges WHERE id = :id")
                .param("id", challenge).query(byte[].class).single();
        String hex = HexFormat.of().formatHex(hash);
        for (String table : List.of("aegis.audit_events", "aegis.rest_idempotency_keys")) {
            assertEquals(0L, jdbc.sql("SELECT count(*) FROM " + table + " t WHERE t::text LIKE :secret OR t::text LIKE :hex")
                    .param("secret", "%" + secret + "%").param("hex", "%" + hex + "%").query(Long.class).single(),
                    table);
        }
    }
}
