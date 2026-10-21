package ca.aegis.control.shared.idempotency;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.identity.IdempotencyProbeSecurity;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * The idempotency service end to end: real transaction and real business inserts in {@code aegis.asset_models}.
 * {@link CatalogProbe}, loaded only by this test, opts in exactly as a catalog controller of document 09, section
 * 20.1, would, on dedicated test paths so it never competes with the real catalog routes. Those paths are guarded
 * by {@link IdempotencyProbeSecurity}, the administrator rule built from the application's security components.
 */
@Import({IdempotencyApiTests.CatalogProbe.class, IdempotencyProbeSecurity.class})
class IdempotencyApiTests extends ApiIntegrationTest {

    static final String MODELS = "/api/v1/admin/idempotency-probe/models";
    static final String MODEL_LOCATIONS = "/api/v1/admin/asset-models/";
    static final String REFUSED_PREFIX = "refused-";
    static final AtomicInteger executions = new AtomicInteger();
    static final Gate gate = new Gate();

    @Autowired
    JdbcClient jdbc;

    @Autowired
    DataSource dataSource;

    TestAccount admin;
    String adminToken;
    String suffix;
    ExecutorService executor;

    @BeforeEach
    void signInAsAdministrator() throws Exception {
        executions.set(0);
        admin = accounts.admin();
        adminToken = accessToken(admin);
        suffix = UUID.randomUUID().toString().substring(0, 8);
        executor = Executors.newFixedThreadPool(2);
    }

    @AfterEach
    void releaseWaitingRequests() throws InterruptedException {
        gate.release();
        executor.shutdownNow();
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));
    }

    @Test
    void aRepeatedRequestReplaysTheOriginalResponseWithoutASecondEffect() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Multimeter " + suffix;
        String firstId = UUID.randomUUID().toString();
        String secondId = UUID.randomUUID().toString();

        MockHttpServletResponse first = perform(create(adminToken, key, modelJson(name)).header("X-Request-Id", firstId));
        MockHttpServletResponse replay = perform(create(adminToken, key, """
                {
                  "tags" : [ "electrical", "handheld" ],   "manufacturer":"Fluke",
                  "name" : "%s"
                }
                """.formatted(name)).header("X-Request-Id", secondId));

        assertEquals(201, first.getStatus());
        String id = json(first).get("id").asString();
        assertEquals(MODEL_LOCATIONS + id, first.getHeader(HttpHeaders.LOCATION));
        assertEquals(MediaType.APPLICATION_JSON_VALUE, first.getContentType());
        assertNull(first.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(firstId, first.getHeader("X-Request-Id"));

        assertEquals(201, replay.getStatus());
        assertEquals(json(first), json(replay));
        assertEquals(first.getHeader(HttpHeaders.LOCATION), replay.getHeader(HttpHeaders.LOCATION));
        assertEquals(MediaType.APPLICATION_JSON_VALUE, replay.getContentType());
        assertEquals("true", replay.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(secondId, replay.getHeader("X-Request-Id"));

        assertEquals(1, executions.get());
        assertEquals(1, models(name));
        Map<String, Object> stored = jdbc.sql("""
                SELECT endpoint, status, response_status, resource_type, resource_id::text AS resource_id
                FROM aegis.rest_idempotency_keys WHERE actor_user_id = :actor AND idempotency_key = :key
                """).param("actor", admin.id()).param("key", key).query().singleRow();
        assertEquals(Map.of("endpoint", "POST /admin/idempotency-probe/models", "status", "COMPLETED", "response_status", 201,
                "resource_type", "ASSET_MODEL", "resource_id", id), Map.copyOf(stored));
    }

    @Test
    void aRepeatedArchiveReplaysItsResponse() throws Exception {
        String id = json(perform(create(adminToken, UUID.randomUUID().toString(), modelJson("Archived " + suffix))))
                .get("id").asString();
        String key = UUID.randomUUID().toString();

        MockHttpServletResponse first = perform(archive(adminToken, key, id));
        MockHttpServletResponse replay = perform(archive(adminToken, key, id));

        assertEquals(200, first.getStatus());
        assertTrue(json(first).get("archived").asBoolean());
        assertNull(first.getHeader(HttpHeaders.LOCATION));
        assertEquals(200, replay.getStatus());
        assertEquals(json(first), json(replay));
        assertNull(replay.getHeader(HttpHeaders.LOCATION));
        assertEquals("true", replay.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(2, executions.get());
    }

    @Test
    void theSameKeyWithAnotherIntentIsRefusedWithoutBusinessChange() throws Exception {
        String key = UUID.randomUUID().toString();
        assertEquals(201, perform(create(adminToken, key, modelJson("First " + suffix))).getStatus());

        MockHttpServletResponse otherBody = perform(create(adminToken, key, modelJson("Second " + suffix)));

        assertProblem(otherBody, 409, ApiError.IDEMPOTENCY_KEY_REUSED);
        assertNull(otherBody.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(0, models("Second " + suffix));
        assertEquals(1, executions.get());

        String archiveKey = UUID.randomUUID().toString();
        String archived = json(perform(create(adminToken, UUID.randomUUID().toString(), modelJson("A " + suffix))))
                .get("id").asString();
        String other = json(perform(create(adminToken, UUID.randomUUID().toString(), modelJson("B " + suffix))))
                .get("id").asString();
        assertEquals(200, perform(archive(adminToken, archiveKey, archived)).getStatus());

        assertProblem(perform(archive(adminToken, archiveKey, other)), 409, ApiError.IDEMPOTENCY_KEY_REUSED);
        assertTrue(jdbc.sql("SELECT archived_at IS NULL FROM aegis.asset_models WHERE id = :id")
                .param("id", UUID.fromString(other)).query(Boolean.class).single());
        assertEquals(4, executions.get());
    }

    @Test
    void theProbeIsReachableOnlyThroughItsTestSecurity() {
        assertFalse(IdempotencyProbeSecurity.documented("POST", MODELS));
        assertFalse(IdempotencyProbeSecurity.documented("POST", MODELS + "/" + UUID.randomUUID() + "/archive"));
    }

    @Test
    void keysAreScopedByActorAndRouteAndRightsAreCheckedBeforeAnyReplay() throws Exception {
        String key = UUID.randomUUID().toString();
        String body = modelJson("Scoped " + suffix);
        MockHttpServletResponse original = perform(create(adminToken, key, body));
        String id = json(original).get("id").asString();

        TestAccount technician = accounts.technician();
        MockHttpServletResponse forbidden = perform(create(accessToken(technician), key, body));
        assertProblem(forbidden, 403, ApiError.FORBIDDEN);
        assertFalse(forbidden.getContentAsString(StandardCharsets.UTF_8).contains(id));
        assertNull(forbidden.getHeader(IdempotencyService.REPLAYED_HEADER));
        MockHttpServletResponse anonymous = perform(post(MODELS).header(IdempotentRequest.HEADER, key)
                .contentType(MediaType.APPLICATION_JSON).content(body));
        assertProblem(anonymous, 401, ApiError.AUTH_TOKEN_INVALID);

        TestAccount otherAdmin = accounts.admin();
        MockHttpServletResponse otherActor = perform(create(accessToken(otherAdmin), key,
                modelJson("Other actor " + suffix)));
        assertEquals(201, otherActor.getStatus());
        assertNotEquals(id, json(otherActor).get("id").asString());
        assertNull(otherActor.getHeader(IdempotencyService.REPLAYED_HEADER));

        MockHttpServletResponse otherRoute = perform(archive(adminToken, key, id));
        assertEquals(200, otherRoute.getStatus());
        assertNull(otherRoute.getHeader(IdempotencyService.REPLAYED_HEADER));

        accounts.disable(admin.id());
        assertProblem(perform(create(adminToken, key, body)), 401, ApiError.AUTH_TOKEN_INVALID);

        assertEquals(3, executions.get());
        assertEquals(2, keys(admin.id()));
        assertEquals(1, keys(otherAdmin.id()));
        assertEquals(0, keys(technician.id()));
    }

    @Test
    void theKeyIsRequiredBeforeTheBodyIsRead() throws Exception {
        MockHttpServletResponse missing = perform(post(MODELS).header(AUTHORIZATION, bearer(adminToken))
                .contentType(MediaType.APPLICATION_JSON).content("{"));
        assertProblem(missing, 400, ApiError.IDEMPOTENCY_KEY_REQUIRED);
        assertProblem(perform(create(adminToken, " ", modelJson("Blank " + suffix))), 400,
                ApiError.IDEMPOTENCY_KEY_REQUIRED);

        MockHttpServletResponse tooLong = perform(create(adminToken, "k".repeat(129), modelJson("Long " + suffix)));
        assertProblem(tooLong, 400, ApiError.VALIDATION_ERROR);
        assertEquals("Idempotency-Key", json(tooLong).get("violations").get(0).get("field").asString());

        assertEquals(201, perform(create(adminToken, "k".repeat(128), modelJson("Longest " + suffix))).getStatus());
        assertEquals(1, executions.get());
        assertEquals(1, keys(admin.id()));
    }

    @Test
    void concurrentRequestsWithTheSameKeyHaveOneEffectAndEqualResponses() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Concurrent " + suffix;
        gate.hold(name);

        Future<MockHttpServletResponse> first = executor.submit(() -> perform(create(adminToken, key, modelJson(name))));
        gate.awaitEntered();
        Future<MockHttpServletResponse> second = executor.submit(() -> perform(create(adminToken, key,
                modelJson(name))));
        awaitLockWaiters(1);
        gate.release();

        List<MockHttpServletResponse> responses = List.of(first.get(30, TimeUnit.SECONDS),
                second.get(30, TimeUnit.SECONDS));
        for (MockHttpServletResponse response : responses) {
            assertEquals(201, response.getStatus());
        }
        assertEquals(json(responses.get(0)), json(responses.get(1)));
        assertEquals(responses.get(0).getHeader(HttpHeaders.LOCATION), responses.get(1).getHeader(HttpHeaders.LOCATION));
        assertNull(responses.get(0).getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals("true", responses.get(1).getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(1, executions.get());
        assertEquals(1, models(name));
        assertEquals(1, keys(admin.id()));
    }

    @Test
    void aKeyStillHeldBeyondTheLockTimeoutIsReportedInProgressWithoutEffect() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Held " + suffix;
        gate.hold(name);

        Future<MockHttpServletResponse> holder = executor.submit(() -> perform(create(adminToken, key,
                modelJson(name))));
        gate.awaitEntered();
        long start = System.nanoTime();
        MockHttpServletResponse waiting = perform(create(adminToken, key, modelJson(name)));
        Duration waited = Duration.ofNanos(System.nanoTime() - start);

        assertProblem(waiting, 409, ApiError.IDEMPOTENCY_REQUEST_IN_PROGRESS);
        assertEquals("1", waiting.getHeader(HttpHeaders.RETRY_AFTER));
        assertNull(waiting.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertTrue(waited.compareTo(IdempotencyService.LOCK_TIMEOUT.minusMillis(500)) >= 0, waited::toString);
        assertTrue(waited.compareTo(IdempotencyService.LOCK_TIMEOUT.plusSeconds(10)) < 0, waited::toString);
        assertEquals(1, executions.get());

        gate.release();
        MockHttpServletResponse completed = holder.get(30, TimeUnit.SECONDS);
        assertEquals(201, completed.getStatus());
        assertEquals(1, models(name));
        assertEquals(1, keys(admin.id()));

        MockHttpServletResponse retry = perform(create(adminToken, key, modelJson(name)));
        assertEquals(json(completed), json(retry));
        assertEquals("true", retry.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(1, executions.get());
    }

    @Test
    void aKeyExpiresTwentyFourHoursAfterItsCreation() throws Exception {
        String key = UUID.randomUUID().toString();
        String original = modelJson("Before expiry " + suffix);
        String otherIntent = modelJson("After expiry " + suffix);
        MockHttpServletResponse first = perform(create(adminToken, key, original));

        advanceAndSignInAgain(IdempotencyService.RETENTION.minus(1, ChronoUnit.MICROS));
        MockHttpServletResponse lastReplay = perform(create(adminToken, key, original));
        assertEquals(json(first), json(lastReplay));
        assertEquals("true", lastReplay.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertProblem(perform(create(adminToken, key, otherIntent)), 409, ApiError.IDEMPOTENCY_KEY_REUSED);

        advanceAndSignInAgain(Duration.of(1, ChronoUnit.MICROS));
        MockHttpServletResponse renewed = perform(create(adminToken, key, otherIntent));
        assertEquals(201, renewed.getStatus());
        assertNull(renewed.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(2, executions.get());
        assertEquals(1, models("Before expiry " + suffix));
        assertEquals(1, models("After expiry " + suffix));
        assertEquals(1, keys(admin.id()));
    }

    @Test
    void anExpiredKeyReplacedConcurrentlyRunsExactlyOneNewExecution() throws Exception {
        String key = UUID.randomUUID().toString();
        String expiredName = "Expired " + suffix;
        String name = "Replacement " + suffix;
        assertEquals(201, perform(create(adminToken, key, modelJson(expiredName))).getStatus());
        advanceAndSignInAgain(IdempotencyService.RETENTION);
        Instant renewedAt = clock.instant();
        gate.hold(name);

        Future<MockHttpServletResponse> first = executor.submit(() -> perform(create(adminToken, key, modelJson(name))));
        gate.awaitEntered();
        Future<MockHttpServletResponse> second = executor.submit(() -> perform(create(adminToken, key,
                modelJson(name))));
        awaitLockWaiters(1);
        gate.release();

        MockHttpServletResponse executed = first.get(30, TimeUnit.SECONDS);
        MockHttpServletResponse replayed = second.get(30, TimeUnit.SECONDS);
        assertEquals(201, executed.getStatus());
        assertNull(executed.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(201, replayed.getStatus());
        assertEquals("true", replayed.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(json(executed), json(replayed));
        assertEquals(2, executions.get());
        assertEquals(1, models(name));
        assertEquals(1, models(expiredName));
        assertEquals(renewedAt, jdbc.sql("""
                SELECT created_at FROM aegis.rest_idempotency_keys
                WHERE actor_user_id = :actor AND idempotency_key = :key
                """).param("actor", admin.id()).param("key", key).query(OffsetDateTime.class).single().toInstant());
    }

    /**
     * A request that waits for the lock of an expired key may find it deleted by the transaction that held it. It
     * then takes the key again instead of failing; the deleting transaction is simulated here.
     */
    @Test
    void aKeyDeletedWhileWaitingForItsLockIsTakenAgain() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Taken again " + suffix;
        assertEquals(201, perform(create(adminToken, key, modelJson("Deleted " + suffix))).getStatus());
        advanceAndSignInAgain(IdempotencyService.RETENTION);

        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock = holder.prepareStatement("""
                    SELECT id FROM aegis.rest_idempotency_keys
                    WHERE actor_user_id = ? AND idempotency_key = ? FOR UPDATE
                    """)) {
                lock.setObject(1, admin.id());
                lock.setString(2, key);
                assertTrue(lock.executeQuery().next());
            }
            Future<MockHttpServletResponse> waiting = executor.submit(() -> perform(create(adminToken, key,
                    modelJson(name))));
            awaitLockWaiters(1);
            try (PreparedStatement delete = holder.prepareStatement(
                    "DELETE FROM aegis.rest_idempotency_keys WHERE actor_user_id = ? AND idempotency_key = ?")) {
                delete.setObject(1, admin.id());
                delete.setString(2, key);
                assertEquals(1, delete.executeUpdate());
            }
            holder.commit();

            MockHttpServletResponse executed = waiting.get(30, TimeUnit.SECONDS);
            assertEquals(201, executed.getStatus());
            assertNull(executed.getHeader(IdempotencyService.REPLAYED_HEADER));
        }
        assertEquals(2, executions.get());
        assertEquals(1, models(name));
        assertEquals(1, keys(admin.id()));
    }

    @Test
    void aBusinessRefusalRollsBackTheKeyAndTheBusinessWrite() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = REFUSED_PREFIX + suffix;

        for (int attempt = 1; attempt <= 2; attempt++) {
            MockHttpServletResponse refused = perform(create(adminToken, key, modelJson(name)));
            assertProblem(refused, 400, ApiError.VALIDATION_ERROR);
            assertNull(refused.getHeader(IdempotencyService.REPLAYED_HEADER));
            assertEquals(attempt, executions.get());
            assertEquals(0, models(name));
            assertEquals(0, keys(admin.id()));
        }
    }

    /** Not recorded, a refusal is re-evaluated by a retry, which may then succeed if the state changed meanwhile. */
    @Test
    void aRetryAfterARefusalRunsAgainstTheCurrentState() throws Exception {
        String key = UUID.randomUUID().toString();
        UUID missing = UUID.randomUUID();

        assertProblem(perform(archive(adminToken, key, missing.toString())), 404, ApiError.RESOURCE_NOT_FOUND);
        assertEquals(0, keys(admin.id()));

        jdbc.sql("INSERT INTO aegis.asset_models (id, name) VALUES (:id, :name)")
                .param("id", missing).param("name", "Late " + suffix).update();
        MockHttpServletResponse archived = perform(archive(adminToken, key, missing.toString()));
        assertEquals(200, archived.getStatus());
        assertNull(archived.getHeader(IdempotencyService.REPLAYED_HEADER));
        assertEquals(2, executions.get());
        assertEquals(1, keys(admin.id()));
    }

    /** Access tokens live 60 minutes on the same clock, so moving it by a day requires a new sign-in. */
    private void advanceAndSignInAgain(Duration duration) throws Exception {
        clock.advance(duration);
        adminToken = accessToken(admin);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request).andReturn().getResponse();
    }

    private static MockHttpServletRequestBuilder create(String token, String key, String body) {
        return post(MODELS).header(AUTHORIZATION, bearer(token)).header(IdempotentRequest.HEADER, key)
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockHttpServletRequestBuilder archive(String token, String key, String id) {
        return post(MODELS + "/" + id + "/archive").header(AUTHORIZATION, bearer(token))
                .header(IdempotentRequest.HEADER, key);
    }

    private String modelJson(String name) {
        return jsonMapper.writeValueAsString(Map.of("name", name, "manufacturer", "Fluke",
                "tags", List.of("electrical", "handheld")));
    }

    private JsonNode json(MockHttpServletResponse response) throws Exception {
        return jsonMapper.readTree(response.getContentAsString(StandardCharsets.UTF_8));
    }

    private void assertProblem(MockHttpServletResponse response, int status, ApiError error) throws Exception {
        assertEquals(status, response.getStatus());
        assertTrue(MediaType.parseMediaType(response.getContentType())
                .equalsTypeAndSubtype(MediaType.APPLICATION_PROBLEM_JSON), response::getContentType);
        assertEquals(error.name(), json(response).get("code").asString());
    }

    private long models(String name) {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE name = :name").param("name", name)
                .query(Long.class).single();
    }

    private long keys(UUID actor) {
        return jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys WHERE actor_user_id = :actor")
                .param("actor", actor).query(Long.class).single();
    }

    /** Waits until other sessions of the test database block on a lock, which proves the race really overlaps. */
    private void awaitLockWaiters(int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            long waiting = jdbc.sql("""
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
                    """).query(Long.class).single();
            if (waiting >= expected) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("No concurrent request waited on the idempotency key");
    }

    /** Holds the business mutation of a chosen model name inside its transaction until the test releases it. */
    static final class Gate {

        private volatile String held;
        private volatile CountDownLatch entered = new CountDownLatch(1);
        private volatile CountDownLatch released = new CountDownLatch(1);

        void hold(String name) {
            entered = new CountDownLatch(1);
            released = new CountDownLatch(1);
            held = name;
        }

        void pass(String name) {
            if (name.equals(held)) {
                entered.countDown();
                try {
                    if (!released.await(30, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("The test never released " + name);
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                }
            }
        }

        void awaitEntered() throws InterruptedException {
            assertTrue(entered.await(10, TimeUnit.SECONDS), "The first request never reached its mutation");
        }

        void release() {
            held = null;
            released.countDown();
        }
    }

    record ProbeModelRequest(String name, String manufacturer, List<String> tags) {
    }

    record ProbeModelView(UUID id, String name, String manufacturer, List<String> tags, Instant createdAt,
            UUID executionId, boolean archived) {
    }

    /** A refusal raised after the business insert, as a use case would after a late guard. */
    static final class ProbeRefusal extends ApiException {

        ProbeRefusal() {
            super(ApiError.VALIDATION_ERROR);
        }
    }

    static final class ProbeNotFound extends ApiException {

        ProbeNotFound() {
            super(ApiError.RESOURCE_NOT_FOUND);
        }
    }

    /** Test-only handlers that create and archive asset models, opted in exactly as a production controller would. */
    @RestController
    static class CatalogProbe {

        private final IdempotencyService idempotency;
        private final JdbcClient jdbc;
        private final Clock clock;

        CatalogProbe(IdempotencyService idempotency, JdbcClient jdbc, Clock clock) {
            this.idempotency = idempotency;
            this.jdbc = jdbc;
            this.clock = clock;
        }

        @PostMapping(path = MODELS, consumes = MediaType.APPLICATION_JSON_VALUE)
        ResponseEntity<JsonNode> create(IdempotentRequest idempotent, @RequestBody ProbeModelRequest request) {
            return idempotency.execute(idempotent, request, () -> {
                executions.incrementAndGet();
                OffsetDateTime now = clock.instant().truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
                UUID id = jdbc.sql("""
                        INSERT INTO aegis.asset_models (name, manufacturer, created_at, updated_at)
                        VALUES (:name, :manufacturer, :now, :now)
                        RETURNING id
                        """)
                        .param("name", request.name()).param("manufacturer", request.manufacturer())
                        .param("now", now)
                        .query((row, number) -> row.getObject("id", UUID.class)).single();
                gate.pass(request.name());
                if (request.name().startsWith(REFUSED_PREFIX)) {
                    throw new ProbeRefusal();
                }
                return IdempotentResult.created(IdempotentResource.ASSET_MODEL, id, new ProbeModelView(id,
                        request.name(), request.manufacturer(), request.tags(), now.toInstant(), UUID.randomUUID(),
                        false));
            });
        }

        @PostMapping(MODELS + "/{modelId}/archive")
        ResponseEntity<JsonNode> archive(IdempotentRequest idempotent, @PathVariable UUID modelId) {
            return idempotency.execute(idempotent, () -> {
                executions.incrementAndGet();
                OffsetDateTime now = clock.instant().truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
                ProbeModelView archived = jdbc.sql("""
                        UPDATE aegis.asset_models SET archived_at = :now, updated_at = :now
                        WHERE id = :id AND archived_at IS NULL
                        RETURNING id, name, manufacturer, created_at
                        """)
                        .param("now", now).param("id", modelId)
                        .query((row, number) -> new ProbeModelView(row.getObject("id", UUID.class),
                                row.getString("name"), row.getString("manufacturer"), List.of(),
                                row.getObject("created_at", OffsetDateTime.class).toInstant(), UUID.randomUUID(),
                                true))
                        .optional()
                        .orElseThrow(ProbeNotFound::new);
                return IdempotentResult.ok(archived);
            });
        }
    }
}
