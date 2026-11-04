package ca.aegis.control.locker;

import java.time.Instant;

/**
 * The {@code OperatingWindowView} of document 09, section 8.6. Its Java name differs from {@link OperatingWindowView},
 * the weekday entry of a schedule (section 13).
 */
public record CurrentWindowView(String timeZone, boolean open, Instant closesAt, Instant nextOpensAt) {

    /** No usable schedule: closed, with no instant and no zone to state. */
    static final CurrentWindowView NONE = new CurrentWindowView(null, false, null, null);
}
