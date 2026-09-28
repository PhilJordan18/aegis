package ca.aegis.control.identity;

import java.util.Locale;

final class EmailAddresses {

    static final int MAX_LENGTH = 320;

    private EmailAddresses() {
    }

    /** Login and storage use the same normalized form, backed by the case-insensitive unique index. */
    static String normalize(String email) {
        return email == null ? null : email.strip().toLowerCase(Locale.ROOT);
    }
}
