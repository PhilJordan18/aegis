package ca.aegis.control.command;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandDispatcher.Outcome;
import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.command.CommandPublisher.CommandPublicationException;
import ca.aegis.control.device.MqttProperties;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * The outbox against the development Mosquitto of {@code infra/docker/compose.yaml}, through the backend account and
 * its ACL, with the test hub account of #115 as the subscriber. A missing broker fails these tests; they are never
 * skipped. {@code AEGIS_TEST_MQTT_*} variables override the example values of {@code infra/docker/.env.example}.
 */
class CommandBrokerTests extends ApiIntegrationTest {

    private static final Path EXAMPLE = Path.of("../../infra/docker/.env.example");
    private static final String COMMANDS = UnlockCommand.topic(CommandFixtures.BROKER_TEST_LOCKER);
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
    private MqttCommandPublisher publisher;
    private final List<MqttClient> hubs = new CopyOnWriteArrayList<>();

    @BeforeEach
    void connect() throws Exception {
        fixtures = new CommandFixtures(jdbc);
        fixtures.retireEarlierCommands();
        fixtures.retireOpenOperationsOnBrokerTestLocker();
        publisher = new MqttCommandPublisher(backendAccount(), Duration.ofSeconds(5));
        publisher.start();
        Instant deadline = Instant.now().plusSeconds(15);
        while (!publisher.isConnected()) {
            if (Instant.now().isAfter(deadline)) {
                fail("The development MQTT broker at " + url() + " is required");
            }
            Thread.sleep(50);
        }
    }

    @AfterEach
    void disconnect() throws MqttException {
        publisher.stop();
        for (MqttClient hub : hubs) {
            if (hub.isConnected()) {
                hub.disconnect();
            }
            hub.close();
        }
    }

    @Test
    void publishesTheCommandAtQosOneWithoutRetainOnTheTargetLockerTopic() throws Exception {
        List<Received> received = subscribeAsHub();
        Authorized authorized = authorizedCommand();

        assertThat(dispatcher(publisher).dispatchNext()).isEqualTo(Outcome.PUBLISHED);

        Received message = awaitMessages(received, 1).getFirst();
        assertThat(message.topic()).isEqualTo(COMMANDS);
        assertThat(message.qos()).isEqualTo(1);
        JsonNode payload = jsonMapper.readTree(message.payload());
        assertThat(payload.get("schemaVersion").asString()).isEqualTo("3.0");
        assertThat(payload.get("type").asString()).isEqualTo("UNLOCK_COMPARTMENT");
        assertThat(payload.get("messageId").asString()).isEqualTo(authorized.command().messageId().toString());
        assertThat(payload.get("operationId").asString()).isEqualTo(authorized.operation().id().toString());
        assertThat(payload.get("lockerId").asString()).isEqualTo(CommandFixtures.BROKER_TEST_LOCKER.toString());
        assertThat(payload.get("compartmentId").asString())
                .isEqualTo(authorized.operation().compartment().toString());
        assertThat(payload.get("expiresAt").asString()).isEqualTo("2026-09-28T13:02:00Z");
        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "DISPATCHED");
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");

        // Section 7.2: nothing stays on the broker for a hub that subscribes later; a live subscriber always sees
        // retain=false (MQTT 3.1.1, section 3.3.1.3), so only a late one proves it.
        List<Received> late = subscribeAsHub();
        Thread.sleep(1000);
        assertThat(late).isEmpty();
    }

    /** The crash window on the real broker: the hub receives the same messageId twice; the backend advances once. */
    @Test
    void republishesTheSameMessageIdAfterACrashBetweenPublicationAndMark() throws Exception {
        List<Received> received = subscribeAsHub();
        Authorized authorized = authorizedCommand();
        CommandDispatcher crashing = dispatcher((topic, payload) -> {
            publisher.publish(topic, payload);
            throw new WorkerCrash();
        });

        assertThatThrownBy(crashing::dispatchNext).isInstanceOf(WorkerCrash.class);
        awaitMessages(received, 1);
        clock.advance(LEASE.plusMillis(1));
        assertThat(dispatcher(publisher).dispatchNext()).isEqualTo(Outcome.PUBLISHED);

        List<Received> both = awaitMessages(received, 2);
        assertThat(both).extracting(m -> jsonMapper.readTree(m.payload()).get("messageId").asString())
                .containsOnly(authorized.command().messageId().toString());
        assertThat(both.get(1).payload()).isEqualTo(both.get(0).payload());
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "COMMAND_SENT");
        assertThat(fixtures.audits(authorized.operation().id())).hasSize(1);
    }

    @Test
    void keepsTheCommandForALaterAttemptWhenThePublisherIsDisconnected() {
        Authorized authorized = authorizedCommand();
        MqttCommandPublisher disconnected = new MqttCommandPublisher(backendAccount(), Duration.ofSeconds(1));

        assertThatThrownBy(() -> disconnected.publish(COMMANDS, new byte[] {'{', '}'}))
                .isInstanceOf(CommandPublicationException.class).hasMessage("BROKER_NOT_CONNECTED");
        assertThat(dispatcher(disconnected).dispatchNext()).isEqualTo(Outcome.RETRY_SCHEDULED);

        assertThat(fixtures.command(authorized.operation().id())).containsEntry("status", "PENDING")
                .containsEntry("last_error", "BROKER_NOT_CONNECTED");
        assertThat(fixtures.operation(authorized.operation().id())).containsEntry("status", "AUTHORIZED");
    }

    private Authorized authorizedCommand() {
        Operation operation = fixtures.awaitingLocalProofOnBrokerTestLocker(accounts.technician().id(),
                START.minusSeconds(30));
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });
        return new Authorized(operation, command);
    }

    private CommandDispatcher dispatcher(CommandPublisher publisher) {
        return new CommandDispatcher(jdbc, transactions, auditTrail, clock, publisher, LEASE);
    }

    /** A hub connection with the test device account, which may read its own commands topic only. */
    private List<Received> subscribeAsHub() throws MqttException {
        MqttClient hub = new MqttClient(url(), "aegis-test-hub-" + UUID.randomUUID(), new MemoryPersistence());
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setCleanSession(true);
        options.setUserName(CommandFixtures.BROKER_TEST_LOCKER.toString());
        options.setPassword(value("AEGIS_TEST_MQTT_DEVICE_PASSWORD", "AEGIS_MQTT_TEST_DEVICE_PASSWORD").toCharArray());
        options.setConnectionTimeout(5);
        hub.connect(options);
        hubs.add(hub);
        List<Received> received = new CopyOnWriteArrayList<>();
        // Subscribed at QoS 2 so that the delivered QoS is the published one, not a downgrade to the subscription.
        int[] granted = hub.subscribeWithResponse(new String[] {COMMANDS}, new int[] {2},
                new org.eclipse.paho.client.mqttv3.IMqttMessageListener[] {(topic, message) -> received.add(
                        new Received(topic, new String(message.getPayload(), StandardCharsets.UTF_8),
                                message.getQos(), message.isRetained()))})
                .getGrantedQos();
        assertThat(granted).containsExactly(2);
        return received;
    }

    private static List<Received> awaitMessages(List<Received> received, int count) throws InterruptedException {
        Instant deadline = Instant.now().plusSeconds(10);
        while (received.size() < count && Instant.now().isBefore(deadline)) {
            Thread.sleep(20);
        }
        assertThat(received).hasSize(count);
        return List.copyOf(received);
    }

    private static MqttProperties backendAccount() {
        return new MqttProperties(true, url(), "aegis_api",
                value("AEGIS_TEST_MQTT_API_PASSWORD", "AEGIS_MQTT_API_PASSWORD"),
                "aegis-test-api-" + UUID.randomUUID(), false);
    }

    private static String url() {
        String host = System.getenv().getOrDefault("AEGIS_TEST_MQTT_HOST", "127.0.0.1");
        String port = System.getenv().getOrDefault("AEGIS_TEST_MQTT_PORT", example().getOrDefault(
                "AEGIS_MQTT_PORT", "1883"));
        return "tcp://" + host + ":" + port;
    }

    private static String value(String variable, String exampleKey) {
        String value = System.getenv(variable);
        String chosen = value == null || value.isBlank() ? example().get(exampleKey) : value.strip();
        if (chosen == null || chosen.isBlank()) {
            throw new IllegalStateException(variable + " must be set, or " + EXAMPLE + " must provide " + exampleKey);
        }
        return chosen;
    }

    private static Map<String, String> example() {
        Map<String, String> values = new HashMap<>();
        if (!Files.isRegularFile(EXAMPLE)) {
            return values;
        }
        try {
            for (String line : Files.readAllLines(EXAMPLE)) {
                int equals = line.indexOf('=');
                if (!line.startsWith("#") && equals > 0) {
                    values.put(line.substring(0, equals).strip(), line.substring(equals + 1).strip());
                }
            }
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
        return values;
    }

    private record Authorized(Operation operation, UnlockCommand command) {
    }

    private record Received(String topic, String payload, int qos, boolean retained) {
    }

    private static final class WorkerCrash extends RuntimeException {
    }
}
