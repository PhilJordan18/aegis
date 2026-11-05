package ca.aegis.control.command;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandDispatcher.Outcome;
import ca.aegis.control.command.CommandFixtures.Operation;
import ca.aegis.control.device.MqttIngestionClient;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * IOT-02 #41 through the development Mosquitto: the test hub account publishes a {@code COMMAND_ACKNOWLEDGED} on
 * {@code aegis/v1/lockers/{lockerId}/events} for a real dispatched command, and the application's own MQTT ingestion
 * applies it. The ingestion runs on a persistent session of its own, discarded at the end; a missing broker fails
 * the test, never skips it. {@code AEGIS_TEST_MQTT_*} variables override {@code infra/docker/.env.example}.
 */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CommandReportBrokerTests extends ApiIntegrationTest {

    private static final Path EXAMPLE = Path.of("../../infra/docker/.env.example");
    private static final UUID LOCKER = CommandFixtures.BROKER_TEST_LOCKER;
    private static final String CLIENT_ID = "aegis-api-test-reports-" + UUID.randomUUID();
    private static volatile MqttIngestionClient started;

    @Autowired
    private MqttIngestionClient ingestion;

    @Autowired
    private CommandOutbox outbox;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private AuditTrail auditTrail;

    @Autowired
    private JdbcClient jdbc;

    @DynamicPropertySource
    static void broker(DynamicPropertyRegistry registry) {
        registry.add("aegis.mqtt.enabled", () -> "true");
        registry.add("aegis.mqtt.url", CommandReportBrokerTests::url);
        registry.add("aegis.mqtt.username", () -> "aegis_api");
        registry.add("aegis.mqtt.password", () -> value("AEGIS_TEST_MQTT_API_PASSWORD", "AEGIS_MQTT_API_PASSWORD"));
        registry.add("aegis.mqtt.client-id", () -> CLIENT_ID);
    }

    @AfterAll
    static void discardTheSubscriberSession() throws MqttException {
        if (started == null) {
            return;
        }
        started.stop();
        MqttClient client = new MqttClient(url(), CLIENT_ID, new MemoryPersistence());
        MqttConnectOptions options = options("aegis_api",
                value("AEGIS_TEST_MQTT_API_PASSWORD", "AEGIS_MQTT_API_PASSWORD"));
        options.setCleanSession(true);
        client.connect(options);
        client.disconnect();
        client.close();
    }

    @Test
    void aHubAcknowledgementPublishedOnTheEventsTopicAdvancesTheOperationOnce() throws Exception {
        started = ingestion;
        ingestion.awaitSubscribed(Duration.ofSeconds(20));
        CommandFixtures fixtures = new CommandFixtures(jdbc);
        fixtures.retireEarlierCommands();
        fixtures.retireOpenOperationsOnBrokerTestLocker();
        Operation operation = fixtures.awaitingLocalProofOnBrokerTestLocker(accounts.technician().id(),
                START.minusSeconds(30));
        // The ingestion tests re-provision the test hub without a session; this boot is the one the hub reports.
        UUID session = UUID.randomUUID();
        jdbc.sql("""
                UPDATE aegis.locker_devices SET device_session_id = :session, boot_count = 7
                WHERE locker_id = :locker AND disabled_at IS NULL
                """).param("session", session).param("locker", LOCKER).update();
        UnlockCommand command = transactions.execute(status -> {
            fixtures.authorize(operation, START);
            return outbox.enqueueUnlock(operation.id());
        });
        clock.advance(Duration.ofSeconds(1));
        assertThat(new CommandDispatcher(jdbc, transactions, auditTrail, clock, (topic, payload) -> { },
                Duration.ofSeconds(15)).dispatchNext()).isEqualTo(Outcome.PUBLISHED);
        clock.advance(Duration.ofSeconds(1));

        UUID event = UUID.randomUUID();
        byte[] ack = ("""
                {"schemaVersion":"3.0","messageId":"%s","type":"COMMAND_ACKNOWLEDGED","result":"ACCEPTED",\
                "commandMessageId":"%s","operationId":"%s","lockerId":"%s","compartmentId":"%s","timestamp":"%s",\
                "deviceSessionId":"%s","bootCount":7,"sequence":%d}""").formatted(event, command.messageId(),
                operation.id(), LOCKER, operation.compartment(), UnlockCommand.format(clock.instant()), session,
                System.nanoTime() & 0xFFFFFFFL).getBytes(StandardCharsets.UTF_8);
        MqttClient hub = new MqttClient(url(), "aegis-test-hub-" + UUID.randomUUID(), new MemoryPersistence());
        hub.connect(options(LOCKER.toString(),
                value("AEGIS_TEST_MQTT_DEVICE_PASSWORD", "AEGIS_MQTT_TEST_DEVICE_PASSWORD")));
        try {
            MqttMessage message = new MqttMessage(ack);
            message.setQos(1);
            message.setRetained(false);
            hub.publish("aegis/v1/lockers/" + LOCKER + "/events", message);
            // The broker redelivers at least once: the same event twice applies once.
            hub.publish("aegis/v1/lockers/" + LOCKER + "/events", message);
        } finally {
            hub.disconnect();
            hub.close();
        }

        await(() -> "COMMAND_ACKNOWLEDGED".equals(fixtures.operation(operation.id()).get("status")));
        await(() -> jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'MQTT_MESSAGE_DUPLICATE_IGNORED'
                  AND inbound_message_id = (SELECT id FROM aegis.inbound_device_messages WHERE message_id = :event)
                """).param("event", event).query(Long.class).single() == 1);
        assertThat(fixtures.inboundMessage(LOCKER, event)).containsEntry("processing_status", "PROCESSED");
        assertThat(fixtures.command(operation.id())).containsEntry("status", "ACKNOWLEDGED");
        assertThat(fixtures.audits(operation.id())).extracting(audit -> audit.get("event_type"))
                .containsExactly("COMMAND_SENT", "COMMAND_ACKNOWLEDGED");
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        Instant deadline = Instant.now().plusSeconds(15);
        while (!condition.getAsBoolean()) {
            if (Instant.now().isAfter(deadline)) {
                fail("Timed out waiting for the broker delivery to be ingested");
            }
            Thread.sleep(50);
        }
    }

    private static MqttConnectOptions options(String user, String password) {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setCleanSession(true);
        options.setUserName(user);
        options.setPassword(password.toCharArray());
        options.setConnectionTimeout(5);
        return options;
    }

    private static String url() {
        String host = System.getenv().getOrDefault("AEGIS_TEST_MQTT_HOST", "127.0.0.1");
        String port = System.getenv().getOrDefault("AEGIS_TEST_MQTT_PORT",
                example().getOrDefault("AEGIS_MQTT_PORT", "1883"));
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
}
