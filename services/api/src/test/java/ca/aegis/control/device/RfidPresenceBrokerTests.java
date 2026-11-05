package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.CELL_A1;
import static ca.aegis.control.device.DevicePayloads.CELL_A2;
import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static ca.aegis.control.device.DevicePayloads.cell;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * PHY-02 (#31) end to end through the development Mosquitto, published with the test hub account only: a stable scan
 * of A1 and A2 reaches the catalog as presence and readiness. Assets are placed in the test hub's cells for one test
 * and their placements end after it; the subscriber's persistent session is discarded at the end of the class.
 */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RfidPresenceBrokerTests extends ApiIntegrationTest {

    private static final TestBroker BROKER = TestBroker.fromEnvironment();
    private static final String CLIENT_ID = "aegis-api-test-" + UUID.randomUUID();
    private static final AtomicLong BOOTS = new AtomicLong(7_000);
    private static volatile MqttIngestionClient started;

    @DynamicPropertySource
    static void broker(DynamicPropertyRegistry registry) {
        registry.add("aegis.mqtt.enabled", () -> "true");
        registry.add("aegis.mqtt.url", () -> BROKER.url);
        registry.add("aegis.mqtt.username", () -> TestBroker.API_USER);
        registry.add("aegis.mqtt.password", () -> BROKER.apiPassword);
        registry.add("aegis.mqtt.client-id", () -> CLIENT_ID);
    }

    @Autowired
    MqttIngestionClient subscriber;

    @Autowired
    JdbcClient jdbc;

    private DeviceTestSupport db;
    private TestBroker.Device hub;
    private Session session;
    private final String suffix = UUID.randomUUID().toString().substring(0, 8);

    @BeforeEach
    void connectedHubOnAFreshlyProvisionedDevice() throws Exception {
        started = subscriber;
        subscriber.awaitSubscribed(Duration.ofSeconds(20));
        // Rejected messages that other classes leave on the shared test hub void any scan received after them;
        // provisioning an hour after their instants keeps them out of this class's evidence.
        clock.set(START.plus(Duration.ofHours(1)));
        db = new DeviceTestSupport(jdbc);
        db.provisionTestHub(clock.instant());
        hub = BROKER.device();
        session = new Session(BOOTS.incrementAndGet());
    }

    @AfterEach
    void endPlacementsAndDisconnectHub() throws Exception {
        jdbc.sql("""
                UPDATE aegis.asset_placements SET removed_at = :now
                WHERE compartment_id IN (:a1, :a2) AND removed_at IS NULL
                """).param("now", DeviceTestSupport.utc(clock.instant())).param("a1", CELL_A1).param("a2", CELL_A2)
                .update();
        if (hub != null) {
            hub.close();
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
    void stableScansOfA1AndA2ReachTheCatalogAsPresenceAndReadiness() throws Exception {
        String tagA1 = "E2-BROKER-" + suffix + "-1";
        String tagA2 = "E2-BROKER-" + suffix + "-2";
        UUID eligible = placedAsset(CELL_A1, tagA1, null);
        UUID expired = placedAsset(CELL_A2, tagA2, START.minus(Duration.ofDays(30)));
        String technician = accessToken(accounts.technician());
        publish(STATUS, heartbeat());
        clock.advance(Duration.ofSeconds(5));
        assertEquals("UNKNOWN", read(view(eligible, technician), "$.presence"), "no scan yet");

        publish(EVENTS, scan(CELL_A1, tagA1));
        publish(EVENTS, scan(CELL_A2, tagA2));

        String a1 = view(eligible, technician);
        assertEquals("PRESENT", read(a1, "$.presence"));
        assertEquals("READY", read(a1, "$.readiness.result"));
        String a2 = view(expired, technician);
        assertEquals("PRESENT", read(a2, "$.presence"));
        assertEquals("BLOCKED", read(a2, "$.readiness.result"));
        assertEquals(List.of("CALIBRATION_EXPIRED"), read(a2, "$.readiness.reasons"));
    }

    @Test
    void aScanDeliveredTwiceStoresOneMessageAndOneSetOfObservations() throws Exception {
        String tag = "E2-BROKER-" + suffix + "-3";
        placedAsset(CELL_A1, tag, null);
        publish(STATUS, heartbeat());
        clock.advance(Duration.ofSeconds(5));
        Map<String, Object> scan = scan(CELL_A1, tag);

        publish(EVENTS, scan);
        hub.publish(EVENTS, bytes(scan));
        Map<String, Object> marker = publish(EVENTS, session.deviceError(clock.instant(), "CLOCK_SYNC_LOST",
                "WARNING"));

        UUID stored = (UUID) db.message(scan.get("messageId")).orElseThrow().get("id");
        assertEquals(1, db.messageCount(scan.get("messageId")));
        DeviceTestSupport.await(() -> db.duplicateAudits(stored) == 1 ? java.util.Optional.of(true)
                : java.util.Optional.empty(), "the duplicate audit");
        assertEquals(List.of("ASSET_IDENTIFIER_DETECTED", "ASSET_PRESENT"), jdbc.sql("""
                SELECT type FROM aegis.physical_observations WHERE inbound_message_id = :id ORDER BY type
                """).param("id", stored).query(String.class).list());
        assertEquals("PROCESSED", db.message(marker.get("messageId")).orElseThrow().get("processing_status"));
    }

    private Map<String, Object> heartbeat() {
        return session.heartbeat(clock.instant(), List.of(
                cell(CELL_A1, 1, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"),
                cell(CELL_A2, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED")));
    }

    private Map<String, Object> scan(UUID compartment, String tag) {
        Instant now = clock.instant();
        return session.scan(now, compartment, "HEALTHY", now.minusSeconds(4), now.minusSeconds(1),
                Map.of(tag, 3));
    }

    /** A serviceable standard asset with its UHF tag, placed in a cell of the test hub before the test clock. */
    private UUID placedAsset(UUID compartment, String tag, Instant calibrationDueAt) {
        UUID model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle présence " + tag).query(UUID.class).single();
        UUID asset = jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, calibration_required,
                                          calibration_due_at)
                VALUES (:model, :code, 'STANDARD', :required, :due)
                RETURNING id
                """).param("model", model).param("code", "PRS-" + tag).param("required", calibrationDueAt != null)
                .param("due", calibrationDueAt == null ? null : DeviceTestSupport.utc(calibrationDueAt))
                .query(UUID.class).single();
        Instant past = START.minus(Duration.ofDays(1));
        jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:asset, 'RFID_UHF', :tag, :past)
                """).param("asset", asset).param("tag", tag).param("past", DeviceTestSupport.utc(past)).update();
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                VALUES (:asset, :compartment, 'Test PHY-02', :past)
                """).param("asset", asset).param("compartment", compartment)
                .param("past", DeviceTestSupport.utc(past)).update();
        return asset;
    }

    /** Publishes and waits until the application has stored it, so the next read sees its effect. */
    private Map<String, Object> publish(String topic, Map<String, Object> message) {
        hub.publish(topic, bytes(message));
        db.awaitMessage(message.get("messageId"));
        return message;
    }

    private String view(UUID asset, String token) throws Exception {
        return mvc.perform(get("/api/v1/assets/" + asset).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static <T> T read(String body, String path) {
        return JsonPath.read(body, path);
    }
}
