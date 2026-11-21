package ca.aegis.control.reservation;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * The rows that the preparation of a physical operation locks, checks and writes (document 06, section 6.4). Every
 * method joins the caller's transaction; the caller has already locked the user, the asset and the reservation or
 * the loan, so the locks taken here continue the order of document 06, section 3.3: locker, compartment, operation,
 * challenge.
 */
@Repository
class PreparationRepository {

    /** The compartment of the asset's current placement, read under lock. */
    record Cell(UUID id, UUID lockerId, String code, boolean enabled, String connectionStatus, String readerStatus,
            String doorState, String lockState) {
    }

    /** The active device of a locker and its current boot, if it has announced one. */
    record Device(UUID id, UUID deviceSessionId) {
    }

    private final JdbcClient jdbc;

    PreparationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The fourth lock: the locker row ({@code FOR UPDATE}), which also serializes the allocation of its display
     * revisions (document 10, section 27.4).
     */
    boolean lockLocker(UUID lockerId) {
        return jdbc.sql("SELECT id FROM aegis.lockers WHERE id = :id FOR UPDATE").param("id", lockerId)
                .query(UUID.class).optional().isPresent();
    }

    /**
     * The compartment of the asset's current placement ({@code FOR SHARE}): a heartbeat cannot change its projected
     * state until this decision commits.
     */
    Optional<Cell> lockPlacedCell(UUID assetId, UUID lockerId) {
        return placedCell(assetId, lockerId, " FOR SHARE OF c");
    }

    /** The same compartment read without a lock, for a display hint such as {@code availableActions}. */
    Optional<Cell> placedCell(UUID assetId, UUID lockerId) {
        return placedCell(assetId, lockerId, "");
    }

    private Optional<Cell> placedCell(UUID assetId, UUID lockerId, String lock) {
        return jdbc.sql("""
                SELECT c.id, c.locker_id, c.code, c.enabled, c.connection_status, c.rfid_reader_status,
                       c.door_state, c.lock_state
                FROM aegis.asset_placements p
                JOIN aegis.compartments c ON c.id = p.compartment_id
                WHERE p.asset_id = :asset AND p.removed_at IS NULL AND c.locker_id = :locker""" + lock)
                .param("asset", assetId)
                .param("locker", lockerId)
                .query((row, number) -> new Cell(row.getObject("id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getString("code"), row.getBoolean("enabled"),
                        row.getString("connection_status"), row.getString("rfid_reader_status"),
                        row.getString("door_state"), row.getString("lock_state")))
                .optional();
    }

    Optional<Device> activeDevice(UUID lockerId) {
        return jdbc.sql("""
                SELECT id, device_session_id FROM aegis.locker_devices
                WHERE locker_id = :locker AND disabled_at IS NULL
                """)
                .param("locker", lockerId)
                .query((row, number) -> new Device(row.getObject("id", UUID.class),
                        row.getObject("device_session_id", UUID.class)))
                .optional();
    }

    /** The active UHF identifier that the cell reader must observe (document 06, section 6.1). */
    Optional<UUID> activeRfidIdentifier(UUID assetId) {
        return jdbc.sql("""
                SELECT id FROM aegis.asset_identifiers
                WHERE asset_id = :asset AND active AND identifier_type = 'RFID_UHF'
                """).param("asset", assetId).query(UUID.class).optional();
    }

    /**
     * Document 06, section 6.1 requires the absence of an unresolved blocking anomaly without defining "blocking".
     * Until it is defined, every unresolved anomaly ({@code OPEN} or {@code ACKNOWLEDGED}) of the asset or of its
     * compartment blocks: the conservative reading, since only a new physical proof resolves an anomaly.
     */
    boolean hasUnresolvedAnomaly(UUID assetId, UUID compartmentId) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.anomalies
                    WHERE status IN ('OPEN', 'ACKNOWLEDGED') AND (asset_id = :asset OR compartment_id = :compartment)
                )
                """).param("asset", assetId).param("compartment", compartmentId).query(Boolean.class).single();
    }

    /** Any non-terminal physical operation of the locker; the P0 serializes openings per locker. */
    boolean hasOpenOperation(UUID lockerId) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.locker_operations
                    WHERE locker_id = :locker AND status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')
                )
                """).param("locker", lockerId).query(Boolean.class).single();
    }

    /** Operations prepared by this user on this locker since {@code since}; an idempotent replay creates none. */
    int preparationsSince(UUID userId, UUID lockerId, Instant since) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.locker_operations
                WHERE user_id = :user AND locker_id = :locker AND created_at > :since
                """).param("user", userId).param("locker", lockerId).param("since", utc(since))
                .query(Integer.class).single();
    }

    /** The oldest preparation counted by {@link #preparationsSince}: the first to leave the window. */
    Instant oldestPreparationSince(UUID userId, UUID lockerId, Instant since) {
        return jdbc.sql("""
                SELECT min(created_at) FROM aegis.locker_operations
                WHERE user_id = :user AND locker_id = :locker AND created_at > :since
                """).param("user", userId).param("locker", lockerId).param("since", utc(since))
                .query(java.time.OffsetDateTime.class).single().toInstant();
    }

    /** A checkout already waiting for its local proof: no lock command exists, nor may one exist yet. */
    UUID insertCheckout(UUID userId, UUID assetId, Cell cell, UUID reservationId, UUID identifierId, Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, reservation_id,
                     expected_asset_identifier_id, created_at)
                VALUES ('CHECKOUT', 'AWAITING_LOCAL_PROOF', :user, :asset, :locker, :compartment, :reservation,
                        :identifier, :now)
                RETURNING id
                """)
                .param("user", userId)
                .param("asset", assetId)
                .param("locker", cell.lockerId())
                .param("compartment", cell.id())
                .param("reservation", reservationId)
                .param("identifier", identifierId)
                .param("now", utc(now))
                .query(UUID.class).single();
    }

    /** Stores the SHA-256 of the token only; the token itself never reaches a column. */
    UUID insertChallenge(UUID operationId, UUID lockerId, Device device, byte[] tokenHash, Instant now,
            Instant expiresAt) {
        return jdbc.sql("""
                INSERT INTO aegis.local_access_challenges
                    (operation_id, locker_id, locker_device_id, target_device_session_id, token_hash, created_at,
                     expires_at)
                VALUES (:operation, :locker, :device, :session, :hash, :now, :expires)
                RETURNING id
                """)
                .param("operation", operationId)
                .param("locker", lockerId)
                .param("device", device.id())
                .param("session", device.deviceSessionId())
                .param("hash", tokenHash)
                .param("now", utc(now))
                .param("expires", utc(expiresAt))
                .query(UUID.class).single();
    }

    private static Object utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
