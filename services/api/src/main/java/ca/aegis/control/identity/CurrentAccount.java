package ca.aegis.control.identity;

import java.util.UUID;

/**
 * The authenticated account as read from the database for the current request. Authorization decisions use
 * these values, never the role or access-level claims of the token (ADR-007).
 */
public record CurrentAccount(UUID id, String displayName, String email, Role role, AccessLevel maximumAccessLevel) {

    static CurrentAccount of(Account account) {
        return new CurrentAccount(account.id(), account.displayName(), account.email(), account.role(),
                account.maximumAccessLevel());
    }

    /** Asset access policy: a {@code STANDARD} account may not use a {@code RESTRICTED} asset. */
    public boolean mayUse(AccessLevel requiredAccessLevel) {
        return maximumAccessLevel.permits(requiredAccessLevel);
    }

    /** Same policy for an action on the asset, rejected with 403 {@code ASSET_ACCESS_DENIED} (document 09, 26.3). */
    public void requireAccessLevel(AccessLevel requiredAccessLevel) {
        if (!mayUse(requiredAccessLevel)) {
            throw new AssetAccessDeniedException();
        }
    }
}
