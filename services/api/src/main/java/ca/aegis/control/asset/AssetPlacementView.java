package ca.aegis.control.asset;

import java.time.Instant;
import java.util.UUID;

/**
 * The active placement returned by {@code PUT /admin/assets/{assetId}/placement}, proposed with CAT-02: document 09,
 * section 12.4, says "le placement actif" without a shape. It extends {@code PlacementSummary} (section 8.2) with the
 * row identifier, its start and its reason.
 */
public record AssetPlacementView(
        UUID id,
        UUID assetId,
        UUID lockerId,
        String lockerCode,
        UUID compartmentId,
        String compartmentCode,
        Instant assignedAt,
        String reason) {
}
