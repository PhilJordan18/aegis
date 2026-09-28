package ca.aegis.control.identity;

/** Hardware access level: each user has a maximum level and each asset a required level (scope 9.5). */
public enum AccessLevel {
    STANDARD,
    RESTRICTED;

    /** Whether a user holding this maximum level may use an asset that requires {@code required}. */
    public boolean permits(AccessLevel required) {
        return switch (required) {
            case STANDARD -> true;
            case RESTRICTED -> this == RESTRICTED;
        };
    }
}
