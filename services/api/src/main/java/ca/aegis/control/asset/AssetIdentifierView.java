package ca.aegis.control.asset;

import java.time.Instant;
import java.util.UUID;

/**
 * Administrative representation of a physical identifier, defined with CAT-02: document 09, section 12.3, names
 * the routes but not their response. The value is shown to administrators only (section 8.2).
 */
public record AssetIdentifierView(
        UUID id,
        UUID assetId,
        IdentifierType type,
        String value,
        boolean active,
        Instant assignedAt,
        Instant revokedAt) {
}
