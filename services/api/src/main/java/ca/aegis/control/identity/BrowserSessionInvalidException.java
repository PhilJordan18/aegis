package ca.aegis.control.identity;

import org.springframework.http.HttpHeaders;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** One refusal for every unusable browser session; the response also clears the cookie. */
class BrowserSessionInvalidException extends ApiException {

    BrowserSessionInvalidException() {
        super(ApiError.AUTH_SESSION_INVALID);
    }

    @Override
    public HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.SET_COOKIE, BrowserSessions.cleared().toString());
        return headers;
    }
}
