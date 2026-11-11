package ca.aegis.control.reservation;

import org.springframework.http.HttpHeaders;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** Document 09, section 15.5: too many preparations by one technician on one locker, with {@code Retry-After}. */
final class LocalProofRateLimitedException extends ApiException {

    private final long retryAfterSeconds;

    LocalProofRateLimitedException(long retryAfterSeconds) {
        super(ApiError.LOCAL_PROOF_RATE_LIMITED);
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    @Override
    public HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds));
        return headers;
    }
}
