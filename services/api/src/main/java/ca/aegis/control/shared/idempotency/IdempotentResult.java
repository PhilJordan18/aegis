package ca.aegis.control.shared.idempotency;

import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;

import ca.aegis.control.shared.web.ProblemResponse;

/**
 * The outcome of a business mutation, recorded for replay in the same transaction. Refusals are normally thrown as
 * exceptions instead: they roll the key back with the mutation and are never replayed. A refusal that must leave a
 * committed trace, such as a counted wrong secret (document 06, section 6.5), is returned with {@link #refused}: the
 * business change, the key and the problem response commit together, and a replay returns that problem without
 * running the mutation again.
 */
public record IdempotentResult(HttpStatus status, Object body, IdempotentResource resource, UUID resourceId) {

    public IdempotentResult {
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(body, "body");
        if (!status.is2xxSuccessful() && !(status.is4xxClientError() && body instanceof ProblemResponse)) {
            throw new IllegalArgumentException("Only a success or a client problem is recorded: " + status);
        }
        if ((resource == null) != (resourceId == null)) {
            throw new IllegalArgumentException("A resource type and its identifier go together");
        }
        if (status == HttpStatus.CREATED && resource == null) {
            throw new IllegalArgumentException("A 201 response names the created resource for its Location");
        }
    }

    /** 201 with {@code Location} built from {@code resource} and {@code id}, on the first response and on replays. */
    public static IdempotentResult created(IdempotentResource resource, UUID id, Object body) {
        return new IdempotentResult(HttpStatus.CREATED, body, resource, id);
    }

    /**
     * 202 for a physical workflow (document 09, section 15.1): {@code Location} names the operation to poll, with
     * {@code Retry-After: 1} and {@code Cache-Control: no-store}, on the first response and on replays.
     */
    public static IdempotentResult accepted(IdempotentResource resource, UUID id, Object body) {
        return new IdempotentResult(HttpStatus.ACCEPTED, body, resource, id);
    }

    /** A committed refusal: its problem body is recorded and replayed as {@code application/problem+json}. */
    public static IdempotentResult refused(ProblemResponse problem) {
        return new IdempotentResult(HttpStatus.valueOf(problem.status()), problem, null, null);
    }

    /** 200 for a mutation of an existing resource. */
    public static IdempotentResult ok(Object body) {
        return new IdempotentResult(HttpStatus.OK, body, null, null);
    }
}
