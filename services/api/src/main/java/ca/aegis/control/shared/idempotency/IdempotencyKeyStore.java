package ca.aegis.control.shared.idempotency;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** {@code aegis.rest_idempotency_keys} (document 08, section 4.10). Every method runs in the caller's transaction. */
@Repository
class IdempotencyKeyStore {

    private final JdbcClient jdbc;

    IdempotencyKeyStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Bounds every lock wait of the current transaction, including a wait for a concurrent insert of the key. */
    void limitLockWait(Duration timeout) {
        jdbc.sql("SELECT set_config('lock_timeout', :timeout, true)")
                .param("timeout", timeout.toMillis() + "ms")
                .query(String.class)
                .single();
    }

    /** Gives the rest of the transaction the lock wait it would have had without {@link #limitLockWait}. */
    void restoreLockWait() {
        jdbc.sql("SET LOCAL lock_timeout TO DEFAULT").update();
    }

    /**
     * Inserts the key as {@code IN_PROGRESS}. When another transaction has inserted the same scope and not yet
     * finished, PostgreSQL waits for it: an empty result means the key exists and is committed.
     */
    Optional<UUID> insertIfAbsent(IdempotentRequest request, byte[] requestHash, Instant createdAt,
            Instant expiresAt) {
        return jdbc.sql("""
                INSERT INTO aegis.rest_idempotency_keys
                    (actor_user_id, endpoint, idempotency_key, request_hash, created_at, expires_at)
                VALUES (:actor, :endpoint, :key, :hash, :createdAt, :expiresAt)
                ON CONFLICT ON CONSTRAINT uq_rest_idempotency_scope DO NOTHING
                RETURNING id
                """)
                .param("actor", request.actorUserId())
                .param("endpoint", request.endpoint())
                .param("key", request.key())
                .param("hash", requestHash)
                .param("createdAt", utc(createdAt))
                .param("expiresAt", utc(expiresAt))
                .query((row, number) -> row.getObject("id", UUID.class))
                .optional();
    }

    /** Locks the committed key of this scope; empty when a concurrent transaction deleted it meanwhile. */
    Optional<StoredKey> lock(IdempotentRequest request) {
        return jdbc.sql("""
                SELECT id, request_hash, status, response_status, response_body::text AS response_body,
                       resource_type, resource_id, expires_at
                FROM aegis.rest_idempotency_keys
                WHERE actor_user_id = :actor AND endpoint = :endpoint AND idempotency_key = :key
                FOR UPDATE
                """)
                .param("actor", request.actorUserId())
                .param("endpoint", request.endpoint())
                .param("key", request.key())
                .query(IdempotencyKeyStore::map)
                .optional();
    }

    void delete(UUID id) {
        jdbc.sql("DELETE FROM aegis.rest_idempotency_keys WHERE id = :id").param("id", id).update();
    }

    void complete(UUID id, int responseStatus, String responseBody, IdempotentResource resource, UUID resourceId,
            Instant completedAt) {
        int updated = jdbc.sql("""
                UPDATE aegis.rest_idempotency_keys
                SET status = 'COMPLETED', response_status = :status, response_body = CAST(:body AS jsonb),
                    resource_type = :resourceType, resource_id = :resourceId,
                    completed_at = GREATEST(:completedAt, created_at)
                WHERE id = :id AND status = 'IN_PROGRESS'
                """)
                .param("status", responseStatus)
                .param("body", responseBody)
                .param("resourceType", resource == null ? null : resource.name())
                .param("resourceId", resourceId)
                .param("completedAt", utc(completedAt))
                .param("id", id)
                .update();
        if (updated != 1) {
            throw new IllegalStateException("Idempotency key " + id + " is not in progress in this transaction");
        }
    }

    private static StoredKey map(ResultSet row, int number) throws SQLException {
        String resourceType = row.getString("resource_type");
        return new StoredKey(
                row.getObject("id", UUID.class),
                row.getBytes("request_hash"),
                "COMPLETED".equals(row.getString("status")),
                row.getInt("response_status"),
                row.getString("response_body"),
                resourceType == null ? null : IdempotentResource.valueOf(resourceType),
                row.getObject("resource_id", UUID.class),
                row.getObject("expires_at", OffsetDateTime.class).toInstant());
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    record StoredKey(UUID id, byte[] requestHash, boolean completed, int responseStatus, String responseBody,
            IdempotentResource resource, UUID resourceId, Instant expiresAt) {
    }
}
