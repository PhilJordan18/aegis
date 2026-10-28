package ca.aegis.control.reservation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

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
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Races of document 06, section 5.3: each attempt runs in its own transaction on its own connection. The user and
 * asset row locks serialize the checks; the partial unique indexes of V005 stay the final guard when a row is inserted
 * by a transaction that took no lock.
 */
@Import(PresentAssetsConfiguration.class)
class ReservationConcurrencyTests extends ApiIntegrationTest {

    private static final int ATTEMPTS = 6;
    private static final Instant UNTIL = Instant.parse("2026-09-28T15:30:00Z");

    @Autowired
    ReservationService reservations;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    private ExecutorService executor;
    private ReservationFixtures fixtures;
    private UUID locker;

    @BeforeEach
    void prepare() {
        executor = Executors.newFixedThreadPool(ATTEMPTS);
        fixtures = new ReservationFixtures(jdbc);
        locker = fixtures.scheduledLocker(accounts.admin().id());
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void severalTechniciansReservingOneAssetCreateExactlyOneReservation() throws Exception {
        UUID asset = fixtures.asset(locker);
        List<Supplier<?>> attempts = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            UUID technician = accounts.technician().id();
            attempts.add(() -> reservations.create(technician, new CreateReservationRequest(asset, UNTIL)));
        }

        List<ApiError> outcomes = race(attempts);

        assertEquals(1, outcomes.stream().filter(outcome -> outcome == null).count(), outcomes::toString);
        assertEquals(ATTEMPTS - 1, outcomes.stream().filter(outcome -> outcome == ApiError.ASSET_ALREADY_RESERVED)
                .count(), outcomes::toString);
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id", asset));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'RESERVATION_CREATED' AND details ->> 'assetId' = CAST(:id AS text)
                """, asset));
    }

    @Test
    void oneTechnicianReservingSeveralAssetsAtOnceHoldsExactlyOne() throws Exception {
        UUID technician = accounts.technician().id();
        List<Supplier<?>> attempts = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            UUID asset = fixtures.asset(locker);
            attempts.add(() -> reservations.create(technician, new CreateReservationRequest(asset, UNTIL)));
        }

        List<ApiError> outcomes = race(attempts);

        assertEquals(1, outcomes.stream().filter(outcome -> outcome == null).count(), outcomes::toString);
        assertEquals(ATTEMPTS - 1, outcomes.stream()
                .filter(outcome -> outcome == ApiError.USER_ALREADY_HAS_ACTIVE_RESERVATION).count(),
                outcomes::toString);
        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE user_id = :id", technician));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE event_type = 'RESERVATION_CREATED' AND actor_user_id = :id
                """, technician));
    }

    /**
     * Another transaction inserts an active reservation of the same technician on another asset and commits only
     * after this request has passed its checks. Its foreign key holds only a {@code KEY SHARE} lock on the user row,
     * which the {@code FOR NO KEY UPDATE} guard does not wait for, and its row is invisible until commit: the request
     * then waits on {@code ux_reservations_one_active_per_user} and its {@code 23505} becomes the documented conflict.
     */
    @Test
    void theUniqueIndexIsTheFinalGuardAgainstAnUnlockedConcurrentInsert() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID elsewhere = fixtures.asset(locker);
        UUID technician = accounts.technician().id();
        List<CompletableFuture<ApiError>> attempt = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            fixtures.reservation(elsewhere, technician, "ACTIVE", START, UNTIL);
            attempt.add(CompletableFuture.supplyAsync(() -> outcome(() -> reservations.create(technician,
                    new CreateReservationRequest(asset, UNTIL))), executor));
            pause();
            assertFalse(attempt.getFirst().isDone(), "the request should wait on the unique index");
        });

        assertEquals(ApiError.USER_ALREADY_HAS_ACTIVE_RESERVATION, attempt.getFirst().get(30, TimeUnit.SECONDS));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id", asset));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events WHERE event_type = 'RESERVATION_CREATED' AND actor_user_id = :id
                """, technician));
    }

    /**
     * An archival holds the asset lock while the request arrives: the request waits for it, then reads the archived
     * asset and is refused, instead of reserving an asset that left the catalog (document 09, section 12.2).
     */
    @Test
    void aRequestWaitsForAnArchivalHoldingTheAssetLockAndIsThenRefused() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID technician = accounts.technician().id();
        List<CompletableFuture<ApiError>> attempt = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            lockAsset(asset);
            jdbc.sql("UPDATE aegis.assets SET archived_at = :now WHERE id = :id")
                    .param("now", ReservationFixtures.utc(START)).param("id", asset).update();
            attempt.add(CompletableFuture.supplyAsync(() -> outcome(() -> reservations.create(technician,
                    new CreateReservationRequest(asset, UNTIL))), executor));
            pause();
            assertFalse(attempt.getFirst().isDone(), "the request should wait for the asset lock");
        });

        assertEquals(ApiError.ASSET_NOT_READY, attempt.getFirst().get(30, TimeUnit.SECONDS));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id", asset));
    }

    /**
     * A placement change holds the asset lock and moves the asset to a locker without a schedule: once the lock is
     * released, the request applies the schedule of the new locker, not the one it saw before waiting.
     */
    @Test
    void aRequestWaitsForAPlacementChangeAndAppliesTheScheduleOfTheNewLocker() throws Exception {
        UUID asset = fixtures.asset(locker);
        UUID unscheduled = fixtures.locker();
        UUID technician = accounts.technician().id();
        List<CompletableFuture<ApiError>> attempt = new ArrayList<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            lockAsset(asset);
            jdbc.sql("UPDATE aegis.asset_placements SET removed_at = :now WHERE asset_id = :id AND removed_at IS NULL")
                    .param("now", ReservationFixtures.utc(START)).param("id", asset).update();
            UUID compartment = jdbc.sql("""
                    INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                    VALUES (:locker, 'M1', 1, 1)
                    RETURNING id
                    """).param("locker", unscheduled).query(UUID.class).single();
            jdbc.sql("""
                    INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                    VALUES (:asset, :compartment, 'Déplacement', :now)
                    """).param("asset", asset).param("compartment", compartment)
                    .param("now", ReservationFixtures.utc(START)).update();
            attempt.add(CompletableFuture.supplyAsync(() -> outcome(() -> reservations.create(technician,
                    new CreateReservationRequest(asset, UNTIL))), executor));
            pause();
            assertFalse(attempt.getFirst().isDone(), "the request should wait for the asset lock");
        });

        assertEquals(ApiError.OUTSIDE_OPERATING_HOURS, attempt.getFirst().get(30, TimeUnit.SECONDS));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id", asset));
    }

    private void lockAsset(UUID asset) {
        jdbc.sql("SELECT id FROM aegis.assets WHERE id = :id FOR UPDATE").param("id", asset).query(UUID.class).single();
    }

    private List<ApiError> race(List<Supplier<?>> actions) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ApiError>> attempts = new ArrayList<>();
        for (Supplier<?> action : actions) {
            attempts.add(executor.submit(() -> {
                start.await();
                return outcome(action);
            }));
        }
        start.countDown();
        List<ApiError> outcomes = new ArrayList<>();
        for (Future<ApiError> attempt : attempts) {
            outcomes.add(attempt.get(30, TimeUnit.SECONDS));
        }
        return outcomes;
    }

    private static ApiError outcome(Supplier<?> action) {
        try {
            action.get();
            return null;
        } catch (ApiException refused) {
            return refused.error();
        }
    }

    private static void pause() {
        try {
            Thread.sleep(500);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
