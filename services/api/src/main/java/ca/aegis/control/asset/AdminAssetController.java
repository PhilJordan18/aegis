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
import ca.aegis.control.shared.web.SearchText;

/**
 * Routes of document 09, section 12.2, reserved to administrators by {@code ApiRoutes}. As for models, the
 * idempotency key is required but not yet stored for replay (document 08, section 4.10).
 */
@RestController
@RequestMapping("/api/v1/admin/assets")
class AdminAssetController {

    private final AdminAssetService assets;

    AdminAssetController(AdminAssetService assets) {
        this.assets = assets;
    }

    @GetMapping
    PageResponse<AdminAssetView> list(@RequestParam(required = false) String q,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size,
            @RequestParam(defaultValue = AssetSort.DEFAULT) String sort) {
        return assets.list(PageQuery.parse(page, size), SearchText.containsPattern(q), AssetSort.parse(sort));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AdminAssetView> create(IdempotencyKey idempotencyKey, @Valid @RequestBody AssetRequest request) {
        AdminAssetView created = assets.create(request);
        return ResponseEntity.created(URI.create("/api/v1/admin/assets/" + created.id())).body(created);
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
    AdminAssetView archive(IdempotencyKey idempotencyKey, @PathVariable UUID assetId) {
        return assets.archive(assetId);
    }
}
