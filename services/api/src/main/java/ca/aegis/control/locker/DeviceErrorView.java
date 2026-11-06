package ca.aegis.control.locker;

import java.time.Instant;
import java.util.UUID;

/**
 * Document 09, section 8.6: one group of reported device errors of the current session, never a raw MQTT message.
 * It carries no {@code detail}, payload or token.
 */
public record DeviceErrorView(String errorCode, String severity, UUID compartmentId, Instant firstReceivedAt,
        Instant lastReceivedAt, long occurrences) {
}
