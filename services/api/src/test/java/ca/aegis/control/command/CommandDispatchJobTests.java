package ca.aegis.control.command;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.device.MqttIngestionClient;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * The production wiring: with {@code aegis.commands.dispatcher.enabled=true} the scheduled job and the Paho
 * publisher dispatch a committed command to the development broker with no test code in between. The ingestion
 * client is replaced so that this context leaves no persistent session on the broker; the context is closed after
 * the class so that its job never claims the commands of other test classes.
 */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CommandDispatchJobTests extends ApiIntegrationTest {

    @MockitoBean
    private MqttIngestionClient ingestion;

    @Autowired
    private CommandOutbox outbox;

    @Autowired
    private MqttCommandPublisher publisher;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    private CommandFixtures fixtures;

    @DynamicPropertySource
    static void dispatcherAndBroker(DynamicPropertyRegistry registry) {
        registry.add("aegis.commands.dispatcher.enabled", () -> "true");
        registry.add("aegis.commands.dispatcher.interval", () -> "PT0.2S");
        registry.add("aegis.mqtt.enabled", () -> "true");
        registry.add("aegis.mqtt.url", () -> "tcp://127.0.0.1:"
                + System.getenv().getOrDefault("AEGIS_TEST_MQTT_PORT", "1883"));
        registry.add("aegis.mqtt.password", () -> Optional.ofNullable(System.getenv("AEGIS_TEST_MQTT_API_PASSWORD"))
                .orElse("local-demo-api-password-change-me"));
        registry.add("aegis.mqtt.client-id", () -> "aegis-test-dispatch-" + UUID.randomUUID());
    }

    @BeforeEach
    void fixtures() {
        fixtures = new CommandFixtures(jdbc);
        fixtures.retireEarlierCommands();
        fixtures.retireOpenOperationsOnBrokerTestLocker();
    }

    @Test
    void theScheduledDispatcherPublishesACommittedCommandThroughTheBroker() throws InterruptedException {
        Operation operation = fixtures.awaitingLocalProofOnBrokerTestLocker(accounts.technician().id(),
                START.minusSeconds(30));
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });

        Instant deadline = Instant.now().plusSeconds(20);
        Map<String, Object> row = fixtures.command(operation.id());
        while (!"DISPATCHED".equals(row.get("status")) && Instant.now().isBefore(deadline)) {
            Thread.sleep(100);
            // The test clock stands still: a pass that ran before the publisher connected scheduled its retry later.
            clock.advance(java.time.Duration.ofMillis(200));
            row = fixtures.command(operation.id());
        }

        assertThat(publisher.isConnected()).isTrue();
        assertThat(row).containsEntry("status", "DISPATCHED").containsEntry("message_id", command.messageId());
        assertThat(fixtures.operation(operation.id())).containsEntry("status", "COMMAND_SENT");
    }
}
