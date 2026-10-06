package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

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
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

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
 * Races of the catalog against PostgreSQL: the unique indexes are the final guard for identities, and the model row
 * locks keep an unarchived asset from ever referencing an archived model.
 */
class CatalogConcurrencyTests extends ApiIntegrationTest {

    private static final long BLOCKED_MILLIS = 300;

    @Autowired
    AssetModelService models;

    @Autowired
    AdminAssetService assets;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    JdbcClient jdbc;

    private ExecutorService executor;
    private String suffix;

    @BeforeEach
    void startExecutor() {
        executor = Executors.newFixedThreadPool(8);
        suffix = UUID.randomUUID().toString().substring(0, 8);
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void concurrentCreationsOfOneAssetCodeCreateExactlyOneAsset() throws Exception {
        UUID model = models.create(model("Course " + suffix)).id();
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ApiError>> attempts = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            String code = (i % 2 == 0 ? "race-" : "RACE-") + suffix;
            attempts.add(executor.submit(() -> {
                start.await();
                return outcome(() -> assets.create(asset(model, code)));
            }));
        }
        start.countDown();

        int created = 0;
        for (Future<ApiError> attempt : attempts) {
            ApiError error = attempt.get(30, TimeUnit.SECONDS);
            if (error == null) {
                created++;
            } else {
                assertEquals(ApiError.ASSET_CODE_ALREADY_EXISTS, error);
            }
        }
        assertEquals(1, created);
        assertEquals(1L, jdbc.sql("SELECT count(*) FROM aegis.assets WHERE lower(asset_code) = :code")
                .param("code", "race-" + suffix).query(Long.class).single());
    }

    @Test
    void archivalWaitsForAnAssetBeingCreatedOnTheModelAndThenRefuses() throws Exception {
        UUID model = models.create(model("Attente création " + suffix)).id();
        AtomicReference<CompletableFuture<ApiError>> archival = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            assets.create(asset(model, "WAIT-" + suffix));
            archival.set(CompletableFuture.supplyAsync(() -> outcome(() -> models.archive(model)), executor));
            assertStillBlocked(archival.get());
        });

        assertEquals(ApiError.ASSET_MODEL_IN_USE, archival.get().get(30, TimeUnit.SECONDS));
        assertNull(archivedAt(model));
    }

    @Test
    void assetCreationWaitsForAnArchivalInProgressAndThenRefuses() throws Exception {
        UUID model = models.create(model("Attente archivage " + suffix)).id();
        AtomicReference<CompletableFuture<ApiError>> creation = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            models.archive(model);
            creation.set(CompletableFuture.supplyAsync(
                    () -> outcome(() -> assets.create(asset(model, "LATE-" + suffix))), executor));
            assertStillBlocked(creation.get());
        });

        assertEquals(ApiError.VALIDATION_ERROR, creation.get().get(30, TimeUnit.SECONDS));
        assertNotNull(archivedAt(model));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.assets WHERE asset_code = :code")
                .param("code", "LATE-" + suffix).query(Long.class).single());
    }

    @Test
    void failedCreationLeavesNoPartialRow() {
        UUID model = models.create(model("Rollback " + suffix)).id();
        assets.create(asset(model, "RB-" + suffix));

        AssetRequest duplicate = new AssetRequest(model, "rb-" + suffix, "SN-RB-" + suffix, AccessLevel.STANDARD,
                OperationalStatus.SERVICEABLE, false, null);
        assertEquals(ApiError.ASSET_CODE_ALREADY_EXISTS, outcome(() -> assets.create(duplicate)));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.assets WHERE serial_number = :serial")
                .param("serial", "SN-RB-" + suffix).query(Long.class).single());
    }

    private static void assertStillBlocked(CompletableFuture<ApiError> future) {
        try {
            Thread.sleep(BLOCKED_MILLIS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
        assertFalse(future.isDone(), "the concurrent transaction should wait for the row lock");
    }

    private Instant archivedAt(UUID model) {
        return models.get(model).archivedAt();
    }

    private static ApiError outcome(Supplier<?> action) {
        try {
            action.get();
            return null;
        } catch (ApiException refused) {
            return refused.error();
        }
    }

    private static AssetModelRequest model(String name) {
        return new AssetModelRequest(name, null, null, null, false);
    }

    private static AssetRequest asset(UUID model, String code) {
        return new AssetRequest(model, code, null, AccessLevel.STANDARD, OperationalStatus.SERVICEABLE, false, null);
    }
}
