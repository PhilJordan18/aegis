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

    /**
     * Document 06, section 13.1: a return that certainly had no physical effect gives the loan back to its holder.
     * {@code return_requested_at} keeps the latest attempt.
     */
    void revert(UUID loanId, Instant now) {
        move(loanId, "RETURN_PENDING", "ACTIVE", "", now);
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
