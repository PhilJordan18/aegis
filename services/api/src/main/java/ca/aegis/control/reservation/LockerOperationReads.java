package ca.aegis.control.reservation;

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

/**
 * Read-only access to {@code aegis.locker_operations} with its challenge (at most one per operation, document 08,
 * section 4.6) and its latest anomaly. No method here locks or writes.
 */
@Repository
class LockerOperationReads {

    private static final String SELECT = """
            SELECT o.id, o.type, o.status, o.user_id, o.asset_id, o.locker_id, o.compartment_id, o.reservation_id,
                   o.loan_id, o.created_at, o.authorized_at, o.local_proof_validated_at, o.expires_at,
                   o.command_sent_at, o.acknowledged_at, o.door_opened_at, o.observation_received_at, o.confirmed_at,
                   o.terminal_at, o.failure_reason,
                   c.id AS challenge_id, c.expires_at AS challenge_expires_at, c.displayed_at AS challenge_displayed_at,
                   (SELECT a.id FROM aegis.anomalies a WHERE a.locker_operation_id = o.id
                    ORDER BY a.detected_at DESC, a.id DESC LIMIT 1) AS anomaly_id
            FROM aegis.locker_operations o
            LEFT JOIN aegis.local_access_challenges c ON c.operation_id = o.id
            """;

    /**
     * Filters of {@code GET /admin/locker-operations} (document 09, section 17). Provisional rule D2 of the 11
     * November 2026 matrix (#67): {@code from} and {@code to} bound {@code created_at}.
     */
    record AdminFilter(LockerOperationStatus status, UUID assetId, UUID userId, UUID lockerId, Instant from,
            Instant to) {

        Where where() {
            return new Where().equal("o.status", status).equal("o.asset_id", assetId).equal("o.user_id", userId)
                    .equal("o.locker_id", lockerId).interval("o.created_at", from, to);
        }
    }

    private final JdbcClient jdbc;

    LockerOperationReads(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<LockerOperationView> find(UUID id) {
        return jdbc.sql(SELECT + " WHERE o.id = :id").param("id", id).query(LockerOperationReads::map).optional();
    }

    /** Provisional order D1 of the 11 November 2026 matrix (#67): most recent first, {@code id} breaking ties. */
    List<LockerOperationView> page(AdminFilter filter, PageQuery page) {
        Where where = filter.where();
        return where.bind(jdbc.sql(SELECT + where.sql()
                        + " ORDER BY o.created_at DESC, o.id DESC LIMIT :limit OFFSET :offset"))
                .param("limit", page.size()).param("offset", page.offset())
                .query(LockerOperationReads::map).list();
    }

    long count(AdminFilter filter) {
        Where where = filter.where();
        return where.bind(jdbc.sql("SELECT count(*) FROM aegis.locker_operations o" + where.sql()))
                .query(Long.class).single();
    }

    private static LockerOperationView map(ResultSet row, int number) throws SQLException {
        LockerOperationStatus status = LockerOperationStatus.valueOf(row.getString("status"));
        return new LockerOperationView(row.getObject("id", UUID.class),
                LockerOperationType.valueOf(row.getString("type")), status, row.getObject("user_id", UUID.class),
                row.getObject("asset_id", UUID.class), row.getObject("locker_id", UUID.class),
                row.getObject("compartment_id", UUID.class), row.getObject("reservation_id", UUID.class),
                row.getObject("loan_id", UUID.class), instant(row, "created_at"), instant(row, "authorized_at"),
                row.getObject("challenge_id", UUID.class), instant(row, "challenge_expires_at"),
                instant(row, "challenge_displayed_at"), instant(row, "local_proof_validated_at"),
                RequiredAction.of(status), instant(row, "expires_at"), instant(row, "command_sent_at"),
                instant(row, "acknowledged_at"), instant(row, "door_opened_at"),
                instant(row, "observation_received_at"), instant(row, "confirmed_at"), instant(row, "terminal_at"),
                row.getString("failure_reason"), row.getObject("anomaly_id", UUID.class));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
