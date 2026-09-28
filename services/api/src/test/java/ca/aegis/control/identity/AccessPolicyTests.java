package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

class AccessPolicyTests {

    @Test
    void standardAccountsMayOnlyUseStandardAssets() {
        assertTrue(AccessLevel.STANDARD.permits(AccessLevel.STANDARD));
        assertFalse(AccessLevel.STANDARD.permits(AccessLevel.RESTRICTED));
        assertTrue(AccessLevel.RESTRICTED.permits(AccessLevel.STANDARD));
        assertTrue(AccessLevel.RESTRICTED.permits(AccessLevel.RESTRICTED));
    }

    @Test
    void insufficientLevelIsRefusedWithTheContractCode() {
        CurrentAccount standard = account(AccessLevel.STANDARD);
        CurrentAccount restricted = account(AccessLevel.RESTRICTED);

        standard.requireAccessLevel(AccessLevel.STANDARD);
        restricted.requireAccessLevel(AccessLevel.RESTRICTED);
        ApiException denied = assertThrows(ApiException.class,
                () -> standard.requireAccessLevel(AccessLevel.RESTRICTED));

        assertEquals(ApiError.ASSET_ACCESS_DENIED, denied.error());
        assertEquals(403, denied.error().status().value());
        assertEquals("https://aegis.local/problems/asset-access-denied", denied.error().type().toString());
    }

    @Test
    void roleAuthoritiesAreDistinct() {
        assertEquals("ROLE_ADMIN", Role.ADMIN.authority());
        assertEquals("ROLE_TECHNICIAN", Role.TECHNICIAN.authority());
    }

    private static CurrentAccount account(AccessLevel level) {
        return new CurrentAccount(UUID.randomUUID(), "Technicien", "technician@aegis.test", Role.TECHNICIAN, level);
    }
}
