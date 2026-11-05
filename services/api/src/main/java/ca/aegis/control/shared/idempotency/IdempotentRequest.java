package ca.aegis.control.shared.idempotency;

import java.util.Collections;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;

/**
 * The identity of a sensitive mutation (document 09, sections 6.2 and 20): the authenticated actor, the
 * {@code Idempotency-Key}, the HTTP method, the logical route template and the path parameters of the matched
 * handler. A controller receives it by declaring a parameter of this type; see {@link IdempotencyService}.
 *
 * @param route the matched route template without the {@code /api/v1} prefix, for example
 *              {@code /admin/asset-models/{modelId}/archive}
 * @param pathParameters the raw path variables, iterated in name order
 */
public record IdempotentRequest(UUID actorUserId, String key, String method, String route,
        Map<String, String> pathParameters) {

    public static final String HEADER = "Idempotency-Key";
    public static final int MAX_KEY_LENGTH = 128;

    public IdempotentRequest {
        Objects.requireNonNull(actorUserId, "actorUserId");
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(route, "route");
        pathParameters = Collections.unmodifiableSortedMap(
                new TreeMap<>(pathParameters == null ? Map.of() : pathParameters));
    }

    /** The logical endpoint that scopes a key with the actor, for example {@code POST /admin/assets}. */
    public String endpoint() {
        return method + " " + route;
    }
}
