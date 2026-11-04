package ca.aegis.control.locker;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.device.ConnectionStatus;

/** Document 09, sections 8.6 and 16.1. */
public record LockerStatusView(UUID lockerId, String code, String name, String topology,
        ConnectionStatus connectionStatus, Instant lastSeenAt, Instant evaluatedAt, CurrentWindowView currentWindow,
        List<CompartmentStatusView> compartments) {
}
