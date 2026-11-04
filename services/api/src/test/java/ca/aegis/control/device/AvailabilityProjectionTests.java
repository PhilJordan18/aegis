package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;

import org.junit.jupiter.api.Test;

import ca.aegis.control.device.AvailabilityProjection.Outcome;
import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.device.Inspection.Storable;

/** Rules R1 to R4 of document 10, section 15.3, with the 30-second threshold. */
class AvailabilityProjectionTests {

    private static final Instant T0 = Instant.parse("2026-09-28T13:00:00Z");
    private static final InboundTopic TOPIC = InboundTopic.parse(STATUS).orElseThrow();

    private DeviceProjection projection = DeviceProjection.PROVISIONED;

    @Test
    void unknownUntilTheFirstValidHeartbeatThenOnlineForThirtySeconds() {
        Session session = new Session(1);
        assertEquals(ConnectionStatus.UNKNOWN, AvailabilityProjection.evaluate(projection, T0));
        apply(session.availability(T0, "ONLINE", "CONNECTED"), T0);
        assertEquals(ConnectionStatus.UNKNOWN, AvailabilityProjection.evaluate(projection, T0),
                "DEVICE_AVAILABILITY ONLINE alone never makes the locker ONLINE");

        apply(session.heartbeat(T0, "CLOSED"), T0);
        assertEquals(ConnectionStatus.ONLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(30)));
        assertEquals(ConnectionStatus.OFFLINE,
                AvailabilityProjection.evaluate(projection, T0.plusSeconds(30).plusNanos(1000)));
    }

    @Test
    void anOlderSequenceOrAnInvalidHeartbeatNeverRegressesTheReference() {
        Session session = new Session(1);
        Map<String, Object> first = session.heartbeat(T0, "CLOSED");
        Map<String, Object> second = session.heartbeat(T0.plusSeconds(10), "OPEN");
        assertTrue(apply(second, T0.plusSeconds(10)).newReference());
        assertFalse(apply(first, T0.plusSeconds(11)).newReference());
        assertEquals(2L, projection.heartbeatSequence());
        assertEquals(T0.plusSeconds(10), projection.lastValidHeartbeatAt());

        Map<String, Object> stale = session.heartbeat(T0.minusSeconds(60), "CLOSED");
        assertFalse(apply(stale, T0.plusSeconds(12)).newReference());
        assertEquals(T0.plusSeconds(10), projection.lastValidHeartbeatAt());
    }

    @Test
    void anOfflineClosesTheReferenceConnectionUntilAHeartbeatOnANewConnection() {
        Session session = new Session(1);
        apply(session.heartbeat(T0, "CLOSED"), T0);
        apply(session.availability(T0.plusSeconds(1), "OFFLINE", "CONNECTION_LOST"), T0.plusSeconds(1));
        assertEquals(ConnectionStatus.OFFLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(2)));

        apply(session.heartbeat(T0.plusSeconds(2), "CLOSED"), T0.plusSeconds(2));
        assertEquals(ConnectionStatus.OFFLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(2)),
                "a late heartbeat of the closed connection does not reopen it");

        session.connectionId = UUID.randomUUID();
        apply(session.heartbeat(T0.plusSeconds(3), "CLOSED"), T0.plusSeconds(3));
        assertEquals(ConnectionStatus.ONLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(3)));
    }

    @Test
    void aNewBootStartsANewSessionAndAnOlderBootHasNoEffect() {
        Session first = new Session(5);
        apply(first.heartbeat(T0, "CLOSED"), T0);
        for (int i = 0; i < 10; i++) {
            apply(first.heartbeat(T0.plusSeconds(i), "CLOSED"), T0.plusSeconds(i));
        }
        Session reboot = new Session(6);
        apply(reboot.restarted(T0.plusSeconds(20)), T0.plusSeconds(20));
        assertEquals(6L, projection.bootCount());
        assertEquals(ConnectionStatus.OFFLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(20)));

        assertTrue(apply(reboot.heartbeat(T0.plusSeconds(21), "CLOSED"), T0.plusSeconds(21)).newReference(),
                "sequence 2 of the new boot wins over sequence 11 of the previous one");
        assertFalse(apply(first.heartbeat(T0.plusSeconds(22), "OPEN"), T0.plusSeconds(22)).newReference());
        assertEquals(reboot.deviceSessionId, projection.deviceSessionId());
        assertEquals(ConnectionStatus.ONLINE, AvailabilityProjection.evaluate(projection, T0.plusSeconds(22)));
    }

    @Test
    void twoSessionsWithTheSameBootCountAreAConflictWithoutEffect() {
        Session one = new Session(3);
        apply(one.heartbeat(T0, "CLOSED"), T0);
        DeviceProjection before = projection;
        Session clone = new Session(3);
        clone.sequence = 100;
        Outcome outcome = apply(clone.heartbeat(T0.plusSeconds(1), "OPEN"), T0.plusSeconds(1));
        assertTrue(outcome.sessionConflict());
        assertEquals(before, projection);
    }

    /** R1: after any valid heartbeat since provisioning the state is ONLINE or OFFLINE, never UNKNOWN. */
    @Test
    void aFirstValidHeartbeatOfAnAlreadyClosedConnectionGivesOfflineNotUnknown() {
        Session session = new Session(1);
        Outcome outcome = apply(session.heartbeat(T0, "CLOSED"), T0, connection -> true);

        assertFalse(outcome.newReference());
        assertEquals(ConnectionStatus.OFFLINE, AvailabilityProjection.evaluate(projection, T0));
        assertEquals(T0, projection.lastSeenAt());
    }

    private Outcome apply(Map<String, Object> message, Instant receivedAt) {
        return apply(message, receivedAt, connection -> false);
    }

    private Outcome apply(Map<String, Object> message, Instant receivedAt,
            Predicate<UUID> closedConnection) {
        Storable storable = (Storable) InboundMessages.inspect(TOPIC, bytes(message), receivedAt);
        if (storable.rejection() != null) {
            storable = (Storable) InboundMessages.inspect(InboundTopic.parse(DevicePayloads.EVENTS).orElseThrow(),
                    bytes(message), receivedAt);
        }
        Outcome outcome = AvailabilityProjection.apply(projection, storable.type(), storable.fact(), receivedAt,
                closedConnection);
        projection = outcome.projection();
        return outcome;
    }
}
