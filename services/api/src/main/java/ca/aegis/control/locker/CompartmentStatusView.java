package ca.aegis.control.locker;

import java.time.Instant;
import java.util.UUID;

/** Document 09, section 8.6: the last heartbeat-derived state of a cell, never a raw MQTT message. */
public record CompartmentStatusView(UUID id, String code, boolean enabled, String connectionStatus,
        String rfidReaderStatus, String doorState, String lockState, Instant lastObservedAt) {
}
