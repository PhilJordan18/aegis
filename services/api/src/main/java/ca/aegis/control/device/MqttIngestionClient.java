package ca.aegis.control.device;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import org.eclipse.paho.client.mqttv3.IMqttActionListener;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * The backend subscriber of {@code aegis/v1/lockers/+/events} and {@code +/status} (document 10, sections 6.2 and
 * 7), on MQTT 3.1.1 with QoS 1. A delivery is acknowledged only after its ingestion transaction has committed, so a
 * delivery the database could not take stays unacknowledged and the broker delivers it again to the persistent
 * session after a reconnection. The broker is never awaited inside a transaction.
 */
public class MqttIngestionClient implements SmartLifecycle, MqttCallbackExtended {

    private static final Logger log = LoggerFactory.getLogger(MqttIngestionClient.class);
    private static final int KEEP_ALIVE_SECONDS = 30;
    private static final long[] INGESTION_RETRY_MILLIS = {200, 1000};
    private static final int SUBSCRIPTION_FAILURE = 0x80;

    private final MqttProperties properties;
    private final DeviceMessageIngestion ingestion;
    private final MqttAsyncClient client;
    private final ScheduledExecutorService connector;
    private final AtomicReference<CompletableFuture<Void>> subscribed =
            new AtomicReference<>(new CompletableFuture<>());
    private volatile boolean running;

    MqttIngestionClient(MqttProperties properties, DeviceMessageIngestion ingestion) {
        this.properties = properties;
        this.ingestion = ingestion;
        try {
            this.client = new MqttAsyncClient(properties.url(), properties.clientId(), new MemoryPersistence());
        } catch (MqttException invalid) {
            throw new IllegalStateException("Invalid MQTT client configuration " + properties, invalid);
        }
        client.setCallback(this);
        client.setManualAcks(true);
        this.connector = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "aegis-mqtt-connect");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Override
    public void start() {
        running = true;
        connect(0);
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
            log.warn("MQTT client did not close cleanly: reasonCode={}", closing.getReasonCode());
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    /** Waits until both subscriptions are granted; used by readiness checks and tests. */
    public void awaitSubscribed(Duration timeout) throws InterruptedException, TimeoutException {
        try {
            subscribed.get().get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (ExecutionException impossible) {
            throw new IllegalStateException(impossible.getCause());
        }
    }

    public boolean isSubscribed() {
        return subscribed.get().isDone();
    }

    private void connect(int attempt) {
        if (!running) {
            return;
        }
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setUserName(properties.username());
        options.setPassword(properties.password().toCharArray());
        options.setCleanSession(properties.cleanSession());
        options.setKeepAliveInterval(KEEP_ALIVE_SECONDS);
        options.setAutomaticReconnect(true);
        options.setMaxReconnectDelay(30_000);
        try {
            client.connect(options, null, new IMqttActionListener() {
                @Override
                public void onSuccess(IMqttToken token) {
                    log.info("MQTT connected: url={}, clientId={}", properties.url(), properties.clientId());
                }

                @Override
                public void onFailure(IMqttToken token, Throwable failure) {
                    retryConnect(attempt, failure);
                }
            });
        } catch (MqttException failure) {
            retryConnect(attempt, failure);
        }
    }

    /** Paho reconnects by itself only after a first success; the first connection follows section 18's backoff. */
    private void retryConnect(int attempt, Throwable failure) {
        long delay = Math.min(30, 1L << Math.min(attempt, 5));
        log.warn("MQTT connection failed ({}); next attempt in {} s", reason(failure), delay);
        if (running) {
            connector.schedule(() -> connect(attempt + 1), delay, TimeUnit.SECONDS);
        }
    }

    @Override
    public void connectComplete(boolean reconnect, String serverUri) {
        // Resubscribing every time covers a broker that did not keep the session.
        try {
            client.subscribe(new String[] {InboundTopic.EVENTS_FILTER, InboundTopic.STATUS_FILTER},
                    new int[] {1, 1}, null, new IMqttActionListener() {
                        @Override
                        public void onSuccess(IMqttToken token) {
                            for (int granted : token.getGrantedQos()) {
                                if (granted == SUBSCRIPTION_FAILURE) {
                                    log.error("MQTT subscription refused by the broker ACL");
                                    return;
                                }
                            }
                            log.info("MQTT subscribed to {} and {}", InboundTopic.EVENTS_FILTER,
                                    InboundTopic.STATUS_FILTER);
                            subscribed.get().complete(null);
                        }

                        @Override
                        public void onFailure(IMqttToken token, Throwable failure) {
                            log.error("MQTT subscription failed ({})", reason(failure));
                        }
                    });
        } catch (MqttException failure) {
            log.error("MQTT subscription failed ({})", reason(failure));
        }
    }

    @Override
    public void connectionLost(Throwable cause) {
        subscribed.set(new CompletableFuture<>());
        log.warn("MQTT connection lost ({}); reconnecting", reason(cause));
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        for (int attempt = 0; ; attempt++) {
            try {
                ingestion.ingest(topic, message.getPayload());
                acknowledge(message);
                return;
            } catch (DataIntegrityViolationException refused) {
                // Deterministic: the same delivery would be refused again, so it is logged and acknowledged.
                log.error("Device message refused by a database constraint and dropped: mqttMessageId={}",
                        message.getId(), refused);
                acknowledge(message);
                return;
            } catch (RuntimeException failure) {
                if (attempt >= INGESTION_RETRY_MILLIS.length) {
                    log.error("Device message left unacknowledged after {} attempts: mqttMessageId={}",
                            attempt + 1, message.getId(), failure);
                    return;
                }
                try {
                    Thread.sleep(INGESTION_RETRY_MILLIS[attempt]);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private void acknowledge(MqttMessage message) {
        try {
            client.messageArrivedComplete(message.getId(), message.getQos());
        } catch (MqttException failure) {
            log.warn("MQTT acknowledgement failed ({})", reason(failure));
        }
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
        // The ingestion publishes nothing.
    }

    private static String reason(Throwable failure) {
        if (failure instanceof MqttException mqtt) {
            return "reasonCode=" + mqtt.getReasonCode();
        }
        return failure == null ? "no cause" : failure.getClass().getSimpleName();
    }
}
