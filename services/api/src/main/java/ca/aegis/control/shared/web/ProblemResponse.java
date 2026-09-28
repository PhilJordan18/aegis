package ca.aegis.control.shared.web;

import java.net.URI;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Error body of the REST contract (document 09, section 7). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProblemResponse(
        URI type,
        String title,
        int status,
        String code,
        String detail,
        String instance,
        String traceId,
        Instant timestamp,
        List<String> reasons,
        List<Violation> violations) {

    /** A field-level error. It never carries the rejected value. */
    public record Violation(String field, String code, String message) {

        static final Comparator<Violation> ORDER =
                Comparator.comparing(Violation::field).thenComparing(Violation::code);
    }
}
