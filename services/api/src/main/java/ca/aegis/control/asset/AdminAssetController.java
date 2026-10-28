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
import ca.aegis.control.shared.web.SearchText;

/**
 * Routes of document 09, section 12.2, reserved to administrators by {@code ApiRoutes}. Creation and archival are
 * idempotent mutations of section 20.1: {@link IdempotencyService} owns their transaction, which the service joins.
 */
@RestController
@RequestMapping("/api/v1/admin/assets")
class AdminAssetController {

    private final AdminAssetService assets;
    private final IdempotencyService idempotency;

    AdminAssetController(AdminAssetService assets, IdempotencyService idempotency) {
        this.assets = assets;
        this.idempotency = idempotency;
    }

    @GetMapping
    PageResponse<AdminAssetView> list(@RequestParam(required = false) String q,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size,
            @RequestParam(defaultValue = AssetSort.DEFAULT) String sort) {
        return assets.list(PageQuery.parse(page, size), SearchText.containsPattern(q), AssetSort.parse(sort));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<JsonNode> create(IdempotentRequest idempotentRequest, @Valid @RequestBody AssetRequest request) {
        return idempotency.execute(idempotentRequest, request, () -> {
            AdminAssetView created = assets.create(request);
            return IdempotentResult.created(IdempotentResource.ASSET, created.id(), created);
        });
    }

    @GetMapping("/{assetId}")
    AdminAssetView get(@PathVariable UUID assetId) {
        return assets.get(assetId);
    }

    @PutMapping(path = "/{assetId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    AdminAssetView replace(@PathVariable UUID assetId, @Valid @RequestBody AssetRequest request) {
        return assets.replace(assetId, request);
    }

    @PostMapping("/{assetId}/archive")
    ResponseEntity<JsonNode> archive(IdempotentRequest idempotentRequest, @PathVariable UUID assetId) {
        return idempotency.execute(idempotentRequest, () -> IdempotentResult.ok(assets.archive(assetId)));
    }
}
