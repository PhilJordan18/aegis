package ca.aegis.control.anomaly;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultActions;

import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Anomaly administration of document 09, sections 8.7 and 18 (#52), through HTTP. Anomalies, their operations and
 * observations are inserted as the physical chain would leave them: synthetic evidence of these routes only, not of a
 * detected physical fault. Each test filters on the asset it creates, since the database is shared by the run.
 */
class AdminAnomalyApiTests extends ApiIntegrationTest {

    static final String ANOMALIES = "/api/v1/admin/anomalies";

    @Autowired
    JdbcClient jdbc;

    ReservationFixtures fixtures;
    TestAccount technician;
    TestAccount adminAccount;
    String admin;
    UUID locker;
    ExecutorService executor;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        technician = accounts.technician();
        adminAccount = accounts.admin();
        admin = accessToken(adminAccount);
        locker = fixtures.scheduledLocker(adminAccount.id());
        executor = Executors.newFixedThreadPool(2);
    }

    @AfterEach
    void stopExecutor() throws InterruptedException {
        executor.shutdownNow();
        executor.awaitTermination(10, TimeUnit.SECONDS);
    }

    @Test
    void aResolvedAnomalyIsReadWithNormalizedEvidenceOnly() throws Exception {
        Attempt attempt = anomalousAttempt(1);
        UUID anomaly = fixtures.anomaly(attempt.id(), "RESOLVED", START.minusSeconds(240));
        UUID observation = jdbc.sql("SELECT resolution_evidence_observation_id FROM aegis.anomalies WHERE id = :id")
                .param("id", anomaly).query(UUID.class).single();
        String rawIdentifier = jdbc.sql("SELECT identifier_value FROM aegis.physical_observations WHERE id = :id")
                .param("id", observation).query(String.class).single();
        long auditBefore = auditEvents();

        read(ANOMALIES + "/" + anomaly).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(anomaly.toString()))
                .andExpect(jsonPath("$.type").value("EXPECTED_ASSET_NOT_OBSERVED"))
                .andExpect(jsonPath("$.severity").value("HIGH"))
                .andExpect(jsonPath("$.status").value("RESOLVED"))
                .andExpect(jsonPath("$.lockerOperationId").value(attempt.id().toString()))
                .andExpect(jsonPath("$.assetId").value(attempt.asset().toString()))
                .andExpect(jsonPath("$.compartmentId").isString())
                .andExpect(jsonPath("$.detectedAt").value("2026-09-28T12:56:00Z"))
                .andExpect(jsonPath("$.acknowledgedAt").value(nullValue()))
                .andExpect(jsonPath("$.acknowledgedBy").value(nullValue()))
                .andExpect(jsonPath("$.acknowledgementNote").value(nullValue()))
                .andExpect(jsonPath("$.resolvedAt").value("2026-09-28T12:57:00Z"))
                .andExpect(jsonPath("$.resolutionEvidenceObservationId").value(observation.toString()))
                .andExpect(jsonPath("$.resolutionNote").value("Actif détecté dans sa cellule"))
                .andExpect(jsonPath("$.summary").value("L'actif attendu n'a pas été observé dans sa cellule."))
                .andExpect(jsonPath("$.length()").value(16))
                .andExpect(jsonPath("$.evidence", hasSize(1)))
                .andExpect(jsonPath("$.evidence[0].observationId").value(observation.toString()))
                .andExpect(jsonPath("$.evidence[0].type").value("ASSET_IDENTIFIER_DETECTED"))
                .andExpect(jsonPath("$.evidence[0].operationId").value(attempt.id().toString()))
                .andExpect(jsonPath("$.evidence[0].observedAt").value("2026-09-28T12:57:00Z"))
                .andExpect(jsonPath("$.evidence[0].receivedAt").isString())
                .andExpect(jsonPath("$.evidence[0].length()").value(6))
                .andExpect(content().string(not(containsString(rawIdentifier))))
                .andExpect(content().string(not(containsString("details"))))
                .andExpect(content().string(not(containsString("payload"))));
        // The list item is the AnomalyView of section 8.7, without evidence.
        read(ANOMALIES + "?assetId=" + attempt.asset()).andExpect(jsonPath("$.items[0].length()").value(15));
        assertEquals(auditBefore, auditEvents());
    }

    @Test
    void anomaliesAreListedLatestFirstWithEveryFilter() throws Exception {
        Attempt attempt = anomalousAttempt(1);
        UUID onOperation = fixtures.anomaly(attempt.id(), "OPEN", START.minusSeconds(200));
        UUID older = rawAnomaly(attempt.asset(), "UNEXPECTED_ASSET_OBSERVED", "LOW", START.minusSeconds(500));
        UUID newest = rawAnomaly(attempt.asset(), "INCONSISTENT_PHYSICAL_STATE", "MEDIUM", START.minusSeconds(10));
        String byAsset = ANOMALIES + "?assetId=" + attempt.asset();

        read(byAsset).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(newest, onOperation, older))))
                .andExpect(jsonPath("$.totalItems").value(3));
        read(byAsset + "&severity=LOW").andExpect(jsonPath("$.items[*].id").value(contains(ids(older))));
        read(byAsset + "&type=INCONSISTENT_PHYSICAL_STATE")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(newest))));
        read(ANOMALIES + "?lockerOperationId=" + attempt.id())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(onOperation))));
        read(byAsset + "&status=OPEN&from=" + START.minusSeconds(500) + "&to=" + START.minusSeconds(10))
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(onOperation, older))));
        read(byAsset + "&status=RESOLVED").andExpect(jsonPath("$.items").value(empty()));
        read(byAsset + "&size=2&page=1").andExpect(jsonPath("$.items[*].id").value(contains(ids(older))))
                .andExpect(jsonPath("$.totalPages").value(2));
        expectProblem(read(ANOMALIES + "?status=CLOSED&type=DOOR&severity=high&lockerOperationId=x"), 400,
                "VALIDATION_ERROR")
                .andExpect(jsonPath("$.violations[*].field").value(
                        contains("lockerOperationId", "severity", "status", "type")));
    }

    @Test
    void acknowledgementRecordsTheAdministratorAndNoteWithoutResolvingAnything() throws Exception {
        Attempt attempt = anomalousAttempt(1);
        UUID anomaly = fixtures.anomaly(attempt.id(), "OPEN", START.minusSeconds(200));
        String note = "Inspection du compartiment planifiée avec le responsable du laboratoire.";
        long auditBefore = auditEvents();

        acknowledge(anomaly, "ack-" + anomaly, note).andExpect(status().isOk())
                .andExpect(header().doesNotExist(IdempotencyService.REPLAYED_HEADER))
                .andExpect(jsonPath("$.id").value(anomaly.toString()))
                .andExpect(jsonPath("$.status").value("ACKNOWLEDGED"))
                .andExpect(jsonPath("$.acknowledgedAt").value("2026-09-28T13:00:00Z"))
                .andExpect(jsonPath("$.acknowledgedBy.id").value(adminAccount.id().toString()))
                .andExpect(jsonPath("$.acknowledgedBy.displayName").isString())
                .andExpect(jsonPath("$.acknowledgedBy.length()").value(2))
                .andExpect(jsonPath("$.acknowledgementNote").value(note))
                .andExpect(jsonPath("$.resolvedAt").value(nullValue()))
                .andExpect(jsonPath("$.resolutionEvidenceObservationId").value(nullValue()))
                .andExpect(jsonPath("$.length()").value(15));

        assertEquals(auditBefore + 1, auditEvents());
        Map<String, Object> event = jdbc.sql("""
                SELECT event_type, actor_user_id, subject_type, subject_id, operation_id, from_state, to_state,
                       result, details::text AS details
                FROM aegis.audit_events WHERE subject_id = :id
                """).param("id", anomaly).query().singleRow();
        assertEquals("ANOMALY_ACKNOWLEDGED", event.get("event_type"));
        assertEquals(adminAccount.id(), event.get("actor_user_id"));
        assertEquals("ANOMALY", event.get("subject_type"));
        assertEquals(attempt.id(), event.get("operation_id"));
        assertEquals("OPEN", event.get("from_state"));
        assertEquals("ACKNOWLEDGED", event.get("to_state"));
        assertEquals("ACCEPTED", event.get("result"));
        assertEquals(false, ((String) event.get("details")).contains("Inspection"));
        // Acknowledged is not resolved, and nothing else moved.
        assertEquals("ACKNOWLEDGED", anomalyStatus(anomaly));
        assertEquals("ANOMALY", fixtures.operationStatus(attempt.id()));
        assertEquals("ACTIVE", fixtures.reservationStatus(attempt.reservation()));
        read(ANOMALIES + "/" + anomaly).andExpect(jsonPath("$.status").value("ACKNOWLEDGED"))
                .andExpect(jsonPath("$.acknowledgementNote").value(note));
    }

    @Test
    void aReplayIsAnsweredOnceAndASecondAcknowledgementKeepsTheFirstNote() throws Exception {
        UUID anomaly = fixtures.anomaly(anomalousAttempt(1).id(), "OPEN", START.minusSeconds(200));
        String key = "ack-" + anomaly;
        MockHttpServletResponse first = acknowledge(anomaly, key, "Première note").andExpect(status().isOk())
                .andReturn().getResponse();
        long auditAfterFirst = auditEvents();

        clock.set(START.plusSeconds(30));
        MockHttpServletResponse replay = acknowledge(anomaly, key, "Première note").andExpect(status().isOk())
                .andExpect(header().string(IdempotencyService.REPLAYED_HEADER, "true"))
                .andReturn().getResponse();
        // The stored body is replayed as JSON; only its member order may differ.
        assertEquals(jsonMapper.readTree(first.getContentAsString(StandardCharsets.UTF_8)),
                jsonMapper.readTree(replay.getContentAsString(StandardCharsets.UTF_8)));
        expectProblem(acknowledge(anomaly, key, "Autre note"), 409, "IDEMPOTENCY_KEY_REUSED");
        expectProblem(acknowledge(anomaly, "other-" + anomaly, "Autre note"), 409, "ANOMALY_NOT_ACKNOWLEDGEABLE");

        assertEquals(auditAfterFirst, auditEvents());
        read(ANOMALIES + "/" + anomaly).andExpect(jsonPath("$.acknowledgementNote").value("Première note"))
                .andExpect(jsonPath("$.acknowledgedAt").value("2026-09-28T13:00:00Z"));
    }

    @Test
    void concurrentAcknowledgementsWithDistinctKeysSucceedExactlyOnce() throws Exception {
        UUID anomaly = fixtures.anomaly(anomalousAttempt(1).id(), "OPEN", START.minusSeconds(200));
        long auditBefore = auditEvents();
        CountDownLatch start = new CountDownLatch(1);
        List<CompletableFuture<Integer>> attempts = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            String key = "race-" + i + "-" + anomaly;
            String note = "Note " + i;
            attempts.add(CompletableFuture.supplyAsync(() -> {
                try {
                    start.await();
                    return acknowledge(anomaly, key, note).andReturn().getResponse().getStatus();
                } catch (Exception failure) {
                    throw new IllegalStateException(failure);
                }
            }, executor));
        }
        start.countDown();
        List<Integer> statuses = attempts.stream().map(CompletableFuture::join).sorted().toList();

        assertEquals(List.of(200, 409), statuses);
        assertEquals(auditBefore + 1, auditEvents());
        assertEquals("ACKNOWLEDGED", anomalyStatus(anomaly));
    }

    @Test
    void refusedAcknowledgementsChangeNothing() throws Exception {
        Attempt resolvedAttempt = anomalousAttempt(1);
        UUID resolved = fixtures.anomaly(resolvedAttempt.id(), "RESOLVED", START.minusSeconds(240));
        UUID open = fixtures.anomaly(anomalousAttempt(2).id(), "OPEN", START.minusSeconds(200));
        long auditBefore = auditEvents();

        expectProblem(acknowledge(resolved, "k1-" + resolved, "Note"), 409, "ANOMALY_ALREADY_RESOLVED");
        expectProblem(acknowledge(UUID.randomUUID(), "k2-" + open, "Note"), 404, "RESOURCE_NOT_FOUND");
        expectProblem(mvc.perform(post(ANOMALIES + "/" + open + "/acknowledge").header(AUTHORIZATION, bearer(admin))
                .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Note\"}")), 400,
                "IDEMPOTENCY_KEY_REQUIRED");
        for (String body : List.of("{}", "{\"note\":null}", "{\"note\":\"   \"}", "{\"note\":\"a\\u0000b\"}",
                jsonMapper.writeValueAsString(Map.of("note", "x".repeat(501))))) {
            expectProblem(acknowledgeRaw(open, "k3-" + UUID.randomUUID(), body), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[0].field").value("note"));
        }
        expectProblem(acknowledgeRaw(open, "k4-" + open, "{\"note\":\"Note\",\"resolve\":true}"), 400,
                "VALIDATION_ERROR").andExpect(jsonPath("$.violations[0].code").value("UNKNOWN_FIELD"));

        assertEquals(auditBefore, auditEvents());
        assertEquals("RESOLVED", anomalyStatus(resolved));
        assertEquals("OPEN", anomalyStatus(open));
        assertEquals(0L, jdbc.sql("""
                SELECT count(*) FROM aegis.anomalies WHERE id = :id AND acknowledgement_note IS NOT NULL
                """).param("id", open).query(Long.class).single());
        // The longest documented note is accepted, line breaks included.
        String longest = "Ligne 1\n" + "y".repeat(492);
        acknowledge(open, "k5-" + open, longest).andExpect(status().isOk())
                .andExpect(jsonPath("$.acknowledgementNote").value(longest));
    }

    @Test
    void onlyAnAdministratorReadsOrAcknowledgesAnomalies() throws Exception {
        UUID anomaly = fixtures.anomaly(anomalousAttempt(1).id(), "OPEN", START.minusSeconds(200));
        String technicianToken = accessToken(technician);

        for (String route : List.of(ANOMALIES, ANOMALIES + "/" + anomaly)) {
            expectProblem(mvc.perform(get(route)), 401, "AUTH_TOKEN_INVALID");
            expectProblem(mvc.perform(get(route).header(AUTHORIZATION, bearer(technicianToken))), 403, "FORBIDDEN");
        }
        String acknowledge = ANOMALIES + "/" + anomaly + "/acknowledge";
        expectProblem(mvc.perform(post(acknowledge).header("Idempotency-Key", "anon-" + anomaly)
                .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Note\"}")), 401, "AUTH_TOKEN_INVALID");
        expectProblem(mvc.perform(post(acknowledge).header(AUTHORIZATION, bearer(technicianToken))
                .header("Idempotency-Key", "tech-" + anomaly).contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"Note\"}")), 403, "FORBIDDEN");
        assertEquals("OPEN", anomalyStatus(anomaly));
    }

    record Attempt(UUID id, UUID asset, UUID reservation) {
    }

    /** A checkout attempt that ended in {@code ANOMALY} after its command was sent, on a new asset. */
    Attempt anomalousAttempt(int address) {
        // One ACTIVE reservation per technician: every attempt belongs to its own technician.
        UUID user = address == 1 ? technician.id() : accounts.technician().id();
        UUID asset = fixtures.assetAt(locker, address);
        UUID reservation = fixtures.reservation(asset, user, "ACTIVE", START.minusSeconds(600),
                START.plusSeconds(3600));
        return new Attempt(fixtures.attempt(asset, user, reservation, "ANOMALY", true, START.minusSeconds(300)),
                asset, reservation);
    }

    /** An anomaly of {@code asset} raised outside any operation. */
    UUID rawAnomaly(UUID asset, String type, String severity, Instant at) {
        return jdbc.sql("""
                INSERT INTO aegis.anomalies (type, severity, asset_id, detected_at)
                VALUES (:type, :severity, :asset, :at) RETURNING id
                """).param("type", type).param("severity", severity).param("asset", asset)
                .param("at", at.atOffset(ZoneOffset.UTC)).query(UUID.class).single();
    }

    ResultActions acknowledge(UUID anomaly, String key, String note) throws Exception {
        return acknowledgeRaw(anomaly, key, jsonMapper.writeValueAsString(Map.of("note", note)));
    }

    ResultActions acknowledgeRaw(UUID anomaly, String key, String body) throws Exception {
        return mvc.perform(post(ANOMALIES + "/" + anomaly + "/acknowledge").header(AUTHORIZATION, bearer(admin))
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    ResultActions read(String uri) throws Exception {
        return mvc.perform(get(uri).header(AUTHORIZATION, bearer(admin)));
    }

    String anomalyStatus(UUID anomaly) {
        return jdbc.sql("SELECT status FROM aegis.anomalies WHERE id = :id").param("id", anomaly)
                .query(String.class).single();
    }

    long auditEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    static String[] ids(UUID... ids) {
        return Arrays.stream(ids).map(UUID::toString).toArray(String[]::new);
    }

    static ResultActions expectProblem(ResultActions result, int status, String code) throws Exception {
        return result.andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }
}
