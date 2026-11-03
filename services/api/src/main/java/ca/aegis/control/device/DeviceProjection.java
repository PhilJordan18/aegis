package ca.aegis.control.device;

import java.time.Instant;
import java.util.UUID;

/**
 * The availability columns of {@code locker_devices} (document 08, section 4.4): the current session, chosen by the
 * greatest {@code bootCount}, and the reference heartbeat with its connection and the closing of that connection.
 */
record DeviceProjection(UUID deviceSessionId, Long bootCount, UUID heartbeatConnectionId, Long heartbeatSequence,
        Instant lastValidHeartbeatAt, Instant heartbeatConnectionClosedAt, Instant firstValidHeartbeatAt,
        Instant lastSeenAt) {

    static final DeviceProjection PROVISIONED = new DeviceProjection(null, null, null, null, null, null, null, null);

    DeviceProjection withSession(UUID sessionId, long boot) {
        return new DeviceProjection(sessionId, boot, null, null, null, null, firstValidHeartbeatAt, lastSeenAt);
    }

    DeviceProjection withReference(UUID connectionId, long sequence, Instant receivedAt) {
        return new DeviceProjection(deviceSessionId, bootCount, connectionId, sequence, receivedAt, null,
                firstValidHeartbeatAt == null ? receivedAt : firstValidHeartbeatAt, lastSeenAt);
    }

    DeviceProjection withReferenceClosed(Instant closedAt) {
        return new DeviceProjection(deviceSessionId, bootCount, heartbeatConnectionId, heartbeatSequence,
                lastValidHeartbeatAt, closedAt, firstValidHeartbeatAt, lastSeenAt);
    }

    DeviceProjection seenAt(Instant receivedAt) {
        Instant seen = lastSeenAt == null || receivedAt.isAfter(lastSeenAt) ? receivedAt : lastSeenAt;
        return new DeviceProjection(deviceSessionId, bootCount, heartbeatConnectionId, heartbeatSequence,
                lastValidHeartbeatAt, heartbeatConnectionClosedAt, firstValidHeartbeatAt, seen);
    }
}
