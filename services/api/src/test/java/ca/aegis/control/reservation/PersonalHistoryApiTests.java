package ca.aegis.control.reservation;

import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.support.ApiIntegrationTest;

class PersonalHistoryApiTests extends ApiIntegrationTest {
    @Autowired JdbcClient jdbc;

    @Test
    void reservationHistoryScopesBothCountAndPageAndBreaksTimestampTiesWithoutMutation() throws Exception {
        var owner = accounts.technician();
        var other = accounts.technician();
        var fixtures = new ReservationFixtures(jdbc);
        UUID asset = fixtures.asset(null);
        List<String> expected = new ArrayList<>();
        for (String state : List.of("CANCELLED", "EXPIRED", "FULFILLED")) {
            expected.add(fixtures.reservation(asset, owner.id(), state, START.minusSeconds(100), START).toString());
        }
        expected.sort(Comparator.reverseOrder());
        fixtures.reservation(asset, other.id(), "CANCELLED", START.minusSeconds(100), START);
        jdbc.sql("UPDATE aegis.assets SET archived_at=:at WHERE id=:id")
                .param("id", asset).param("at", utc(START)).update();
        long before = auditCount();
        String token = accessToken(owner);
        for (int page = 0; page < 3; page++) {
            mvc.perform(get("/api/v1/me/reservations").param("page", "" + page).param("size", "1")
                            .param("userId", other.id().toString()).header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(3))
                    .andExpect(jsonPath("$.totalPages").value(3))
                    .andExpect(jsonPath("$.items[0].id").value(expected.get(page)))
                    .andExpect(jsonPath("$.items[0].userId").value(owner.id().toString()))
                    .andExpect(jsonPath("$.items[0].asset.id").value(asset.toString()))
                    .andExpect(jsonPath("$.items[0].availableActions").value(empty()))
                    .andExpect(jsonPath("$.items[0].currentOperationId").value(nullValue()));
        }
        for (String state : List.of("CANCELLED", "EXPIRED", "FULFILLED")) {
            mvc.perform(get("/api/v1/me/reservations").param("status", state).header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(1))
                    .andExpect(jsonPath("$.items[0].status").value(state));
        }
        mvc.perform(get("/api/v1/me/reservations").param("page", "2147483647").param("size", "100")
                        .header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").value(empty()));
        assertEquals(before, auditCount());
        assertEquals(3L, jdbc.sql("SELECT count(*) FROM aegis.reservations WHERE user_id=:id")
                .param("id", owner.id()).query(Long.class).single());
    }

    @Test
    void loansAreOwnerScopedOrderedAndFilterableIncludingCompleted() throws Exception {
        var owner = accounts.technician();
        var other = accounts.technician();
        var fixtures = new ReservationFixtures(jdbc);
        UUID locker = fixtures.locker();
        UUID older = fixtures.loan(fixtures.assetAt(locker, 1), owner.id(), START.minusSeconds(300));
        UUID newer = fixtures.loan(fixtures.assetAt(locker, 2), owner.id(), START.minusSeconds(100));
        fixtures.loan(fixtures.assetAt(locker, 3), other.id(), START.minusSeconds(100));
        UUID returned = returnAttempt(older, "CONFIRMED", START.minusSeconds(80));
        jdbc.sql("UPDATE aegis.loans SET status='COMPLETED', return_requested_at=:at, returned_at=:at, "
                + "return_operation_id=:operation WHERE id=:id").param("operation", returned)
                .param("id", older).param("at", START.atOffset(java.time.ZoneOffset.UTC)).update();
        String token = accessToken(owner);
        long before = auditCount();
        mvc.perform(get("/api/v1/me/loans").param("size", "1").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(2))
                .andExpect(jsonPath("$.items[0].id").value(newer.toString()))
                .andExpect(jsonPath("$.items[0].asset.placement.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.items[0].checkoutOperationId").isString())
                .andExpect(jsonPath("$.items[0].availableActions").value(empty()));
        mvc.perform(get("/api/v1/me/loans").param("status", "COMPLETED").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].id").value(older.toString()))
                .andExpect(jsonPath("$.items[0].overdue").value(false));
        mvc.perform(get("/api/v1/me/loans").param("status", "RETURN_PENDING").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(0));
        assertEquals(before, auditCount());
    }

    @Test
    void bothRoutesEnforceRoleValidationAndAnEmptyPageContract() throws Exception {
        String token = accessToken(accounts.technician());
        String admin = accessToken(accounts.admin());
        for (String path : List.of("/api/v1/me/reservations", "/api/v1/me/loans")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).header(AUTHORIZATION, bearer(admin))).andExpect(status().isForbidden());
            mvc.perform(get(path).header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.items").value(empty()))
                    .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.size").value(20))
                    .andExpect(jsonPath("$.totalItems").value(0)).andExpect(jsonPath("$.totalPages").value(0));
            for (String[] invalid : List.of(new String[]{"status", "UNKNOWN"}, new String[]{"size", "101"},
                    new String[]{"size", "0"}, new String[]{"page", "-1"}, new String[]{"page", "x"})) {
                mvc.perform(get(path).param(invalid[0], invalid[1]).header(AUTHORIZATION, bearer(token)))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
            }
        }
    }

    @Test
    void tiedLoansUseUuidOrderAndPendingOrDueActivityIsNeverMutatedByHistory() throws Exception {
        var owner = accounts.technician();
        var fixtures = new ReservationFixtures(jdbc);
        UUID locker = fixtures.locker();
        UUID first = fixtures.loan(fixtures.assetAt(locker, 1), owner.id(), START.minusSeconds(4000));
        UUID second = fixtures.loan(fixtures.assetAt(locker, 2), owner.id(), START.minusSeconds(4000));
        List<String> expected = new ArrayList<>(List.of(first.toString(), second.toString()));
        expected.sort(Comparator.reverseOrder());
        jdbc.sql("UPDATE aegis.loans SET status='RETURN_PENDING', return_requested_at=:at WHERE id=:id")
                .param("id", first).param("at", utc(START.minusSeconds(20))).update();
        UUID due = fixtures.reservation(fixtures.asset(null), owner.id(), "ACTIVE", START.minusSeconds(100),
                START.minusSeconds(10));
        String token = accessToken(owner);
        for (int page = 0; page < 2; page++) {
            mvc.perform(get("/api/v1/me/loans").param("page", "" + page).param("size", "1")
                            .header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(expected.get(page)))
                    .andExpect(jsonPath("$.items[0].overdue").value(true));
        }
        mvc.perform(get("/api/v1/me/loans").param("status", "RETURN_PENDING").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].id").value(first.toString()));
        mvc.perform(get("/api/v1/me/reservations").param("status", "ACTIVE").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(due.toString()))
                .andExpect(jsonPath("$.items[0].status").value("ACTIVE"));
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.reservations WHERE id=:id")
                .param("id", due).query(String.class).single());
        assertEquals("RETURN_PENDING", jdbc.sql("SELECT status FROM aegis.loans WHERE id=:id")
                .param("id", first).query(String.class).single());
    }

    UUID returnAttempt(UUID loan, String status, Instant at) {
        boolean authorized = status.equals("AUTHORIZED") || status.equals("CONFIRMED");
        boolean confirmed = status.equals("CONFIRMED");
        boolean terminal = confirmed || status.equals("FAILED") || status.equals("EXPIRED");
        Instant authorizedAt = authorized ? at.plusSeconds(10) : null;
        Instant milestone = confirmed ? at.plusSeconds(11) : null;
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, loan_id,
                     expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
                     command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at,
                     terminal_at, failure_reason)
                SELECT 'RETURN', :status, l.holder_user_id, l.asset_id, c.locker_id, c.id, l.id, i.id,
                       :created, :authorized, :authorized, :expires, :milestone, :milestone, :milestone, :milestone,
                       :confirmed, :terminal, :reason
                FROM aegis.loans l
                JOIN aegis.asset_placements p ON p.asset_id = l.asset_id AND p.removed_at IS NULL
                JOIN aegis.compartments c ON c.id = p.compartment_id
                JOIN aegis.asset_identifiers i ON i.asset_id = l.asset_id AND i.active
                WHERE l.id = :loan
                RETURNING id
                """)
                .param("status", status).param("loan", loan).param("created", utc(at))
                .param("authorized", utc(authorizedAt))
                .param("expires", authorized ? utc(authorizedAt.plusSeconds(120)) : null)
                .param("milestone", utc(milestone))
                .param("confirmed", confirmed ? utc(at.plusSeconds(60)) : null)
                .param("terminal", terminal ? utc(at.plusSeconds(60)) : null)
                .param("reason", terminal && !confirmed ? "TEST_" + status : null)
                .query(UUID.class).single();
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    private long auditCount() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }
}
