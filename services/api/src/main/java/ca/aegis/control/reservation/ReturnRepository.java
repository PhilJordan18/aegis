package ca.aegis.control.reservation;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.loan.LoanStatus;

/**
 * The loan rows a return locks, checks and changes (document 06, sections 6.3, 6.5 and 13). Every method joins the
 * caller's transaction. The loan lock comes third, after the user and the asset (document 08, section 7.1).
 */
@Repository
class ReturnRepository {

    record LoanRow(UUID id, UUID assetId, UUID holderUserId, LoanStatus status) {
    }

    private final JdbcClient jdbc;

    ReturnRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<LoanRow> find(UUID loanId) {
        return select(loanId, "");
    }

    Optional<LoanRow> lock(UUID loanId) {
        return select(loanId, " FOR UPDATE");
    }

    private Optional<LoanRow> select(UUID loanId, String lock) {
        return jdbc.sql("SELECT id, asset_id, holder_user_id, status FROM aegis.loans WHERE id = :id" + lock)
                .param("id", loanId)
                .query((row, number) -> new LoanRow(row.getObject("id", UUID.class),
                        row.getObject("asset_id", UUID.class), row.getObject("holder_user_id", UUID.class),
                        LoanStatus.valueOf(row.getString("status"))))
                .optional();
    }

    /** A return already waiting for its local proof; the loan keeps its state until the authorization. */
    UUID insertReturn(UUID userId, UUID assetId, PreparationRepository.Cell cell, UUID loanId, UUID identifierId,
            Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, loan_id, expected_asset_identifier_id,
                     created_at)
                VALUES ('RETURN', 'AWAITING_LOCAL_PROOF', :user, :asset, :locker, :compartment, :loan, :identifier,
                        :now)
                RETURNING id
                """)
                .param("user", userId)
                .param("asset", assetId)
                .param("locker", cell.lockerId())
                .param("compartment", cell.id())
                .param("loan", loanId)
                .param("identifier", identifierId)
                .param("now", now.atOffset(ZoneOffset.UTC))
                .query(UUID.class).single();
    }

    /** Document 06, section 6.5: the local authorization of a return moves its locked loan to RETURN_PENDING. */
    void start(UUID loanId, Instant now) {
        move(loanId, "ACTIVE", "RETURN_PENDING", ", return_requested_at = :now", now);
    }

    /** RETURN_PENDING to COMPLETED, with the proven return operation (document 08, section 7.5). */
    void complete(UUID loanId, UUID operationId, Instant now) {
        int completed = jdbc.sql("""
                UPDATE aegis.loans SET status = 'COMPLETED', returned_at = :now, return_operation_id = :operation
                WHERE id = :id AND status = 'RETURN_PENDING'
                """).param("now", now.atOffset(ZoneOffset.UTC)).param("operation", operationId).param("id", loanId)
                .update();
        if (completed != 1) {
            throw new IllegalStateException("A locked loan changed state: " + loanId);
        }
    }

    /**
     * Document 06, section 13.1: a return that certainly had no physical effect gives the loan back to its holder.
     * {@code return_requested_at} keeps the latest attempt.
     */
    void revert(UUID loanId, Instant now) {
        move(loanId, "RETURN_PENDING", "ACTIVE", "", now);
    }

    /**
     * Document 06, section 13.4: a {@code RETURN_PENDING} loan admits a recovery once one of its returns ended in
     * {@code ANOMALY} and no anomaly linked to its returns is still {@code OPEN}. Its acknowledged anomalies stay
     * unresolved until a coherent proof of the recovery.
     */
    boolean recoverable(UUID loanId) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM aegis.locker_operations
                               WHERE loan_id = :loan AND type = 'RETURN' AND status = 'ANOMALY')
                   AND NOT EXISTS (SELECT 1 FROM aegis.anomalies a
                                   JOIN aegis.locker_operations o ON o.id = a.locker_operation_id
                                   WHERE o.loan_id = :loan AND o.type = 'RETURN' AND a.status = 'OPEN')
                """).param("loan", loanId).query(Boolean.class).single();
    }

    /**
     * Whether the return operation recovers its loan: an earlier return of the loan ended in {@code ANOMALY}, so the
     * loan was already {@code RETURN_PENDING} when this one was authorized and must stay so if it ends safely.
     */
    boolean isRecovery(UUID loanId, UUID operationId) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM aegis.locker_operations
                               WHERE loan_id = :loan AND type = 'RETURN' AND status = 'ANOMALY' AND id <> :operation)
                """).param("loan", loanId).param("operation", operationId).query(Boolean.class).single();
    }

    record LinkedAnomaly(UUID id, UUID operationId, String type, String severity) {
    }

    /** The acknowledged anomalies of the loan's other returns, locked: those a coherent recovery resolves. */
    java.util.List<LinkedAnomaly> lockAcknowledgedAnomalies(UUID loanId, UUID operationId) {
        return jdbc.sql("""
                SELECT a.id, a.locker_operation_id, a.type, a.severity FROM aegis.anomalies a
                JOIN aegis.locker_operations o ON o.id = a.locker_operation_id
                WHERE o.loan_id = :loan AND o.type = 'RETURN' AND o.id <> :operation AND a.status = 'ACKNOWLEDGED'
                ORDER BY a.detected_at, a.id
                FOR UPDATE OF a
                """).param("loan", loanId).param("operation", operationId)
                .query((row, number) -> new LinkedAnomaly(row.getObject("id", UUID.class),
                        row.getObject("locker_operation_id", UUID.class), row.getString("type"),
                        row.getString("severity")))
                .list();
    }

    /** ACKNOWLEDGED to RESOLVED with the observation that proves the asset back (document 08, ck_anomalies_lifecycle). */
    void resolve(UUID anomalyId, UUID evidenceObservationId, String note, Instant now) {
        int resolved = jdbc.sql("""
                UPDATE aegis.anomalies
                SET status = 'RESOLVED', resolved_at = :now, resolution_evidence_observation_id = :evidence,
                    resolution_note = :note
                WHERE id = :id AND status = 'ACKNOWLEDGED'
                """).param("now", now.atOffset(ZoneOffset.UTC)).param("evidence", evidenceObservationId)
                .param("note", note).param("id", anomalyId).update();
        if (resolved != 1) {
            throw new IllegalStateException("A locked anomaly changed state: " + anomalyId);
        }
    }

    private void move(UUID loanId, String from, String to, String extra, Instant now) {
        var statement = jdbc.sql("UPDATE aegis.loans SET status = :to" + extra + " WHERE id = :id AND status = :from")
                .param("to", to).param("id", loanId).param("from", from);
        if (!extra.isEmpty()) {
            statement = statement.param("now", now.atOffset(ZoneOffset.UTC));
        }
        if (statement.update() != 1) {
            throw new IllegalStateException("A locked loan changed state: " + loanId);
        }
    }
}
