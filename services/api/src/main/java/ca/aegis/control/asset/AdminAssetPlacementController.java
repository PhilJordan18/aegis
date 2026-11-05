package ca.aegis.control.asset;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.identity.CurrentAccount;

/** Route of document 09, section 12.4. A PUT is idempotent by definition and takes no Idempotency-Key (§20.1). */
@RestController
class AdminAssetPlacementController {

    private final AssetPlacementService placements;

    AdminAssetPlacementController(AssetPlacementService placements) {
        this.placements = placements;
    }

    @PutMapping(path = "/api/v1/admin/assets/{assetId}/placement", consumes = MediaType.APPLICATION_JSON_VALUE)
    AssetPlacementView place(@AuthenticationPrincipal CurrentAccount actor, @PathVariable UUID assetId,
            @Valid @RequestBody PlacementRequest request) {
        return placements.place(assetId, request, actor.id());
    }
}
