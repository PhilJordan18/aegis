package ca.aegis.control.shared.idempotency;

import java.net.URI;
import java.util.UUID;

/**
 * Resources that an idempotent mutation may create, stored as {@code resource_type}. A replayed 201 rebuilds its
 * {@code Location} from this read route and the stored identifier, so no response header is stored.
 */
public enum IdempotentResource {

    ASSET_MODEL("/api/v1/admin/asset-models/"),
    ASSET("/api/v1/admin/assets/");

    private final String readRoutePrefix;

    IdempotentResource(String readRoutePrefix) {
        this.readRoutePrefix = readRoutePrefix;
    }

    public URI location(UUID id) {
        return URI.create(readRoutePrefix + id);
    }
}
