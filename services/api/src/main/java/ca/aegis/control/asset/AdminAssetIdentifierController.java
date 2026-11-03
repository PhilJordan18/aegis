package ca.aegis.control.asset;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResource;
import ca.aegis.control.shared.idempotency.IdempotentResult;

/**
 * Routes of document 09, section 12.3, both idempotent mutations of section 20.1. No route reads a single
 * identifier, so the {@code Location} of an assignment names the asset that now carries it.
 */
@RestController
@RequestMapping("/api/v1/admin/assets/{assetId}/identifiers")
class AdminAssetIdentifierController {

    private final AssetIdentifierService identifiers;
    private final IdempotencyService idempotency;

    AdminAssetIdentifierController(AssetIdentifierService identifiers, IdempotencyService idempotency) {
        this.identifiers = identifiers;
        this.idempotency = idempotency;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<JsonNode> assign(IdempotentRequest idempotentRequest, @PathVariable UUID assetId,
            @Valid @RequestBody AssetIdentifierRequest request) {
        return idempotency.execute(idempotentRequest, request, () -> IdempotentResult.created(
                IdempotentResource.ASSET, assetId,
                identifiers.assign(assetId, request, idempotentRequest.actorUserId())));
    }

    @PostMapping("/{identifierId}/revoke")
    ResponseEntity<JsonNode> revoke(IdempotentRequest idempotentRequest, @PathVariable UUID assetId,
            @PathVariable UUID identifierId) {
        return idempotency.execute(idempotentRequest, () -> IdempotentResult.ok(
                identifiers.revoke(assetId, identifierId, idempotentRequest.actorUserId())));
    }
}
