package ca.aegis.control.command;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;

import ca.aegis.control.device.MqttProperties;

/**
 * Publishes unlock commands with the backend MQTT account (document 10, section 6.2) on a connection of its own, so
 * that a publication never waits behind, nor disturbs, the persistent ingestion session. It needs no session of its
 * own: an in-flight message lost with this process is published again from the outbox.
 */
public class MqttCommandPublisher implements CommandPublisher, SmartLifecycle {

    static final String CLIENT_ID_SUFFIX = "-commands";
    private static final Logger log = LoggerFactory.getLogger(MqttCommandPublisher.class);
    private static final int QOS_AT_LEAST_ONCE = 1;
    private static final long MAX_CONNECT_DELAY_SECONDS = 30;

    private final MqttProperties properties;
    private final Duration publishTimeout;
    private final MqttAsyncClient client;
    private final ScheduledExecutorService connector;
    private volatile boolean running;

    MqttCommandPublisher(MqttProperties properties, Duration publishTimeout) {
        this.properties = properties;
        this.publishTimeout = publishTimeout;
        try {
            this.client = new MqttAsyncClient(properties.url(), properties.clientId() + CLIENT_ID_SUFFIX,
                    new MemoryPersistence());
        } catch (MqttException invalid) {
            throw new IllegalStateException("Invalid MQTT client configuration " + properties, invalid);
        }
        this.connector = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "aegis-mqtt-commands-connect");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Override
    public void publish(String topic, byte[] payload) throws CommandPublicationException {
        if (!client.isConnected()) {
            throw new CommandPublicationException("BROKER_NOT_CONNECTED", null);
        }
        try {
            // retained=false: a command must never reach a hub merely because it reconnects (section 7.2).
            IMqttDeliveryToken token = client.publish(topic, payload, QOS_AT_LEAST_ONCE, false);
            token.waitForCompletion(publishTimeout.toMillis());
        } catch (MqttException failure) {
            throw new CommandPublicationException("MQTT_PUBLISH_FAILED reasonCode=" + failure.getReasonCode(),
                    failure);
        }
    }

    /** Whether the publisher connection is up; used by tests and readiness checks. */
    public boolean isConnected() {
        return client.isConnected();
    }

    @Override
    public void start() {
        running = true;
        connector.execute(() -> connect(0));
    }

    private void connect(int attempt) {
        if (!running) {
            return;
        }
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setUserName(properties.username());
        options.setPassword(properties.password().toCharArray());
        options.setCleanSession(true);
        options.setKeepAliveInterval(30);
        // Once connected, Paho restores a lost connection itself; only the first connection is retried here.
        options.setAutomaticReconnect(true);
        try {
            client.connect(options).waitForCompletion(10_000);
            log.info("MQTT command publisher connected: url={}, clientId={}{}", properties.url(),
                    properties.clientId(), CLIENT_ID_SUFFIX);
        } catch (MqttException failure) {
            long delay = Math.min(MAX_CONNECT_DELAY_SECONDS, 1L << Math.min(attempt, 5));
            log.warn("MQTT command publisher connection failed (reasonCode={}); next attempt in {} s",
                    failure.getReasonCode(), delay);
            if (running && !connector.isShutdown()) {
                connector.schedule(() -> connect(attempt + 1), delay, TimeUnit.SECONDS);
            }
        }
    }

    @Override
    public void stop() {
        running = false;
        connector.shutdownNow();
        try {
            if (client.isConnected()) {
                client.disconnect(2000).waitForCompletion(3000);
            }
            client.close(true);
        } catch (MqttException closing) {
            log.warn("MQTT command publisher did not close cleanly: reasonCode={}", closing.getReasonCode());
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }
}
