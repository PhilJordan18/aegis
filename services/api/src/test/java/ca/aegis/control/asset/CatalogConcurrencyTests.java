package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
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
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
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

    @Autowired
    AuditTrail auditTrail;

    private ExecutorService executor;
    private String suffix;
    private UUID actor;

    @BeforeEach
    void startExecutor() {
        executor = Executors.newFixedThreadPool(8);
        suffix = UUID.randomUUID().toString().substring(0, 8);
        actor = accounts.admin().id();
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void concurrentCreationsOfOneAssetCodeCreateExactlyOneAsset() throws Exception {
        UUID model = models.create(model("Course " + suffix), actor).id();
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ApiError>> attempts = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            String code = (i % 2 == 0 ? "race-" : "RACE-") + suffix;
            attempts.add(executor.submit(() -> {
                start.await();
                return outcome(() -> assets.create(asset(model, code), actor));
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
        UUID model = models.create(model("Attente création " + suffix), actor).id();
        AtomicReference<CompletableFuture<ApiError>> archival = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            assets.create(asset(model, "WAIT-" + suffix), actor);
            archival.set(CompletableFuture.supplyAsync(() -> outcome(() -> models.archive(model, actor)), executor));
            assertStillBlocked(archival.get());
        });

        assertEquals(ApiError.ASSET_MODEL_IN_USE, archival.get().get(30, TimeUnit.SECONDS));
        assertNull(archivedAt(model));
    }

    @Test
    void assetCreationWaitsForAnArchivalInProgressAndThenRefuses() throws Exception {
        UUID model = models.create(model("Attente archivage " + suffix), actor).id();
        AtomicReference<CompletableFuture<ApiError>> creation = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            models.archive(model, actor);
            creation.set(CompletableFuture.supplyAsync(
                    () -> outcome(() -> assets.create(asset(model, "LATE-" + suffix), actor)), executor));
            assertStillBlocked(creation.get());
        });

        assertEquals(ApiError.VALIDATION_ERROR, creation.get().get(30, TimeUnit.SECONDS));
        assertNotNull(archivedAt(model));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.assets WHERE asset_code = :code")
                .param("code", "LATE-" + suffix).query(Long.class).single());
    }

    @Test
    void concurrentArchivalsOfOneAssetWriteExactlyOneAcceptedArchivalEvent() throws Exception {
        UUID model = models.create(model("Archivages " + suffix), actor).id();
        UUID asset = assets.create(asset(model, "ARC-RACE-" + suffix), actor).id();
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ApiError>> attempts = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            attempts.add(executor.submit(() -> {
                start.await();
                return outcome(() -> assets.archive(asset, actor));
            }));
        }
        start.countDown();

        for (Future<ApiError> attempt : attempts) {
            assertNull(attempt.get(30, TimeUnit.SECONDS));
        }
        assertEquals(Map.of("ACCEPTED", 1L, "ALREADY_APPLIED", 7L), archivalResults(asset));
    }

    @Test
    void anArchivalWaitingForAnotherOneIsAuditedAsAlreadyApplied() throws Exception {
        UUID model = models.create(model("Archivage en attente " + suffix), actor).id();
        AtomicReference<CompletableFuture<ApiError>> second = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            models.archive(model, actor);
            second.set(CompletableFuture.supplyAsync(() -> outcome(() -> models.archive(model, actor)), executor));
            assertStillBlocked(second.get());
        });

        assertNull(second.get().get(30, TimeUnit.SECONDS));
        assertEquals(Map.of("ACCEPTED", 1L, "ALREADY_APPLIED", 1L), archivalResults(model));
    }

    @Test
    void failedCreationLeavesNoPartialRow() {
        UUID model = models.create(model("Rollback " + suffix), actor).id();
        assets.create(asset(model, "RB-" + suffix), actor);

        AssetRequest duplicate = new AssetRequest(model, "rb-" + suffix, "SN-RB-" + suffix, AccessLevel.STANDARD,
                OperationalStatus.SERVICEABLE, false, null);
        assertEquals(ApiError.ASSET_CODE_ALREADY_EXISTS, outcome(() -> assets.create(duplicate, actor)));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.assets WHERE serial_number = :serial")
                .param("serial", "SN-RB-" + suffix).query(Long.class).single());
        assertEquals(0L, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'ASSET_CREATED' AND details -> 'created' ->> 'serialNumber' = :serial
                """).param("serial", "SN-RB-" + suffix).query(Long.class).single());
    }

    /** The mutation and its event commit or roll back together. */
    @Test
    void aRolledBackMutationTakesItsEventWithIt() {
        AtomicReference<UUID> created = new AtomicReference<>();
        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            created.set(models.create(model("Annulé " + suffix), actor).id());
            transaction.setRollbackOnly();
        });

        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id")
                .param("id", created.get()).query(Long.class).single());
    }

    @Test
    void theAuditTrailRefusesToWriteOutsideATransaction() {
        AuditEvent event = new AuditEvent(AuditEventType.ASSET_UPDATED, actor, AuditSubjectType.ASSET,
                UUID.randomUUID(), AuditResult.ACCEPTED, Map.of(), START);

        assertThrows(IllegalTransactionStateException.class, () -> auditTrail.record(event));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.audit_events WHERE subject_id = :id")
                .param("id", event.subjectId()).query(Long.class).single());
    }

    private Map<String, Long> archivalResults(UUID subject) {
        return jdbc.sql("""
                SELECT result, count(*) AS events FROM aegis.audit_events
                WHERE event_type = 'ASSET_ARCHIVED' AND subject_id = :id
                GROUP BY result
                """)
                .param("id", subject)
                .query((row, number) -> Map.entry(row.getString("result"), row.getLong("events")))
                .list().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
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
