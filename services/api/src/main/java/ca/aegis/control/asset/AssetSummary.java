package ca.aegis.control.asset;

import java.util.UUID;

/**
 * Asset summary embedded in reservation and loan views (document 09, section 8.8): no raw identifier and no readiness.
 *
 * @param placement the current expected placement, or {@code null}
 */
public record AssetSummary(UUID id, String assetCode, AssetModelSummary model, PlacementSummary placement) {

    static AssetSummary of(AssetRecord asset) {
        return new AssetSummary(asset.id(), asset.assetCode(), asset.model(), asset.placement());
    }
}
