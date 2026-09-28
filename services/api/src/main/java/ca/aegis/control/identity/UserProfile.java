package ca.aegis.control.identity;

import java.util.UUID;

/** Minimal profile of the REST contract (document 09, section 4.4). */
record UserProfile(UUID id, String displayName, String email, Role role, AccessLevel maximumAccessLevel) {

    static UserProfile of(CurrentAccount account) {
        return new UserProfile(account.id(), account.displayName(), account.email(), account.role(),
                account.maximumAccessLevel());
    }
}
