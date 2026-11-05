package ca.aegis.control.shared.idempotency;

import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;

/**
 * The successful outcome of a business mutation, recorded for replay in the same transaction. Refusals are thrown
 * as exceptions instead: they roll the key back with the mutation and are never replayed.
 */
public record IdempotentResult(HttpStatus status, Object body, IdempotentResource resource, UUID resourceId) {

    public IdempotentResult {
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(body, "body");
        if (!status.is2xxSuccessful()) {
            throw new IllegalArgumentException("Only a successful response is recorded: " + status);
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

    /** 200 for a mutation of an existing resource. */
    public static IdempotentResult ok(Object body) {
        return new IdempotentResult(HttpStatus.OK, body, null, null);
    }
}
