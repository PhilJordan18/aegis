package ca.aegis.control.device;

import java.sql.SQLException;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
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

/**
 * The backend subscriber of {@code aegis/v1/lockers/+/events} and {@code +/status} (document 10, sections 6.2 and
 * 7), on MQTT 3.1.1 with QoS 1 and a persistent session. A delivery is acknowledged only after its ingestion
 * transaction has committed; the broker is never awaited inside a transaction.
 *
 * <p>MQTT 3.1.1 redelivers an unacknowledged message only when the session resumes, so a delivery that still fails
 * after its retries starts a recovery: every later delivery is left unacknowledged, and the client disconnects then
 * reconnects with a growing delay. The broker then resends the held deliveries in their original order, and the
 * ingestion's deduplication absorbs any that had already committed. Disconnecting happens on the connector thread,
 * never inside a Paho callback.
 */
public class MqttIngestionClient implements SmartLifecycle, MqttCallbackExtended {

    private static final Logger log = LoggerFactory.getLogger(MqttIngestionClient.class);
    private static final int KEEP_ALIVE_SECONDS = 30;
    private static final long[] INGESTION_RETRY_MILLIS = {200, 1000};
    private static final long MAX_DELAY_SECONDS = 30;
    private static final int SUBSCRIPTION_FAILURE = 0x80;

    private final MqttProperties properties;
    private final DeviceMessageIngestion ingestion;
    private final MqttAsyncClient client;
    private final ScheduledExecutorService connector;
    private final AtomicReference<CompletableFuture<Void>> subscribed =
            new AtomicReference<>(new CompletableFuture<>());
    private final AtomicBoolean recovering = new AtomicBoolean();
    private final AtomicInteger consecutiveRecoveries = new AtomicInteger();
    private final AtomicLong recoveries = new AtomicLong();
    private final AtomicBoolean closed = new AtomicBoolean();
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
        connector.execute(() -> connect(0));
    }

    @Override
    public void stop() {
        running = false;
        if (!closed.compareAndSet(false, true)) {
            return;
        }
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

    /** How many recoveries have reconnected so far. */
    long recoveries() {
        return recoveries.get();
    }

    /** Runs on the connector thread only, so that a connection and a recovery never overlap. */
    private void connect(int attempt) {
        if (!running) {
            return;
        }
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setUserName(properties.username());
        options.setPassword(properties.password().toCharArray());
        options.setCleanSession(false);
        options.setKeepAliveInterval(KEEP_ALIVE_SECONDS);
        // Reconnection is ours: Paho's own timer could resume the session in the middle of a recovery.
        options.setAutomaticReconnect(false);
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
            if (failure.getReasonCode() == MqttException.REASON_CODE_CLIENT_CONNECTED
                    || failure.getReasonCode() == MqttException.REASON_CODE_CONNECT_IN_PROGRESS) {
                return;
            }
            retryConnect(attempt, failure);
        }
    }

    /** Section 18: the delay doubles from 1 s up to 30 s. */
    private void retryConnect(int attempt, Throwable failure) {
        long delay = delaySeconds(attempt);
        log.warn("MQTT connection failed ({}); next attempt in {} s", reason(failure), delay);
        schedule(() -> connect(attempt + 1), delay);
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
        if (!recovering.get()) {
            schedule(() -> connect(0), 0);
        }
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        if (recovering.get()) {
            // Left unacknowledged: the broker resends it, in order, once the recovery has reconnected.
            return;
        }
        for (int attempt = 0; ; attempt++) {
            try {
                ingestion.ingest(topic, message.getPayload());
                consecutiveRecoveries.set(0);
                acknowledge(message);
                return;
            } catch (RuntimeException failure) {
                if (attempt >= INGESTION_RETRY_MILLIS.length) {
                    log.error("Device message ingestion failed after {} attempts ({}); holding the deliveries "
                            + "until the session is resumed: mqttMessageId={}", attempt + 1, cause(failure),
                            message.getId());
                    startRecovery();
                    return;
                }
                try {
                    Thread.sleep(INGESTION_RETRY_MILLIS[attempt]);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    startRecovery();
                    return;
                }
            }
        }
    }

    private void startRecovery() {
        if (recovering.compareAndSet(false, true)) {
            schedule(this::recover, delaySeconds(consecutiveRecoveries.getAndIncrement()));
        }
    }

    private void recover() {
        subscribed.set(new CompletableFuture<>());
        try {
            if (client.isConnected()) {
                client.disconnect(5000).waitForCompletion(10_000);
            }
        } catch (MqttException failure) {
            log.warn("MQTT disconnection for recovery failed ({}); closing the network connection",
                    reason(failure));
            try {
                client.disconnectForcibly(0, 1000, false);
            } catch (MqttException ignored) {
                // The connection is already gone.
            }
        }
        // Cleared only once disconnected, so that no delivery of the resumed session can be skipped.
        recovering.set(false);
        recoveries.incrementAndGet();
        log.info("MQTT session resuming to receive the held deliveries again");
        connect(0);
    }

    private void schedule(Runnable task, long delaySeconds) {
        if (running && !connector.isShutdown()) {
            connector.schedule(task, delaySeconds, TimeUnit.SECONDS);
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

    private static long delaySeconds(int attempt) {
        return Math.min(MAX_DELAY_SECONDS, 1L << Math.min(attempt, 5));
    }

    /** The failure class and SQLState only: a driver message can quote the values of the row. */
    private static String cause(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql) {
                return failure.getClass().getSimpleName() + ", sqlState=" + sql.getSQLState();
            }
        }
        return failure.getClass().getSimpleName();
    }

    private static String reason(Throwable failure) {
        if (failure instanceof MqttException mqtt) {
            return "reasonCode=" + mqtt.getReasonCode();
        }
        return failure == null ? "no cause" : failure.getClass().getSimpleName();
    }
}
