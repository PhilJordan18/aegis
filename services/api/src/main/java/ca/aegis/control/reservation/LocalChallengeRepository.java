package ca.aegis.control.reservation;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * The local access challenge of a checkout attempt still before its authorization ({@code local_access_challenges},
 * document 08, section 4.6), as the end of its reservation closes it. Callers hold the attempt lock, so the challenge
 * comes seventh in the lock order of document 08, section 7.1.
 */
@Repository
class LocalChallengeRepository {

    private record Locked(UUID id, LocalChallengeStatus status) {
    }

    private final JdbcClient jdbc;

    LocalChallengeRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Locks the challenge of {@code operationId} and returns it if it is still {@code PENDING}. */
    Optional<UUID> lockPending(UUID operationId) {
        return jdbc.sql("SELECT id, status FROM aegis.local_access_challenges WHERE operation_id = :id FOR UPDATE")
                .param("id", operationId)
                .query((row, number) -> new Locked(row.getObject("id", UUID.class),
                        LocalChallengeStatus.valueOf(row.getString("status"))))
                .optional()
                .filter(challenge -> challenge.status() == LocalChallengeStatus.PENDING)
                .map(Locked::id);
    }

    /** Closes a locked {@code PENDING} challenge as {@code EXPIRED} or {@code INVALIDATED}. */
    void close(UUID challengeId, LocalChallengeStatus closed, Instant now) {
        int updated = jdbc.sql("""
                UPDATE aegis.local_access_challenges SET status = :status, closed_at = :now
                WHERE id = :id AND status = 'PENDING'
                """)
                .param("status", closed.name())
                .param("now", now.atOffset(ZoneOffset.UTC))
                .param("id", challengeId)
                .update();
        if (updated != 1) {
            throw new IllegalStateException("A locked local challenge changed state: " + challengeId);
        }
    }

    /**
     * Stops the distribution of the challenge's display instruction, releases its claim and purges its ciphertext,
     * keeping only the metadata (document 08, section 4.6). An instruction still sendable becomes {@code CANCELLED},
     * since {@code ck_display_sendable_payload} keeps a payload on every sendable status; an instruction already
     * acknowledged or rejected keeps its status. Returns the number of instructions changed.
     */
    int stopDisplay(UUID challengeId) {
        return jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = CASE WHEN status IN ('PENDING', 'CLAIMED', 'DISPATCHED') THEN 'CANCELLED' ELSE status END,
                    claim_until = NULL,
                    encrypted_payload = NULL
                WHERE challenge_id = :id
                  AND (encrypted_payload IS NOT NULL OR status IN ('PENDING', 'CLAIMED', 'DISPATCHED'))
                """)
                .param("id", challengeId)
                .update();
    }
}
