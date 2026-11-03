package ca.aegis.control.shared.web;

import java.util.List;

import org.springframework.http.HttpHeaders;

/** An expected refusal that maps directly to a stable contract error. */
public abstract class ApiException extends RuntimeException {

    private final ApiError error;

    protected ApiException(ApiError error) {
        super(error.name(), null, false, false);
        this.error = error;
    }

    public ApiError error() {
        return error;
    }

    public HttpHeaders headers() {
        return new HttpHeaders();
    }

    public List<ProblemResponse.Violation> violations() {
        return null;
    }

    /** Controlled business reasons of the refusal (document 09, section 7), or {@code null} when it has none. */
    public List<String> reasons() {
        return null;
    }
}
