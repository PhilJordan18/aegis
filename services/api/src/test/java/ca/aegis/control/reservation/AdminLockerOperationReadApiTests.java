package ca.aegis.control.reservation;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Administrative operation reads of document 09, sections 8.5 and 17 (#48), through HTTP. Operations, challenges and
 * anomalies are inserted as the checkout flow would leave them: synthetic evidence of the reads only, not of a
 * physical checkout (#47). Each test filters on the locker it creates, since the database is shared by the run.
 */
class AdminLockerOperationReadApiTests extends ApiIntegrationTest {

    static final String OPERATIONS = "/api/v1/admin/locker-operations";

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
    void anOperationAwaitingItsLocalProofIsReadWithoutAnySecretOfItsChallenge() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(120),
                START.plusSeconds(3600));
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                START.minusSeconds(20));
        UUID challenge = fixtures.challenge(attempt, START.minusSeconds(20), true);
        UUID compartment = jdbc.sql("SELECT compartment_id FROM aegis.locker_operations WHERE id = :id")
                .param("id", attempt).query(UUID.class).single();
        long auditBefore = auditEvents();

        read(OPERATIONS + "/" + attempt).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(attempt.toString()))
                .andExpect(jsonPath("$.type").value("CHECKOUT"))
                .andExpect(jsonPath("$.status").value("AWAITING_LOCAL_PROOF"))
                .andExpect(jsonPath("$.userId").value(technician.id().toString()))
                .andExpect(jsonPath("$.assetId").value(asset.toString()))
                .andExpect(jsonPath("$.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.compartmentId").value(compartment.toString()))
                .andExpect(jsonPath("$.reservationId").value(reservation.toString()))
                .andExpect(jsonPath("$.loanId").value(nullValue()))
                .andExpect(jsonPath("$.createdAt").value("2026-09-28T12:59:40Z"))
                .andExpect(jsonPath("$.authorizedAt").value(nullValue()))
                .andExpect(jsonPath("$.localAccessChallengeId").value(challenge.toString()))
                .andExpect(jsonPath("$.localProofExpiresAt").value("2026-09-28T13:00:40Z"))
                .andExpect(jsonPath("$.localProofDisplayedAt").value("2026-09-28T12:59:45Z"))
                .andExpect(jsonPath("$.localProofValidatedAt").value(nullValue()))
                .andExpect(jsonPath("$.requiredAction").value("SCAN_HUB_QR"))
                .andExpect(jsonPath("$.expiresAt").value(nullValue()))
                .andExpect(jsonPath("$.commandSentAt").value(nullValue()))
                .andExpect(jsonPath("$.terminalAt").value(nullValue()))
                .andExpect(jsonPath("$.failureReason").value(nullValue()))
                .andExpect(jsonPath("$.anomalyId").value(nullValue()))
                .andExpect(jsonPath("$.length()").value(25))
                .andExpect(content().string(not(containsString("token"))))
                .andExpect(content().string(not(containsString("payload"))));

        assertEquals(auditBefore, auditEvents());
        assertEquals("AWAITING_LOCAL_PROOF", fixtures.operationStatus(attempt));
        assertEquals("PENDING", jdbc.sql("SELECT status FROM aegis.local_access_challenges WHERE id = :id")
                .param("id", challenge).query(String.class).single());
    }

    @Test
    void aTerminalOperationNamesItsLatestAnomalyAndRequiresNothing() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600),
                START.plusSeconds(3600));
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "ANOMALY", true,
                START.minusSeconds(300));
        fixtures.anomaly(attempt, "RESOLVED", START.minusSeconds(240));
        UUID latest = fixtures.anomaly(attempt, "OPEN", START.minusSeconds(60));

        read(OPERATIONS + "/" + attempt).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ANOMALY"))
                .andExpect(jsonPath("$.requiredAction").value("NONE"))
                .andExpect(jsonPath("$.authorizedAt").value("2026-09-28T12:55:10Z"))
                .andExpect(jsonPath("$.localProofValidatedAt").value("2026-09-28T12:55:10Z"))
                .andExpect(jsonPath("$.expiresAt").value("2026-09-28T12:57:10Z"))
                .andExpect(jsonPath("$.commandSentAt").value("2026-09-28T12:55:11Z"))
                .andExpect(jsonPath("$.terminalAt").value("2026-09-28T12:56:00Z"))
                .andExpect(jsonPath("$.failureReason").value("TEST_ANOMALY"))
                .andExpect(jsonPath("$.localAccessChallengeId").value(nullValue()))
                .andExpect(jsonPath("$.anomalyId").value(latest.toString()));
    }

    @Test
    void operationsAreListedMostRecentFirstWithEveryFilter() throws Exception {
        UUID firstAsset = fixtures.assetAt(locker, 1);
        UUID first = fixtures.attempt(firstAsset, technician.id(),
                fixtures.reservation(firstAsset, technician.id(), "FULFILLED", START.minusSeconds(900),
                        START.minusSeconds(100)),
                "CONFIRMED", true, START.minusSeconds(900));
        TestAccount other = accounts.technician();
        UUID secondAsset = fixtures.assetAt(locker, 2);
        UUID second = fixtures.attempt(secondAsset, other.id(),
                fixtures.reservation(secondAsset, other.id(), "ACTIVE", START.minusSeconds(600),
                        START.plusSeconds(600)),
                "EXPIRED", false, START.minusSeconds(600));
        UUID elsewhere = fixtures.scheduledLocker(accounts.admin().id());
        UUID elsewhereAsset = fixtures.assetAt(elsewhere, 1);
        fixtures.attempt(elsewhereAsset, technician.id(), fixtures.reservation(elsewhereAsset, technician.id(),
                "ACTIVE", START.minusSeconds(60), START.plusSeconds(600)), "REQUESTED", false, START.minusSeconds(60));

        read(OPERATIONS + "?lockerId=" + locker).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(second, first))))
                .andExpect(jsonPath("$.items[0].requiredAction").value("NONE"))
                .andExpect(jsonPath("$.items[1].confirmedAt").value("2026-09-28T12:46:00Z"))
                .andExpect(jsonPath("$.totalItems").value(2));
        read(OPERATIONS + "?lockerId=" + locker + "&status=CONFIRMED")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(first))));
        read(OPERATIONS + "?lockerId=" + locker + "&userId=" + other.id())
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(second))));
        read(OPERATIONS + "?assetId=" + firstAsset).andExpect(jsonPath("$.items[*].id").value(contains(ids(first))));
        read(OPERATIONS + "?lockerId=" + locker + "&from=" + START.minusSeconds(900) + "&to=" + START.minusSeconds(600))
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(first))));
        read(OPERATIONS + "?lockerId=" + locker + "&size=1&page=1")
                .andExpect(jsonPath("$.items[*].id").value(contains(ids(first))))
                .andExpect(jsonPath("$.totalPages").value(2));
        read(OPERATIONS + "?lockerId=" + UUID.randomUUID()).andExpect(jsonPath("$.items").value(empty()))
                .andExpect(jsonPath("$.totalItems").value(0));
    }

    @Test
    void invalidFiltersAndIdsAreRefused() throws Exception {
        expectProblem(read(OPERATIONS + "?status=CANCELLED&lockerId=x&to=2026-13-01T00:00:00Z"), 400,
                "VALIDATION_ERROR")
                .andExpect(jsonPath("$.violations[*].field").value(contains("lockerId", "status", "to")));
        expectProblem(read(OPERATIONS + "/" + UUID.randomUUID()), 404, "RESOURCE_NOT_FOUND");
        expectProblem(read(OPERATIONS + "/not-a-uuid"), 400, "VALIDATION_ERROR");
    }

    @Test
    void onlyAnAdministratorReadsOperations() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID attempt = fixtures.attempt(asset, technician.id(), fixtures.reservation(asset, technician.id(),
                "ACTIVE", START.minusSeconds(60), START.plusSeconds(600)), "REQUESTED", false, START.minusSeconds(60));
        String technicianToken = accessToken(technician);

        for (String route : List.of(OPERATIONS, OPERATIONS + "/" + attempt)) {
            expectProblem(mvc.perform(get(route)), 401, "AUTH_TOKEN_INVALID");
            expectProblem(mvc.perform(get(route).header(AUTHORIZATION, bearer(technicianToken))), 403, "FORBIDDEN");
        }
    }

    ResultActions read(String uri) throws Exception {
        return mvc.perform(get(uri).header(AUTHORIZATION, bearer(admin)));
    }

    long auditEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    static String[] ids(UUID... ids) {
        return Arrays.stream(ids).map(UUID::toString).toArray(String[]::new);
    }

    static ResultActions expectProblem(ResultActions result, int status, String code) throws Exception {
        return AdminCustodyReadApiTests.expectProblem(result, status, code);
    }
}
