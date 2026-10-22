package ca.aegis.control.asset;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResource;
import ca.aegis.control.shared.idempotency.IdempotentResult;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;

/**
 * Routes of document 09, section 12.1, reserved to administrators by {@code ApiRoutes}. Creation and archival are
 * idempotent mutations of section 20.1: {@link IdempotencyService} owns their transaction, which the service joins.
 */
@RestController
@RequestMapping("/api/v1/admin/asset-models")
class AdminAssetModelController {

    private final AssetModelService models;
    private final IdempotencyService idempotency;

    AdminAssetModelController(AssetModelService models, IdempotencyService idempotency) {
        this.models = models;
        this.idempotency = idempotency;
    }

    @GetMapping
    PageResponse<AssetModelView> list(@RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        return models.list(PageQuery.parse(page, size));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<JsonNode> create(IdempotentRequest idempotentRequest,
            @Valid @RequestBody AssetModelRequest request) {
        return idempotency.execute(idempotentRequest, request, () -> {
            AssetModelView created = models.create(request);
            return IdempotentResult.created(IdempotentResource.ASSET_MODEL, created.id(), created);
        });
    }

    @GetMapping("/{modelId}")
    AssetModelView get(@PathVariable UUID modelId) {
        return models.get(modelId);
    }

    @PutMapping(path = "/{modelId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    AssetModelView replace(@PathVariable UUID modelId, @Valid @RequestBody AssetModelRequest request) {
        return models.replace(modelId, request);
    }

    @PostMapping("/{modelId}/archive")
    ResponseEntity<JsonNode> archive(IdempotentRequest idempotentRequest, @PathVariable UUID modelId) {
        return idempotency.execute(idempotentRequest, () -> IdempotentResult.ok(models.archive(modelId)));
    }
}
