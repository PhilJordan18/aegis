package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Races on physical identifiers and placements: the asset row lock serializes the mutations of one asset, and the
 * partial unique indexes of V002 and V003 are the final guard between two assets.
 */
class PhysicalCatalogConcurrencyTests extends ApiIntegrationTest {

    private static final int ATTEMPTS = 8;
    private static final long BLOCKED_MILLIS = 300;

    @Autowired
    AssetModelService models;

    @Autowired
    AdminAssetService assets;

    @Autowired
    AssetIdentifierService identifiers;

    @Autowired
    AssetPlacementService placements;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    private ExecutorService executor;
    private String suffix;
    private UUID actor;

    @BeforeEach
    void startExecutor() {
        executor = Executors.newFixedThreadPool(ATTEMPTS);
        suffix = UUID.randomUUID().toString().substring(0, 8);
        actor = accounts.admin().id();
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void oneTagAssignedConcurrentlyToSeveralAssetsIsActiveOnExactlyOne() throws Exception {
        UUID model = models.create(new AssetModelRequest("Course tag " + suffix, null, null, null, false), actor)
                .id();
        List<UUID> candidates = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            candidates.add(asset(model, "TAGRACE-" + i + "-" + suffix));
        }
        String tag = "E300" + suffix;

        List<ApiError> outcomes = race(candidates.stream().<Supplier<?>>map(asset -> () -> identifiers.assign(
                asset, new AssetIdentifierRequest("RFID_UHF", tag), actor)).toList());

        assertEquals(1, outcomes.stream().filter(outcome -> outcome == null).count(), outcomes::toString);
        assertEquals(ATTEMPTS - 1, outcomes.stream()
                .filter(outcome -> outcome == ApiError.IDENTIFIER_ALREADY_ASSIGNED).count(), outcomes::toString);
        assertEquals(1L, jdbc.sql("SELECT count(*) FROM aegis.asset_identifiers WHERE identifier_value = :tag")
                .param("tag", tag).query(Long.class).single());
        assertEquals(1L, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'ASSET_IDENTIFIER_ASSIGNED' AND details -> 'assigned' ->> 'value' = :tag
                """).param("tag", tag).query(Long.class).single());
    }

    @Test
    void concurrentRevocationsOfOneIdentifierRevokeItOnceAndRecordTheOthersAsAlreadyApplied() throws Exception {
        UUID model = models.create(new AssetModelRequest("Course révocation " + suffix, null, null, null, false),
                actor).id();
        UUID asset = asset(model, "REVRACE-" + suffix);
        UUID identifier = identifiers.assign(asset, new AssetIdentifierRequest("NFC", "N-" + suffix), actor).id();
        List<Supplier<?>> revocations = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            revocations.add(() -> identifiers.revoke(asset, identifier, actor));
        }

        List<ApiError> outcomes = race(revocations);

        assertEquals(ATTEMPTS, outcomes.stream().filter(outcome -> outcome == null).count(), outcomes::toString);
        assertEquals(Map.of("ACCEPTED", 1L, "ALREADY_APPLIED", (long) ATTEMPTS - 1), jdbc.sql("""
                SELECT result, count(*) AS events FROM aegis.audit_events
                WHERE event_type = 'ASSET_UPDATED' AND subject_type = 'ASSET_IDENTIFIER' AND subject_id = :id
                GROUP BY result
                """).param("id", identifier)
                .query((row, number) -> Map.entry(row.getString("result"), row.getLong("events")))
                .list().stream().collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
        assertFalse(jdbc.sql("SELECT active FROM aegis.asset_identifiers WHERE id = :id").param("id", identifier)
                .query(Boolean.class).single());
    }

    @Test
    void severalAssetsPlacedConcurrentlyInOneCompartmentLeaveExactlyOneThere() throws Exception {
        UUID model = models.create(new AssetModelRequest("Course cellule " + suffix, null, null, null, false), actor)
                .id();
        UUID compartment = PlacementFixtures.compartment(jdbc, PlacementFixtures.locker(jdbc, "RACE-" + suffix),
                "A1", 1);
        List<UUID> candidates = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            candidates.add(asset(model, "CELLRACE-" + i + "-" + suffix));
        }

        List<ApiError> outcomes = race(candidates.stream().<Supplier<?>>map(asset -> () -> placements.place(
                asset, new PlacementRequest(compartment, "Course"), actor)).toList());

        assertEquals(1, outcomes.stream().filter(outcome -> outcome == null).count(), outcomes::toString);
        assertEquals(ATTEMPTS - 1, outcomes.stream()
                .filter(outcome -> outcome == ApiError.COMPARTMENT_ALREADY_OCCUPIED).count(), outcomes::toString);
        assertEquals(1L, jdbc.sql("SELECT count(*) FROM aegis.asset_placements WHERE compartment_id = :id")
                .param("id", compartment).query(Long.class).single());
        assertEquals(1L, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'ASSET_PLACEMENT_CHANGED' AND details -> 'to' ->> 'compartmentId' = :id
                """).param("id", compartment.toString()).query(Long.class).single());
    }

    /** Each asset moves into the cell the other one leaves: the compartment locks are taken in one order. */
    @Test
    void twoAssetsSwappingCellsConcurrentlyNeverDeadlockOrShareACell() throws Exception {
        UUID model = models.create(new AssetModelRequest("Course échange " + suffix, null, null, null, false), actor)
                .id();
        UUID locker = PlacementFixtures.locker(jdbc, "SWAP-" + suffix);
        UUID left = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        UUID right = PlacementFixtures.compartment(jdbc, locker, "A2", 2);
        UUID first = asset(model, "SWAP-1-" + suffix);
        UUID second = asset(model, "SWAP-2-" + suffix);
        placements.place(first, new PlacementRequest(left, "Initial"), actor);
        placements.place(second, new PlacementRequest(right, "Initial"), actor);

        List<ApiError> outcomes = race(List.of(
                () -> placements.place(first, new PlacementRequest(right, "Échange"), actor),
                () -> placements.place(second, new PlacementRequest(left, "Échange"), actor)));

        assertEquals(List.of(ApiError.COMPARTMENT_ALREADY_OCCUPIED, ApiError.COMPARTMENT_ALREADY_OCCUPIED), outcomes);
        assertEquals(List.of(first + " " + left, second + " " + right), jdbc.sql("""
                SELECT asset_id || ' ' || compartment_id FROM aegis.asset_placements
                WHERE asset_id IN (:first, :second) AND removed_at IS NULL ORDER BY asset_id = :second
                """).param("first", first).param("second", second).query(String.class).list());
    }

    @Test
    void anArchivalWaitingForAPlacementChangeEndsTheNewPlacement() throws Exception {
        UUID model = models.create(new AssetModelRequest("Archivage après " + suffix, null, null, null, false), actor)
                .id();
        UUID locker = PlacementFixtures.locker(jdbc, "ARCH-A-" + suffix);
        UUID left = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        UUID right = PlacementFixtures.compartment(jdbc, locker, "A2", 2);
        UUID asset = asset(model, "ARCH-A-" + suffix);
        placements.place(asset, new PlacementRequest(left, "Initial"), actor);
        AtomicReference<CompletableFuture<ApiError>> archival = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            placements.place(asset, new PlacementRequest(right, "Déplacement"), actor);
            archival.set(CompletableFuture.supplyAsync(() -> outcome(() -> assets.archive(asset, actor)), executor));
            assertStillBlocked(archival.get());
        });

        assertEquals(null, archival.get().get(30, TimeUnit.SECONDS));
        assertCoherentArchivedAsset(asset, 2, 3);
    }

    @Test
    void aPlacementChangeWaitingForAnArchivalIsRefused() throws Exception {
        UUID model = models.create(new AssetModelRequest("Archivage avant " + suffix, null, null, null, false), actor)
                .id();
        UUID locker = PlacementFixtures.locker(jdbc, "ARCH-B-" + suffix);
        UUID left = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        UUID right = PlacementFixtures.compartment(jdbc, locker, "A2", 2);
        UUID asset = asset(model, "ARCH-B-" + suffix);
        placements.place(asset, new PlacementRequest(left, "Initial"), actor);
        AtomicReference<CompletableFuture<ApiError>> change = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            assets.archive(asset, actor);
            change.set(CompletableFuture.supplyAsync(() -> outcome(() -> placements.place(asset,
                    new PlacementRequest(right, "Trop tard"), actor)), executor));
            assertStillBlocked(change.get());
        });

        assertEquals(ApiError.ASSET_ARCHIVED, change.get().get(30, TimeUnit.SECONDS));
        assertCoherentArchivedAsset(asset, 1, 2);
    }

    /** Without a forced order, whichever transaction wins leaves an archived asset with no active placement. */
    @Test
    void archivalsRacingPlacementChangesNeverLeaveAnActivePlacementOnAnArchivedAsset() throws Exception {
        UUID model = models.create(new AssetModelRequest("Archivage course " + suffix, null, null, null, false),
                actor).id();
        UUID locker = PlacementFixtures.locker(jdbc, "ARCH-C-" + suffix);
        List<UUID> cells = new ArrayList<>();
        for (int i = 1; i <= ATTEMPTS; i++) {
            cells.add(PlacementFixtures.compartment(jdbc, locker, "C" + i, i));
        }
        for (int round = 0; round < ATTEMPTS; round++) {
            UUID asset = asset(model, "ARCH-C-" + round + "-" + suffix);
            placements.place(asset, new PlacementRequest(cells.get(round), "Initial"), actor);
            // The target is still free: only the archived asset of round 0 ever held cell C1.
            UUID target = cells.get((round + 1) % ATTEMPTS);

            List<ApiError> outcomes = race(List.of(
                    () -> placements.place(asset, new PlacementRequest(target, "Course"), actor),
                    () -> assets.archive(asset, actor)));

            assertEquals(null, outcomes.get(1));
            assertEquals(true, outcomes.getFirst() == null || outcomes.getFirst() == ApiError.ASSET_ARCHIVED,
                    outcomes::toString);
            assertEquals(0L, jdbc.sql("""
                    SELECT count(*) FROM aegis.asset_placements WHERE asset_id = :id AND removed_at IS NULL
                    """).param("id", asset).query(Long.class).single());
        }
    }

    /** The asset is archived, every placement row is kept and ended, and each effective change has one event. */
    private void assertCoherentArchivedAsset(UUID asset, long rows, long placementEvents) {
        assertEquals(true, jdbc.sql("SELECT archived_at IS NOT NULL FROM aegis.assets WHERE id = :id")
                .param("id", asset).query(Boolean.class).single());
        assertEquals(List.of(rows, 0L), jdbc.sql("""
                SELECT count(*) AS total, count(*) FILTER (WHERE removed_at IS NULL) AS active
                FROM aegis.asset_placements WHERE asset_id = :id
                """).param("id", asset).query((row, number) -> List.of(row.getLong("total"), row.getLong("active")))
                .single());
        assertEquals(placementEvents, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'ASSET_PLACEMENT_CHANGED' AND subject_id = :id
                """).param("id", asset).query(Long.class).single());
    }

    private static void assertStillBlocked(CompletableFuture<ApiError> future) {
        try {
            Thread.sleep(BLOCKED_MILLIS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
        assertFalse(future.isDone(), "the concurrent transaction should wait for the asset row lock");
    }

    private UUID asset(UUID model, String code) {
        return assets.create(new AssetRequest(model, code, null, AccessLevel.STANDARD, OperationalStatus.SERVICEABLE,
                false, null), actor).id();
    }

    /** Starts every action at once and returns, in order, the refusal of each or {@code null} for a success. */
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
}
