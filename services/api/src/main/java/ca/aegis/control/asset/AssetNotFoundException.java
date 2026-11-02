package ca.aegis.control.asset;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** An asset id unknown to the technician catalog (document 09, section 11.2). */
final class AssetNotFoundException extends ApiException {

    AssetNotFoundException() {
        super(ApiError.ASSET_NOT_FOUND);
    }
}
