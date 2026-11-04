package ca.aegis.control.command;

import static ca.aegis.control.command.CommandFixtures.instant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandAcknowledgements.CommandReport;
import ca.aegis.control.command.CommandAcknowledgements.Kind;
import ca.aegis.control.command.CommandAcknowledgements.Result;
import ca.aegis.control.command.CommandDispatcher.Outcome;
import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * IOT-02 #41, backend side: a hub report is correlated with a real command and applied once, in the transaction that
 * stores it (document 08, section 9.3; document 05, section 5; document 10, sections 10 and 16).
 */
class CommandAcknowledgementsTests extends ApiIntegrationTest {

    private static final Duration LEASE = Duration.ofSeconds(15);

    @Autowired
    private CommandOutbox outbox;

    @Autowired
    private CommandAcknowledgements acknowledgements;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private AuditTrail auditTrail;

    @Autowired
    private JdbcClient jdbc;

    private CommandFixtures fixtures;

    @BeforeEach
    void fixtures() {
        fixtures = new CommandFixtures(jdbc);
        fixtures.retireEarlierCommands();
    }

    @AfterEach
    void retireCommands() {
        fixtures.retireEarlierCommands();
    }

    @Test
    void anAcknowledgementOfAPublishedCommandAdvancesTheOperationOnce() {
        Sent sent = sentCommand();

        assertThat(report(sent, Kind.ACKNOWLEDGED, "ACCEPTED")).isEqualTo(Result.APPLIED);

        Map<String, Object> operation = fixtures.operation(sent.operation().id());
        assertThat(operation).containsEntry("status", "COMMAND_ACKNOWLEDGED");
        Map<String, Object> command = fixtures.command(sent.operation().id());
        assertThat(command).containsEntry("status", "ACKNOWLEDGED");
        assertThat(instant(command.get("acknowledged_at"))).isEqualTo(START.plusSeconds(2));
        assertThat(eventTypes(sent)).containsExactly("COMMAND_SENT", "COMMAND_ACKNOWLEDGED");

        // Document 10, section 10.1: the hub answers a redelivered command with ALREADY_APPLIED and a new event id.
        clock.advance(Duration.ofSeconds(1));
        assertThat(report(sent, Kind.ACKNOWLEDGED, "ALREADY_APPLIED")).isEqualTo(Result.ALREADY_APPLIED);
        assertThat(fixtures.operation(sent.operation().id())).containsEntry("status", "COMMAND_ACKNOWLEDGED");
        assertThat(instant(fixtures.command(sent.operation().id()).get("acknowledged_at")))
                .isEqualTo(START.plusSeconds(2));
        assertThat(eventTypes(sent)).containsExactly("COMMAND_SENT", "COMMAND_ACKNOWLEDGED");
    }

    /** The acknowledgement overtakes the dispatcher's mark: it records the sending, then the acknowledgement. */
    @Test
    void anAcknowledgementThatOvertakesTheMarkIsAppliedOnceAndTheLateMarkChangesNothing() {
        Authorized authorized = authorizedCommand();
        CommandDispatcher crashing = dispatcher((topic, payload) -> {
            throw new WorkerStopped();
        });
        assertThatThrownBy(crashing::dispatchNext).isInstanceOf(WorkerStopped.class);
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "CLAIMED");

        clock.advance(Duration.ofSeconds(1));
        Sent sent = new Sent(authorized.operation(), authorized.command());
        assertThat(report(sent, Kind.ACKNOWLEDGED, "ACCEPTED")).isEqualTo(Result.APPLIED);

        Map<String, Object> operation = fixtures.operation(authorized.operation().id());
        assertThat(operation).containsEntry("status", "COMMAND_ACKNOWLEDGED");
        assertThat(instant(operation.get("command_sent_at"))).isEqualTo(START.plusSeconds(1));
        Map<String, Object> command = fixtures.command(authorized.operation().id());
        assertThat(command).containsEntry("status", "ACKNOWLEDGED");
        assertThat(command.get("claim_until")).isNull();
        assertThat(instant(command.get("published_at"))).isEqualTo(START.plusSeconds(1));
        // Both transitions share one instant; their states, not their order, chain them.
        assertThat(fixtures.audits(sent.operation().id()))
                .extracting(audit -> audit.get("from_state") + "->" + audit.get("to_state"))
                .containsExactlyInAnyOrder("AUTHORIZED->COMMAND_SENT", "COMMAND_SENT->COMMAND_ACKNOWLEDGED");

        // The lease ends: the acknowledged row is never claimed or published again.
        clock.advance(LEASE.multipliedBy(2));
        assertThat(dispatcher((topic, payload) -> {
            throw new AssertionError("an acknowledged command was published again");
        }).dispatchNext()).isEqualTo(Outcome.IDLE);
    }

    @Test
    void aRejectionBeforeActuationFailsTheOperationSafely() {
        for (String reason : List.of("COMMAND_EXPIRED", "WRONG_LOCKER", "UNKNOWN_COMPARTMENT", "CELL_UNREACHABLE")) {
            Sent sent = sentCommand();

            assertThat(report(sent, Kind.REJECTED, reason)).as(reason).isEqualTo(Result.APPLIED);

            assertThat(fixtures.operation(sent.operation().id())).as(reason).containsEntry("status", "FAILED")
                    .containsEntry("failure_reason", "COMMAND_REJECTED_" + reason);
            assertThat(fixtures.command(sent.operation().id())).as(reason).containsEntry("status", "REJECTED");
            assertThat(eventTypes(sent)).as(reason).containsExactly("COMMAND_SENT", "COMMAND_REJECTED");
            // Document 10, section 10.1: a known rejection stays a rejection when the hub repeats it.
            assertThat(report(sent, Kind.REJECTED, reason)).as(reason).isEqualTo(Result.ALREADY_APPLIED);
            assertThat(report(sent, Kind.ACKNOWLEDGED, "ALREADY_APPLIED")).as(reason)
                    .isEqualTo(Result.ALREADY_APPLIED);
            assertThat(fixtures.operation(sent.operation().id())).as(reason).containsEntry("status", "FAILED");
        }
    }

    @Test
    void aRejectionWithAnUncertainPhysicalStateIsNeverASafeFailure() {
        for (String reason : List.of("PREVIOUS_EXECUTION_UNCERTAIN", "LOCK_ACTUATION_FAILED")) {
            Sent sent = sentCommand();

            assertThat(report(sent, Kind.REJECTED, reason)).as(reason).isEqualTo(Result.APPLIED);

            assertThat(fixtures.operation(sent.operation().id())).as(reason).containsEntry("status", "COMMAND_SENT");
            assertThat(fixtures.command(sent.operation().id())).as(reason).containsEntry("status", "REJECTED");
            assertThat(fixtures.audits(sent.operation().id())).as(reason).last()
                    .satisfies(audit -> assertThat(audit).containsEntry("event_type", "COMMAND_REJECTED")
                            .containsEntry("subject_type", "COMMAND_OUTBOX")
                            .containsEntry("reason", "PHYSICAL_STATE_UNCERTAIN"));
        }
    }

    @Test
    void aReportForAnotherTargetThanItsCommandChangesNothing() {
        Sent sent = sentCommand();
        UUID neighbour = fixtures.compartment(sent.operation().locker(), 2);

        Result result = transactions.execute(status -> acknowledgements.apply(new CommandReport(
                fixtures.storeReport(sent.operation(), sent.command().messageId(), "COMMAND_ACKNOWLEDGED",
                        clock.instant()),
                Kind.ACKNOWLEDGED, sent.command().messageId(), sent.operation().id(), sent.operation().locker(),
                neighbour, "ACCEPTED", clock.instant())));

        assertThat(result).isEqualTo(Result.NOT_CORRELATED);
        assertThat(fixtures.operation(sent.operation().id())).containsEntry("status", "COMMAND_SENT");
        assertThat(fixtures.command(sent.operation().id())).containsEntry("status", "DISPATCHED");
        assertThat(eventTypes(sent)).containsExactly("COMMAND_SENT");
    }

    @Test
    void refusesToApplyAReportOutsideTheIngestionTransaction() {
        Sent sent = sentCommand();
        UUID stored = transactions.execute(status -> fixtures.storeReport(sent.operation(),
                sent.command().messageId(), "COMMAND_ACKNOWLEDGED", clock.instant()));

        assertThatThrownBy(() -> acknowledgements.apply(new CommandReport(stored, Kind.ACKNOWLEDGED,
                sent.command().messageId(), sent.operation().id(), sent.operation().locker(),
                sent.operation().compartment(), "ACCEPTED", clock.instant())))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(fixtures.operation(sent.operation().id())).containsEntry("status", "COMMAND_SENT");
    }

    /** Two consumers ingest two reports of the same command at once: one applies it, the other finds it decided. */
    @Test
    void twoConcurrentReportsOfOneCommandApplyItOnce() throws Exception {
        Sent sent = sentCommand();
        CyclicBarrier start = new CyclicBarrier(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        List<Result> results = new ArrayList<>();
        try {
            List<Future<Result>> futures = new ArrayList<>();
            for (String outcome : List.of("ACCEPTED", "ALREADY_APPLIED")) {
                futures.add(executor.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    return report(sent, Kind.ACKNOWLEDGED, outcome);
                }));
            }
            for (Future<Result> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
        } finally {
            executor.shutdownNow();
        }

        assertThat(results).containsExactlyInAnyOrder(Result.APPLIED, Result.ALREADY_APPLIED);
        assertThat(fixtures.operation(sent.operation().id())).containsEntry("status", "COMMAND_ACKNOWLEDGED");
        assertThat(eventTypes(sent)).containsExactly("COMMAND_SENT", "COMMAND_ACKNOWLEDGED");
    }

    private Result report(Sent sent, Kind kind, String outcome) {
        Instant at = clock.instant();
        String type = kind == Kind.ACKNOWLEDGED ? "COMMAND_ACKNOWLEDGED" : "COMMAND_REJECTED";
        return transactions.execute(status -> acknowledgements.apply(new CommandReport(
                fixtures.storeReport(sent.operation(), sent.command().messageId(), type, at), kind,
                sent.command().messageId(), sent.operation().id(), sent.operation().locker(),
                sent.operation().compartment(), outcome, at)));
    }

    /** A command published and marked: its operation is {@code COMMAND_SENT}. */
    private Sent sentCommand() {
        Authorized authorized = authorizedCommand();
        clock.advance(Duration.ofSeconds(1));
        assertThat(dispatcher((topic, payload) -> { }).dispatchNext()).isEqualTo(Outcome.PUBLISHED);
        // Audit events are ordered by instant: the report comes one second after the sending.
        clock.advance(Duration.ofSeconds(1));
        return new Sent(authorized.operation(), authorized.command());
    }

    private Authorized authorizedCommand() {
        clock.set(START);
        Operation operation = fixtures.awaitingLocalProof(accounts.technician().id(), START.minusSeconds(30));
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });
        return new Authorized(operation, command);
    }

    private CommandDispatcher dispatcher(CommandPublisher publisher) {
        return new CommandDispatcher(jdbc, transactions, auditTrail, clock, publisher, LEASE);
    }

    private List<Object> eventTypes(Sent sent) {
        return fixtures.audits(sent.operation().id()).stream().map(audit -> audit.get("event_type")).toList();
    }

    private record Authorized(Operation operation, UnlockCommand command) {
    }

    private record Sent(Operation operation, UnlockCommand command) {
    }

    private static final class WorkerStopped extends RuntimeException {
    }
}
