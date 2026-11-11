package ca.aegis.control.reservation;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Administrative reservation and loan reads of document 09, section 17 (#48), through HTTP. Reservations and loans
 * are inserted as their business flows would leave them, because no route creates a loan yet: this is synthetic
 * evidence of the reads, not of checkout or return (#47, #51). Each test filters on accounts it creates, since the
 * database is shared by the run. Every read is checked to write nothing.
 */
class AdminCustodyReadApiTests extends ApiIntegrationTest {

    static final String RESERVATIONS = "/api/v1/admin/reservations";
    static final String LOANS = "/api/v1/admin/loans";

    @Autowired
    JdbcClient jdbc;

    ReservationFixtures fixtures;
    TestAccount technician;
    String admin;
    UUID locker;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        technician = accounts.technician();
        admin = accessToken(accounts.admin());
        locker = fixtures.scheduledLocker(accounts.admin().id());
    }

    @Test
    void reservationsAreListedMostRecentFirstWithEveryFilter() throws Exception {
        UUID fulfilled = fixtures.reservation(fixtures.assetAt(locker, 1), technician.id(), "FULFILLED",
                START.minusSeconds(4000), START.minusSeconds(3000));
        UUID expired = fixtures.reservation(fixtures.assetAt(locker, 2), technician.id(), "EXPIRED",
                START.minusSeconds(3000), START.minusSeconds(2000));
        UUID cancelled = fixtures.reservation(fixtures.assetAt(locker, 3), technician.id(), "CANCELLED",
                START.minusSeconds(2000), START.minusSeconds(1000));
        UUID activeAsset = fixtures.assetAt(locker, 4);
        UUID active = fixtures.reservation(activeAsset, technician.id(), "ACTIVE", START.minusSeconds(60),
                START.plusSeconds(3600));
        UUID otherTechnician = accounts.technician().id();
        fixtures.reservation(fixtures.assetAt(locker, 5), otherTechnician, "ACTIVE", START, START.plusSeconds(600));
        long auditBefore = auditEvents();

        read(RESERVATIONS + "?userId=" + technician.id()).andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(active, cancelled, expired, fulfilled))))
                .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalItems").value(4)).andExpect(jsonPath("$.totalPages").value(1));
        read(RESERVATIONS + "?userId=" + technician.id() + "&status=CANCELLED")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(cancelled))));
        read(RESERVATIONS + "?assetId=" + activeAsset)
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(active))));
        // from is inclusive and to exclusive, on createdAt (rule D2 approved on 11 November 2026).
        read(RESERVATIONS + "?userId=" + technician.id() + "&from=" + START.minusSeconds(3000) + "&to="
                + START.minusSeconds(60))
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(cancelled, expired))));
        read(RESERVATIONS + "?userId=" + technician.id() + "&status=ACTIVE&from=2026-09-28T08:59:00-04:00")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(active))));

        assertEquals(auditBefore, auditEvents());
        assertEquals("ACTIVE", fixtures.reservationStatus(active));
    }

    @Test
    void anActiveReservationOffersNoActionToTheAdministrator() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(60),
                START.plusSeconds(3600));

        // The holder may cancel; the administrator reads the same reservation with no action (rule D4).
        mvc.perform(get("/api/v1/reservations/" + reservation).header(AUTHORIZATION, bearer(accessToken(technician))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.availableActions").value(contains("CANCEL")))
                .andExpect(jsonPath("$.user").doesNotExist()).andExpect(jsonPath("$.length()").value(12));
        // Rule G1: only the administrative view adds the holder's summary.
        read(RESERVATIONS + "/" + reservation).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(reservation.toString()))
                .andExpect(jsonPath("$.asset.id").value(asset.toString()))
                .andExpect(jsonPath("$.asset.assetCode").isString())
                .andExpect(jsonPath("$.asset.placement.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.userId").value(technician.id().toString()))
                .andExpect(jsonPath("$.user.id").value(technician.id().toString()))
                .andExpect(jsonPath("$.user.displayName").isString())
                .andExpect(jsonPath("$.user.length()").value(2))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.reservedFrom").value("2026-09-28T12:59:00Z"))
                .andExpect(jsonPath("$.reservedUntil").value("2026-09-28T14:00:00Z"))
                .andExpect(jsonPath("$.createdAt").value("2026-09-28T12:59:00Z"))
                .andExpect(jsonPath("$.cancelledAt").value(nullValue()))
                .andExpect(jsonPath("$.fulfilledAt").value(nullValue()))
                .andExpect(jsonPath("$.expiredAt").value(nullValue()))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()))
                .andExpect(jsonPath("$.length()").value(13));
        read(RESERVATIONS + "?assetId=" + asset).andExpect(jsonPath("$.items[0].availableActions").value(empty()))
                .andExpect(jsonPath("$.items[0].user.id").value(technician.id().toString()));
    }

    /** Document 09, section 8.4: a terminal attempt stays referenced, and a non-terminal one takes priority. */
    @Test
    void anActiveReservationKeepsReferencingItsLatestAttemptEvenWhenTerminal() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(900),
                START.plusSeconds(3600));
        UUID failed = fixtures.attempt(asset, technician.id(), reservation, "FAILED", false, START.minusSeconds(600));
        UUID expired = fixtures.attempt(asset, technician.id(), reservation, "EXPIRED", false,
                START.minusSeconds(300));
        String technicianToken = accessToken(technician);

        read(RESERVATIONS + "/" + reservation).andExpect(jsonPath("$.currentOperationId").value(expired.toString()));
        mvc.perform(get("/api/v1/reservations/" + reservation).header(AUTHORIZATION, bearer(technicianToken)))
                .andExpect(jsonPath("$.currentOperationId").value(expired.toString()));

        // An older non-terminal attempt still wins over a newer terminal one.
        jdbc.sql("UPDATE aegis.locker_operations SET status = 'REQUESTED', terminal_at = NULL, failure_reason = NULL "
                + "WHERE id = :id").param("id", failed).update();
        read(RESERVATIONS + "?assetId=" + asset)
                .andExpect(jsonPath("$.items[0].currentOperationId").value(failed.toString()));
        mvc.perform(get("/api/v1/me/reservation").header(AUTHORIZATION, bearer(technicianToken)))
                .andExpect(jsonPath("$.currentOperationId").value(failed.toString()));
    }

    /** Document 09, section 8.4: a terminal attempt stays referenced, and a non-terminal one takes priority. */
    @Test
    void anActiveReservationKeepsReferencingItsLatestAttemptEvenWhenTerminal() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(900),
                START.plusSeconds(3600));
        UUID failed = fixtures.attempt(asset, technician.id(), reservation, "FAILED", false, START.minusSeconds(600));
        UUID expired = fixtures.attempt(asset, technician.id(), reservation, "EXPIRED", false,
                START.minusSeconds(300));
        String technicianToken = accessToken(technician);

        read(RESERVATIONS + "/" + reservation).andExpect(jsonPath("$.currentOperationId").value(expired.toString()));
        mvc.perform(get("/api/v1/reservations/" + reservation).header(AUTHORIZATION, bearer(technicianToken)))
                .andExpect(jsonPath("$.currentOperationId").value(expired.toString()));

        // An older non-terminal attempt still wins over a newer terminal one.
        jdbc.sql("UPDATE aegis.locker_operations SET status = 'REQUESTED', terminal_at = NULL, failure_reason = NULL "
                + "WHERE id = :id").param("id", failed).update();
        read(RESERVATIONS + "?assetId=" + asset)
                .andExpect(jsonPath("$.items[0].currentOperationId").value(failed.toString()));
        mvc.perform(get("/api/v1/me/reservation").header(AUTHORIZATION, bearer(technicianToken)))
                .andExpect(jsonPath("$.currentOperationId").value(failed.toString()));
    }

    @Test
    void pagesNeitherRepeatNorOmitAReservation() throws Exception {
        // A window no other test of the shared database uses.
        Instant base = Instant.parse("2025-03-03T03:03:00Z");
        List<UUID> expected = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            TestAccount holder = i == 0 ? technician : accounts.technician();
            UUID asset = fixtures.assetAt(locker, i + 1);
            // Two reservations share each creation instant, so only the id breaks the tie.
            expected.add(fixtures.reservation(asset, holder.id(), "EXPIRED", base.plusSeconds(100 * (i / 2)),
                    base.plusSeconds(600)));
        }
        String filter = RESERVATIONS + "?status=EXPIRED&from=" + base + "&to=" + base.plusSeconds(201) + "&size=2";
        List<String> seen = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            String body = read(filter + "&page=" + page).andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalItems").value(5)).andExpect(jsonPath("$.totalPages").value(3))
                    .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
            seen.addAll(JsonPath.read(body, "$.items[*].id"));
        }
        read(filter + "&page=3").andExpect(jsonPath("$.items").value(empty()))
                .andExpect(jsonPath("$.totalItems").value(5));
        assertEquals(5, seen.size());
        assertEquals(5, seen.stream().distinct().count());
        assertEquals(expected.stream().map(UUID::toString).sorted().toList(), seen.stream().sorted().toList());
    }

    @Test
    void loansAreListedByHolderWithOverdueDerivedAndCustodyKept() throws Exception {
        UUID olderAsset = fixtures.assetAt(locker, 1);
        UUID older = fixtures.loan(olderAsset, technician.id(), START.minusSeconds(7200));
        UUID newer = fixtures.loan(fixtures.assetAt(locker, 2), technician.id(), START.minusSeconds(600));
        jdbc.sql("UPDATE aegis.loans SET status = 'RETURN_PENDING', return_requested_at = :at WHERE id = :id")
                .param("id", newer).param("at", ReservationFixtures.utc(START.minusSeconds(30))).update();
        UUID otherHolder = accounts.technician().id();
        UUID others = fixtures.loan(fixtures.assetAt(locker, 3), otherHolder, START.minusSeconds(300));
        long auditBefore = auditEvents();

        // The older loan was due at 12:00Z: overdue, still ACTIVE, and its asset stays in custody.
        read(LOANS + "?userId=" + technician.id()).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(newer, older))))
                .andExpect(jsonPath("$.totalItems").value(2))
                .andExpect(jsonPath("$.items[0].status").value("RETURN_PENDING"))
                .andExpect(jsonPath("$.items[0].overdue").value(false))
                .andExpect(jsonPath("$.items[1].status").value("ACTIVE"))
                .andExpect(jsonPath("$.items[1].overdue").value(true))
                .andExpect(jsonPath("$.items[1].holderUserId").value(technician.id().toString()))
                .andExpect(jsonPath("$.items[1].holder.id").value(technician.id().toString()))
                .andExpect(jsonPath("$.items[1].holder.displayName").isString())
                .andExpect(jsonPath("$.items[1].asset.id").value(olderAsset.toString()))
                .andExpect(jsonPath("$.items[1].availableActions").value(empty()));
        read(LOANS + "?userId=" + technician.id() + "&status=ACTIVE")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(older))));
        read(LOANS + "?assetId=" + olderAsset).andExpect(jsonPath("$.items[*].id").value(contains(ids(older))));
        // from/to bound checkedOutAt, a minute after the fixture's checkout instant (rule D2).
        read(LOANS + "?userId=" + otherHolder + "&from=" + START.minusSeconds(240) + "&to=" + START)
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(others))));
        read(LOANS + "?userId=" + otherHolder + "&from=" + START.minusSeconds(239))
                .andExpect(jsonPath("$.items").value(empty())).andExpect(jsonPath("$.totalPages").value(0));

        assertEquals(auditBefore, auditEvents());
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.loans WHERE id = :id").param("id", older)
                .query(String.class).single());
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.loans WHERE asset_id = :id "
                + "AND status IN ('ACTIVE', 'RETURN_PENDING')", olderAsset));
    }

    @Test
    void anyLoanIsReadByIdWithTheContractView() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID loan = fixtures.loan(asset, technician.id(), START.minusSeconds(600));
        UUID checkout = jdbc.sql("SELECT checkout_operation_id FROM aegis.loans WHERE id = :id").param("id", loan)
                .query(UUID.class).single();

        read(LOANS + "/" + loan).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(loan.toString()))
                .andExpect(jsonPath("$.asset.id").value(asset.toString()))
                .andExpect(jsonPath("$.holderUserId").value(technician.id().toString()))
                .andExpect(jsonPath("$.holder.id").value(technician.id().toString()))
                .andExpect(jsonPath("$.holder.displayName").isString())
                .andExpect(jsonPath("$.holder.length()").value(2))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.checkedOutAt").value("2026-09-28T12:51:00Z"))
                .andExpect(jsonPath("$.dueAt").value("2026-09-28T13:50:00Z"))
                .andExpect(jsonPath("$.overdue").value(false))
                .andExpect(jsonPath("$.returnRequestedAt").value(nullValue()))
                .andExpect(jsonPath("$.returnedAt").value(nullValue()))
                .andExpect(jsonPath("$.checkoutOperationId").value(checkout.toString()))
                .andExpect(jsonPath("$.returnOperationId").value(nullValue()))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()))
                .andExpect(jsonPath("$.length()").value(14));
        mvc.perform(get("/api/v1/loans/" + loan).header(AUTHORIZATION, bearer(accessToken(technician))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.holder").doesNotExist())
                .andExpect(jsonPath("$.length()").value(13));
    }

    @Test
    void anUnknownOrMalformedIdIsRefused() throws Exception {
        for (String route : List.of(RESERVATIONS, LOANS)) {
            expectProblem(read(route + "/" + UUID.randomUUID()), 404, "RESOURCE_NOT_FOUND");
            expectProblem(read(route + "/not-a-uuid"), 400, "VALIDATION_ERROR");
        }
        // A reservation id is not a loan id.
        UUID reservation = fixtures.reservation(fixtures.assetAt(locker, 1), technician.id(), "ACTIVE", START,
                START.plusSeconds(60));
        expectProblem(read(LOANS + "/" + reservation), 404, "RESOURCE_NOT_FOUND");
    }

    @Test
    void invalidFiltersAreReportedTogether() throws Exception {
        for (String route : List.of(RESERVATIONS, LOANS)) {
            expectProblem(read(route + "?status=OPEN&assetId=42&userId=&from=2026-09-28T13:00:00&to=tomorrow"), 400,
                    "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[*].field").value(
                            contains("assetId", "from", "status", "to", "userId")))
                    .andExpect(jsonPath("$.violations[*].code").value(contains("INVALID_VALUE", "INVALID_VALUE",
                            "INVALID_VALUE", "INVALID_VALUE", "INVALID_VALUE")));
            expectProblem(read(route + "?status=active"), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[0].field").value("status"));
            expectProblem(read(route + "?assetId=1-1-1-1-1"), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[0].field").value("assetId"));
            // An empty interval is refused rather than answered with an empty page.
            expectProblem(read(route + "?from=" + START + "&to=" + START), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations", hasSize(1)))
                    .andExpect(jsonPath("$.violations[0].field").value("to"));
            expectProblem(read(route + "?size=0"), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[0].field").value("size"));
            expectProblem(read(route + "?size=101&page=-1"), 400, "VALIDATION_ERROR")
                    .andExpect(jsonPath("$.violations[*].field").value(contains("page", "size")));
            read(route + "?size=100&page=0").andExpect(status().isOk()).andExpect(jsonPath("$.size").value(100));
        }
    }

    @Test
    void onlyAnAdministratorReadsTheseRoutes() throws Exception {
        UUID reservation = fixtures.reservation(fixtures.assetAt(locker, 1), technician.id(), "ACTIVE", START,
                START.plusSeconds(60));
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 2), technician.id(), START.minusSeconds(600));
        String technicianToken = accessToken(technician);

        for (String route : List.of(RESERVATIONS, RESERVATIONS + "/" + reservation, LOANS, LOANS + "/" + loan)) {
            expectProblem(mvc.perform(get(route)), 401, "AUTH_TOKEN_INVALID");
            expectProblem(mvc.perform(get(route).header(AUTHORIZATION, bearer("not-a-token"))), 401,
                    "AUTH_TOKEN_INVALID");
            expectProblem(mvc.perform(get(route).header(AUTHORIZATION, bearer(technicianToken))), 403, "FORBIDDEN");
        }
    }

    ResultActions read(String uri) throws Exception {
        return mvc.perform(asAdmin(get(uri)));
    }

    MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder request) {
        return request.header(AUTHORIZATION, bearer(admin));
    }

    static String[] ids(UUID... ids) {
        return Arrays.stream(ids).map(UUID::toString).toArray(String[]::new);
    }

    long auditEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    static ResultActions expectProblem(ResultActions result, int status, String code) throws Exception {
        return result.andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }
}
