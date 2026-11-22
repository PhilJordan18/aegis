package ca.aegis.control.identity;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/**
 * ADR-016: a browser session is started, refreshed or revoked only from an allowed Manager origin. Together with
 * {@code SameSite=Strict}, this refuses a cross-site request that would ride on the cookie.
 */
class OriginNotAllowedException extends ApiException {

    OriginNotAllowedException() {
        super(ApiError.FORBIDDEN);
    }
}
