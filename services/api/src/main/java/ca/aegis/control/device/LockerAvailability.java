package ca.aegis.control.device;

import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The connection status of a locker's hub, evaluated at the instant asked (document 10, section 15.3, rule R4) rather
 * than read from a cache, so that silence makes a hub OFFLINE without any scheduled job.
 */
@Component
public class LockerAvailability {

    /**
     * {@code lastSeenAt} is the reception of the latest valid heartbeat since provisioning that belonged to the
     * current session when it arrived, including one from a closed connection; a new session keeps it. It is null
     * before the first one.
     */
    public record Availability(ConnectionStatus status, Instant lastSeenAt) {

        static final Availability NOT_PROVISIONED = new Availability(ConnectionStatus.UNKNOWN, null);
    }

    private final LockerDeviceRepository devices;

    LockerAvailability(LockerDeviceRepository devices) {
        this.devices = devices;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Availability of(UUID lockerId, Instant now) {
        return devices.active(lockerId)
                .map(device -> new Availability(AvailabilityProjection.evaluate(device.projection(), now),
                        device.projection().lastSeenAt()))
                .orElse(Availability.NOT_PROVISIONED);
    }
}
