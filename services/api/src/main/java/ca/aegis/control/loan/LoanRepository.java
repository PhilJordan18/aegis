package ca.aegis.control.loan;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.shared.jdbc.Where;
import ca.aegis.control.shared.web.PageQuery;

/** Read access to {@code aegis.loans} (document 08, section 4.9); this slice never writes a loan. */
@Repository
class LoanRepository {

    private static final String COLUMNS = """
            id, asset_id, holder_user_id, status, checked_out_at, due_at, return_requested_at, returned_at,
            checkout_operation_id, return_operation_id
            """;

    private final JdbcClient jdbc;

    LoanRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The open loans of {@code holder}, oldest checkout first. P0 expects at most one (document 09, section 15.3), but
     * no constraint enforces it per holder, so the caller sees every row and decides.
     */
    List<LoanRow> openOfHolder(UUID holder) {
        return jdbc.sql("SELECT " + COLUMNS + """
                FROM aegis.loans
                WHERE holder_user_id = :holder AND status IN ('ACTIVE', 'RETURN_PENDING')
                ORDER BY checked_out_at, id
                """).param("holder", holder).query(LoanRepository::map).list();
    }

    Optional<LoanRow> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM aegis.loans WHERE id = :id").param("id", id)
                .query(LoanRepository::map).optional();
    }

    /**
     * Filters of {@code GET /admin/loans} (document 09, section 17): {@code userId} is the holder. Rule D2 approved
     * on 11 November 2026 (#67): {@code from} and {@code to} bound {@code checked_out_at}.
     */
    record AdminFilter(LoanStatus status, UUID assetId, UUID holderUserId, Instant from, Instant to) {

        Where where() {
            return new Where().equal("status", status).equal("asset_id", assetId)
                    .equal("holder_user_id", holderUserId).interval("checked_out_at", from, to);
        }
    }

    /** Order D1 approved on 11 November 2026 (#67): latest checkout first, {@code id} breaking ties. */
    List<LoanRow> page(AdminFilter filter, PageQuery page) {
        Where where = filter.where();
        return where.bind(jdbc.sql("SELECT " + COLUMNS + " FROM aegis.loans" + where.sql()
                        + " ORDER BY checked_out_at DESC, id DESC LIMIT :limit OFFSET :offset"))
                .param("limit", page.size()).param("offset", page.offset())
                .query(LoanRepository::map).list();
    }

    long count(AdminFilter filter) {
        Where where = filter.where();
        return where.bind(jdbc.sql("SELECT count(*) FROM aegis.loans" + where.sql())).query(Long.class).single();
    }

    /**
     * Document 09, section 8.4: the latest return attempt of the loan, a non-terminal one first; it stays set when
     * terminal so that a failure or an anomaly can be explained.
     */
    Optional<UUID> latestReturnAttemptOf(UUID loanId) {
        return jdbc.sql("""
                SELECT id FROM aegis.locker_operations
                WHERE loan_id = :id AND type = 'RETURN'
                ORDER BY (status IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')), created_at DESC, id DESC
                LIMIT 1
                """).param("id", loanId).query(UUID.class).optional();
    }

    record LoanRow(UUID id, UUID assetId, UUID holderUserId, LoanStatus status, Instant checkedOutAt, Instant dueAt,
            Instant returnRequestedAt, Instant returnedAt, UUID checkoutOperationId, UUID returnOperationId) {
    }

    private static LoanRow map(ResultSet row, int number) throws SQLException {
        return new LoanRow(row.getObject("id", UUID.class), row.getObject("asset_id", UUID.class),
                row.getObject("holder_user_id", UUID.class), LoanStatus.valueOf(row.getString("status")),
                instant(row, "checked_out_at"), instant(row, "due_at"), instant(row, "return_requested_at"),
                instant(row, "returned_at"), row.getObject("checkout_operation_id", UUID.class),
                row.getObject("return_operation_id", UUID.class));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
