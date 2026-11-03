package ca.aegis.control.reservation;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;

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

    Optional<ReservationRow> activeOfUser(UUID userId) {
        return jdbc.sql(SELECT_RESERVATION + "WHERE user_id = :id AND status = 'ACTIVE'").param("id", userId)
                .query(ReservationRepository::map).optional();
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
