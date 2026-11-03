package ca.aegis.control.device;

import static ca.aegis.control.device.LockerDeviceRepository.utc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * {@code physical_observations} (document 08, section 4.8) and the stored facts presence is evaluated from. The table
 * is append-only for the application role: rows are inserted, never updated, deleted or locked.
 */
@Repository
class PhysicalObservationRepository {

    enum Type {
        ASSET_IDENTIFIER_DETECTED,
        ASSET_PRESENT,
        ASSET_ABSENT
    }

    record Observation(UUID inboundMessageId, UUID lockerId, UUID compartmentId, UUID operationId, Type type,
            Instant observedAt, String identifierValue, String valueJson) {
    }

    /** The asset expected in a compartment through its current placement and active RFID identifier. */
    record ExpectedTag(UUID assetId, String value, Instant boundSince) {
    }

    record CompartmentState(UUID id, UUID lockerId, boolean enabled, String connectionStatus, String readerStatus,
            String doorState) {
    }

    /** The first message of a connection: the lowest sequence and its device instant. */
    record ConnectionStart(long sequence, Instant occurredAt, Instant receivedAt) {
    }

    /**
     * A scan or door event of a device session. {@code compartmentId} is null when the stored message has no parsed
     * payload: its cell is then unknown, and it counts against every cell of the locker.
     */
    record PhysicalEvent(UUID id, InboundMessageType type, long sequence, Instant occurredAt, Instant receivedAt,
            UUID compartmentId, String readerStatus, Instant windowStartedAt) {

        boolean attributable() {
            return compartmentId != null;
        }
    }

    record Detection(UUID compartmentId, String identifierValue) {
    }

    /**
     * A heartbeat of the session in which a cell is not seen connected with its door closed: reported otherwise, left
     * out, or in a payload that could not be parsed.
     */
    record UnobservedCell(long sequence, UUID compartmentId) {
    }

    private final JdbcClient jdbc;

    PhysicalObservationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(Observation observation) {
        jdbc.sql("""
                INSERT INTO aegis.physical_observations
                    (inbound_message_id, locker_id, compartment_id, operation_id, type, observed_at, identifier_value,
                     value_json)
                VALUES (:message, :locker, :compartment, :operation, :type, :observedAt, :identifier,
                        CAST(:value AS jsonb))
                """)
                .param("message", observation.inboundMessageId())
                .param("locker", observation.lockerId())
                .param("compartment", observation.compartmentId())
                .param("operation", observation.operationId())
                .param("type", observation.type().name())
                .param("observedAt", utc(observation.observedAt()))
                .param("identifier", observation.identifierValue())
                .param("value", observation.valueJson())
                .update();
    }

    boolean compartmentOf(UUID lockerId, UUID compartmentId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM aegis.compartments WHERE id = :id AND locker_id = :locker)")
                .param("id", compartmentId).param("locker", lockerId).query(Boolean.class).single();
    }

    /** Read without a lock: a placement changed concurrently is caught by the binding instant at read time. */
    Optional<ExpectedTag> expectedTag(UUID compartmentId) {
        return jdbc.sql("""
                SELECT p.asset_id, i.identifier_value, greatest(p.assigned_at, i.assigned_at) AS bound_since
                FROM aegis.asset_placements p
                JOIN aegis.asset_identifiers i
                  ON i.asset_id = p.asset_id AND i.active AND i.identifier_type = 'RFID_UHF'
                WHERE p.compartment_id = :compartment AND p.removed_at IS NULL
                """)
                .param("compartment", compartmentId)
                .query((row, number) -> new ExpectedTag(row.getObject("asset_id", UUID.class),
                        row.getString("identifier_value"), instant(row, "bound_since")))
                .optional();
    }

    /**
     * Projects a scan's reader status onto its cell, as a reference heartbeat does (document 10, section 12.1), unless
     * a later scan of that cell in the same session is already stored: an old scan never replaces a newer one.
     */
    void applyReaderStatus(UUID lockerId, UUID deviceId, UUID compartmentId, UUID deviceSessionId, long bootCount,
            long sequence, String readerStatus, Instant receivedAt) {
        jdbc.sql("""
                UPDATE aegis.compartments
                SET rfid_reader_status = :reader, last_observed_at = :at, updated_at = :at
                WHERE id = :id AND locker_id = :locker
                  AND NOT EXISTS (
                      SELECT 1 FROM aegis.inbound_device_messages later
                      WHERE later.locker_device_id = :device AND later.device_session_id = :session
                        AND later.boot_count = :boot AND later.sequence > :sequence
                        AND later.message_type = 'RFID_SCAN_COMPLETED' AND later.processing_status <> 'REJECTED'
                        AND later.parsed_payload ->> 'compartmentId' = CAST(:id AS text))
                """)
                .param("reader", readerStatus)
                .param("at", utc(receivedAt))
                .param("id", compartmentId)
                .param("locker", lockerId)
                .param("device", deviceId)
                .param("session", deviceSessionId)
                .param("boot", bootCount)
                .param("sequence", sequence)
                .update();
    }

    List<CompartmentState> compartments(Collection<UUID> ids) {
        return jdbc.sql("""
                SELECT id, locker_id, enabled, connection_status, rfid_reader_status, door_state
                FROM aegis.compartments WHERE id IN (:ids)
                """)
                .param("ids", ids)
                .query((row, number) -> new CompartmentState(row.getObject("id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getBoolean("enabled"),
                        row.getString("connection_status"), row.getString("rfid_reader_status"),
                        row.getString("door_state")))
                .list();
    }

    Optional<ConnectionStart> connectionStart(UUID deviceId, DeviceProjection projection, Instant provisionedAt) {
        return jdbc.sql("""
                SELECT sequence, occurred_at, received_at FROM aegis.inbound_device_messages
                WHERE locker_device_id = :device AND device_session_id = :session AND boot_count = :boot
                  AND connection_id = :connection AND processing_status <> 'REJECTED'
                  AND received_at >= :provisionedAt
                ORDER BY sequence, received_at
                LIMIT 1
                """)
                .param("device", deviceId)
                .param("session", projection.deviceSessionId())
                .param("boot", projection.bootCount())
                .param("connection", projection.heartbeatConnectionId())
                .param("provisionedAt", utc(provisionedAt))
                .query((row, number) -> new ConnectionStart(row.getLong("sequence"), instant(row, "occurred_at"),
                        instant(row, "received_at")))
                .optional();
    }

    /** The accepted scans and door events of the device's current session from {@code fromSequence} on. */
    List<PhysicalEvent> events(UUID deviceId, DeviceProjection projection, Instant provisionedAt,
            long fromSequence) {
        return jdbc.sql("""
                SELECT id, message_type, sequence, occurred_at, received_at,
                       parsed_payload ->> 'compartmentId' AS compartment_id,
                       parsed_payload ->> 'readerStatus' AS reader_status,
                       parsed_payload ->> 'windowStartedAt' AS window_started_at
                FROM aegis.inbound_device_messages
                WHERE locker_device_id = :device AND device_session_id = :session AND boot_count = :boot
                  AND processing_status <> 'REJECTED' AND received_at >= :provisionedAt
                  AND sequence >= :from
                  AND message_type IN ('RFID_SCAN_COMPLETED', 'DOOR_OPENED', 'DOOR_CLOSED')
                ORDER BY sequence, received_at
                """)
                .param("device", deviceId)
                .param("session", projection.deviceSessionId())
                .param("boot", projection.bootCount())
                .param("provisionedAt", utc(provisionedAt))
                .param("from", fromSequence)
                .query(PhysicalObservationRepository::event)
                .list();
    }

    /**
     * For each of {@code compartmentIds}, the heartbeats of the device's current session from {@code fromSequence} on
     * that do not report it {@code CONNECTED} with its door {@code CLOSED}.
     */
    List<UnobservedCell> unobservedCells(UUID deviceId, DeviceProjection projection, Instant provisionedAt,
            long fromSequence, Collection<UUID> compartmentIds) {
        if (compartmentIds.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("""
                SELECT m.sequence, wanted.id AS compartment_id
                FROM aegis.inbound_device_messages m
                JOIN aegis.compartments wanted ON wanted.id IN (:cells)
                WHERE m.locker_device_id = :device AND m.device_session_id = :session AND m.boot_count = :boot
                  AND m.message_type = 'HEARTBEAT' AND m.processing_status <> 'REJECTED'
                  AND m.received_at >= :provisionedAt AND m.sequence >= :from
                  AND NOT EXISTS (
                      SELECT 1 FROM jsonb_array_elements(CASE
                          WHEN jsonb_typeof(m.parsed_payload -> 'compartments') = 'array'
                          THEN m.parsed_payload -> 'compartments' ELSE '[]'::jsonb END) AS cell
                      WHERE cell ->> 'compartmentId' = CAST(wanted.id AS text)
                        AND cell ->> 'connectionStatus' = 'CONNECTED' AND cell ->> 'doorState' = 'CLOSED')
                """)
                .param("cells", List.copyOf(compartmentIds))
                .param("device", deviceId)
                .param("session", projection.deviceSessionId())
                .param("boot", projection.bootCount())
                .param("provisionedAt", utc(provisionedAt))
                .param("from", fromSequence)
                .query((row, number) -> new UnobservedCell(row.getLong("sequence"),
                        row.getObject("compartment_id", UUID.class)))
                .list();
    }

    /**
     * A heartbeat, door or scan message of the device that was rejected: it keeps no session, sequence or parsed
     * payload, so its cells are unknown and its order is only what its raw payload claims, when that can be read.
     */
    record RejectedMessage(Instant receivedAt, Optional<InboundMessages.Position> claimed) {
    }

    /** The device's heartbeat, door and scan messages rejected since {@code since}. */
    List<RejectedMessage> rejectedPhysicalMessages(UUID deviceId, Instant provisionedAt, Instant since) {
        return jdbc.sql("""
                SELECT received_at, raw_payload FROM aegis.inbound_device_messages
                WHERE locker_device_id = :device AND processing_status = 'REJECTED'
                  AND message_type IN ('HEARTBEAT', 'RFID_SCAN_COMPLETED', 'DOOR_OPENED', 'DOOR_CLOSED')
                  AND received_at >= :provisionedAt AND received_at >= :since
                """)
                .param("device", deviceId)
                .param("provisionedAt", utc(provisionedAt))
                .param("since", utc(since))
                .query((row, number) -> new RejectedMessage(instant(row, "received_at"),
                        InboundMessages.claimedPosition(row.getBytes("raw_payload"))))
                .list();
    }

    /** The presence verdicts that the ingestion recorded for these scans. */
    List<Observation> verdicts(Collection<UUID> inboundMessageIds) {
        return jdbc.sql("""
                SELECT inbound_message_id, locker_id, compartment_id, operation_id, type, observed_at,
                       identifier_value, value_json::text AS value_json
                FROM aegis.physical_observations
                WHERE inbound_message_id IN (:ids) AND type IN ('ASSET_PRESENT', 'ASSET_ABSENT')
                """)
                .param("ids", inboundMessageIds)
                .query((row, number) -> new Observation(row.getObject("inbound_message_id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getObject("compartment_id", UUID.class),
                        row.getObject("operation_id", UUID.class), Type.valueOf(row.getString("type")),
                        instant(row, "observed_at"), row.getString("identifier_value"),
                        row.getString("value_json")))
                .list();
    }

    /**
     * Detections of these values that still stand in some cell: made in the current session of an active device,
     * and not followed in that session by a healthy scan of the same cell. A later healthy scan that saw the tag
     * again stands through its own detection.
     */
    List<Detection> standingDetections(Collection<String> values) {
        return jdbc.sql("""
                SELECT DISTINCT o.compartment_id, o.identifier_value
                FROM aegis.physical_observations o
                JOIN aegis.inbound_device_messages m ON m.id = o.inbound_message_id
                JOIN aegis.locker_devices d ON d.id = m.locker_device_id AND d.disabled_at IS NULL
                WHERE o.type = 'ASSET_IDENTIFIER_DETECTED' AND o.identifier_value IN (:values)
                  AND m.device_session_id = d.device_session_id AND m.boot_count = d.boot_count
                  AND m.received_at >= d.provisioned_at AND m.processing_status <> 'REJECTED'
                  AND NOT EXISTS (
                      SELECT 1 FROM aegis.inbound_device_messages later
                      WHERE later.locker_device_id = m.locker_device_id
                        AND later.device_session_id = m.device_session_id AND later.boot_count = m.boot_count
                        AND later.message_type = 'RFID_SCAN_COMPLETED' AND later.processing_status <> 'REJECTED'
                        AND later.received_at >= d.provisioned_at AND later.sequence > m.sequence
                        AND later.parsed_payload ->> 'compartmentId' = o.compartment_id::text
                        AND later.parsed_payload ->> 'readerStatus' = 'HEALTHY')
                """)
                .param("values", values)
                .query((row, number) -> new Detection(row.getObject("compartment_id", UUID.class),
                        row.getString("identifier_value")))
                .list();
    }

    private static PhysicalEvent event(ResultSet row, int number) throws SQLException {
        String compartment = row.getString("compartment_id");
        String window = row.getString("window_started_at");
        return new PhysicalEvent(row.getObject("id", UUID.class),
                InboundMessageType.valueOf(row.getString("message_type")), row.getLong("sequence"),
                instant(row, "occurred_at"), instant(row, "received_at"),
                compartment == null ? null : Uuids.canonical(compartment).orElse(null),
                row.getString("reader_status"),
                window == null ? null : InboundMessages.instant(window));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
