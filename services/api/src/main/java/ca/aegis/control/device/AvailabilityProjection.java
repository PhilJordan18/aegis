package ca.aegis.control.device;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Predicate;

import ca.aegis.control.device.Inspection.Fact;

/**
 * Rules R1 to R4 of document 10, section 15.3, and document 06, section 14.4, applied to one accepted fact at a
 * time. Only the facts and the present instant matter, so replaying the facts of a device in {@code receivedAt}
 * order rebuilds the same projection. No rule here touches a loan, a reservation, an operation or a readiness.
 */
final class AvailabilityProjection {

    static final Duration FRESHNESS = Duration.ofSeconds(30);

    record Outcome(DeviceProjection projection, boolean newReference, boolean sessionConflict) {
    }

    private AvailabilityProjection() {
    }

    /** Evaluated at every read: a stored status would go stale as soon as the heartbeats stop. */
    static ConnectionStatus evaluate(DeviceProjection projection, Instant now) {
        if (projection.firstValidHeartbeatAt() == null) {
            return ConnectionStatus.UNKNOWN;
        }
        if (projection.heartbeatConnectionId() == null || projection.heartbeatConnectionClosedAt() != null) {
            return ConnectionStatus.OFFLINE;
        }
        return Duration.between(projection.lastValidHeartbeatAt(), now).compareTo(FRESHNESS) > 0
                ? ConnectionStatus.OFFLINE : ConnectionStatus.ONLINE;
    }

    /**
     * @param closedConnection whether an accepted OFFLINE of the fact's session already closed a connection; asked
     *     only for a valid heartbeat whose connection is not the reference one
     */
    static Outcome apply(DeviceProjection current, InboundMessageType type, Fact fact, Instant receivedAt,
            Predicate<UUID> closedConnection) {
        DeviceProjection projection = current;
        if (projection.bootCount() == null || fact.bootCount() > projection.bootCount()) {
            projection = projection.withSession(fact.deviceSessionId(), fact.bootCount());
        } else if (fact.bootCount() < projection.bootCount()) {
            return new Outcome(current, false, false);
        } else if (!fact.deviceSessionId().equals(projection.deviceSessionId())) {
            // R2: two boots share a bootCount, so the counter is not conforming; the fact is kept without effect.
            return new Outcome(current, false, true);
        }

        boolean newReference = false;
        if (type == InboundMessageType.HEARTBEAT && fact.heartbeatValid()) {
            projection = projection.seenAt(receivedAt);
            boolean sameConnection = fact.connectionId().equals(projection.heartbeatConnectionId());
            boolean closed = sameConnection
                    ? projection.heartbeatConnectionClosedAt() != null
                    : closedConnection.test(fact.connectionId());
            if (!closed && (projection.heartbeatSequence() == null
                    || fact.sequence() > projection.heartbeatSequence())) {
                projection = projection.withReference(fact.connectionId(), fact.sequence(), receivedAt);
                newReference = true;
            }
        } else if (type == InboundMessageType.DEVICE_AVAILABILITY && "OFFLINE".equals(fact.availabilityStatus())
                && fact.connectionId().equals(projection.heartbeatConnectionId())
                && projection.heartbeatConnectionClosedAt() == null) {
            projection = projection.withReferenceClosed(receivedAt);
        }
        return new Outcome(projection, newReference, false);
    }
}
