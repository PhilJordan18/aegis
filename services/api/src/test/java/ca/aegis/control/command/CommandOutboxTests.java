package ca.aegis.control.command;

import static ca.aegis.control.command.CommandFixtures.instant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.command.CommandRefusedException.Reason;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Document 06, section 7.2 and document 08, sections 4.7 and 9.1: the unlock intent exists exactly when the business
 * decision that authorizes it commits, and only for the compartment that decision names.
 */
class CommandOutboxTests extends ApiIntegrationTest {

    @Autowired
    private CommandOutbox outbox;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    private CommandFixtures fixtures;

    @BeforeEach
    void fixtures() {
        fixtures = new CommandFixtures(jdbc);
    }

    /** The scheduled job of {@link CommandDispatchJobTests} must find no due command of this class. */
    @AfterEach
    void retireCommands() {
        fixtures.retireEarlierCommands();
    }

    @Test
    void commitsTheAuthorizationAndItsCommandTogether() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));

        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });

        assertThat(fixtures.operation(operation.id())).containsEntry("status", "AUTHORIZED");
        Map<String, Object> row = fixtures.command(operation.id());
        assertThat(row).containsEntry("message_id", command.messageId())
                .containsEntry("locker_id", operation.locker())
                .containsEntry("compartment_id", operation.compartment())
                .containsEntry("command_type", "UNLOCK_COMPARTMENT")
                .containsEntry("topic", "aegis/v1/lockers/" + operation.locker() + "/commands")
                .containsEntry("schema_version", "3.0")
                .containsEntry("status", "PENDING")
                .containsEntry("attempt_count", 0);
        assertThat(instant(row.get("issued_at"))).isEqualTo(START);
        // The command expires with the operation: 120 seconds after the authorization.
        assertThat(instant(row.get("expires_at"))).isEqualTo(START.plusSeconds(120))
                .isEqualTo(instant(fixtures.operation(operation.id()).get("expires_at")));
        assertThat(instant(row.get("next_attempt_at"))).isEqualTo(START);
        assertThat(row.get("claim_until")).isNull();
        assertThat(row.get("published_at")).isNull();

        JsonNode payload = jsonMapper.readTree((String) row.get("payload"));
        assertThat(payload.propertyNames()).containsExactlyInAnyOrder("schemaVersion", "messageId", "type",
                "operationId", "lockerId", "compartmentId", "issuedAt", "expiresAt");
        assertThat(payload.get("messageId").asString()).isEqualTo(command.messageId().toString());
        assertThat(payload.get("operationId").asString()).isEqualTo(operation.id().toString());
        assertThat(payload.get("compartmentId").asString()).isEqualTo(operation.compartment().toString());
        assertThat(payload.get("expiresAt").asString()).isEqualTo("2026-09-28T13:02:00Z");
    }

    @Test
    void issuesTheCommandAtTheInstantOfTheAuthorizingDecision() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));

        clock.advance(Duration.ofSeconds(3));
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id(), START);
        });

        assertThat(command.issuedAt()).isEqualTo(START);
        assertThat(instant(fixtures.command(operation.id()).get("issued_at"))).isEqualTo(START);
    }

    @Test
    void aRolledBackAuthorizationLeavesNoCommand() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));

        assertThatThrownBy(() -> transactions.executeWithoutResult(status -> {
            fixtures.authorize(operation, START);
            outbox.enqueueUnlock(operation.id());
            throw new IllegalStateException("a later guard of the authorization fails");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(fixtures.operation(operation.id())).containsEntry("status", "AWAITING_LOCAL_PROOF");
        assertThat(fixtures.commandCount(operation.id())).isZero();
    }

    @Test
    void refusesToWriteACommandOutsideTheAuthorizingTransaction() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));
        transactions.executeWithoutResult(status -> fixtures.authorize(operation, START));

        assertThatThrownBy(() -> outbox.enqueueUnlock(operation.id()))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(fixtures.commandCount(operation.id())).isZero();
    }

    @Test
    void refusesAnOperationThatIsNotAuthorized() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));

        assertRefused(operation.id(), Reason.OPERATION_NOT_AUTHORIZED);
        assertRefused(UUID.randomUUID(), Reason.OPERATION_NOT_FOUND);
    }

    @Test
    void refusesAnAuthorizationWhoseLocalChallengeWasNotConsumed() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));

        assertThatThrownBy(() -> transactions.executeWithoutResult(status -> {
            fixtures.authorizeWithoutConsumingChallenge(operation, START);
            outbox.enqueueUnlock(operation.id());
        })).isInstanceOfSatisfying(CommandRefusedException.class,
                refused -> assertThat(refused.reason()).isEqualTo(Reason.LOCAL_CHALLENGE_NOT_CONSUMED));

        // The refusal rolled the authorization back with it.
        assertThat(fixtures.operation(operation.id())).containsEntry("status", "AWAITING_LOCAL_PROOF");
        assertThat(fixtures.commandCount(operation.id())).isZero();
    }

    @Test
    void refusesAnOperationWhoseWindowHasEnded() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));
        transactions.executeWithoutResult(status -> fixtures.authorize(operation, START));

        clock.set(START.plusSeconds(120));
        assertRefused(operation.id(), Reason.OPERATION_EXPIRED);
        clock.set(START.plusSeconds(119).plusMillis(999));
        assertThat(transactions.execute(status -> outbox.enqueueUnlock(operation.id())).expiresAt())
                .isEqualTo(START.plusSeconds(120));
    }

    @Test
    void writesASingleCommandPerOperation() {
        Operation operation = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));
        UnlockCommand first = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });

        clock.advance(Duration.ofSeconds(5));
        assertRefused(operation.id(), Reason.COMMAND_ALREADY_ISSUED);

        // uq_command_outbox_operation stays the final guard if two authorizations ever raced past the check.
        assertThatThrownBy(() -> jdbc.sql("""
                INSERT INTO aegis.command_outbox (message_id, operation_id, locker_id, compartment_id, command_type,
                    topic, schema_version, issued_at, expires_at, payload)
                SELECT :message, operation_id, locker_id, compartment_id, command_type, topic, schema_version,
                       issued_at, expires_at, payload
                FROM aegis.command_outbox WHERE operation_id = :operation
                """).param("message", UUID.randomUUID()).param("operation", operation.id()).update())
                .isInstanceOf(DuplicateKeyException.class);
        assertThat(fixtures.command(operation.id())).containsEntry("message_id", first.messageId());
    }

    @Test
    void targetsOnlyTheCompartmentTheOperationWasAuthorizedFor() {
        Operation first = fixtures.awaitingLocalProof(technician(), START.minusSeconds(30));
        UUID neighbour = fixtures.compartment(first.locker(), 2);

        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(first, START);
            return outbox.enqueueUnlock(first.id());
        });

        assertThat(command.compartmentId()).isEqualTo(first.compartment()).isNotEqualTo(neighbour);
        assertThat(command.lockerId()).isEqualTo(first.locker());
        assertThat(fixtures.command(first.id())).containsEntry("compartment_id", first.compartment());

        // fk_command_outbox_operation is the final guard: no row may name another compartment of the operation.
        jdbc.sql("DELETE FROM aegis.command_outbox WHERE operation_id = :operation").param("operation", first.id())
                .update();
        assertThatThrownBy(() -> jdbc.sql("""
                INSERT INTO aegis.command_outbox (message_id, operation_id, locker_id, compartment_id, command_type,
                    topic, schema_version, issued_at, expires_at, payload)
                VALUES (:message, :operation, :locker, :neighbour, 'UNLOCK_COMPARTMENT', :topic, '3.0', :issued,
                        :expires, '{}'::jsonb)
                """).param("message", UUID.randomUUID()).param("operation", first.id())
                .param("locker", first.locker()).param("neighbour", neighbour).param("topic", command.topic())
                .param("issued", CommandFixtures.utc(START)).param("expires", CommandFixtures.utc(START.plusSeconds(120)))
                .update()).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_command_outbox_operation");
    }

    private void assertRefused(UUID operation, Reason reason) {
        assertThatThrownBy(() -> transactions.executeWithoutResult(status -> outbox.enqueueUnlock(operation)))
                .isInstanceOfSatisfying(CommandRefusedException.class,
                        refused -> assertThat(refused.reason()).isEqualTo(reason));
    }

    /** A new technician for each checkout: a user holds at most one active reservation. */
    private UUID technician() {
        return accounts.technician().id();
    }
}
