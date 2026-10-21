package ca.aegis.control.shared.idempotency;

import org.springframework.http.HttpHeaders;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** Refusals of the idempotency layer (document 09, section 20.2). */
final class IdempotencyExceptions {

    /** Seconds a client waits before repeating a request whose key is still held by another attempt. */
    static final String RETRY_AFTER_SECONDS = "1";

    private IdempotencyExceptions() {
    }

    static final class KeyRequired extends ApiException {

        KeyRequired() {
            super(ApiError.IDEMPOTENCY_KEY_REQUIRED);
        }
    }

    static final class KeyReused extends ApiException {

        KeyReused() {
            super(ApiError.IDEMPOTENCY_KEY_REUSED);
        }
    }

    static final class RequestInProgress extends ApiException {

        RequestInProgress() {
            super(ApiError.IDEMPOTENCY_REQUEST_IN_PROGRESS);
        }

        @Override
        public HttpHeaders headers() {
            HttpHeaders headers = new HttpHeaders();
            headers.set(HttpHeaders.RETRY_AFTER, RETRY_AFTER_SECONDS);
            return headers;
        }
    }
}
