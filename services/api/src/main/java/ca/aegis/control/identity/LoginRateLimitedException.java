package ca.aegis.control.identity;

import java.time.Duration;

import org.springframework.http.HttpHeaders;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

class LoginRateLimitedException extends ApiException {

    private final Duration retryAfter;

    LoginRateLimitedException(Duration retryAfter) {
        super(ApiError.RATE_LIMITED);
        this.retryAfter = retryAfter;
    }

    Duration retryAfter() {
        return retryAfter;
    }

    @Override
    public HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        long seconds = Math.max(1, (retryAfter.toMillis() + 999) / 1000);
        headers.set(HttpHeaders.RETRY_AFTER, Long.toString(seconds));
        return headers;
    }
}
