package ca.aegis.control.command;

import static ca.aegis.control.command.CommandFixtures.instant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandDispatcher.Outcome;
import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.command.CommandPublisher.CommandPublicationException;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Document 06, section 7.3 and document 08, section 9.2 on PostgreSQL, with an in-memory publisher: claim, publication
 * outside any transaction, mark, retry, expiry, crash recovery and concurrent dispatchers. The real broker is
 * exercised by {@link CommandBrokerTests}.
 */
class CommandDispatcherTests extends ApiIntegrationTest {

    private static final Duration LEASE = Duration.ofSeconds(15);

    @Autowired
    private CommandOutbox outbox;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private AuditTrail auditTrail;

    @Autowired
    private JdbcClient jdbc;

    private CommandFixtures fixtures;
    private final List<Publication> published = new CopyOnWriteArrayList<>();

    @BeforeEach
    void fixtures() {
        fixtures = new CommandFixtures(jdbc);
        fixtures.retireEarlierCommands();
    }

    @Test
    void publishesOutsideAnyTransactionThenMarksTheOperationSent() {
        Authorized authorized = authorizedCommand();
        List<String> statusWhilePublishing = new ArrayList<>();
        CommandDispatcher dispatcher = dispatcher((topic, payload) -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            // The claim has committed: another connection already sees the lease while the broker is awaited.
            statusWhilePublishing.add((String) fixtures.command(authorized.operation().id()).get("status"));
            record(topic, payload);
        });

        clock.advance(Duration.ofSeconds(1));
        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.PUBLISHED);

        assertThat(statusWhilePublishing).containsExactly("CLAIMED");
        assertThat(published).hasSize(1);
        Publication publication = published.getFirst();
        assertThat(publication.topic()).isEqualTo("aegis/v1/lockers/" + authorized.operation().locker() + "/commands");
        Map<String, Object> row = fixtures.command(authorized.operation().id());
        // The published bytes state exactly the stored contract.
        assertThat(jsonMapper.readTree(publication.payload())).isEqualTo(jsonMapper.readTree((String) row.get("payload")));
        JsonNode payload = jsonMapper.readTree(publication.payload());
        assertThat(payload.get("messageId").asString()).isEqualTo(authorized.command().messageId().toString());
        assertThat(payload.get("compartmentId").asString())
                .isEqualTo(authorized.operation().compartment().toString());
        assertThat(row).containsEntry("status", "DISPATCHED").containsEntry("attempt_count", 1);
        assertThat(row.get("claim_until")).isNull();
        assertThat(instant(row.get("published_at"))).isEqualTo(START.plusSeconds(1));

        Map<String, Object> operation = fixtures.operation(authorized.operation().id());
        assertThat(operation).containsEntry("status", "COMMAND_SENT");
        assertThat(instant(operation.get("command_sent_at"))).isEqualTo(START.plusSeconds(1));
        assertThat(fixtures.audits(authorized.operation().id())).singleElement().satisfies(audit -> {
            assertThat(audit).containsEntry("event_type", "COMMAND_SENT")
                    .containsEntry("subject_type", "LOCKER_OPERATION")
                    .containsEntry("from_state", "AUTHORIZED").containsEntry("to_state", "COMMAND_SENT")
                    .containsEntry("result", "ACCEPTED");
            assertThat((String) audit.get("details")).contains(authorized.command().messageId().toString());
        });

        // A dispatched command is never claimed again.
        clock.advance(LEASE.multipliedBy(2));
        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.IDLE);
        assertThat(published).hasSize(1);
    }

    @Test
    void cancelsAnExpiredCommandWithoutPublishingAndExpiresTheOperation() {
        Authorized authorized = authorizedCommand();
        CommandDispatcher dispatcher = dispatcher(this::record);

        clock.set(START.plusSeconds(120));
        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.CANCELLED);

        assertThat(published).isEmpty();
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "CANCELLED")
                .containsEntry("last_error", "COMMAND_EXPIRED");
        Map<String, Object> operation = fixtures.operation(authorized.operation().id());
        assertThat(operation).containsEntry("status", "EXPIRED")
                .containsEntry("failure_reason", "COMMAND_NOT_PUBLISHED_BEFORE_EXPIRY");
        assertThat(operation.get("command_sent_at")).isNull();
        assertThat(fixtures.audits(authorized.operation().id())).singleElement()
                .satisfies(audit -> assertThat(audit).containsEntry("event_type", "OPERATION_EXPIRED")
                        .containsEntry("from_state", "AUTHORIZED").containsEntry("to_state", "EXPIRED"));
    }

    @Test
    void cancelsTheCommandOfAnOperationThatEndedBeforePublication() {
        Authorized authorized = authorizedCommand();
        fixtures.fail(authorized.operation().id(), START.plusSeconds(2));
        CommandDispatcher dispatcher = dispatcher(this::record);

        clock.advance(Duration.ofSeconds(3));
        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.CANCELLED);

        assertThat(published).isEmpty();
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "CANCELLED")
                .containsEntry("last_error", "OPERATION_TERMINAL");
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "FAILED");
        assertThat(fixtures.audits(authorized.operation().id())).isEmpty();
    }

    @Test
    void releasesAnUnconfirmedPublicationAndRetriesTheSameMessageIdLater() {
        Authorized authorized = authorizedCommand();
        List<Boolean> brokerUp = new CopyOnWriteArrayList<>(List.of(false));
        CommandDispatcher dispatcher = dispatcher((topic, payload) -> {
            record(topic, payload);
            if (!brokerUp.getLast()) {
                throw new CommandPublicationException("BROKER_NOT_CONNECTED", null);
            }
        });

        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.RETRY_SCHEDULED);
        Map<String, Object> released = fixtures.command(authorized.operation().id());
        assertThat(released).containsEntry("status", "PENDING").containsEntry("attempt_count", 1)
                .containsEntry("last_error", "BROKER_NOT_CONNECTED");
        assertThat(released.get("claim_until")).isNull();
        assertThat(instant(released.get("next_attempt_at"))).isEqualTo(START.plusSeconds(1));
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "AUTHORIZED");

        assertThat(dispatcher.dispatchNext()).as("before its retry delay").isEqualTo(Outcome.IDLE);

        brokerUp.add(true);
        clock.advance(Duration.ofSeconds(1));
        assertThat(dispatcher.dispatchNext()).isEqualTo(Outcome.PUBLISHED);

        assertThat(published).hasSize(2).extracting(Publication::messageId)
                .containsOnly(authorized.command().messageId().toString());
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "DISPATCHED")
                .containsEntry("attempt_count", 2).containsEntry("last_error", null);
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");
    }

    /**
     * ADR-005, verification: the worker dies after the broker accepted the command and before its mark. The row stays
     * claimed, no other dispatcher takes it during the lease, and the next claim publishes the same command again:
     * delivery is at least once, the operation advances once.
     */
    @Test
    void resumesAfterACrashBetweenPublicationAndMark() {
        Authorized authorized = authorizedCommand();
        CommandDispatcher crashing = dispatcher((topic, payload) -> {
            record(topic, payload);
            throw new WorkerCrash();
        });
        CommandDispatcher survivor = dispatcher(this::record);

        assertThatThrownBy(crashing::dispatchNext).isInstanceOf(WorkerCrash.class);
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "CLAIMED")
                .containsEntry("attempt_count", 1);
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "AUTHORIZED");

        clock.advance(LEASE);
        assertThat(survivor.dispatchNext()).as("while the lease still holds").isEqualTo(Outcome.IDLE);

        clock.advance(Duration.ofMillis(1));
        assertThat(survivor.dispatchNext()).isEqualTo(Outcome.PUBLISHED);

        assertThat(published).hasSize(2);
        assertThat(published.get(1).payload()).isEqualTo(published.get(0).payload());
        assertThat(published).extracting(Publication::messageId)
                .containsOnly(authorized.command().messageId().toString());
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "DISPATCHED")
                .containsEntry("attempt_count", 2);
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");
        assertThat(fixtures.audits(authorized.operation().id())).singleElement()
                .satisfies(audit -> assertThat(audit).containsEntry("event_type", "COMMAND_SENT"));
    }

    /**
     * A command whose earlier attempt may have reached the hub is not a safe failure at its deadline (document 05,
     * section 5): it is cancelled, never republished, and its operation is left for reconciliation.
     */
    @Test
    void doesNotExpireTheOperationOfACommandThatMayAlreadyHaveBeenPublished() {
        Authorized authorized = authorizedCommand();
        CommandDispatcher crashing = dispatcher((topic, payload) -> {
            record(topic, payload);
            throw new WorkerCrash();
        });
        assertThatThrownBy(crashing::dispatchNext).isInstanceOf(WorkerCrash.class);

        clock.set(START.plusSeconds(120));
        assertThat(dispatcher(this::record).dispatchNext()).isEqualTo(Outcome.CANCELLED);

        assertThat(published).hasSize(1);
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "CANCELLED")
                .containsEntry("last_error", "COMMAND_EXPIRED_AFTER_UNCERTAIN_ATTEMPT");
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "AUTHORIZED");
        assertThat(fixtures.audits(authorized.operation().id())).isEmpty();
    }

    /**
     * A publication slower than the lease: a second dispatcher claims the row again and marks it. The first one, whose
     * fencing token is now stale, publishes but can neither mark the row nor advance the operation a second time.
     */
    @Test
    void aDispatcherWhoseLeaseEndedCannotMarkARowAnotherClaimOwns() throws Exception {
        Authorized authorized = authorizedCommand();
        CountDownLatch publishing = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        CommandDispatcher slow = dispatcher((topic, payload) -> {
            record(topic, payload);
            publishing.countDown();
            await(resume);
        });
        CommandDispatcher fast = dispatcher(this::record);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<Outcome> slowOutcome = executor.submit(slow::dispatchNext);
            assertThat(publishing.await(10, TimeUnit.SECONDS)).isTrue();

            clock.advance(LEASE.plusMillis(1));
            assertThat(fast.dispatchNext()).isEqualTo(Outcome.PUBLISHED);
            resume.countDown();

            assertThat(slowOutcome.get(10, TimeUnit.SECONDS)).isEqualTo(Outcome.PUBLISHED_UNMARKED);
        } finally {
            resume.countDown();
            executor.shutdownNow();
        }

        assertThat(published).hasSize(2).extracting(Publication::messageId)
                .containsOnly(authorized.command().messageId().toString());
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "DISPATCHED")
                .containsEntry("attempt_count", 2);
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");
        assertThat(fixtures.audits(authorized.operation().id())).hasSize(1);
    }

    /**
     * The fencing token: a dispatcher whose lease ended and whose publication then fails must not release the row
     * that a second claim is publishing, or the command would be claimed and published a third time.
     */
    @Test
    void aStaleDispatcherCannotReleaseARowAnotherClaimIsPublishing() throws Exception {
        Authorized authorized = authorizedCommand();
        CountDownLatch slowPublishing = new CountDownLatch(1);
        CountDownLatch slowResume = new CountDownLatch(1);
        CountDownLatch fastPublishing = new CountDownLatch(1);
        CountDownLatch fastResume = new CountDownLatch(1);
        CommandDispatcher slow = dispatcher((topic, payload) -> {
            slowPublishing.countDown();
            await(slowResume);
            throw new CommandPublicationException("MQTT_PUBLISH_FAILED reasonCode=32000", null);
        });
        CommandDispatcher fast = dispatcher((topic, payload) -> {
            record(topic, payload);
            fastPublishing.countDown();
            await(fastResume);
        });
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Outcome> slowOutcome = executor.submit(slow::dispatchNext);
            assertThat(slowPublishing.await(10, TimeUnit.SECONDS)).isTrue();
            clock.advance(LEASE.plusMillis(1));
            Future<Outcome> fastOutcome = executor.submit(fast::dispatchNext);
            assertThat(fastPublishing.await(10, TimeUnit.SECONDS)).isTrue();

            slowResume.countDown();
            assertThat(slowOutcome.get(10, TimeUnit.SECONDS)).isEqualTo(Outcome.RETRY_SCHEDULED);
            assertThat(fixtures.command(authorized.operation().id())).as("still owned by the second claim")
                    .containsEntry("status", "CLAIMED").containsEntry("attempt_count", 2)
                    .containsEntry("last_error", null);

            fastResume.countDown();
            assertThat(fastOutcome.get(10, TimeUnit.SECONDS)).isEqualTo(Outcome.PUBLISHED);
        } finally {
            slowResume.countDown();
            fastResume.countDown();
            executor.shutdownNow();
        }

        clock.advance(Duration.ofMinutes(1));
        assertThat(dispatcher(this::record).dispatchNext()).isEqualTo(Outcome.IDLE);
        assertThat(published).hasSize(1);
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "DISPATCHED");
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");
    }

    /** IOT-01: concurrent dispatchers never publish the same command twice, and each operation advances once. */
    @Test
    void twoConcurrentDispatchersPublishEachCommandExactlyOnce() throws Exception {
        int commands = 30;
        List<Authorized> authorized = new ArrayList<>();
        for (int i = 0; i < commands; i++) {
            authorized.add(authorizedCommand());
        }
        CommandPublisher slowBroker = (topic, payload) -> {
            record(topic, payload);
            try {
                Thread.sleep(2);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        };
        List<CommandDispatcher> dispatchers = List.of(dispatcher(slowBroker), dispatcher(slowBroker));
        CyclicBarrier start = new CyclicBarrier(dispatchers.size());
        ExecutorService executor = Executors.newFixedThreadPool(dispatchers.size());
        try {
            List<Future<Integer>> handled = new ArrayList<>();
            for (CommandDispatcher dispatcher : dispatchers) {
                handled.add(executor.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    return dispatcher.dispatchDue(Integer.MAX_VALUE);
                }));
            }
            int total = 0;
            for (Future<Integer> count : handled) {
                total += count.get(60, TimeUnit.SECONDS);
            }
            assertThat(total).isEqualTo(commands);
        } finally {
            executor.shutdownNow();
        }

        assertThat(published).hasSize(commands);
        assertThat(published).extracting(Publication::messageId).doesNotHaveDuplicates()
                .containsExactlyInAnyOrderElementsOf(
                        authorized.stream().map(a -> a.command().messageId().toString()).toList());
        for (Authorized each : authorized) {
            assertThat(fixtures.command(each.operation().id())).containsEntry("status", "DISPATCHED")
                    .containsEntry("attempt_count", 1);
            assertThat(fixtures.operation(each.operation().id())).containsEntry("status", "COMMAND_SENT");
            assertThat(fixtures.audits(each.operation().id())).hasSize(1);
        }
    }

    @Test
    void retriesAfterADelayThatDoublesUpToThirtySeconds() {
        assertThat(CommandDispatcher.retryDelay(1)).isEqualTo(Duration.ofSeconds(1));
        assertThat(CommandDispatcher.retryDelay(2)).isEqualTo(Duration.ofSeconds(2));
        assertThat(CommandDispatcher.retryDelay(5)).isEqualTo(Duration.ofSeconds(16));
        assertThat(CommandDispatcher.retryDelay(6)).isEqualTo(Duration.ofSeconds(30));
        assertThat(CommandDispatcher.retryDelay(40)).isEqualTo(Duration.ofSeconds(30));
    }

    private Authorized authorizedCommand() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });
        return new Authorized(operation, command);
    }

    private CommandDispatcher dispatcher(CommandPublisher publisher) {
        return new CommandDispatcher(jdbc, transactions, auditTrail, jsonMapper, clock, publisher, LEASE);
    }

    private void record(String topic, byte[] payload) {
        String json = new String(payload, StandardCharsets.UTF_8);
        published.add(new Publication(topic, json, jsonMapper.readTree(json).get("messageId").asString()));
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private record Authorized(Operation operation, UnlockCommand command) {
    }

    private record Publication(String topic, String payload, String messageId) {
    }

    /** Stands for the process dying: nothing after the publication runs. */
    private static final class WorkerCrash extends RuntimeException {
    }

    /** A new technician for each checkout: a user holds at most one active reservation. */
    private UUID technician() {
        return accounts.technician().id();
    }
}
