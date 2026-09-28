package ca.aegis.control.identity;

import java.time.Instant;
import java.util.UUID;

/** A prepared account as stored in {@code aegis.users}. */
record Account(
        UUID id,
        String displayName,
        String email,
        String passwordHash,
        Role role,
        AccessLevel maximumAccessLevel,
        AccountStatus status,
        Instant archivedAt) {

    boolean canAuthenticate() {
        return status == AccountStatus.ACTIVE && archivedAt == null;
    }

    @Override
    public String toString() {
        return "Account[id=%s, email=%s, role=%s, maximumAccessLevel=%s, status=%s]"
                .formatted(id, email, role, maximumAccessLevel, status);
    }
}
