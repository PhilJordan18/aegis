package ca.aegis.control.device;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** What a message says before any database check (document 10, section 19.1). */
sealed interface Inspection {

    /**
     * Too large, unparseable, or missing what a row of {@code inbound_device_messages} needs (a canonical
     * {@code messageId}, a known {@code type}, a printable {@code schemaVersion}, a valid {@code timestamp}): it is
     * logged without its payload and never stored, so that no identifier or device instant is made up.
     *
     * @param messageId the extracted message identifier, or null when it could not be read
     */
    record Unstorable(ProcessingError error, UUID messageId) implements Inspection {
    }

    /** Readable enough to be kept; {@code rejection} is null and {@code fact} set exactly when it is accepted. */
    record Storable(UUID messageId, InboundMessageType type, String schemaVersion, Instant occurredAt,
            ProcessingError rejection, Fact fact) implements Inspection {

        static Storable rejected(UUID messageId, InboundMessageType type, String schemaVersion, Instant occurredAt,
                ProcessingError rejection) {
            return new Storable(messageId, type, schemaVersion, occurredAt, rejection, null);
        }
    }

    /**
     * The accepted content the ingestion uses; {@code parsedJson} is null when the payload holds a character
     * PostgreSQL {@code jsonb} cannot store.
     *
     * @param heartbeatValid for a heartbeat only: clock synchronized and timestamp within the window of section 15.3
     * @param rfidScan for an {@code RFID_SCAN_COMPLETED} only, its validated body (section 12.1)
     */
    record Fact(UUID deviceSessionId, long bootCount, long sequence, UUID connectionId, String availabilityStatus,
            UUID operationId, UUID compartmentId, UUID commandMessageId, UUID displayMessageId,
            boolean heartbeatValid, List<CompartmentReport> compartments, String errorCode, String parsedJson,
            RfidScan rfidScan) {
    }
}
