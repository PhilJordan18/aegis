package ca.aegis.control.shared.idempotency;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.shared.idempotency.IdempotencyKeyStore.StoredKey;
import ca.aegis.control.shared.web.RequestIdFilter;

/**
 * Durable REST idempotency (document 08, section 8.1; document 09, sections 6.2 and 20).
 * <p>
 * A controller declares an {@link IdempotentRequest} parameter, which makes {@code Idempotency-Key} mandatory, and
 * delegates its mutation to {@link #execute}. The key, the business mutation and the recorded response share one
 * transaction:
 * <ol>
 * <li>{@code lock_timeout} bounds the wait for the key, then the key is inserted; a concurrent attempt with the
 * same scope waits for the first transaction to end;</li>
 * <li>a new key runs the mutation and records its response;</li>
 * <li>an existing key is locked: expired, it is replaced and the mutation runs; with the same request hash, its
 * response is replayed without calling the mutation; with another hash, {@code IDEMPOTENCY_KEY_REUSED};</li>
 * <li>a refusal thrown by the mutation rolls everything back, key included, so a retry runs it again against the
 * business state of that moment.</li>
 * </ol>
 * The key row is the first row the flow locks explicitly, before any business aggregate (document 08, sections 7.1
 * and 8.1). Inserting it also takes a {@code KEY SHARE} lock on the actor's {@code aegis.users} row through
 * {@code fk_rest_idempotency_actor}; business guards therefore lock that row with {@code FOR NO KEY UPDATE}, which
 * does not conflict with it, never with {@code FOR UPDATE}, which would deadlock two concurrent requests of the
 * same actor. Authorization is decided by the security filter before the controller, so an actor never reaches
 * this service, or another actor's response, on a route it may not call.
 */
@Service
public class IdempotencyService {

    public static final String REPLAYED_HEADER = "Idempotency-Replayed";
    static final Duration RETENTION = Duration.ofHours(24);
    static final Duration LOCK_TIMEOUT = Duration.ofSeconds(5);

    private static final Logger log = LoggerFactory.getLogger(IdempotencyService.class);
    private static final String LOCK_NOT_AVAILABLE = "55P03";
    /** A key replaced concurrently needs a second pass; more passes mean the key keeps changing under us. */
    private static final int MAX_ACQUISITION_ATTEMPTS = 3;

    private final IdempotencyKeyStore keys;
    private final TransactionTemplate transactions;
    private final JsonMapper jsonMapper;
    private final Clock clock;

    IdempotencyService(IdempotencyKeyStore keys, PlatformTransactionManager transactionManager, JsonMapper jsonMapper,
            Clock clock) {
        this.keys = keys;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        this.jsonMapper = jsonMapper;
        this.clock = clock;
    }

    /** {@link #execute(IdempotentRequest, Object, Supplier)} for a route without request body. */
    public ResponseEntity<JsonNode> execute(IdempotentRequest request, Supplier<IdempotentResult> mutation) {
        return execute(request, null, mutation);
    }

    /**
     * Runs {@code mutation} at most once per key and request, or replays the response recorded for them.
     *
     * @param body the deserialized request body, part of the request hash; {@code null} when the route has none
     * @param mutation the business use case; it joins this method's transaction and must not start another
     */
    public ResponseEntity<JsonNode> execute(IdempotentRequest request, Object body,
            Supplier<IdempotentResult> mutation) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("The idempotency service owns the transaction of the request");
        }
        byte[] requestHash = RequestHash.of(request, body);
        Response response = transactions.execute(status -> run(request, requestHash, mutation));
        return response.entity();
    }

    private Response run(IdempotentRequest request, byte[] requestHash, Supplier<IdempotentResult> mutation) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Acquisition acquisition = acquire(request, requestHash, now);
        if (acquisition.replay() != null) {
            StoredKey stored = acquisition.replay();
            log.info("Request {} replays the response of idempotency row {} on {}", MDC.get(RequestIdFilter.MDC_KEY),
                    stored.id(), request.endpoint());
            return new Response(HttpStatus.valueOf(stored.responseStatus()), jsonMapper.readTree(stored.responseBody()),
                    stored.resource(), stored.resourceId(), true);
        }

        log.info("Request {} executes {} with idempotency row {}", MDC.get(RequestIdFilter.MDC_KEY),
                request.endpoint(), acquisition.keyId());
        IdempotentResult result = mutation.get();
        JsonNode responseBody = jsonMapper.valueToTree(result.body());
        keys.complete(acquisition.keyId(), result.status().value(), jsonMapper.writeValueAsString(responseBody),
                result.resource(), result.resourceId(), clock.instant().truncatedTo(ChronoUnit.MICROS));
        return new Response(result.status(), responseBody, result.resource(), result.resourceId(), false);
    }

    private Acquisition acquire(IdempotentRequest request, byte[] requestHash, Instant now) {
        try {
            keys.limitLockWait(LOCK_TIMEOUT);
            for (int attempt = 0; attempt < MAX_ACQUISITION_ATTEMPTS; attempt++) {
                Optional<UUID> inserted = keys.insertIfAbsent(request, requestHash, now, now.plus(RETENTION));
                if (inserted.isPresent()) {
                    // The business use case keeps its own lock policy; only the wait for the key is bounded here.
                    keys.restoreLockWait();
                    return new Acquisition(inserted.get(), null);
                }
                Optional<StoredKey> existing = keys.lock(request);
                if (existing.isEmpty()) {
                    continue;
                }
                StoredKey stored = existing.get();
                if (!stored.expiresAt().isAfter(now)) {
                    // Expired keys are not history: they only protect a retry window (document 08, section 8.1).
                    keys.delete(stored.id());
                    continue;
                }
                if (!Arrays.equals(stored.requestHash(), requestHash)) {
                    throw new IdempotencyExceptions.KeyReused();
                }
                if (!stored.completed()) {
                    // Unreachable while a key is completed in the transaction that inserted it.
                    throw new IdempotencyExceptions.RequestInProgress();
                }
                return new Acquisition(null, stored);
            }
            throw new IdempotencyExceptions.RequestInProgress();
        } catch (DataAccessException failure) {
            if (isLockTimeout(failure)) {
                throw new IdempotencyExceptions.RequestInProgress();
            }
            throw failure;
        }
    }

    private static boolean isLockTimeout(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && LOCK_NOT_AVAILABLE.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private record Acquisition(UUID keyId, StoredKey replay) {
    }

    private record Response(HttpStatus status, JsonNode body, IdempotentResource resource, UUID resourceId,
            boolean replayed) {

        /** The same status, JSON content and stable headers for the first response and every replay. */
        ResponseEntity<JsonNode> entity() {
            ResponseEntity.BodyBuilder builder = ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON);
            if (status == HttpStatus.CREATED) {
                builder.location(resource.location(resourceId));
            }
            if (replayed) {
                builder.header(REPLAYED_HEADER, "true");
            }
            return builder.body(body);
        }
    }
}
