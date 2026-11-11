package ca.aegis.control.reservation;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.shared.jdbc.Where;
import ca.aegis.control.shared.web.PageQuery;

/**
 * Reservations of document 08, section 4.6. The application never deletes one; the guards lock rows in the order of
 * section 7.1: the user, then the asset (through {@code ReservableAssets}), then the reservation and the loan.
 */
@Repository
class ReservationRepository {

    /** A stored reservation row. */
    record ReservationRow(UUID id, UUID assetId, UUID userId, ReservationStatus status, Instant reservedFrom,
            Instant reservedUntil, Instant createdAt, Instant cancelledAt, Instant fulfilledAt, Instant expiredAt) {
    }

    /** The stored user, as the guard reads it under lock. */
    record LockedUser(UUID id, AccountStatus status, Role role, AccessLevel maximumAccessLevel) {
    }

    private static final String SELECT_RESERVATION = """
            SELECT id, asset_id, user_id, status, reserved_from, reserved_until, created_at, cancelled_at,
                   fulfilled_at, expired_at
            FROM aegis.reservations
            """;
    private static final String NON_TERMINAL_OPERATION =
            "status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')";

    private final JdbcClient jdbc;

    ReservationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * {@code FOR NO KEY UPDATE}, never {@code FOR UPDATE}: the idempotency key of the same request already holds a
     * {@code KEY SHARE} lock on this row through its foreign key (document 08, section 7.1).
     */
    Optional<LockedUser> lockUser(UUID userId) {
        return jdbc.sql("""
                SELECT id, status, role, maximum_access_level FROM aegis.users WHERE id = :id FOR NO KEY UPDATE
                """).param("id", userId)
                .query((row, number) -> new LockedUser(row.getObject("id", UUID.class),
                        AccountStatus.valueOf(row.getString("status")), Role.valueOf(row.getString("role")),
                        AccessLevel.valueOf(row.getString("maximum_access_level"))))
                .optional();
    }

    boolean lockActiveOfUser(UUID userId) {
        return !jdbc.sql("SELECT id FROM aegis.reservations WHERE user_id = :id AND status = 'ACTIVE' FOR UPDATE")
                .param("id", userId).query(UUID.class).list().isEmpty();
    }

    boolean lockActiveOfAsset(UUID assetId) {
        return !jdbc.sql("SELECT id FROM aegis.reservations WHERE asset_id = :id AND status = 'ACTIVE' FOR UPDATE")
                .param("id", assetId).query(UUID.class).list().isEmpty();
    }

    /** A loan is open until it is {@code COMPLETED}, late or not (document 06, section 5.1). */
    boolean lockOpenLoanOfAsset(UUID assetId) {
        return !jdbc.sql("""
                SELECT id FROM aegis.loans WHERE asset_id = :id AND status IN ('ACTIVE', 'RETURN_PENDING') FOR UPDATE
                """).param("id", assetId).query(UUID.class).list().isEmpty();
    }

    UUID insert(UUID assetId, UUID userId, Instant reservedFrom, Instant reservedUntil, Instant createdAt) {
        return jdbc.sql("""
                INSERT INTO aegis.reservations (asset_id, user_id, status, reserved_from, reserved_until, created_at)
                VALUES (:assetId, :userId, 'ACTIVE', :reservedFrom, :reservedUntil, :createdAt)
                RETURNING id
                """)
                .param("assetId", assetId)
                .param("userId", userId)
                .param("reservedFrom", utc(reservedFrom))
                .param("reservedUntil", utc(reservedUntil))
                .param("createdAt", utc(createdAt))
                .query(UUID.class)
                .single();
    }

    Optional<ReservationRow> find(UUID id) {
        return jdbc.sql(SELECT_RESERVATION + "WHERE id = :id").param("id", id)
                .query(ReservationRepository::map).optional();
    }

    /**
     * Filters of {@code GET /admin/reservations} (document 09, section 17). Provisional rule D2 of the 11 November
     * 2026 matrix (#67): {@code from} and {@code to} bound {@code created_at}.
     */
    record AdminFilter(ReservationStatus status, UUID assetId, UUID userId, Instant from, Instant to) {

        Where where() {
            return new Where().equal("status", status).equal("asset_id", assetId).equal("user_id", userId)
                    .interval("created_at", from, to);
        }
    }

    /** Provisional order D1 of the 11 November 2026 matrix (#67): most recent first, {@code id} breaking ties. */
    List<ReservationRow> page(AdminFilter filter, PageQuery page) {
        Where where = filter.where();
        return where.bind(jdbc.sql(SELECT_RESERVATION + where.sql()
                        + " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset"))
                .param("limit", page.size()).param("offset", page.offset())
                .query(ReservationRepository::map).list();
    }

    long count(AdminFilter filter) {
        Where where = filter.where();
        return where.bind(jdbc.sql("SELECT count(*) FROM aegis.reservations" + where.sql())).query(Long.class)
                .single();
    }

    Optional<ReservationRow> activeOfUser(UUID userId) {
        return jdbc.sql(SELECT_RESERVATION + "WHERE user_id = :id AND status = 'ACTIVE'").param("id", userId)
                .query(ReservationRepository::map).optional();
    }

    /** The reservation row, locked after its asset (document 08, section 7.1) and read again under that lock. */
    Optional<ReservationRow> lock(UUID id) {
        return jdbc.sql(SELECT_RESERVATION + "WHERE id = :id FOR UPDATE").param("id", id)
                .query(ReservationRepository::map).optional();
    }

    /** The asset of a reservation, read without lock to find the asset row to lock first. */
    Optional<UUID> assetOf(UUID id) {
        return jdbc.sql("SELECT asset_id FROM aegis.reservations WHERE id = :id").param("id", id)
                .query(UUID.class).optional();
    }

    void cancel(UUID id, Instant at) {
        end(id, "CANCELLED", "cancelled_at", at);
    }

    void expire(UUID id, Instant at) {
        end(id, "EXPIRED", "expired_at", at);
    }

    /** A due reservation and its position in the order of a pass. */
    record Due(UUID id, Instant reservedUntil) {
    }

    /**
     * Up to {@code limit} {@code ACTIVE} reservations due at {@code now}, in the order {@code (reserved_until, id)},
     * strictly after {@code after} when it is not null: a pass pages through them with this keyset, so the
     * reservations it defers, skips or fails on never hide the later ones.
     */
    List<Due> dueAfter(Instant now, Due after, int limit) {
        String keyset = after == null ? "" : " AND (reserved_until, id) > (:afterUntil, :afterId)";
        var query = jdbc.sql("SELECT id, reserved_until FROM aegis.reservations WHERE status = 'ACTIVE' "
                + "AND reserved_until <= :now" + keyset + " ORDER BY reserved_until, id LIMIT :limit")
                .param("now", utc(now)).param("limit", limit);
        if (after != null) {
            query = query.param("afterUntil", utc(after.reservedUntil())).param("afterId", after.id());
        }
        return query.query((row, number) -> new Due(row.getObject("id", UUID.class),
                instant(row, "reserved_until"))).list();
    }

    /** The active reservations of a technician or of an asset that are due at {@code now}. */
    List<UUID> dueOf(UUID userId, UUID assetId, Instant now) {
        return jdbc.sql("""
                SELECT id FROM aegis.reservations
                WHERE status = 'ACTIVE' AND reserved_until <= :now AND (user_id = :user OR asset_id = :asset)
                ORDER BY id
                """).param("now", utc(now)).param("user", userId).param("asset", assetId).query(UUID.class).list();
    }

    private void end(UUID id, String status, String dateColumn, Instant at) {
        int ended = jdbc.sql("UPDATE aegis.reservations SET status = :status, " + dateColumn
                + " = :at WHERE id = :id AND status = 'ACTIVE'")
                .param("status", status).param("at", utc(at)).param("id", id).update();
        if (ended != 1) {
            throw new IllegalStateException("A locked reservation is no longer active: " + id);
        }
    }

    /** The non-terminal checkout attempt of the reservation, if any; none exists before the checkout slice. */
    Optional<UUID> currentOperationOf(UUID reservationId) {
        return jdbc.sql("SELECT id FROM aegis.locker_operations WHERE reservation_id = :id AND "
                + NON_TERMINAL_OPERATION + " ORDER BY created_at DESC LIMIT 1")
                .param("id", reservationId).query(UUID.class).optional();
    }

    private static ReservationRow map(ResultSet row, int number) throws SQLException {
        return new ReservationRow(row.getObject("id", UUID.class), row.getObject("asset_id", UUID.class),
                row.getObject("user_id", UUID.class), ReservationStatus.valueOf(row.getString("status")),
                instant(row, "reserved_from"), instant(row, "reserved_until"), instant(row, "created_at"),
                instant(row, "cancelled_at"), instant(row, "fulfilled_at"), instant(row, "expired_at"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
