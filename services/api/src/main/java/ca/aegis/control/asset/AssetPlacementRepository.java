package ca.aegis.control.asset;

import static ca.aegis.control.asset.AssetModelRepository.instant;
import static ca.aegis.control.asset.AssetModelRepository.utc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Placements are ended, never deleted: the expected-location history of an asset stays complete. */
@Repository
class AssetPlacementRepository {

    private static final String SELECT_PLACEMENT = """
            SELECT p.id, p.asset_id, l.id AS locker_id, l.code AS locker_code, c.id AS compartment_id,
                   c.code AS compartment_code, p.assigned_at, p.reason
            FROM aegis.asset_placements p
            JOIN aegis.compartments c ON c.id = p.compartment_id
            JOIN aegis.lockers l ON l.id = c.locker_id
            """;

    private final JdbcClient jdbc;

    AssetPlacementRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Locks the compartments in identifier order, after the asset row (document 08, section 7.1), so that two
     * placements touching the same compartment are serialized without deadlock. The lock does not block the foreign
     * key checks of other writers.
     */
    List<CompartmentRecord> lockCompartments(Collection<UUID> ids) {
        return jdbc.sql("""
                SELECT id, locker_id, code, enabled FROM aegis.compartments
                WHERE id IN (:ids) ORDER BY id FOR NO KEY UPDATE
                """)
                .param("ids", ids)
                .query((row, number) -> new CompartmentRecord(row.getObject("id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getString("code"), row.getBoolean("enabled")))
                .list();
    }

    Optional<AssetPlacementView> currentOf(UUID assetId) {
        return jdbc.sql(SELECT_PLACEMENT + "WHERE p.asset_id = :assetId AND p.removed_at IS NULL")
                .param("assetId", assetId).query(AssetPlacementRepository::map).optional();
    }

    Optional<UUID> currentOccupant(UUID compartmentId) {
        return jdbc.sql("""
                SELECT asset_id FROM aegis.asset_placements WHERE compartment_id = :id AND removed_at IS NULL
                """).param("id", compartmentId).query(UUID.class).optional();
    }

    Optional<AssetPlacementView> find(UUID id) {
        return jdbc.sql(SELECT_PLACEMENT + "WHERE p.id = :id").param("id", id)
                .query(AssetPlacementRepository::map).optional();
    }

    UUID insert(UUID assetId, UUID compartmentId, String reason, Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                VALUES (:assetId, :compartmentId, :reason, :now)
                RETURNING id
                """)
                .param("assetId", assetId)
                .param("compartmentId", compartmentId)
                .param("reason", reason)
                .param("now", utc(now))
                .query(UUID.class)
                .single();
    }

    void end(UUID id, Instant now) {
        jdbc.sql("UPDATE aegis.asset_placements SET removed_at = :now WHERE id = :id AND removed_at IS NULL")
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    private static AssetPlacementView map(ResultSet row, int rowNumber) throws SQLException {
        return new AssetPlacementView(
                row.getObject("id", UUID.class),
                row.getObject("asset_id", UUID.class),
                row.getObject("locker_id", UUID.class),
                row.getString("locker_code"),
                row.getObject("compartment_id", UUID.class),
                row.getString("compartment_code"),
                instant(row, "assigned_at"),
                row.getString("reason"));
    }
}
