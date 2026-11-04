package ca.aegis.control.loan;

import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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

/**
 * Loan reads of document 09, sections 8.4, 8.10 and 15.3, through HTTP. Loans are inserted as the checkout
 * confirmation (#47) will create them, because no route creates one yet; these reads never write. Reproduces the
 * manual acceptance of #38 on 4 November 2026: a technician with an active reservation and no open loan must get
 * {@code 404 ACTIVE_LOAN_NOT_FOUND}, never the generic {@code RESOURCE_NOT_FOUND} of an unhandled route.
 */
class LoanReadApiTests extends ApiIntegrationTest {

    static final String MINE = "/api/v1/me/loan";
    static final String LOANS = "/api/v1/loans/";
    /** The checkout of {@link ReservationFixtures#loan}: out at 12:51Z, due at 13:50Z; the clock starts at 13:00Z. */
    static final Instant CHECKOUT = START.minusSeconds(600);
    static final Instant DUE = CHECKOUT.plusSeconds(3600);

    @Autowired
    JdbcClient jdbc;

    ReservationFixtures fixtures;
    TestAccount technician;
    String token;
    UUID locker;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        technician = accounts.technician();
        token = accessToken(technician);
        locker = fixtures.scheduledLocker(accounts.admin().id());
    }

    @Test
    void aTechnicianWithAnActiveReservationAndNoLoanGetsTheBusinessNotFound() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        fixtures.reservation(asset, technician.id(), "ACTIVE", START, START.plusSeconds(3600));

        mvc.perform(get("/api/v1/me/reservation").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"));
        expectProblem(mine(token), 404, "ACTIVE_LOAN_NOT_FOUND");
    }

    @Test
    void theTechniciansActiveLoanIsReadWithTheContractView() throws Exception {
        UUID asset = fixtures.assetAt(locker, 1);
        UUID loan = fixtures.loan(asset, technician.id(), CHECKOUT);
        UUID checkout = checkoutOf(loan);
        long auditBefore = auditEvents();

        for (ResultActions read : new ResultActions[] {mine(token), byId(token, loan)}) {
            read.andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.id").value(loan.toString()))
                    .andExpect(jsonPath("$.asset.id").value(asset.toString()))
                    .andExpect(jsonPath("$.asset.assetCode").isString())
                    .andExpect(jsonPath("$.asset.placement.lockerId").value(locker.toString()))
                    .andExpect(jsonPath("$.holderUserId").value(technician.id().toString()))
                    .andExpect(jsonPath("$.status").value("ACTIVE"))
                    .andExpect(jsonPath("$.checkedOutAt").value("2026-09-28T12:51:00Z"))
                    .andExpect(jsonPath("$.dueAt").value("2026-09-28T13:50:00Z"))
                    .andExpect(jsonPath("$.overdue").value(false))
                    .andExpect(jsonPath("$.returnRequestedAt").value(nullValue()))
                    .andExpect(jsonPath("$.returnedAt").value(nullValue()))
                    .andExpect(jsonPath("$.checkoutOperationId").value(checkout.toString()))
                    .andExpect(jsonPath("$.returnOperationId").value(nullValue()))
                    .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                    // Section 8.10: RETURN is emitted only once the return route exists.
                    .andExpect(jsonPath("$.availableActions").value(empty()));
        }
        assertEquals(auditBefore, auditEvents());
        assertEquals("ACTIVE", loanStatus(loan));
    }

    @Test
    void aLoanPastItsDueTimeIsOverdueButStaysOpen() throws Exception {
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 1), technician.id(), CHECKOUT);

        clock.set(DUE);
        mine(token).andExpect(status().isOk()).andExpect(jsonPath("$.overdue").value(false));
        clock.set(DUE.plusSeconds(1));
        mine(token).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.overdue").value(true));
        assertEquals("ACTIVE", loanStatus(loan));
    }

    @Test
    void aReturnAttemptInProgressIsTheCurrentOperation() throws Exception {
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 1), technician.id(), CHECKOUT);
        UUID earlier = returnAttempt(loan, "EXPIRED", START.minusSeconds(300));
        UUID waiting = returnAttempt(loan, "AWAITING_LOCAL_PROOF", START.minusSeconds(60));

        // During the QR wait the loan keeps its status (section 15.2).
        mine(token).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.currentOperationId").value(waiting.toString()))
                .andExpect(jsonPath("$.returnOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()));

        jdbc.sql("""
                UPDATE aegis.locker_operations SET status = 'EXPIRED', terminal_at = :at, failure_reason = 'TEST'
                WHERE id = :id
                """).param("id", waiting).param("at", utc(START)).update();
        // A terminal attempt stays referenced to explain its outcome; the latest one wins.
        mine(token).andExpect(jsonPath("$.currentOperationId").value(waiting.toString()));
        assertEquals(2L, jdbc.sql("SELECT count(*) FROM aegis.locker_operations WHERE loan_id = :id")
                .param("id", loan).query(Long.class).single());
        assertEquals("EXPIRED", jdbc.sql("SELECT status FROM aegis.locker_operations WHERE id = :id")
                .param("id", earlier).query(String.class).single());
    }

    @Test
    void aReturnPendingLoanIsStillTheCurrentLoan() throws Exception {
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 1), technician.id(), CHECKOUT);
        UUID attempt = returnAttempt(loan, "AUTHORIZED", START.minusSeconds(60));
        jdbc.sql("UPDATE aegis.loans SET status = 'RETURN_PENDING', return_requested_at = :at WHERE id = :id")
                .param("id", loan).param("at", utc(START.minusSeconds(50))).update();

        mine(token).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(loan.toString()))
                .andExpect(jsonPath("$.status").value("RETURN_PENDING"))
                .andExpect(jsonPath("$.returnRequestedAt").value("2026-09-28T12:59:10Z"))
                .andExpect(jsonPath("$.returnedAt").value(nullValue()))
                .andExpect(jsonPath("$.returnOperationId").value(nullValue()))
                .andExpect(jsonPath("$.currentOperationId").value(attempt.toString()))
                // Open question Q2 of section 8.10: no RETURN for a RETURN_PENDING loan.
                .andExpect(jsonPath("$.availableActions").value(empty()));
    }

    @Test
    void aCompletedLoanIsNoLongerCurrentButItsHolderCanStillReadIt() throws Exception {
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 1), technician.id(), CHECKOUT);
        UUID confirmed = returnAttempt(loan, "CONFIRMED", START.minusSeconds(120));
        jdbc.sql("""
                UPDATE aegis.loans SET status = 'COMPLETED', return_requested_at = :requested, returned_at = :returned,
                                       return_operation_id = :operation
                WHERE id = :id
                """).param("id", loan).param("requested", utc(START.minusSeconds(110)))
                .param("returned", utc(START.minusSeconds(60))).param("operation", confirmed).update();
        clock.set(DUE.plusSeconds(3600));

        expectProblem(mine(token), 404, "ACTIVE_LOAN_NOT_FOUND");
        byId(token, loan).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.overdue").value(false))
                .andExpect(jsonPath("$.returnedAt").value("2026-09-28T12:59:00Z"))
                .andExpect(jsonPath("$.returnOperationId").value(confirmed.toString()))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()));
    }

    @Test
    void anotherTechniciansLoanIsNeverVisible() throws Exception {
        TestAccount other = accounts.technician();
        UUID theirs = fixtures.loan(fixtures.assetAt(locker, 1), other.id(), CHECKOUT);

        expectProblem(mine(token), 404, "ACTIVE_LOAN_NOT_FOUND");
        expectProblem(byId(token, theirs), 404, "RESOURCE_NOT_FOUND");
        expectProblem(byId(token, UUID.randomUUID()), 404, "RESOURCE_NOT_FOUND");

        UUID own = fixtures.loan(fixtures.assetAt(locker, 2), technician.id(), CHECKOUT);
        mine(token).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(own.toString()));
        mine(accessToken(other)).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(theirs.toString()));
    }

    @Test
    void onlyAnAuthenticatedTechnicianReadsLoans() throws Exception {
        UUID loan = fixtures.loan(fixtures.assetAt(locker, 1), technician.id(), CHECKOUT);
        String admin = accessToken(accounts.admin());

        expectProblem(mvc.perform(get(MINE)), 401, "AUTH_TOKEN_INVALID");
        expectProblem(mvc.perform(get(LOANS + loan)), 401, "AUTH_TOKEN_INVALID");
        expectProblem(mvc.perform(get(MINE).header(AUTHORIZATION, bearer("not-a-token"))), 401,
                "AUTH_TOKEN_INVALID");
        expectProblem(mine(admin), 403, "FORBIDDEN");
        expectProblem(byId(admin, loan), 403, "FORBIDDEN");
    }

    ResultActions mine(String accessToken) throws Exception {
        return mvc.perform(get(MINE).header(AUTHORIZATION, bearer(accessToken)));
    }

    ResultActions byId(String accessToken, UUID loan) throws Exception {
        return mvc.perform(get(LOANS + loan).header(AUTHORIZATION, bearer(accessToken)));
    }

    static ResultActions expectProblem(ResultActions result, int status, String code) throws Exception {
        return result.andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    /**
     * A return attempt of {@code loan} created at {@code at}, on the loan's asset, compartment and identifier.
     * {@code AUTHORIZED} and {@code CONFIRMED} were authorized ten seconds later; {@code CONFIRMED} carries every
     * milestone; a terminal attempt ended a minute after creation.
     */
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

    UUID checkoutOf(UUID loan) {
        return jdbc.sql("SELECT checkout_operation_id FROM aegis.loans WHERE id = :id").param("id", loan)
                .query(UUID.class).single();
    }

    String loanStatus(UUID loan) {
        return jdbc.sql("SELECT status FROM aegis.loans WHERE id = :id").param("id", loan).query(String.class)
                .single();
    }

    long auditEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
