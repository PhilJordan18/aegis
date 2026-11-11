package ca.aegis.control.audit;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;

import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;
import tools.jackson.databind.JsonNode;

/**
 * The audit timeline of document 09, sections 19.1 and 22.2 (#53), through HTTP. Most events are inserted directly
 * with chosen instants and details: synthetic evidence of the reads, not of the mutations that would write them. Each
 * test filters on a subject it creates, since the database is shared by the run.
 */
class AdminAuditApiTests extends ApiIntegrationTest {

    static final String AUDIT = "/api/v1/admin/audit-events";

    @Autowired
    JdbcClient jdbc;

    TestAccount adminAccount;
    String admin;

    @BeforeEach
    void prepare() throws Exception {
        adminAccount = accounts.admin();
        admin = accessToken(adminAccount);
    }

    @Test
    void aWalkNeverRepeatsAndMissesOnlyEventsCommittedBehindItsCursor() throws Exception {
        UUID subject = UUID.randomUUID();
        List<Row> rows = new ArrayList<>();
        // Three events share one instant: the id breaks the tie.
        for (int second : new int[] {50, 40, 40, 40, 30}) {
            rows.add(new Row(event("RESERVATION_CREATED", "RESERVATION", subject, null, null,
                    START.minusSeconds(100 - second), "{}"), START.minusSeconds(100 - second)));
        }
        // PostgreSQL orders uuid by unsigned bytes, as the canonical strings compare; UUID.compareTo is signed.
        rows.sort(Comparator.comparing(Row::at).thenComparing(row -> row.id().toString()).reversed());
        List<String> expected = rows.stream().map(row -> row.id().toString()).toList();
        long auditBefore = auditEvents();

        JsonNode first = json(read(AUDIT + "?subjectId=" + subject + "&limit=2").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$.hasMore").value(true)));
        // No snapshot: each page is its own read. occurred_at is the mutation's clock, not its commit time, so an
        // event committed during the walk may sort anywhere. One newer than the walk's start and one behind the
        // cursor are both absent from this walk; one still ahead of the cursor is read in place.
        event("RESERVATION_CREATED", "RESERVATION", subject, null, null, START, "{}");
        UUID behind = event("RESERVATION_CREATED", "RESERVATION", subject, null, null, START.minusSeconds(55), "{}");
        UUID ahead = event("RESERVATION_CREATED", "RESERVATION", subject, null, null, START.minusSeconds(65), "{}");
        expected = new ArrayList<>(expected);
        expected.add(4, ahead.toString());
        List<String> walked = new ArrayList<>(ids(first));
        String cursor = first.get("nextCursor").asString();
        while (cursor != null) {
            JsonNode page = json(read(AUDIT + "?subjectId=" + subject + "&limit=2&cursor=" + cursor));
            walked.addAll(ids(page));
            JsonNode next = page.get("nextCursor");
            assertEquals(page.get("hasMore").asBoolean(), !next.isNull());
            cursor = next.isNull() ? null : next.asString();
        }

        assertEquals(expected, walked);
        assertFalse(walked.contains(behind.toString()));
        read(AUDIT + "?subjectId=" + subject + "&limit=100").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(8))
                .andExpect(jsonPath("$.items[2].id").value(behind.toString()));
        assertEquals(auditBefore + 3, auditEvents());
    }

    @Test
    void nestedDetailsKeepOnlyTheAllowedScalarFields() throws Exception {
        UUID subject = UUID.randomUUID();
        UUID update = event("ASSET_UPDATED", "ASSET_MODEL", subject, null, null, START.minusSeconds(30), """
                {"changes": {"name": {"from": "Old", "to": "New"},
                             "description": {"from": "free text", "to": "other free text"},
                             "manufacturer": {"from": {"nested": "object"}, "to": "Acme"},
                             "secretHash": {"from": "h1", "to": "h2"}}}""");
        UUID placement = event("ASSET_PLACEMENT_CHANGED", "ASSET", subject, null, null, START.minusSeconds(20), """
                {"from": null,
                 "to": {"placementId": "p", "lockerCode": "L-01", "reason": "free text", "extra": "x"}}""");
        UUID schedule = event("SCHEDULE_UPDATED", "OPERATING_SCHEDULE", subject, null, null, START.minusSeconds(10), """
                {"previousScheduleId": null,
                 "after": {"timeZone": "America/Toronto", "note": "free text",
                           "windows": [{"dayOfWeek": "MONDAY", "enabled": true, "opensAt": "08:00",
                                        "closesAt": "17:00", "payload": "x"}]}}""");

        read(AUDIT + "?subjectId=" + subject).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(schedule, placement, update))))
                .andExpect(jsonPath("$.items[0].details.previousScheduleId").value(nullValue()))
                .andExpect(jsonPath("$.items[0].details.after.length()").value(2))
                .andExpect(jsonPath("$.items[0].details.after.timeZone").value("America/Toronto"))
                .andExpect(jsonPath("$.items[0].details.after.windows[0].length()").value(4))
                .andExpect(jsonPath("$.items[0].details.after.windows[0].enabled").value(true))
                .andExpect(jsonPath("$.items[1].details.from").value(nullValue()))
                .andExpect(jsonPath("$.items[1].details.to.length()").value(2))
                .andExpect(jsonPath("$.items[1].details.to.lockerCode").value("L-01"))
                .andExpect(jsonPath("$.items[2].details.changes.length()").value(2))
                .andExpect(jsonPath("$.items[2].details.changes.name.to").value("New"))
                .andExpect(jsonPath("$.items[2].details.changes.manufacturer.length()").value(1))
                .andExpect(jsonPath("$.items[2].details.changes.manufacturer.to").value("Acme"))
                .andExpect(content().string(not(containsString("free text"))))
                .andExpect(content().string(not(containsString("nested"))))
                .andExpect(content().string(not(containsString("h1"))));
    }

    @Test
    void anEventIsReadWithItsActorSummaryAndFilteredDetailsOnly() throws Exception {
        UUID identifier = UUID.randomUUID();
        UUID asset = UUID.randomUUID();
        UUID assigned = event("ASSET_IDENTIFIER_ASSIGNED", "ASSET_IDENTIFIER", identifier, null, adminAccount.id(),
                START.minusSeconds(20), """
                        {"assigned": {"assetId": "%s", "type": "RFID_UHF", "value": "E2-RAW-TAG-0001"},
                         "token": "never-shown"}""".formatted(asset));
        UUID revoked = event("ASSET_UPDATED", "ASSET_IDENTIFIER", identifier, null, adminAccount.id(),
                START.minusSeconds(10), """
                        {"revoked": {"assetId": "%s", "type": "RFID_UHF", "value": "E2-RAW-TAG-0001"},
                         "revokedAt": "2026-09-28T12:59:50Z"}""".formatted(asset));
        UUID backend = event("LOCKER_ONLINE", "ASSET_IDENTIFIER", identifier, null, null, START.minusSeconds(5),
                "{\"payload\": {\"raw\": \"x\"}}");

        read(AUDIT + "?subjectId=" + identifier).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(backend, revoked, assigned))))
                .andExpect(jsonPath("$.items[0].actor").value(nullValue()))
                .andExpect(jsonPath("$.items[0].details.length()").value(0))
                .andExpect(jsonPath("$.items[1].details.revoked.assetId").value(asset.toString()))
                .andExpect(jsonPath("$.items[1].details.revokedAt").value("2026-09-28T12:59:50Z"))
                .andExpect(jsonPath("$.items[2].id").value(assigned.toString()))
                .andExpect(jsonPath("$.items[2].eventType").value("ASSET_IDENTIFIER_ASSIGNED"))
                .andExpect(jsonPath("$.items[2].actor.id").value(adminAccount.id().toString()))
                .andExpect(jsonPath("$.items[2].actor.displayName").isString())
                .andExpect(jsonPath("$.items[2].actor.length()").value(2))
                .andExpect(jsonPath("$.items[2].subjectType").value("ASSET_IDENTIFIER"))
                .andExpect(jsonPath("$.items[2].subjectId").value(identifier.toString()))
                .andExpect(jsonPath("$.items[2].operationId").value(nullValue()))
                .andExpect(jsonPath("$.items[2].fromState").value(nullValue()))
                .andExpect(jsonPath("$.items[2].toState").value(nullValue()))
                .andExpect(jsonPath("$.items[2].result").value("ACCEPTED"))
                .andExpect(jsonPath("$.items[2].reason").value(nullValue()))
                .andExpect(jsonPath("$.items[2].occurredAt").value("2026-09-28T12:59:40Z"))
                .andExpect(jsonPath("$.items[2].details.assigned.type").value("RFID_UHF"))
                .andExpect(jsonPath("$.items[2].details.length()").value(1))
                .andExpect(jsonPath("$.items[2].length()").value(12))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.hasMore").value(false))
                .andExpect(content().string(not(containsString("E2-RAW-TAG"))))
                .andExpect(content().string(not(containsString("never-shown"))))
                .andExpect(content().string(not(containsString("payload"))));
    }

    @Test
    void anAcknowledgedAnomalyIsFoundThroughItsOperation() throws Exception {
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        TestAccount technician = accounts.technician();
        UUID locker = fixtures.scheduledLocker(adminAccount.id());
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600),
                START.plusSeconds(3600));
        UUID operation = fixtures.attempt(asset, technician.id(), reservation, "ANOMALY", true,
                START.minusSeconds(300));
        UUID anomaly = fixtures.anomaly(operation, "OPEN", START.minusSeconds(200));
        mvc.perform(post("/api/v1/admin/anomalies/" + anomaly + "/acknowledge").header(AUTHORIZATION, bearer(admin))
                .header("Idempotency-Key", "audit-" + anomaly).contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"Note confidentielle de l'administrateur\"}")).andExpect(status().isOk());

        read(AUDIT + "?operationId=" + operation + "&eventType=ANOMALY_ACKNOWLEDGED").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].subjectType").value("ANOMALY"))
                .andExpect(jsonPath("$.items[0].subjectId").value(anomaly.toString()))
                .andExpect(jsonPath("$.items[0].operationId").value(operation.toString()))
                .andExpect(jsonPath("$.items[0].actor.id").value(adminAccount.id().toString()))
                .andExpect(jsonPath("$.items[0].fromState").value("OPEN"))
                .andExpect(jsonPath("$.items[0].toState").value("ACKNOWLEDGED"))
                .andExpect(jsonPath("$.items[0].occurredAt").value("2026-09-28T13:00:00Z"))
                .andExpect(jsonPath("$.items[0].details.type").value("EXPECTED_ASSET_NOT_OBSERVED"))
                .andExpect(jsonPath("$.items[0].details.severity").value("HIGH"))
                .andExpect(content().string(not(containsString("confidentielle"))));
    }

    @Test
    void everyFilterNarrowsTheTimeline() throws Exception {
        UUID subject = UUID.randomUUID();
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        TestAccount technician = accounts.technician();
        UUID asset = fixtures.assetAt(fixtures.scheduledLocker(adminAccount.id()), 1);
        UUID operation = fixtures.attempt(asset, technician.id(), fixtures.reservation(asset, technician.id(),
                "ACTIVE", START.minusSeconds(60), START.plusSeconds(600)), "REQUESTED", false, START.minusSeconds(60));
        UUID created = event("RESERVATION_CREATED", "RESERVATION", subject, null, adminAccount.id(),
                START.minusSeconds(30), "{}");
        UUID cancelled = event("RESERVATION_CANCELLED", "RESERVATION", subject, operation, null,
                START.minusSeconds(20), "{}");
        UUID other = event("ANOMALY_CREATED", "ANOMALY", subject, null, null, START.minusSeconds(10), "{}");
        String bySubject = AUDIT + "?subjectId=" + subject;

        read(bySubject).andExpect(jsonPath("$.items[*].id").value(contains(ids(other, cancelled, created))));
        read(bySubject + "&eventType=RESERVATION_CREATED")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(created))));
        read(bySubject + "&subjectType=ANOMALY").andExpect(jsonPath("$.items[*].id").value(contains(ids(other))));
        read(bySubject + "&actorUserId=" + adminAccount.id())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(created))));
        read(bySubject + "&from=" + START.minusSeconds(20) + "&to=" + START.minusSeconds(10))
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(cancelled))));
        read(bySubject + "&eventType=LOCKER_OFFLINE").andExpect(jsonPath("$.items").value(empty()))
                .andExpect(jsonPath("$.hasMore").value(false));
        read(bySubject + "&operationId=" + operation)
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(cancelled))));
    }

    @Test
    void theDefaultLimitIsFiftyAndTheBoundsAreChecked() throws Exception {
        UUID subject = UUID.randomUUID();
        for (int i = 0; i < 51; i++) {
            event("RESERVATION_CREATED", "RESERVATION", subject, null, null, START.minusSeconds(100 + i), "{}");
        }
        read(AUDIT + "?subjectId=" + subject).andExpect(jsonPath("$.items.length()").value(50))
                .andExpect(jsonPath("$.hasMore").value(true));
        read(AUDIT + "?subjectId=" + subject + "&limit=100").andExpect(jsonPath("$.items.length()").value(51))
                .andExpect(jsonPath("$.hasMore").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
        expectProblem(read(AUDIT + "?limit=0&eventType=UNKNOWN&subjectType=asset&subjectId=1-1-1-1-1"
                + "&actorUserId=x&from=2026-09-28T13:00:00Z&to=2026-09-28T13:00:00Z"), 400, "VALIDATION_ERROR")
                .andExpect(jsonPath("$.violations[*].field").value(
                        contains("actorUserId", "eventType", "limit", "subjectId", "subjectType", "to")));
        for (String limit : List.of("101", "abc", "-1", "")) {
            expectProblem(read(AUDIT + "?limit=" + limit), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[0].field").value("limit"));
        }
    }

    @Test
    void aCursorIsRefusedWhenMalformedOrReusedWithOtherFilters() throws Exception {
        UUID subject = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            event("RESERVATION_CREATED", "RESERVATION", subject, null, null, START.minusSeconds(10 + i), "{}");
        }
        String cursor = json(read(AUDIT + "?subjectId=" + subject + "&limit=1")).get("nextCursor").asString();
        assertNotNull(cursor);
        read(AUDIT + "?subjectId=" + subject + "&limit=1&cursor=" + cursor).andExpect(status().isOk());
        // The limit may change between pages; the filters may not.
        read(AUDIT + "?subjectId=" + subject + "&limit=5&cursor=" + cursor).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));

        String decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.US_ASCII);
        String forged = Base64.getUrlEncoder().withoutPadding().encodeToString(
                decoded.replaceAll("\\.[0-9a-f]+$", ".0000000000000000").getBytes(StandardCharsets.US_ASCII));
        for (String refused : List.of(AUDIT + "?subjectId=" + UUID.randomUUID() + "&cursor=" + cursor,
                AUDIT + "?subjectId=" + subject + "&eventType=RESERVATION_CREATED&cursor=" + cursor,
                AUDIT + "?cursor=" + cursor,
                AUDIT + "?subjectId=" + subject + "&cursor=" + forged,
                AUDIT + "?subjectId=" + subject + "&cursor=not*base64",
                AUDIT + "?subjectId=" + subject + "&cursor=",
                AUDIT + "?subjectId=" + subject + "&cursor=" + Base64.getUrlEncoder().encodeToString(
                        "v1.x.y.z".getBytes(StandardCharsets.US_ASCII)))) {
            expectProblem(read(refused), 400, "INVALID_CURSOR");
        }
    }

    @Test
    void onlyAnAdministratorReadsTheAudit() throws Exception {
        expectProblem(mvc.perform(get(AUDIT)), 401, "AUTH_TOKEN_INVALID");
        expectProblem(mvc.perform(get(AUDIT).header(AUTHORIZATION, bearer(accessToken(accounts.technician())))),
                403, "FORBIDDEN");
        long before = auditEvents();
        read(AUDIT).andExpect(status().isOk());
        assertEquals(before, auditEvents());
    }

    record Row(UUID id, Instant at) {
    }

    UUID event(String type, String subjectType, UUID subject, UUID operation, UUID actor, Instant at, String details) {
        return jdbc.sql("""
                INSERT INTO aegis.audit_events
                    (event_type, actor_user_id, subject_type, subject_id, operation_id, result, details, occurred_at)
                VALUES (:type, :actor, :subjectType, :subject, :operation, 'ACCEPTED', CAST(:details AS jsonb), :at)
                RETURNING id
                """).param("type", type).param("actor", actor).param("subjectType", subjectType)
                .param("subject", subject).param("operation", operation).param("details", details)
                .param("at", at.atOffset(ZoneOffset.UTC)).query(UUID.class).single();
    }

    ResultActions read(String uri) throws Exception {
        return mvc.perform(get(uri).header(AUTHORIZATION, bearer(admin)));
    }

    JsonNode json(ResultActions result) throws Exception {
        return jsonMapper.readTree(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    static List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.get("items").forEach(item -> ids.add(item.get("id").asString()));
        assertFalse(ids.isEmpty());
        return ids;
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
