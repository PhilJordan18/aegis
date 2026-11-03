package ca.aegis.control.reservation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.reservation.ReservationExpiry.Outcome;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Server-side expiry of document 06, section 14.1 and document 05, sections 3.3 and 3.4, through the service the job
 * runs. Races use real transactions on separate connections, like {@link ReservationConcurrencyTests}.
 */
@Import(PresentAssetsConfiguration.class)
class ReservationExpiryTests extends ApiIntegrationTest {

    private static final Instant FROM = START.minusSeconds(3600);
    private static final Instant UNTIL = Instant.parse("2026-09-28T15:30:00Z");

    @Autowired
    ReservationExpiry expiry;

    @Autowired
    ReservationService reservations;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    private ExecutorService executor;
    private ReservationFixtures fixtures;
    private UUID locker;
    private TestAccount technician;

    @BeforeEach
    void prepare() {
        executor = Executors.newFixedThreadPool(6);
        fixtures = new ReservationFixtures(jdbc);
        locker = fixtures.scheduledLocker(accounts.admin().id());
        technician = accounts.technician();
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void aReservationExpiresExactlyAtReservedUntilAndFreesItsAsset() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);

        assertEquals(Outcome.UNCHANGED, expiry.expire(reservation, UNTIL.minusNanos(1_000), false));
        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));
        assertEquals(0L, expiredEvents(reservation));

        assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, false));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.reservations
                WHERE id = :id AND status = 'EXPIRED' AND expired_at = '2026-09-28T15:30:00Z' AND cancelled_at IS NULL
                """, reservation));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id = :id AND subject_type = 'RESERVATION' AND event_type = 'RESERVATION_EXPIRED'
                  AND actor_user_id IS NULL AND from_state = 'ACTIVE' AND to_state = 'EXPIRED' AND result = 'ACCEPTED'
                  AND occurred_at = '2026-09-28T15:30:00Z'
                """, reservation));
        clock.set(UNTIL);
        assertEquals("AVAILABLE", availability(asset));
    }

    @Test
    void theJobExpiresEachDueReservationOnceAndARolledBackPassLeavesNothingHalfDone() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                UNTIL.minusSeconds(30));
        UUID challenge = fixtures.challenge(attempt, UNTIL.minusSeconds(30), false);
        clock.set(UNTIL.plusSeconds(5));

        // A crash after the decision but before the commit: everything it wrote goes back.
        try {
            new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
                assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL.plusSeconds(5), false));
                throw new IllegalStateException("crash before commit");
            });
        } catch (IllegalStateException expected) {
            // The rollback is the point of this step.
        }
        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));
        assertEquals("AWAITING_LOCAL_PROOF", fixtures.operationStatus(attempt));
        assertEquals(0L, expiredEvents(reservation));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.audit_events WHERE operation_id = :id", attempt));
        assertEquals("PENDING", challengeStatus(challenge));

        expiry.expireDue(100);
        expiry.expireDue(100);

        assertEquals("EXPIRED", fixtures.reservationStatus(reservation));
        assertEquals(1L, expiredEvents(reservation));
        assertEquals("EXPIRED", challengeStatus(challenge));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'LOCAL_CHALLENGE_EXPIRED'
                """, challenge));
    }

    /** Document 05, section 5.7: a QR wait does not defer the expiry; both end in the same transaction. */
    @Test
    void anAttemptWaitingForItsQrExpiresWithTheReservation() {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                UNTIL.minusSeconds(30));

        assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, false));

        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.locker_operations
                WHERE id = :id AND status = 'EXPIRED' AND failure_reason = 'RESERVATION_EXPIRED'
                  AND terminal_at = '2026-09-28T15:30:00Z' AND authorized_at IS NULL
                """, attempt));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE operation_id = :id AND event_type = 'OPERATION_EXPIRED' AND actor_user_id IS NULL
                  AND from_state = 'AWAITING_LOCAL_PROOF' AND to_state = 'EXPIRED'
                """, attempt));
        assertEquals("EXPIRED", fixtures.reservationStatus(reservation));
    }

    /**
     * Document 06, section 14.1 and document 08, section 4.6: the pending challenge of a QR wait expires with the
     * reservation and its display instruction stops with its ciphertext purged; a sendable instruction becomes
     * {@code CANCELLED}, an acknowledged one keeps its status. A challenge already closed stays as it is.
     */
    @Test
    void aPendingQrChallengeExpiresWithItsReservationAndItsCiphertextIsPurged() {
        for (String displayStatus : new String[] {"PENDING", "ACKNOWLEDGED"}) {
            UUID asset = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
            UUID holder = accounts.technician().id();
            UUID reservation = fixtures.reservation(asset, holder, "ACTIVE", FROM, UNTIL);
            UUID attempt = fixtures.attempt(asset, holder, reservation, "AWAITING_LOCAL_PROOF", false,
                    UNTIL.minusSeconds(30));
            UUID challenge = fixtures.challenge(attempt, UNTIL.minusSeconds(30), true);
            UUID display = fixtures.display(challenge, displayStatus, UNTIL.minusSeconds(30));

            assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, false), displayStatus);

            assertEquals(1L, fixtures.count("""
                    SELECT count(*) FROM aegis.local_access_challenges
                    WHERE id = :id AND status = 'EXPIRED' AND closed_at = '2026-09-28T15:30:00Z'
                    """, challenge), displayStatus);
            assertEquals(1L, jdbc.sql("""
                    SELECT count(*) FROM aegis.hub_display_outbox
                    WHERE id = :id AND status = :status AND encrypted_payload IS NULL AND claim_until IS NULL
                    """).param("id", display)
                    .param("status", displayStatus.equals("PENDING") ? "CANCELLED" : "ACKNOWLEDGED")
                    .query(Long.class).single(), displayStatus);
            assertEquals(1L, jdbc.sql("""
                    SELECT count(*) FROM aegis.audit_events
                    WHERE subject_id = :challenge AND subject_type = 'LOCAL_ACCESS_CHALLENGE'
                      AND event_type = 'LOCAL_CHALLENGE_EXPIRED' AND operation_id = :attempt AND actor_user_id IS NULL
                      AND from_state = 'PENDING' AND to_state = 'EXPIRED' AND reason = 'RESERVATION_EXPIRED'
                      AND occurred_at = '2026-09-28T15:30:00Z'
                    """).param("challenge", challenge).param("attempt", attempt).query(Long.class).single(),
                    displayStatus);
        }

        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        UUID attempt = fixtures.attempt(asset, technician.id(), reservation, "AWAITING_LOCAL_PROOF", false,
                UNTIL.minusSeconds(90));
        UUID challenge = fixtures.challenge(attempt, UNTIL.minusSeconds(90), false);
        jdbc.sql("""
                UPDATE aegis.local_access_challenges SET status = 'EXPIRED', closed_at = expires_at WHERE id = :id
                """).param("id", challenge).update();

        assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, false));
        assertEquals("EXPIRED", fixtures.operationStatus(attempt));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.local_access_challenges
                WHERE id = :id AND status = 'EXPIRED' AND closed_at = '2026-09-28T15:29:30Z'
                """, challenge));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id", challenge));
    }

    /**
     * Document 09, section 8.10: an attempt in anomaly defers the expiry only while its anomaly is not
     * {@code RESOLVED}; once resolved, the reservation expires and frees its asset.
     */
    @Test
    void onlyAnUnresolvedAnomalyDefersTheExpiry() throws Exception {
        for (String anomaly : new String[] {"OPEN", "RESOLVED"}) {
            UUID asset = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
            UUID holder = accounts.technician().id();
            UUID reservation = fixtures.reservation(asset, holder, "ACTIVE", FROM, UNTIL);
            UUID attempt = fixtures.attempt(asset, holder, reservation, "ANOMALY", true, UNTIL.minusSeconds(300));
            fixtures.anomaly(attempt, anomaly, UNTIL.minusSeconds(240));

            boolean resolved = anomaly.equals("RESOLVED");
            assertEquals(resolved ? Outcome.EXPIRED : Outcome.DEFERRED,
                    expiry.expire(reservation, UNTIL.plusSeconds(600), true), anomaly);
            assertEquals(resolved ? "EXPIRED" : "ACTIVE", fixtures.reservationStatus(reservation), anomaly);
            assertEquals("ANOMALY", fixtures.operationStatus(attempt));
        }
    }

    /**
     * Document 06, section 14.1: an authorized attempt not yet classified, or one in anomaly, defers the expiry and
     * the asset stays reserved; once the attempt has ended safely without a loan, the reservation expires.
     */
    @Test
    void anAuthorizedOrUncertainAttemptDefersTheExpiryAndKeepsTheAssetReserved() throws Exception {
        for (String status : new String[] {"AUTHORIZED", "COMMAND_SENT", "ANOMALY"}) {
            UUID asset = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
            UUID holder = accounts.technician().id();
            UUID reservation = fixtures.reservation(asset, holder, "ACTIVE", FROM, UNTIL);
            UUID attempt = fixtures.attempt(asset, holder, reservation, status, true, UNTIL.minusSeconds(30));

            assertEquals(Outcome.DEFERRED, expiry.expire(reservation, UNTIL.plusSeconds(600), true), status);
            assertEquals("ACTIVE", fixtures.reservationStatus(reservation), status);
            assertEquals(status, fixtures.operationStatus(attempt));
            assertEquals(0L, expiredEvents(reservation), status);
            clock.set(UNTIL.plusSeconds(600));
            assertEquals("RESERVED", availability(asset), status);
            clock.set(START);
        }

        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        fixtures.attempt(asset, technician.id(), reservation, "FAILED", true, UNTIL.minusSeconds(300));
        assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, true));
    }

    /** A fulfilled reservation never expires and its loan keeps the asset borrowed, late or not. */
    @Test
    void anOpenLoanIsNeverReleasedByTheExpiry() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID loan = fixtures.loan(asset, technician.id(), FROM);
        UUID fulfilled = jdbc.sql("SELECT reservation_id FROM aegis.locker_operations WHERE asset_id = :id")
                .param("id", asset).query(UUID.class).single();
        clock.set(UNTIL.plusSeconds(86_400));

        expiry.expireDue(100);
        assertEquals(Outcome.UNCHANGED, expiry.expire(fulfilled, UNTIL.plusSeconds(86_400), true));

        assertEquals("FULFILLED", fixtures.reservationStatus(fulfilled));
        assertEquals(0L, expiredEvents(fulfilled));
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.loans WHERE id = :id AND status = 'ACTIVE'",
                loan));
        assertEquals("BORROWED", availability(asset));
    }

    @Test
    void concurrentWorkersExpireEachDueReservationExactlyOnce() throws Exception {
        List<UUID> due = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            due.add(fixtures.reservation(fixtures.asset(locker), accounts.technician().id(), "ACTIVE", FROM, UNTIL));
        }
        clock.set(UNTIL);

        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> workers = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            workers.add(executor.submit(() -> {
                start.await();
                return expiry.expireDue(100);
            }));
        }
        start.countDown();
        for (Future<Integer> worker : workers) {
            worker.get(30, TimeUnit.SECONDS);
        }
        // A worker skips an asset another one holds: a last pass picks up anything skipped.
        expiry.expireDue(100);

        for (UUID reservation : due) {
            assertEquals("EXPIRED", fixtures.reservationStatus(reservation));
            assertEquals(1L, expiredEvents(reservation));
        }
    }

    /** The cancellation holds the asset lock: the expiry waits, then finds the reservation cancelled and does nothing. */
    @Test
    void anExpiryAfterACancellationChangesNothing() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        clock.set(UNTIL.minusSeconds(1));
        List<CompletableFuture<Outcome>> expiring = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            reservations.cancel(technician.id(), reservation);
            expiring.add(CompletableFuture.supplyAsync(() -> expiry.expire(reservation, UNTIL, true), executor));
            pause();
            assertFalse(expiring.getFirst().isDone(), "the expiry should wait for the asset lock");
        });

        assertEquals(Outcome.UNCHANGED, expiring.getFirst().get(30, TimeUnit.SECONDS));
        assertEquals("CANCELLED", fixtures.reservationStatus(reservation));
        assertEquals(0L, expiredEvents(reservation));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED'
                """, reservation));
    }

    /** The expiry holds the asset lock: the cancellation waits, then finds the reservation expired and is refused. */
    @Test
    void aCancellationAfterAnExpiryIsRefusedAndWritesNothing() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        // The cancellation still runs before reservedUntil by its own clock: only the lock decides the order.
        clock.set(UNTIL.minusSeconds(1));
        List<CompletableFuture<ApiError>> cancelling = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, true));
            cancelling.add(CompletableFuture.supplyAsync(() -> outcome(reservation), executor));
            pause();
            assertFalse(cancelling.getFirst().isDone(), "the cancellation should wait for the asset lock");
        });

        assertEquals(ApiError.RESERVATION_NOT_CANCELLABLE, cancelling.getFirst().get(30, TimeUnit.SECONDS));
        assertEquals("EXPIRED", fixtures.reservationStatus(reservation));
        assertEquals(1L, expiredEvents(reservation));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'RESERVATION_CANCELLED'
                """, reservation));
    }

    /** A pass of the job never waits behind a transaction that holds the asset: it skips it for a later pass. */
    @Test
    void theJobSkipsAnAssetThatAnotherTransactionHolds() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", FROM, UNTIL);
        List<CompletableFuture<Outcome>> pass = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            jdbc.sql("SELECT id FROM aegis.assets WHERE id = :id FOR UPDATE").param("id", asset).query(UUID.class)
                    .single();
            pass.add(CompletableFuture.supplyAsync(() -> expiry.expire(reservation, UNTIL, false), executor));
            try {
                assertEquals(Outcome.SKIPPED, pass.getFirst().get(10, TimeUnit.SECONDS));
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });

        assertEquals("ACTIVE", fixtures.reservationStatus(reservation));
        assertEquals(Outcome.EXPIRED, expiry.expire(reservation, UNTIL, false));
    }

    private ApiError outcome(UUID reservation) {
        try {
            reservations.cancel(technician.id(), reservation);
            return null;
        } catch (ApiException refused) {
            return refused.error();
        }
    }

    private String availability(UUID asset) throws Exception {
        String body = mvc.perform(get("/api/v1/assets/" + asset)
                .header(AUTHORIZATION, bearer(accessToken(technician))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.availability").isString())
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(body, "$.availability");
    }

    private long expiredEvents(UUID reservation) {
        return fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id AND event_type = 'RESERVATION_EXPIRED'
                """, reservation);
    }

    private static void pause() {
        try {
            Thread.sleep(500);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    private String challengeStatus(UUID challenge) {
        return jdbc.sql("SELECT status FROM aegis.local_access_challenges WHERE id = :id").param("id", challenge)
                .query(String.class).single();
    }
}
