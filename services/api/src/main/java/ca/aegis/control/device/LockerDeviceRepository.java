package ca.aegis.control.device;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.device.Inspection.Fact;

/** The availability projection of {@code locker_devices} and its mirror on {@code lockers} (document 08, §4.4). */
@Repository
class LockerDeviceRepository {

    record ActiveDevice(UUID id, UUID lockerId, Instant provisionedAt, DeviceProjection projection,
            ConnectionStatus cachedStatus) {
    }

    private static final String SELECT = """
            SELECT id, locker_id, provisioned_at, device_session_id, boot_count, heartbeat_connection_id,
                   heartbeat_sequence, last_valid_heartbeat_at, heartbeat_connection_closed_at,
                   first_valid_heartbeat_at, last_seen_at, connection_status
            FROM aegis.locker_devices
            WHERE locker_id = :locker AND disabled_at IS NULL
            """;

    private final JdbcClient jdbc;

    LockerDeviceRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Serializes the facts of one device (document 08, section 7.1); the projection is read under this lock. */
    Optional<ActiveDevice> lockActive(UUID lockerId) {
        return jdbc.sql(SELECT + "FOR UPDATE").param("locker", lockerId)
                .query(LockerDeviceRepository::device).optional();
    }

    Optional<ActiveDevice> active(UUID lockerId) {
        return jdbc.sql(SELECT).param("locker", lockerId).query(LockerDeviceRepository::device).optional();
    }

    boolean hasDisabledDevice(UUID lockerId) {
        return jdbc.sql("SELECT count(*) FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NOT NULL")
                .param("locker", lockerId).query(Long.class).single() > 0;
    }

    /**
     * R3: whether an accepted OFFLINE availability of this boot, received since provisioning, closed the connection.
     * The facts are the source: the projection only keeps the closing of the reference connection.
     */
    boolean connectionClosed(UUID deviceId, long bootCount, UUID connectionId, Instant provisionedAt) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.inbound_device_messages
                    WHERE locker_device_id = :device AND boot_count = :boot AND connection_id = :connection
                      AND message_type = 'DEVICE_AVAILABILITY' AND availability_status = 'OFFLINE'
                      AND processing_status <> 'REJECTED' AND received_at >= :provisionedAt)
                """)
                .param("device", deviceId).param("boot", bootCount).param("connection", connectionId)
                .param("provisionedAt", utc(provisionedAt))
                .query(Boolean.class).single();
    }

    void save(ActiveDevice device, DeviceProjection projection, ConnectionStatus status, Instant now) {
        jdbc.sql("""
                UPDATE aegis.locker_devices
                SET device_session_id = :session, boot_count = :boot, heartbeat_connection_id = :connection,
                    heartbeat_sequence = :sequence, last_valid_heartbeat_at = :lastValid,
                    heartbeat_connection_closed_at = :closed, first_valid_heartbeat_at = :firstValid,
                    last_seen_at = :lastSeen, connection_status = :status, updated_at = :now
                WHERE id = :id
                """)
                .param("session", projection.deviceSessionId())
                .param("boot", projection.bootCount())
                .param("connection", projection.heartbeatConnectionId())
                .param("sequence", projection.heartbeatSequence())
                .param("lastValid", utc(projection.lastValidHeartbeatAt()))
                .param("closed", utc(projection.heartbeatConnectionClosedAt()))
                .param("firstValid", utc(projection.firstValidHeartbeatAt()))
                .param("lastSeen", utc(projection.lastSeenAt()))
                .param("status", status.name())
                .param("now", utc(now))
                .param("id", device.id())
                .update();
        // lockers.status and last_seen_at are the fast projection of the active device (document 08, section 4.4);
        // like connection_status they are caches, and readers evaluate the status against the present instant.
        jdbc.sql("UPDATE aegis.lockers SET status = :status, last_seen_at = :lastSeen, updated_at = :now WHERE id = :id")
                .param("status", status.name())
                .param("lastSeen", utc(projection.lastSeenAt()))
                .param("now", utc(now))
                .param("id", device.lockerId())
                .update();
    }

    /**
     * Applies one reported cell when it belongs to the locker at the reported address; false otherwise. The reader
     * status stays that of a later RFID scan of the cell already stored for the session: a projection never goes
     * back to an older fact (document 10, section 14).
     */
    boolean applyCompartment(ActiveDevice device, Fact heartbeat, CompartmentReport report, Instant receivedAt) {
        return jdbc.sql("""
                UPDATE aegis.compartments
                SET connection_status = :connection, door_state = :door, lock_state = :lock,
                    last_observed_at = :at, updated_at = :at,
                    rfid_reader_status = CASE WHEN EXISTS (
                        SELECT 1 FROM aegis.inbound_device_messages later
                        WHERE later.locker_device_id = :device AND later.device_session_id = :session
                          AND later.boot_count = :boot AND later.sequence > :sequence
                          AND later.message_type = 'RFID_SCAN_COMPLETED' AND later.processing_status <> 'REJECTED'
                          AND later.received_at >= :provisionedAt
                          AND later.parsed_payload ->> 'compartmentId' = CAST(:id AS text))
                        THEN rfid_reader_status ELSE :reader END
                WHERE id = :id AND locker_id = :locker AND local_address = :address
                """)
                .param("device", device.id())
                .param("session", heartbeat.deviceSessionId())
                .param("boot", heartbeat.bootCount())
                .param("sequence", heartbeat.sequence())
                .param("provisionedAt", utc(device.provisionedAt()))
                .param("connection", report.connectionStatus())
                .param("reader", report.readerStatus())
                .param("door", report.doorState())
                .param("lock", report.lockState())
                .param("at", utc(receivedAt))
                .param("id", report.compartmentId())
                .param("locker", device.lockerId())
                .param("address", report.cellAddress())
                .update() == 1;
    }

    /** A cell the reference heartbeat does not report, or reports incoherently, is no longer known. */
    void forgetCompartmentsOtherThan(UUID lockerId, Collection<UUID> reported, Instant now) {
        String exclusion = reported.isEmpty() ? "" : "AND id NOT IN (:reported) ";
        var statement = jdbc.sql("""
                UPDATE aegis.compartments
                SET connection_status = 'UNKNOWN', rfid_reader_status = 'UNKNOWN', door_state = 'UNKNOWN',
                    lock_state = 'UNKNOWN', updated_at = :now
                WHERE locker_id = :locker
                  AND (connection_status, rfid_reader_status, door_state, lock_state)
                      IS DISTINCT FROM ('UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN')
                """ + exclusion)
                .param("now", utc(now))
                .param("locker", lockerId);
        if (!reported.isEmpty()) {
            statement = statement.param("reported", reported);
        }
        statement.update();
    }

    private static ActiveDevice device(ResultSet row, int number) throws SQLException {
        long boot = row.getLong("boot_count");
        Long bootCount = row.wasNull() ? null : boot;
        long sequence = row.getLong("heartbeat_sequence");
        Long heartbeatSequence = row.wasNull() ? null : sequence;
        DeviceProjection projection = new DeviceProjection(
                row.getObject("device_session_id", UUID.class),
                bootCount,
                row.getObject("heartbeat_connection_id", UUID.class),
                heartbeatSequence,
                instant(row, "last_valid_heartbeat_at"),
                instant(row, "heartbeat_connection_closed_at"),
                instant(row, "first_valid_heartbeat_at"),
                instant(row, "last_seen_at"));
        return new ActiveDevice(row.getObject("id", UUID.class), row.getObject("locker_id", UUID.class),
                instant(row, "provisioned_at"), projection,
                ConnectionStatus.valueOf(row.getString("connection_status")));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
