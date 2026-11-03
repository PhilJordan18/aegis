package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.expectProblem;
import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * RES-02 through HTTP: cancellation (document 09, section 14.4; document 06, section 5.5), {@code availableActions}
 * (section 8.10) and the expiry re-evaluated at the start of an action (document 06, section 14). The clock starts on
 * Monday 28 September 2026 at 09:00 in Toronto; the test lockers are open from 08:00 to 17:00 there.
 */
@Import(PresentAssetsConfiguration.class)
class ReservationCancellationApiTests extends ApiIntegrationTest {

    static final String RESERVATIONS = "/api/v1/reservations";
    static final Instant UNTIL = Instant.parse("2026-09-28T15:30:00Z");
    static final Instant CLOSING = Instant.parse("2026-09-28T21:00:00Z");

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
    void theHolderCancelsAndTheAssetIsAvailableAgainWithTheAuditInTheSameTransaction() throws Exception {
        UUID reservation = reserve();
        availability(asset, "RESERVED");

        cancel(token, key(), reservation)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.id").value(reservation.toString()))
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelledAt").value(START.toString()))
                .andExpect(jsonPath("$.expiredAt").value(nullValue()))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()))
                .andExpect(jsonPath("$.availableActions").value(empty()));

        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events e JOIN aegis.reservations r ON r.id = e.subject_id
                WHERE e.subject_id = :id AND e.event_type = 'RESERVATION_CANCELLED' AND e.subject_type = 'RESERVATION'
                  AND e.from_state = 'ACTIVE' AND e.to_state = 'CANCELLED' AND e.result = 'ACCEPTED'
                  AND e.actor_user_id = r.user_id AND e.occurred_at = r.cancelled_at
                  AND e.details ->> 'assetId' = r.asset_id::text
                """, reservation));
        availability(asset, "AVAILABLE");
        expectProblem(mvc.perform(get("/api/v1/me/reservation").header(AUTHORIZATION, bearer(token))), 404,
                "ACTIVE_RESERVATION_NOT_FOUND");
        // A cancellation, like the reservation, never opens a compartment.
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.locker_operations WHERE asset_id = :id", asset));
    }

    @Test
    void theSameKeyReplaysTheCancellationAndANewKeyIsAlreadyApplied() throws Exception {
        UUID reservation = reserve();
        String key = key();
        MvcResult first = cancel(token, key, reservation).andExpect(status().isOk()).andReturn();
        clock.advance(java.time.Duration.ofMinutes(1));
        String later = accessToken(technician);
        MvcResult replay = cancel(later, key, reservation)
                .andExpect(status().isOk())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn();
        assertEquals(json(first), json(replay));
        assertEquals(1L, cancellationEvents(reservation, "ACCEPTED"));
        assertEquals(0L, cancellationEvents(reservation, "ALREADY_APPLIED"));

        cancel(later, key(), reservation)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelledAt").value(START.toString()));
        assertEquals(1L, cancellationEvents(reservation, "ACCEPTED"));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED' AND result = 'ALREADY_APPLIED'
                  AND from_state IS NULL AND to_state IS NULL
                """, reservation));
    }

    @Test
    void anEmptyObjectAndAnAbsentBodyAreTheSameRequestAndAnyPropertyIsRefused() throws Exception {
        UUID reservation = reserve();
        expectProblem(mvc.perform(cancelRequest(token, key(), reservation).contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"x\"}")), 400, "VALIDATION_ERROR");
        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));

        String key = key();
        mvc.perform(cancelRequest(token, key, reservation).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(header().doesNotExist("Idempotency-Replayed"));
        cancel(token, key, reservation).andExpect(status().isOk())
                .andExpect(header().string("Idempotency-Replayed", "true"));
        // Another reservation under the same key is another intent.
        expectProblem(cancel(token, key, UUID.randomUUID()), 409, "IDEMPOTENCY_KEY_REUSED");
    }

    @Test
    void anotherTechniciansReservationIsNotFoundAndNothingIsWritten() throws Exception {
        UUID reservation = reserve();
        TestAccount other = accounts.technician();

        expectProblem(cancel(accessToken(other), key(), reservation), 404, "RESOURCE_NOT_FOUND");
        expectProblem(cancel(token, key(), UUID.randomUUID()), 404, "RESOURCE_NOT_FOUND");
        expectProblem(cancel(accessToken(accounts.admin()), key(), reservation), 403, "FORBIDDEN");
        expectProblem(mvc.perform(post(RESERVATIONS + "/" + reservation + "/cancel")
                .header(AUTHORIZATION, bearer(token))), 400, "IDEMPOTENCY_KEY_REQUIRED");

        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED'
                """, reservation));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.rest_idempotency_keys WHERE actor_user_id = :id",
                other.id()));
    }

    @Test
    void aFulfilledOrExpiredReservationIsNotCancellable() throws Exception {
        UUID fulfilled = fixtures.reservation(asset, technician.id(), "FULFILLED", START.minusSeconds(3600),
                START.minusSeconds(60));
        UUID expired = fixtures.reservation(fixtures.asset(locker), technician.id(), "EXPIRED",
                START.minusSeconds(3600), START.minusSeconds(60));

        expectProblem(cancel(token, key(), fulfilled), 409, "RESERVATION_NOT_CANCELLABLE");
        expectProblem(cancel(token, key(), expired), 409, "RESERVATION_NOT_CANCELLABLE");

        assertEquals("FULFILLED", fixtures.reservationStatus(fulfilled));
        assertEquals("EXPIRED", fixtures.reservationStatus(expired));
        assertEquals(0L, auditEventsOf(technician.id()));
    }

    @Test
    void aCancellationEndsAnAttemptWaitingForItsQrInTheSameTransaction() throws Exception {
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                START.minusSeconds(30));
        read(reservation)
                .andExpect(jsonPath("$.currentOperationId").value(attempt.toString()))
                .andExpect(jsonPath("$.availableActions").value(contains("CANCEL")));

        cancel(token, key(), reservation)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.currentOperationId").value(nullValue()));

        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.locker_operations
                WHERE id = :id AND status = 'FAILED' AND failure_reason = 'RESERVATION_CANCELLED'
                  AND terminal_at = '2026-09-28T13:00:00Z' AND authorized_at IS NULL AND command_sent_at IS NULL
                """, attempt));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND operation_id = :id AND subject_type = 'LOCKER_OPERATION'
                  AND event_type = 'OPERATION_FAILED' AND from_state = 'AWAITING_LOCAL_PROOF' AND to_state = 'FAILED'
                  AND reason = 'RESERVATION_CANCELLED' AND result = 'ACCEPTED'
                """, attempt));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED'
                  AND details -> 'endedOperationIds' ->> 0 = (SELECT id::text FROM aegis.locker_operations
                                                              WHERE reservation_id = :id)
                """, reservation));
        availability(asset, "AVAILABLE");
    }

    /**
     * Document 06, section 5.5 and document 08, section 4.6: the cancellation invalidates the pending challenge of the
     * attempt it ends, releases the claim of its display instruction and purges its ciphertext, in the same
     * transaction. A refusal leaves the challenge usable, and a replay changes nothing more.
     */
    @Test
    void aCancellationInvalidatesTheQrChallengeAndStopsItsDisplay() throws Exception {
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                START.minusSeconds(30));
        UUID challenge = fixtures.challenge(attempt, START.minusSeconds(30), true);
        UUID display = fixtures.display(challenge, "CLAIMED", START.minusSeconds(30));

        TestAccount stranger = accounts.technician();
        expectProblem(cancel(accessToken(stranger), key(), reservation), 404, "RESOURCE_NOT_FOUND");
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.local_access_challenges
                WHERE id = :id AND status = 'PENDING' AND closed_at IS NULL
                """, challenge));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.hub_display_outbox
                WHERE id = :id AND status = 'CLAIMED' AND claim_until IS NOT NULL AND encrypted_payload IS NOT NULL
                """, display));

        String key = key();
        cancel(token, key, reservation).andExpect(status().isOk());
        cancel(token, key, reservation).andExpect(status().isOk())
                .andExpect(header().string("Idempotency-Replayed", "true"));

        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.local_access_challenges
                WHERE id = :id AND status = 'INVALIDATED' AND closed_at = '2026-09-28T13:00:00Z'
                  AND consumed_at IS NULL
                """, challenge));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.hub_display_outbox
                WHERE id = :id AND status = 'CANCELLED' AND claim_until IS NULL AND encrypted_payload IS NULL
                  AND message_type = 'DISPLAY_ACCESS_CHALLENGE' AND encryption_key_id = 'display-key-test'
                """, display));
        assertEquals(1L, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :challenge AND subject_type = 'LOCAL_ACCESS_CHALLENGE'
                  AND event_type = 'LOCAL_CHALLENGE_INVALIDATED' AND operation_id = :attempt
                  AND actor_user_id = :actor AND from_state = 'PENDING' AND to_state = 'INVALIDATED'
                  AND reason = 'RESERVATION_CANCELLED' AND result = 'ACCEPTED'
                  AND (details ->> 'displayInstructionsStopped')::int = 1
                  AND occurred_at = '2026-09-28T13:00:00Z'
                """).param("challenge", challenge).param("attempt", attempt).param("actor", technician.id())
                .query(Long.class).single());
        assertEquals("FAILED", fixtures.operationStatus(attempt));
    }

    /**
     * Document 09, section 8.10: only an anomaly that is not {@code RESOLVED} is a physical uncertainty. An attempt
     * never authorized whose anomaly is resolved leaves the cancellation open; one that was authorized still blocks
     * it (Q1, read literally), and an attempt in {@code ANOMALY} without any anomaly row stays uncertain.
     */
    @Test
    void onlyAnUnresolvedAnomalyIsAPhysicalUncertaintyForTheCancellation() throws Exception {
        record Case(boolean authorized, String anomaly, boolean cancellable) {
        }
        for (Case c : new Case[] {new Case(false, "OPEN", false), new Case(false, null, false),
                new Case(true, "RESOLVED", false), new Case(false, "RESOLVED", true)}) {
            UUID placed = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
            TestAccount holder = accounts.technician();
            String holderToken = accessToken(holder);
            UUID reservation = fixtures.reservation(placed, holder.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
            UUID attempt = fixtures.attempt(placed, holder.id(), reservation, "ANOMALY", c.authorized(),
                    START.minusSeconds(300));
            if (c.anomaly() != null) {
                fixtures.anomaly(attempt, c.anomaly(), START.minusSeconds(240));
            }

            if (c.cancellable()) {
                read(holderToken, reservation).andExpect(jsonPath("$.availableActions").value(contains("CANCEL")));
                cancel(holderToken, key(), reservation).andExpect(status().isOk());
                assertEquals("CANCELLED", fixtures.reservationStatus(reservation), c.toString());
            } else {
                read(holderToken, reservation).andExpect(jsonPath("$.availableActions").value(empty()));
                expectProblem(cancel(holderToken, key(), reservation), 409, "RESERVATION_NOT_CANCELLABLE");
                assertEquals("ACTIVE", fixtures.reservationStatus(reservation), c.toString());
                assertEquals(0L, auditEventsOf(holder.id()), c.toString());
            }
            assertEquals("ANOMALY", fixtures.operationStatus(attempt));
        }
    }

    /**
     * Document 09, section 8.10, open question Q1, read literally: once an attempt was authorized, whatever its
     * outcome, the reservation can no longer be cancelled; an authorized attempt in progress or in anomaly blocks it
     * too. Each refusal writes nothing.
     */
    @Test
    void anAttemptAuthorizedOnceOrInAnomalyBlocksTheCancellation() throws Exception {
        for (String status : new String[] {"AUTHORIZED", "COMMAND_SENT", "FAILED", "EXPIRED", "ANOMALY"}) {
            UUID placed = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
            TestAccount holder = accounts.technician();
            String holderToken = accessToken(holder);
            UUID reservation = fixtures.reservation(placed, holder.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
            UUID attempt = fixtures.attempt(placed, holder.id(), reservation, status, true, START.minusSeconds(300));

            read(holderToken, reservation).andExpect(jsonPath("$.availableActions").value(empty()));
            expectProblem(cancel(holderToken, key(), reservation), 409, "RESERVATION_NOT_CANCELLABLE");

            assertEquals("ACTIVE", fixtures.reservationStatus(reservation), status);
            assertEquals(status, fixtures.operationStatus(attempt));
            assertEquals(0L, auditEventsOf(holder.id()), status);
        }
    }

    @Test
    void anAttemptEndedBeforeAuthorizationLeavesTheCancellationOpen() throws Exception {
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600), UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "EXPIRED", false, START.minusSeconds(300));

        read(reservation).andExpect(jsonPath("$.availableActions").value(contains("CANCEL")));
        cancel(token, key(), reservation).andExpect(status().isOk());
        assertEquals("EXPIRED", fixtures.operationStatus(attempt));
    }

    @Test
    void cancelIsOfferedUntilJustBeforeReservedUntilAndRefusedFromThenWhileTheActionExpiresIt() throws Exception {
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", START.minusSeconds(600), UNTIL);

        String before = at(UNTIL.minusNanos(1_000));
        read(before, reservation).andExpect(jsonPath("$.availableActions").value(contains("CANCEL")));

        String due = at(UNTIL);
        // A read is not an action: the due reservation stays ACTIVE until an action or the job expires it.
        read(due, reservation)
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.availableActions").value(empty()));
        expectProblem(cancel(due, key(), reservation), 409, "RESERVATION_NOT_CANCELLABLE");

        read(due, reservation)
                .andExpect(jsonPath("$.status").value("EXPIRED"))
                .andExpect(jsonPath("$.expiredAt").value(UNTIL.toString()))
                .andExpect(jsonPath("$.cancelledAt").value(nullValue()));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND event_type = 'RESERVATION_EXPIRED' AND actor_user_id IS NULL
                  AND from_state = 'ACTIVE' AND to_state = 'EXPIRED'
                """, reservation));
        assertEquals(0L, cancellationEvents(reservation, "ACCEPTED"));
        availability(due, asset, "AVAILABLE");
    }

    /**
     * Two cancellations of the same reservation by its holder under different keys, at the same time: the holder lock
     * serializes them, so one cancels and the other finds it already cancelled. Both answer 200 {@code CANCELLED};
     * exactly one transition is audited.
     */
    @Test
    void twoConcurrentCancellationsUnderDifferentKeysCancelOnce() throws Exception {
        UUID reservation = reserve();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<MvcResult>> cancellations = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                String key = key();
                cancellations.add(executor.submit(() -> {
                    start.await();
                    return mvc.perform(cancelRequest(token, key, reservation)).andReturn();
                }));
            }
            start.countDown();
            for (Future<MvcResult> cancellation : cancellations) {
                MvcResult result = cancellation.get(30, TimeUnit.SECONDS);
                assertEquals(200, result.getResponse().getStatus());
                assertEquals("CANCELLED", JsonPath.read(
                        result.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.status"));
            }
        } finally {
            executor.shutdownNow();
        }

        assertEquals(1L, cancellationEvents(reservation, "ACCEPTED"));
        assertEquals(1L, cancellationEvents(reservation, "ALREADY_APPLIED"));
        assertEquals("CANCELLED", fixtures.reservationStatus(reservation));
    }

    @Test
    void aCreationFirstExpiresTheDueReservationsOfItsTechnicianAndOfItsAsset() throws Exception {
        UUID mineElsewhere = fixtures.reservation(fixtures.asset(locker), technician.id(), "ACTIVE",
                START.minusSeconds(3600), START.minusSeconds(1));
        UUID othersOnAsset = fixtures.reservation(asset, accounts.technician().id(), "ACTIVE",
                START.minusSeconds(3600), START);

        reserve();

        assertEquals("EXPIRED", fixtures.reservationStatus(mineElsewhere));
        assertEquals("EXPIRED", fixtures.reservationStatus(othersOnAsset));
    }

    @Test
    void afterACancellationANewReservationStillRespectsTheOperatingHours() throws Exception {
        cancel(token, key(), reserve()).andExpect(status().isOk());

        expectProblem(reserve(CLOSING.plusMillis(1)), 422, "RESERVATION_END_AFTER_CLOSING");
        reserve(CLOSING).andExpect(status().isCreated())
                .andExpect(jsonPath("$.availableActions").value(contains("CANCEL")));
    }

    private UUID reserve() throws Exception {
        String body = reserve(UNTIL).andExpect(status().isCreated()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private ResultActions reserve(Instant until) throws Exception {
        return mvc.perform(post(RESERVATIONS).header(AUTHORIZATION, bearer(token)).header("Idempotency-Key", key())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetId\":\"" + asset + "\",\"reservedUntil\":\"" + until + "\"}"));
    }

    private ResultActions cancel(String accessToken, String key, UUID reservation) throws Exception {
        return mvc.perform(cancelRequest(accessToken, key, reservation));
    }

    private static MockHttpServletRequestBuilder cancelRequest(String accessToken, String key, UUID reservation) {
        return post(RESERVATIONS + "/" + reservation + "/cancel").header(AUTHORIZATION, bearer(accessToken))
                .header("Idempotency-Key", key);
    }

    private ResultActions read(UUID reservation) throws Exception {
        return read(token, reservation);
    }

    private ResultActions read(String accessToken, UUID reservation) throws Exception {
        return mvc.perform(get(RESERVATIONS + "/" + reservation).header(AUTHORIZATION, bearer(accessToken)))
                .andExpect(status().isOk());
    }

    private void availability(UUID assetId, String expected) throws Exception {
        availability(token, assetId, expected);
    }

    private void availability(String accessToken, UUID assetId, String expected) throws Exception {
        mvc.perform(get("/api/v1/assets/" + assetId).header(AUTHORIZATION, bearer(accessToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value(expected));
    }

    /** Moves the clock, then signs in again: a token issued in the future of the clock is not accepted. */
    private String at(Instant instant) throws Exception {
        clock.set(instant);
        return accessToken(technician);
    }

    private long cancellationEvents(UUID reservation, String result) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED' AND result = :result
                """).param("id", reservation).param("result", result).query(Long.class).single();
    }

    private long auditEventsOf(UUID actor) {
        return fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE actor_user_id = :id AND event_type <> 'AUTHENTICATION_SUCCEEDED'
                """, actor);
    }

    private Object json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
