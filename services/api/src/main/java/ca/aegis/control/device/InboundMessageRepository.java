package ca.aegis.control.device;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import static ca.aegis.control.device.LockerDeviceRepository.utc;

/** The durable facts of {@code inbound_device_messages}: one canonical row per device and messageId (§4.8). */
@Repository
class InboundMessageRepository {

    record Row(UUID deviceId, UUID messageId, String topic, InboundMessageType type, UUID operationId,
            UUID commandMessageId, UUID displayMessageId, String schemaVersion, UUID deviceSessionId,
            Long bootCount, Long sequence, UUID connectionId, String availabilityStatus, Instant occurredAt,
            Instant receivedAt, byte[] rawPayload, String parsedPayload, String processingStatus,
            ProcessingError processingError) {
    }

    record OperationRef(UUID id, UUID lockerId, UUID compartmentId) {
    }

    private final JdbcClient jdbc;

    InboundMessageRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Records how a stored command report was applied (document 08, section 9.3). */
    void markProcessed(UUID id) {
        jdbc.sql("UPDATE aegis.inbound_device_messages SET processing_status = 'PROCESSED' WHERE id = :id")
                .param("id", id).update();
    }

    void markRejected(UUID id, ProcessingError error) {
        jdbc.sql("""
                UPDATE aegis.inbound_device_messages SET processing_status = 'REJECTED', processing_error = :error
                WHERE id = :id
                """).param("id", id).param("error", error.name()).update();
    }

    /**
     * Reserves the pair (device, messageId) before any effect (document 10, section 16.2). Empty when the pair is
     * already taken: the unique constraint, not a prior read, decides between concurrent consumers.
     */
    Optional<UUID> insert(Row row) {
        return jdbc.sql("""
                INSERT INTO aegis.inbound_device_messages
                    (locker_device_id, message_id, topic, message_type, operation_id, command_message_id,
                     display_message_id, schema_version, device_session_id, boot_count, sequence, connection_id,
                     availability_status, occurred_at, received_at, raw_payload, parsed_payload, processing_status,
                     processing_error)
                VALUES (:device, :messageId, :topic, :type, :operation, :command, :display, :schemaVersion,
                        :session, :boot, :sequence, :connection, :availability, :occurredAt, :receivedAt, :raw,
                        CAST(:parsed AS jsonb), :status, :error)
                ON CONFLICT ON CONSTRAINT uq_inbound_messages_device_message DO NOTHING
                RETURNING id
                """)
                .param("device", row.deviceId())
                .param("messageId", row.messageId())
                .param("topic", row.topic())
                .param("type", row.type().name())
                .param("operation", row.operationId())
                .param("command", row.commandMessageId())
                .param("display", row.displayMessageId())
                .param("schemaVersion", row.schemaVersion())
                .param("session", row.deviceSessionId())
                .param("boot", row.bootCount())
                .param("sequence", row.sequence())
                .param("connection", row.connectionId())
                .param("availability", row.availabilityStatus())
                .param("occurredAt", utc(row.occurredAt()))
                .param("receivedAt", utc(row.receivedAt()))
                .param("raw", row.rawPayload())
                .param("parsed", row.parsedPayload())
                .param("status", row.processingStatus())
                .param("error", row.processingError() == null ? null : row.processingError().name())
                .query(UUID.class)
                .optional();
    }

    UUID idOf(UUID deviceId, UUID messageId) {
        return jdbc.sql("""
                SELECT id FROM aegis.inbound_device_messages WHERE locker_device_id = :device AND message_id = :message
                """).param("device", deviceId).param("message", messageId).query(UUID.class).single();
    }

    Optional<OperationRef> operation(UUID operationId) {
        return jdbc.sql("SELECT id, locker_id, compartment_id FROM aegis.locker_operations WHERE id = :id")
                .param("id", operationId)
                .query((row, number) -> new OperationRef(row.getObject("id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getObject("compartment_id", UUID.class)))
                .optional();
    }

    boolean commandExists(UUID messageId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM aegis.command_outbox WHERE message_id = :id)")
                .param("id", messageId).query(Boolean.class).single();
    }

    boolean displayExists(UUID messageId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM aegis.hub_display_outbox WHERE message_id = :id)")
                .param("id", messageId).query(Boolean.class).single();
    }
}
