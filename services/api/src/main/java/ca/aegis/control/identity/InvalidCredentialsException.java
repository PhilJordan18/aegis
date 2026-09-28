package ca.aegis.control.identity;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** Same refusal for an unknown, disabled or archived account and for a wrong password. */
class InvalidCredentialsException extends ApiException {

    InvalidCredentialsException() {
        super(ApiError.AUTH_INVALID_CREDENTIALS);
    }
}
