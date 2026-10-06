package ca.aegis.control.asset;

import java.net.URI;
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

import ca.aegis.control.shared.web.IdempotencyKey;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;

/**
 * Routes of document 09, section 12.1, reserved to administrators by {@code ApiRoutes}. The idempotency key is
 * required and validated, but responses are not yet stored for replay: that needs {@code rest_idempotency_keys}
 * (document 08, section 4.10). Until then the uniqueness constraints keep a repeated creation from creating twice.
 */
@RestController
@RequestMapping("/api/v1/admin/asset-models")
class AdminAssetModelController {

    private final AssetModelService models;

    AdminAssetModelController(AssetModelService models) {
        this.models = models;
    }

    @GetMapping
    PageResponse<AssetModelView> list(@RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        return models.list(PageQuery.parse(page, size));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AssetModelView> create(IdempotencyKey idempotencyKey,
            @Valid @RequestBody AssetModelRequest request) {
        AssetModelView created = models.create(request);
        return ResponseEntity.created(URI.create("/api/v1/admin/asset-models/" + created.id())).body(created);
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
    AssetModelView archive(IdempotencyKey idempotencyKey, @PathVariable UUID modelId) {
        return models.archive(modelId);
    }
}
