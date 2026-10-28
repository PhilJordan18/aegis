package ca.aegis.control.reservation;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.Role;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * RES-01 through HTTP (document 09, sections 14.1 to 14.3, 20 and 26.3), with every asset physically present so that
 * readiness can be {@code READY}. The clock starts on Monday 28 September 2026 at 09:00 in Toronto; the test lockers
 * are open every day from 08:00 to 17:00 there, that is until 21:00Z.
 */
@Import(PresentAssetsConfiguration.class)
class ReservationApiTests extends ApiIntegrationTest {

    static final String RESERVATIONS = "/api/v1/reservations";
    static final String MINE = "/api/v1/me/reservation";
    static final Instant CLOSING = Instant.parse("2026-09-28T21:00:00Z");
    static final Instant UNTIL = Instant.parse("2026-09-28T15:30:00Z");

    @Autowired
    JdbcClient jdbc;

    ReservationFixtures fixtures;
    TestAccount technician;
    String token;
    UUID locker;
    UUID asset;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        technician = accounts.technician();
        token = accessToken(technician);
        locker = fixtures.scheduledLocker(accounts.admin().id());
        asset = fixtures.asset(locker);
    }

    @Test
    void aReadyAssetIsReservedFromNowWithItsAuditInTheSameTransaction() throws Exception {
        MvcResult result = reserve(token, UUID.randomUUID().toString(), asset, UNTIL)
                .andExpect(status().isCreated())
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.asset.id").value(asset.toString()))
                .andExpect(jsonPath("$.asset.placement.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.asset.readiness").doesNotExist())
                .andExpect(jsonPath("$.userId").value(technician.id().toString()))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.cancelledAt").value(nullValue()))
                .andExpect(jsonPath("$.fulfilledAt").value(nullValue()))
                .andExpect(jsonPath("$.expiredAt").value(nullValue()))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        String id = JsonPath.read(body, "$.id");
        assertEquals("/api/v1/reservations/" + id, result.getResponse().getHeader("Location"));
        assertEquals(START, Instant.parse(JsonPath.read(body, "$.reservedFrom")));
        assertEquals(START, Instant.parse(JsonPath.read(body, "$.createdAt")));
        assertEquals(UNTIL, Instant.parse(JsonPath.read(body, "$.reservedUntil")));

        UUID reservation = UUID.fromString(id);
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'RESERVATION_CREATED' AND subject_type = 'RESERVATION' AND subject_id = :id
                  AND from_state IS NULL AND to_state IS NULL AND result = 'ACCEPTED'
                  AND details ->> 'status' = 'ACTIVE'
                  AND details ->> 'assetId' = (SELECT asset_id::text FROM aegis.reservations WHERE id = :id)
                """, reservation));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events e JOIN aegis.reservations r ON r.id = e.subject_id
                WHERE r.id = :id AND e.actor_user_id = r.user_id AND e.occurred_at = r.created_at
                """, reservation));
        // A reservation never opens a compartment: no locker operation exists for the asset.
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.locker_operations WHERE asset_id = :id", asset));

        mvc.perform(get(MINE).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(get(RESERVATIONS + "/" + id).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.asset.assetCode").isString());
        mvc.perform(get("/api/v1/assets/" + asset).header(AUTHORIZATION, bearer(token)))
                .andExpect(jsonPath("$.availability").value("RESERVED"));
    }

    @Test
    void aReservationMayEndExactlyAtClosingButNotAfter() throws Exception {
        expectProblem(reserve(token, key(), asset, CLOSING.plusMillis(1)), 422, "RESERVATION_END_AFTER_CLOSING");
        assertEquals(0L, activeReservationsOf(asset));

        reserve(token, key(), asset, CLOSING).andExpect(status().isCreated());
        assertEquals(1L, activeReservationsOf(asset));
    }

    @Test
    void aRequestOutsideTheOpenWindowIsRefused() throws Exception {
        expectProblem(reserve(at(Instant.parse("2026-09-28T11:59:59Z")), key(), asset, UNTIL), 422,
                "OUTSIDE_OPERATING_HOURS");
        expectProblem(reserve(at(CLOSING), key(), asset, CLOSING.plusSeconds(60)), 422, "OUTSIDE_OPERATING_HOURS");

        reserve(at(Instant.parse("2026-09-28T12:00:00Z")), key(), asset, UNTIL).andExpect(status().isCreated());
    }

    @Test
    void aClosedDayOrALockerWithoutScheduleHasNoOpenWindow() throws Exception {
        UUID closed = fixtures.locker();
        fixtures.schedule(closed, accounts.admin().id(), false);
        expectProblem(reserve(token, key(), fixtures.asset(closed), UNTIL), 422, "OUTSIDE_OPERATING_HOURS");
        expectProblem(reserve(token, key(), fixtures.asset(fixtures.locker()), UNTIL), 422,
                "OUTSIDE_OPERATING_HOURS");
    }

    @Test
    void anEndThatIsNotAfterNowIsAValidationError() throws Exception {
        expectProblem(reserve(token, key(), asset, START), 400, "VALIDATION_ERROR")
                .andExpect(jsonPath("$.violations[0].field").value("reservedUntil"));
        expectProblem(reserve(token, key(), asset, START.minusSeconds(1)), 400, "VALIDATION_ERROR");
    }

    @Test
    void aTechnicianHoldsAtMostOneActiveReservation() throws Exception {
        reserve(token, key(), asset, UNTIL).andExpect(status().isCreated());
        expectProblem(reserve(token, key(), fixtures.asset(locker), UNTIL), 409,
                "USER_ALREADY_HAS_ACTIVE_RESERVATION");
    }

    @Test
    void anAssetHoldsAtMostOneActiveReservation() throws Exception {
        reserve(token, key(), asset, UNTIL).andExpect(status().isCreated());
        String other = accessToken(accounts.technician());
        expectProblem(reserve(other, key(), asset, UNTIL), 409, "ASSET_ALREADY_RESERVED");
    }

    @Test
    void aTerminalReservationDoesNotBlockANewOne() throws Exception {
        fixtures.reservation(asset, technician.id(), "CANCELLED", START.minusSeconds(3600), START.minusSeconds(60));
        fixtures.reservation(asset, technician.id(), "EXPIRED", START.minusSeconds(7200), START.minusSeconds(3600));
        reserve(token, key(), asset, UNTIL).andExpect(status().isCreated());
    }

    @Test
    void anAssetWithAnOpenLoanIsRefused() throws Exception {
        fixtures.loan(asset, accounts.technician().id(), START.minusSeconds(3600));
        expectProblem(reserve(token, key(), asset, UNTIL), 409, "ASSET_HAS_OPEN_LOAN");
    }

    @Test
    void anInsufficientAccessLevelIsForbidden() throws Exception {
        UUID restricted = fixtures.asset(locker, "RESTRICTED", "SERVICEABLE", false, null);
        expectProblem(reserve(token, key(), restricted, UNTIL), 403, "ASSET_ACCESS_DENIED");

        TestAccount cleared = accounts.create(Role.TECHNICIAN, AccessLevel.RESTRICTED);
        reserve(accessToken(cleared), key(), restricted, UNTIL).andExpect(status().isCreated());
    }

    @Test
    void anUnreadyAssetIsRefusedWithItsReadinessReasons() throws Exception {
        UUID expired = fixtures.asset(locker, "STANDARD", "SERVICEABLE", true, START.minusSeconds(1));
        expectProblem(reserve(token, key(), expired, UNTIL), 422, "ASSET_NOT_READY")
                .andExpect(jsonPath("$.reasons").value(contains("CALIBRATION_EXPIRED")));
        UUID damaged = fixtures.asset(locker, "STANDARD", "DAMAGED", false, null);
        expectProblem(reserve(token, key(), damaged, UNTIL), 422, "ASSET_NOT_READY")
                .andExpect(jsonPath("$.reasons").value(contains("DAMAGED")));
        jdbc.sql("UPDATE aegis.assets SET archived_at = now() WHERE id = :id").param("id", asset).update();
        expectProblem(reserve(token, key(), asset, UNTIL), 422, "ASSET_NOT_READY")
                .andExpect(jsonPath("$.reasons").value(contains("NOT_AVAILABLE")));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE user_id = :id",
                technician.id()));
    }

    @Test
    void anAssetWithoutExpectedPlacementCannotBeProvenPresent() throws Exception {
        expectProblem(reserve(token, key(), fixtures.asset(null), UNTIL), 422, "ASSET_NOT_READY")
                .andExpect(jsonPath("$.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")));
    }

    @Test
    void anUnknownAssetIsNotFound() throws Exception {
        expectProblem(reserve(token, key(), UUID.randomUUID(), UNTIL), 404, "ASSET_NOT_FOUND");
    }

    /** Document 09, section 14.1: when several checks fail, the first one in the documented order is reported. */
    @Test
    void theFirstFailingCheckInTheDocumentedOrderIsReported() throws Exception {
        UUID other = accounts.technician().id();
        UUID holder = accounts.technician().id();
        fixtures.reservation(fixtures.asset(locker), technician.id(), "ACTIVE", START, UNTIL);

        // An end that is not after now, then an unknown asset, come before the technician's own reservation.
        expectProblem(reserve(token, key(), UUID.randomUUID(), START), 400, "VALIDATION_ERROR");
        expectProblem(reserve(token, key(), UUID.randomUUID(), UNTIL), 404, "ASSET_NOT_FOUND");

        // The technician's reservation, then the asset's, then its open loan.
        UUID reservedAndBorrowed = fixtures.asset(locker);
        fixtures.loan(reservedAndBorrowed, holder, START.minusSeconds(3600));
        fixtures.reservation(reservedAndBorrowed, other, "ACTIVE", START, UNTIL);
        expectProblem(reserve(token, key(), reservedAndBorrowed, UNTIL), 409,
                "USER_ALREADY_HAS_ACTIVE_RESERVATION");
        TestAccount free = accounts.technician();
        String freeToken = accessToken(free);
        expectProblem(reserve(freeToken, key(), reservedAndBorrowed, UNTIL), 409, "ASSET_ALREADY_RESERVED");

        // The end of the open window, then the access level, then readiness, then the missing placement.
        UUID restrictedExpired = fixtures.asset(locker, "RESTRICTED", "SERVICEABLE", true, START.minusSeconds(1));
        expectProblem(reserve(freeToken, key(), restrictedExpired, CLOSING.plusMillis(1)), 422,
                "RESERVATION_END_AFTER_CLOSING");
        expectProblem(reserve(freeToken, key(), restrictedExpired, UNTIL), 403, "ASSET_ACCESS_DENIED");
        UUID unplacedExpired = fixtures.asset(null, "STANDARD", "SERVICEABLE", true, START.minusSeconds(1));
        expectProblem(reserve(freeToken, key(), unplacedExpired, UNTIL), 422, "ASSET_NOT_READY")
                .andExpect(jsonPath("$.reasons").value(contains("CALIBRATION_EXPIRED")));

        // Before opening: the open loan comes before the window, and the window before the access level.
        UUID borrowed = fixtures.asset(locker);
        fixtures.loan(borrowed, holder, START.minusSeconds(3600));
        clock.set(Instant.parse("2026-09-28T11:59:59Z"));
        String early = accessToken(free);
        expectProblem(reserve(early, key(), borrowed, UNTIL), 409, "ASSET_HAS_OPEN_LOAN");
        expectProblem(reserve(early, key(), restrictedExpired, UNTIL), 422, "OUTSIDE_OPERATING_HOURS");

        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE user_id = :id", free.id()));
    }

    @Test
    void theSameKeyAndBodyReplayTheFirstResponseWithoutASecondReservation() throws Exception {
        String key = key();
        MvcResult first = reserve(token, key, asset, UNTIL).andExpect(status().isCreated()).andReturn();
        // A refusal is never what a replay returns: the recorded success is.
        MvcResult replay = reserve(token, key, asset, UNTIL)
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn();

        assertEquals(first.getResponse().getHeader("Location"), replay.getResponse().getHeader("Location"));
        assertEquals(jsonMapper.readTree(first.getResponse().getContentAsString(StandardCharsets.UTF_8)),
                jsonMapper.readTree(replay.getResponse().getContentAsString(StandardCharsets.UTF_8)));
        assertEquals(1L, activeReservationsOf(asset));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'RESERVATION_CREATED' AND actor_user_id = :id
                """, technician.id()));
    }

    @Test
    void theSameKeyWithAnotherBodyIsRefused() throws Exception {
        String key = key();
        reserve(token, key, asset, UNTIL).andExpect(status().isCreated());
        expectProblem(reserve(token, key, asset, UNTIL.plusSeconds(60)), 409, "IDEMPOTENCY_KEY_REUSED");
        expectProblem(reserve(token, key, fixtures.asset(locker), UNTIL), 409, "IDEMPOTENCY_KEY_REUSED");
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE user_id = :id",
                technician.id()));
    }

    @Test
    void aRefusalIsNotRecordedSoTheSameKeyRunsAgainstTheCurrentState() throws Exception {
        String key = key();
        expectProblem(reserve(at(Instant.parse("2026-09-28T11:00:00Z")), key, asset, UNTIL), 422,
                "OUTSIDE_OPERATING_HOURS");
        reserve(at(START), key, asset, UNTIL).andExpect(status().isCreated())
                .andExpect(header().doesNotExist("Idempotency-Replayed"));
    }

    @Test
    void creationRequiresAnIdempotencyKeyAndATechnician() throws Exception {
        expectProblem(mvc.perform(post(RESERVATIONS).header(AUTHORIZATION, bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(body(asset, UNTIL))), 400,
                "IDEMPOTENCY_KEY_REQUIRED");
        expectProblem(reserve(accessToken(accounts.admin()), key(), asset, UNTIL), 403, "FORBIDDEN");
        expectProblem(mvc.perform(post(RESERVATIONS).header("Idempotency-Key", key())
                .contentType(MediaType.APPLICATION_JSON).content(body(asset, UNTIL))), 401, "AUTH_TOKEN_INVALID");
        assertEquals(0L, activeReservationsOf(asset));
    }

    @Test
    void aMissingFieldOrAClientReservedFromIsAValidationError() throws Exception {
        expectProblem(mvc.perform(post(RESERVATIONS).header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetId\":\"" + asset + "\"}")), 400, "VALIDATION_ERROR");
        expectProblem(mvc.perform(post(RESERVATIONS).header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetId\":\"" + asset + "\",\"reservedFrom\":\"2026-09-28T13:00:00Z\","
                        + "\"reservedUntil\":\"" + UNTIL + "\"}")), 400, "VALIDATION_ERROR");
    }

    @Test
    void aTechnicianReadsOnlyTheirOwnReservation() throws Exception {
        expectProblem(mvc.perform(get(MINE).header(AUTHORIZATION, bearer(token))), 404,
                "ACTIVE_RESERVATION_NOT_FOUND");
        TestAccount other = accounts.technician();
        String id = JsonPath.read(reserve(accessToken(other), key(), asset, UNTIL).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), "$.id");

        expectProblem(mvc.perform(get(RESERVATIONS + "/" + id).header(AUTHORIZATION, bearer(token))), 404,
                "RESOURCE_NOT_FOUND");
        expectProblem(mvc.perform(get(RESERVATIONS + "/" + UUID.randomUUID()).header(AUTHORIZATION, bearer(token))),
                404, "RESOURCE_NOT_FOUND");
        expectProblem(mvc.perform(get(MINE).header(AUTHORIZATION, bearer(token))), 404,
                "ACTIVE_RESERVATION_NOT_FOUND");
        expectProblem(mvc.perform(get(RESERVATIONS + "/" + id)
                .header(AUTHORIZATION, bearer(accessToken(accounts.admin())))), 403, "FORBIDDEN");
    }

    @Test
    void aTerminalReservationIsReadableByIdButIsNotTheActiveOne() throws Exception {
        UUID cancelled = fixtures.reservation(asset, technician.id(), "CANCELLED", START.minusSeconds(3600),
                START.minusSeconds(60));
        mvc.perform(get(RESERVATIONS + "/" + cancelled).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelledAt").isString())
                .andExpect(jsonPath("$.availableActions").value(empty()));
        expectProblem(mvc.perform(get(MINE).header(AUTHORIZATION, bearer(token))), 404,
                "ACTIVE_RESERVATION_NOT_FOUND");
    }

    @Test
    void archivalIsRefusedWhileTheAssetIsReservedBorrowedOrInOperation() throws Exception {
        String admin = accessToken(accounts.admin());
        UUID reservation = UUID.fromString(JsonPath.read(reserve(token, key(), asset, UNTIL)
                .andExpect(status().isCreated()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8), "$.id"));
        expectProblem(archive(admin, asset), 409, "ASSET_ALREADY_RESERVED");

        UUID borrowed = fixtures.asset(locker);
        fixtures.loan(borrowed, accounts.technician().id(), START.minusSeconds(3600));
        expectProblem(archive(admin, borrowed), 409, "ASSET_HAS_OPEN_LOAN");

        UUID inOperation = fixtures.asset(locker);
        UUID holder = accounts.technician().id();
        UUID expired = fixtures.reservation(inOperation, holder, "EXPIRED", START.minusSeconds(3600),
                START.minusSeconds(60));
        fixtures.checkout(inOperation, holder, expired, "REQUESTED", START.minusSeconds(120));
        expectProblem(archive(admin, inOperation), 409, "ASSET_OPERATION_IN_PROGRESS");

        assertEquals(0L, jdbc.sql("""
                SELECT count(*) FROM aegis.assets WHERE id IN (:ids) AND archived_at IS NOT NULL
                """).param("ids", List.of(asset, borrowed, inOperation)).query(Long.class).single());
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.reservations WHERE id = :id")
                .param("id", reservation).query(String.class).single());
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE event_type = 'ASSET_ARCHIVED' AND subject_id = :id
                """, asset));

        UUID free = fixtures.asset(locker);
        fixtures.reservation(free, holder, "CANCELLED", START.minusSeconds(3600), START.minusSeconds(60));
        archive(admin, free).andExpect(status().isOk()).andExpect(jsonPath("$.archivedAt").isString());
    }

    /** Moves the clock, then signs in again: a token issued in the future of the clock is not accepted. */
    String at(Instant instant) throws Exception {
        clock.set(instant);
        return accessToken(technician);
    }

    ResultActions reserve(String accessToken, String key, UUID assetId, Instant until) throws Exception {
        return mvc.perform(post(RESERVATIONS).header(AUTHORIZATION, bearer(accessToken))
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(assetId, until)));
    }

    ResultActions archive(String adminToken, UUID assetId) throws Exception {
        return mvc.perform(post("/api/v1/admin/assets/" + assetId + "/archive")
                .header(AUTHORIZATION, bearer(adminToken)).header("Idempotency-Key", key()));
    }

    String body(UUID assetId, Instant until) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("assetId", assetId.toString());
        body.put("reservedUntil", until.toString());
        return jsonMapper.writeValueAsString(body);
    }

    static ResultActions expectProblem(ResultActions result, int status, String code) throws Exception {
        return result.andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    long activeReservationsOf(UUID assetId) {
        return fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id AND status = 'ACTIVE'",
                assetId);
    }

    static String key() {
        return UUID.randomUUID().toString();
    }
}
