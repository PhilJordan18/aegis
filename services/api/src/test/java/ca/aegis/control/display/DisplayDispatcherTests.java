package ca.aegis.control.display;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.command.CommandPublisher;
import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * The display dispatcher against rows sealed by {@link HubDisplayOutbox}: it publishes exactly the sealed message, and
 * never publishes a payload whose ciphertext, associated data or key cannot be authenticated, nor one past its display
 * deadline. Other test classes leave rows in the shared database, so every assertion targets this test's row.
 */
class DisplayDispatcherTests extends ApiIntegrationTest {

    @Autowired
    JdbcClient jdbc;

    @Autowired
    TransactionTemplate transactions;

    @Autowired
    HubDisplayOutbox outbox;

    @Autowired
    DisplayEncryption encryption;

    final List<Published> published = new ArrayList<>();
    boolean brokerDown;
    UUID operation;
    UUID row;
    UUID messageId;

    record Published(String topic, String message) {
    }

    @BeforeEach
    void queueOneStatusInstruction() {
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        UUID technician = accounts.technician().id();
        UUID locker = fixtures.scheduledLocker(accounts.admin().id());
        UUID asset = fixtures.assetAt(locker, 1);
        UUID reservation = fixtures.reservation(asset, technician, "ACTIVE", START, START.plusSeconds(3600));
        operation = fixtures.attempt(asset, technician, reservation, "AWAITING_LOCAL_PROOF", false, START);
        jdbc.sql("""
                INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, device_session_id, boot_count)
                VALUES (:locker, :key, 'test', :session, 1)
                """).param("locker", locker).param("key", "dispatch-" + UUID.randomUUID())
                .param("session", UUID.randomUUID()).update();
        messageId = transactions.execute(status -> outbox.enqueueStatus(operation, "FAILED", "TEST", START)
                .orElseThrow());
        row = jdbc.sql("SELECT id FROM aegis.hub_display_outbox WHERE message_id = :id").param("id", messageId)
                .query(UUID.class).single();
    }

    @Test
    void publishesTheSealedMessageOnItsTopicAndMarksIt() {
        drain(dispatcher(encryption));
        Map<String, Object> state = state();
        assertEquals("DISPATCHED", state.get("status"));
        assertNotNull(state.get("published_at"));
        Published message = mine();
        assertEquals(state.get("topic"), message.topic());
        JsonNode json = jsonMapper.readTree(message.message());
        assertEquals("DISPLAY_OPERATION_STATUS", json.get("type").asString());
        assertEquals("FAILED", json.get("payload").get("status").asString());
        assertEquals(operation.toString(), json.get("operationId").asString());
    }

    @Test
    void aModifiedCiphertextIsNeverPublished() {
        jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET encrypted_payload = overlay(encrypted_payload PLACING
                    decode(lpad(to_hex(get_byte(encrypted_payload, 20) # 1), 2, '0'), 'hex') FROM 21 FOR 1)
                WHERE id = :id
                """).param("id", row).update();
        assertRefused("DISPLAY_PAYLOAD_AUTHENTICATION_FAILED");
    }

    @Test
    void ciphertextMovedToOtherAssociatedDataIsNeverPublished() {
        // Same bytes, other revision: the associated data no longer matches.
        jdbc.sql("UPDATE aegis.hub_display_outbox SET display_revision = display_revision + 1000 WHERE id = :id")
                .param("id", row).update();
        assertRefused("DISPLAY_PAYLOAD_AUTHENTICATION_FAILED");
    }

    @Test
    void anOldKeyKeptAfterRotationStillOpensItsRows() {
        DisplayEncryption rotated = new DisplayEncryption(true,
                "next-key:" + randomBase64(32) + "," + DISPLAY_KEY_ID + ":" + DISPLAY_KEY, "next-key");
        drain(dispatcher(rotated));
        assertEquals("DISPATCHED", state().get("status"));
        mine();
    }

    @Test
    void aRetiredKeyStillReferencedCancelsTheRowUnpublished() {
        DisplayEncryption retired = new DisplayEncryption(true, "next-key:" + randomBase64(32), "next-key");
        DisplayKeyDependencies dependencies = new DisplayKeyDependencies(jdbc, retired);
        assertTrue(dependencies.missing().stream().anyMatch(found -> found.keyId().equals(DISPLAY_KEY_ID)));
        drain(dispatcher(retired));
        assertCancelledUnpublished("DISPLAY_PAYLOAD_KEY_NOT_CONFIGURED");
    }

    @Test
    void anInstructionPastItsDisplayDeadlineIsCancelledUnpublished() {
        clock.advance(Duration.ofSeconds(30));
        drain(dispatcher(encryption));
        assertCancelledUnpublished("DISPLAY_EXPIRED");
    }

    @Test
    void anUnconfirmedPublicationIsRetriedLater() {
        brokerDown = true;
        DisplayDispatcher dispatcher = dispatcher(encryption);
        drain(dispatcher);
        Map<String, Object> state = state();
        assertEquals("PENDING", state.get("status"));
        assertEquals(1, ((Number) state.get("attempt_count")).intValue());
        assertEquals(START.plusSeconds(1), ((java.sql.Timestamp) state.get("next_attempt_at")).toInstant());
        assertNotNull(state.get("encrypted_payload"));

        brokerDown = false;
        clock.advance(Duration.ofSeconds(1));
        drain(dispatcher);
        assertEquals("DISPATCHED", state().get("status"));
        assertEquals(2, ((Number) state().get("attempt_count")).intValue());
    }

    private void assertRefused(String reason) {
        drain(dispatcher(encryption));
        assertCancelledUnpublished(reason);
    }

    private void assertCancelledUnpublished(String reason) {
        Map<String, Object> state = state();
        assertEquals("CANCELLED", state.get("status"));
        assertEquals(reason, state.get("last_error"));
        assertNull(state.get("encrypted_payload"));
        assertNull(state.get("published_at"));
        assertTrue(published.stream().noneMatch(message -> message.message().contains(messageId.toString())));
    }

    private Published mine() {
        return published.stream().filter(message -> message.message().contains(messageId.toString())).findFirst()
                .orElseThrow();
    }

    private Map<String, Object> state() {
        return jdbc.sql("SELECT * FROM aegis.hub_display_outbox WHERE id = :id").param("id", row).query()
                .singleRow();
    }

    private void drain(DisplayDispatcher dispatcher) {
        dispatcher.dispatchDue(1000);
    }

    private DisplayDispatcher dispatcher(DisplayEncryption keys) {
        CommandPublisher publisher = (topic, payload) -> {
            if (brokerDown) {
                throw new CommandPublisher.CommandPublicationException("BROKER_UNAVAILABLE", false, null);
            }
            published.add(new Published(topic, new String(payload, StandardCharsets.UTF_8)));
        };
        return new DisplayDispatcher(jdbc, transactions, clock, publisher, keys, Duration.ofSeconds(15));
    }
}
