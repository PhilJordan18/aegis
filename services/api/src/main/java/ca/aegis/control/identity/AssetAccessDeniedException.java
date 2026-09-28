package ca.aegis.control.identity;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

final class AssetAccessDeniedException extends ApiException {

    AssetAccessDeniedException() {
        super(ApiError.ASSET_ACCESS_DENIED);
    }
}
