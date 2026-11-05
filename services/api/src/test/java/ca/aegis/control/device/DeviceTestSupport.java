package ca.aegis.control.device;

import static org.junit.jupiter.api.Assertions.fail;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import org.springframework.jdbc.core.simple.JdbcClient;

/** Database checks shared by the ingestion tests; every query is scoped to the test locker or a message id. */
final class DeviceTestSupport {

    private final JdbcClient jdbc;

    DeviceTestSupport(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The test locker, its two cells and its hub device, created once in the test database. Document 08, section
     * 4.4: re-provisioning then resets the session and the reference heartbeat.
     */
    void provisionTestHub(Instant now) {
        jdbc.sql("""
                INSERT INTO aegis.lockers (id, code, name, topology)
                VALUES (:locker, 'AEGIS-TEST-HUB', 'Casier de test MQTT', 'HUB_CELL')
                ON CONFLICT (id) DO NOTHING
                """).param("locker", DevicePayloads.LOCKER).update();
        int address = 1;
        for (UUID cell : new UUID[] {DevicePayloads.CELL_A1, DevicePayloads.CELL_A2}) {
            jdbc.sql("""
                    INSERT INTO aegis.compartments (id, locker_id, code, local_address, hub_port)
                    VALUES (:id, :locker, :code, :address, :address)
                    ON CONFLICT (id) DO NOTHING
                    """).param("id", cell).param("locker", DevicePayloads.LOCKER).param("code", "A" + address)
                    .param("address", address).update();
            address++;
        }
        jdbc.sql("""
                INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version)
                SELECT :locker, :key, 'test'
                WHERE NOT EXISTS (SELECT 1 FROM aegis.locker_devices WHERE locker_id = :locker)
                """).param("locker", DevicePayloads.LOCKER).param("key", "test-" + DevicePayloads.LOCKER).update();
        reprovision(now);
    }

    private void reprovision(Instant now) {
        jdbc.sql("""
                UPDATE aegis.locker_devices
                SET provisioned_at = :now, device_session_id = NULL, boot_count = NULL,
                    heartbeat_connection_id = NULL, heartbeat_sequence = NULL, last_valid_heartbeat_at = NULL,
                    heartbeat_connection_closed_at = NULL, first_valid_heartbeat_at = NULL, last_seen_at = NULL,
                    connection_status = 'UNKNOWN', updated_at = :now
                WHERE locker_id = :locker AND disabled_at IS NULL
                """).param("now", utc(now)).param("locker", DevicePayloads.LOCKER).update();
        jdbc.sql("""
                UPDATE aegis.compartments
                SET connection_status = 'UNKNOWN', rfid_reader_status = 'UNKNOWN', door_state = 'UNKNOWN',
                    lock_state = 'UNKNOWN', last_observed_at = NULL
                WHERE locker_id = :locker
                """).param("locker", DevicePayloads.LOCKER).update();
        jdbc.sql("UPDATE aegis.lockers SET status = 'UNKNOWN', last_seen_at = NULL WHERE id = :locker")
                .param("locker", DevicePayloads.LOCKER).update();
    }

    Optional<Map<String, Object>> message(Object messageId) {
        return jdbc.sql("""
                SELECT m.id, m.message_type, m.processing_status, m.processing_error, m.schema_version,
                       m.parsed_payload IS NOT NULL AS parsed, m.raw_payload, m.boot_count, m.sequence
                FROM aegis.inbound_device_messages m
                JOIN aegis.locker_devices d ON d.id = m.locker_device_id
                WHERE d.locker_id = :locker AND m.message_id = :messageId
                """).param("locker", DevicePayloads.LOCKER).param("messageId", UUID.fromString(messageId.toString()))
                .query().listOfRows().stream().findFirst();
    }

    long messageCount(Object messageId) {
        return jdbc.sql("SELECT count(*) FROM aegis.inbound_device_messages WHERE message_id = :messageId")
                .param("messageId", UUID.fromString(messageId.toString())).query(Long.class).single();
    }

    Map<String, Object> awaitMessage(Object messageId) {
        return await(() -> message(messageId), "inbound message " + messageId);
    }

    long duplicateAudits(UUID inboundId) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'MQTT_MESSAGE_DUPLICATE_IGNORED' AND subject_type = 'INBOUND_DEVICE_MESSAGE'
                  AND subject_id = :id AND inbound_message_id = :id AND result = 'ALREADY_APPLIED'
                """).param("id", inboundId).query(Long.class).single();
    }

    Map<String, Object> device() {
        return jdbc.sql("""
                SELECT device_session_id, boot_count, heartbeat_connection_id, heartbeat_sequence,
                       last_valid_heartbeat_at, heartbeat_connection_closed_at, first_valid_heartbeat_at,
                       last_seen_at, connection_status, updated_at
                FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NULL
                """).param("locker", DevicePayloads.LOCKER).query().singleRow();
    }

    Map<String, Object> cell(UUID compartmentId) {
        return jdbc.sql("""
                SELECT connection_status, rfid_reader_status, door_state, lock_state FROM aegis.compartments
                WHERE id = :id
                """).param("id", compartmentId).query().singleRow();
    }

    static <T> T await(Supplier<Optional<T>> probe, String what) {
        return await(probe, what, Duration.ofSeconds(15));
    }

    static <T> T await(Supplier<Optional<T>> probe, String what, Duration timeout) {
        Instant deadline = Instant.now().plus(timeout);
        while (Instant.now().isBefore(deadline)) {
            Optional<T> value = probe.get();
            if (value.isPresent()) {
                return value.get();
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        return fail("Timed out waiting for " + what);
    }

    static java.time.OffsetDateTime utc(Instant instant) {
        return instant.atOffset(java.time.ZoneOffset.UTC);
    }
}
