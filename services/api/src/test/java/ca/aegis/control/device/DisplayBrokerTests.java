package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.CELL_A1;
import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.LOCKER;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.jayway.jsonpath.JsonPath;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.asset.PresentAssetsConfiguration;
import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.device.TestBroker.Delivery;
import ca.aegis.control.reservation.LocalChallengeExpiry;
import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * LOC-01 on the development Mosquitto with its real ACL (#43, #46): the API publishes the decrypted challenge only
 * on the target hub's {@code display} topic, the backend account itself cannot read it back, and the hub's
 * {@code ACCESS_CHALLENGE_DISPLAYED} travels through the broker to the ingestion. Presence is the test
 * configuration's (every asset {@code PRESENT}); the RFID path is covered by {@link RfidPresenceBrokerTests}.
 */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(PresentAssetsConfiguration.class)
class DisplayBrokerTests extends ApiIntegrationTest {

    private static final TestBroker BROKER = TestBroker.fromEnvironment();
    private static final String CLIENT_ID = "aegis-api-test-" + UUID.randomUUID();
    private static final AtomicLong BOOTS = new AtomicLong(9_000);
    private static final String DISPLAY = "aegis/v1/lockers/" + LOCKER + "/display";
    private static volatile MqttIngestionClient started;

    @DynamicPropertySource
    static void broker(DynamicPropertyRegistry registry) {
        registry.add("aegis.mqtt.enabled", () -> "true");
        registry.add("aegis.mqtt.url", () -> BROKER.url);
        registry.add("aegis.mqtt.username", () -> TestBroker.API_USER);
        registry.add("aegis.mqtt.password", () -> BROKER.apiPassword);
        registry.add("aegis.mqtt.client-id", () -> CLIENT_ID);
        registry.add("aegis.display.dispatcher.enabled", () -> "true");
        registry.add("aegis.display.dispatcher.interval", () -> "PT0.2S");
    }

    @Autowired
    MqttIngestionClient subscriber;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    LocalChallengeExpiry challengeExpiry;

    private DeviceTestSupport db;
    private TestBroker.Device hub;
    private TestBroker.Device observer;
    private Session session;
    private final BlockingQueue<Delivery> screen = new LinkedBlockingQueue<>();
    private final BlockingQueue<Delivery> observed = new LinkedBlockingQueue<>();
    private TestAccount technician;
    private UUID reservation;

    @BeforeEach
    void onlineHubWithAReservedAssetInA1() throws Exception {
        started = subscriber;
        subscriber.awaitSubscribed(Duration.ofSeconds(20));
        clock.set(START.plus(Duration.ofHours(1)));
        db = new DeviceTestSupport(jdbc);
        db.provisionTestHub(clock.instant());
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        if (jdbc.sql("SELECT count(*) FROM aegis.operating_schedules WHERE locker_id = :id").param("id", LOCKER)
                .query(Long.class).single() == 0) {
            fixtures.schedule(LOCKER, accounts.admin().id(), true);
        }
        technician = accounts.technician();
        UUID asset = placedAsset("E2-DISPLAY-" + UUID.randomUUID().toString().substring(0, 8));
        reservation = fixtures.reservation(asset, technician.id(), "ACTIVE", clock.instant().minusSeconds(60),
                clock.instant().plus(Duration.ofHours(1)));

        hub = BROKER.device();
        hub.subscribe(DISPLAY, screen);
        observer = BROKER.api();
        // Everything the backend account may read; the display topics must not be among it.
        observer.subscribe("aegis/v1/lockers/+/display", observed);
        observer.subscribe("aegis/v1/lockers/" + LOCKER + "/events", observed);
        observer.subscribe("aegis/v1/lockers/" + LOCKER + "/status", observed);
        session = new Session(BOOTS.incrementAndGet());
        publish(STATUS, session.heartbeat(clock.instant(), "CLOSED"));
    }

    @AfterEach
    void endPlacementsAndDisconnect() throws Exception {
        jdbc.sql("""
                UPDATE aegis.asset_placements SET removed_at = :now
                WHERE compartment_id = :a1 AND removed_at IS NULL
                """).param("now", DeviceTestSupport.utc(clock.instant())).param("a1", CELL_A1).update();
        if (hub != null) {
            hub.close();
        }
        if (observer != null) {
            observer.close();
        }
    }

    @AfterAll
    static void discardTheSubscriberSession() {
        if (started != null) {
            started.stop();
            BROKER.discardSession(CLIENT_ID);
        }
    }

    @Test
    void theChallengeReachesOnlyItsHubAndTheHubAcknowledgementReachesTheBackend() throws Exception {
        UUID operation = prepare();
        Delivery delivery = nextDisplay("DISPLAY_ACCESS_CHALLENGE");
        assertEquals(1, delivery.qos());
        assertFalse(delivery.retained());
        JsonNode message = jsonMapper.readTree(new String(delivery.payload(), StandardCharsets.UTF_8));
        assertEquals(operation.toString(), message.get("operationId").asString());
        assertEquals(session.deviceSessionId.toString(), message.get("targetDeviceSessionId").asString());
        assertEquals(CELL_A1.toString(), message.get("compartmentId").asString());
        String token = message.get("payload").get("token").asString();
        byte[] hash = jdbc.sql("SELECT token_hash FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(byte[].class).single();
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(Base64.getUrlDecoder().decode(token)), hash);

        Map<String, Object> ack = session.envelope("ACCESS_CHALLENGE_DISPLAYED", clock.instant());
        ack.put("operationId", operation.toString());
        ack.put("compartmentId", CELL_A1.toString());
        ack.put("displayMessageId", message.get("messageId").asString());
        ack.put("challengeId", message.get("payload").get("challengeId").asString());
        ack.put("displayRevision", message.get("displayRevision").longValue());
        publish(EVENTS, ack);
        assertEquals("PROCESSED", db.awaitMessage(ack.get("messageId")).get("processing_status"));
        assertNotNull(displayedAt(operation));
        assertEquals("ACKNOWLEDGED", jdbc.sql("""
                SELECT status FROM aegis.hub_display_outbox WHERE message_id = :id
                """).param("id", UUID.fromString(message.get("messageId").asString())).query(String.class).single());

        // The same report again is a duplicate; displayedAt keeps its first value.
        Instant first = displayedAt(operation);
        hub.publish(EVENTS, bytes(ack));
        Thread.sleep(500);
        assertEquals(first, displayedAt(operation));

        // Secrecy: the backend account received no display message, and no message it can read holds the token.
        Thread.sleep(500);
        for (Delivery seen : observed) {
            assertFalse(seen.topic().endsWith("/display"), seen.topic());
            assertFalse(new String(seen.payload(), StandardCharsets.UTF_8).contains(token), seen.topic());
        }
    }

    @Test
    void anUnconsumedChallengeExpiresAndAStatusClearsTheScreen() throws Exception {
        UUID operation = prepare();
        JsonNode challenge = jsonMapper.readTree(new String(nextDisplay("DISPLAY_ACCESS_CHALLENGE").payload(),
                StandardCharsets.UTF_8));
        clock.advance(Duration.ofSeconds(60));
        challengeExpiry.run(100);
        assertEquals("EXPIRED", jdbc.sql("SELECT status FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(String.class).single());
        JsonNode clear = jsonMapper.readTree(new String(nextDisplay("DISPLAY_OPERATION_STATUS").payload(),
                StandardCharsets.UTF_8));
        assertEquals("EXPIRED", clear.get("payload").get("status").asString());
        assertEquals("LOCAL_PROOF_EXPIRED", clear.get("payload").get("reasonCode").asString());
        assertFalse(clear.get("payload").has("token"));
        assertEquals(challenge.get("displayRevision").longValue() + 1, clear.get("displayRevision").longValue());
        assertNull(jdbc.sql("""
                SELECT encrypted_payload FROM aegis.hub_display_outbox
                WHERE operation_id = :id AND message_type = 'DISPLAY_ACCESS_CHALLENGE'
                """).param("id", operation).query(byte[].class).optional().orElse(null));

        // A late acknowledgement, delivered after the expiry, changes nothing.
        Map<String, Object> late = session.envelope("ACCESS_CHALLENGE_DISPLAYED", clock.instant());
        late.put("operationId", operation.toString());
        late.put("compartmentId", CELL_A1.toString());
        late.put("displayMessageId", challenge.get("messageId").asString());
        late.put("challengeId", challenge.get("payload").get("challengeId").asString());
        late.put("displayRevision", challenge.get("displayRevision").longValue());
        publish(EVENTS, late);
        assertEquals("REJECTED", db.awaitMessage(late.get("messageId")).get("processing_status"));
        assertNull(displayedAt(operation));
    }

    private UUID prepare() throws Exception {
        String body = mvc.perform(post("/api/v1/reservations/" + reservation + "/checkout")
                .header(AUTHORIZATION, bearer(accessToken(technician)))
                .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        assertFalse(body.contains("token"));
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private Delivery nextDisplay(String type) throws InterruptedException {
        List<String> skipped = new ArrayList<>();
        Instant deadline = Instant.now().plusSeconds(15);
        while (Instant.now().isBefore(deadline)) {
            Delivery delivery = screen.poll(500, TimeUnit.MILLISECONDS);
            if (delivery == null) {
                continue;
            }
            JsonNode message = jsonMapper.readTree(new String(delivery.payload(), StandardCharsets.UTF_8));
            if (type.equals(message.get("type").asString())) {
                return delivery;
            }
            skipped.add(message.get("type").asString());
        }
        throw new AssertionError("No " + type + " on " + DISPLAY + "; skipped " + skipped);
    }

    private Instant displayedAt(UUID operation) {
        return jdbc.sql("SELECT displayed_at FROM aegis.local_access_challenges WHERE operation_id = :id")
                .param("id", operation).query(OffsetDateTime.class).optional().map(OffsetDateTime::toInstant)
                .orElse(null);
    }

    private UUID placedAsset(String tag) {
        jdbc.sql("""
                UPDATE aegis.asset_placements SET removed_at = :now
                WHERE compartment_id = :a1 AND removed_at IS NULL
                """).param("now", DeviceTestSupport.utc(clock.instant())).param("a1", CELL_A1).update();
        UUID model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle écran " + tag).query(UUID.class).single();
        UUID asset = jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, calibration_required)
                VALUES (:model, :code, 'STANDARD', false) RETURNING id
                """).param("model", model).param("code", "DSP-" + tag).query(UUID.class).single();
        Instant past = START.minus(Duration.ofDays(1));
        jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:asset, 'RFID_UHF', :tag, :past)
                """).param("asset", asset).param("tag", tag).param("past", DeviceTestSupport.utc(past)).update();
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                VALUES (:asset, :a1, 'Test LOC-01', :past)
                """).param("asset", asset).param("a1", CELL_A1).param("past", DeviceTestSupport.utc(past)).update();
        return asset;
    }

    private Map<String, Object> publish(String topic, Map<String, Object> message) {
        hub.publish(topic, bytes(message));
        db.awaitMessage(message.get("messageId"));
        return message;
    }
}
