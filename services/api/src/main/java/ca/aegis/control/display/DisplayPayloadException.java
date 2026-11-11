package ca.aegis.control.display;

/** A stored display payload that cannot be opened; it is never published, and its reason never quotes the payload. */
public final class DisplayPayloadException extends RuntimeException {

    public enum Reason {
        /** The row's key id is no longer in {@code AEGIS_DISPLAY_KEYS}: it was retired too early. */
        KEY_NOT_CONFIGURED,
        /** Truncated, modified or bound to other associated data. */
        AUTHENTICATION_FAILED
    }

    private final Reason reason;

    DisplayPayloadException(Reason reason) {
        super(reason.name(), null, false, false);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
