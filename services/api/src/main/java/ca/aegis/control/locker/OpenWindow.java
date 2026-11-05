package ca.aegis.control.locker;

import java.time.Instant;

/** One day's window resolved to instants: open from {@code opensAt} inclusive to {@code closesAt} exclusive. */
public record OpenWindow(Instant opensAt, Instant closesAt) {

    public boolean contains(Instant instant) {
        return !instant.isBefore(opensAt) && instant.isBefore(closesAt);
    }
}
