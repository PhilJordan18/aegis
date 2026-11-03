package ca.aegis.control.device;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

/**
 * The development Mosquitto of {@code infra/docker/compose.yaml}. {@code AEGIS_TEST_MQTT_*} variables override the
 * local example values of {@code infra/docker/.env.example}; only a loopback broker is accepted, and a missing broker
 * fails the tests instead of skipping them.
 */
final class TestBroker {

    static final String API_USER = "aegis_api";
    /** The only device account of the ACL: it may publish on the demo locker's events and status, nothing else. */
    static final String DEVICE_USER = DevicePayloads.LOCKER.toString();

    private static final Path EXAMPLE = Path.of("../../infra/docker/.env.example");

    final String url;
    final String apiPassword;
    final String devicePassword;

    private TestBroker(String url, String apiPassword, String devicePassword) {
        this.url = url;
        this.apiPassword = apiPassword;
        this.devicePassword = devicePassword;
    }

    static TestBroker fromEnvironment() {
        Map<String, String> example = example();
        String host = value("AEGIS_TEST_MQTT_HOST", "127.0.0.1", example);
        String port = value("AEGIS_TEST_MQTT_PORT", example.getOrDefault("AEGIS_MQTT_PORT", "1883"), example);
        if (!loopback(host)) {
            throw new IllegalStateException("Refusing to run the MQTT tests on " + host + ": loopback broker only");
        }
        return new TestBroker("tcp://" + host + ":" + port,
                value("AEGIS_TEST_MQTT_API_PASSWORD", example.get("AEGIS_MQTT_API_PASSWORD"), example),
                value("AEGIS_TEST_MQTT_DEVICE_PASSWORD", example.get("AEGIS_MQTT_DEVICE_PASSWORD"), example));
    }

    /** A hub connection with the device account; QoS 1 and never retained, so no test leaves a message behind. */
    Device device() {
        try {
            MqttClient client = new MqttClient(url, "aegis-test-hub-" + UUID.randomUUID(), new MemoryPersistence());
            MqttConnectOptions options = new MqttConnectOptions();
            options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
            options.setCleanSession(true);
            options.setUserName(DEVICE_USER);
            options.setPassword(devicePassword.toCharArray());
            options.setConnectionTimeout(5);
            client.connect(options);
            return new Device(client);
        } catch (MqttException unreachable) {
            throw new IllegalStateException("The development MQTT broker at " + url + " is required", unreachable);
        }
    }

    static final class Device implements AutoCloseable {

        private final MqttClient client;

        private Device(MqttClient client) {
            this.client = client;
        }

        void publish(String topic, byte[] payload) {
            MqttMessage message = new MqttMessage(payload);
            message.setQos(1);
            message.setRetained(false);
            try {
                client.publish(topic, message);
            } catch (MqttException failure) {
                throw new IllegalStateException("Publication failed", failure);
            }
        }

        @Override
        public void close() throws MqttException {
            client.disconnect();
            client.close();
        }
    }

    private static String value(String name, String fallback, Map<String, String> example) {
        String value = System.getenv(name);
        String chosen = value == null || value.isBlank() ? fallback : value.strip();
        if (chosen == null || chosen.isBlank()) {
            throw new IllegalStateException(name + " must be set, or " + EXAMPLE + " must provide it");
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

    private static boolean loopback(String host) {
        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            return addresses.length > 0 && Arrays.stream(addresses).allMatch(InetAddress::isLoopbackAddress);
        } catch (UnknownHostException unresolved) {
            return false;
        }
    }
}
