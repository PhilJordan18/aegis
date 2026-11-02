package ca.aegis.control.locker;

/**
 * A refusal of the operating-hours rule of document 06, section 5.1. It carries no web status: the reservation slice
 * maps {@link Reason#OUTSIDE_OPERATING_HOURS} and {@link Reason#UNTIL_AFTER_CLOSING} to the 422 codes of document 09,
 * section 21, and chooses the code of {@link Reason#UNTIL_NOT_AFTER_NOW}.
 */
public final class OperatingHoursException extends RuntimeException {

    public enum Reason {
        /** The day is closed, or the instant is before opening or at or after closing. */
        OUTSIDE_OPERATING_HOURS,
        /** The requested end is not after the current instant. */
        UNTIL_NOT_AFTER_NOW,
        /** The requested end is after the closing of the current window. */
        UNTIL_AFTER_CLOSING
    }

    private final Reason reason;

    OperatingHoursException(Reason reason) {
        super(reason.name(), null, false, false);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
