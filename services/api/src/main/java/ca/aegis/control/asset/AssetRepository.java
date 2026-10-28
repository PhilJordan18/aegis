package ca.aegis.control.asset;

import static ca.aegis.control.asset.AssetModelRepository.instant;
import static ca.aegis.control.asset.AssetModelRepository.utc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.shared.web.PageQuery;

/**
 * Assets are always read with their model and their active placement in one query, for a page as for a single
 * asset; {@code ux_asset_placements_one_current_per_asset} keeps that join to one row per asset.
 */
@Repository
class AssetRepository {

    private static final String SELECT_ASSET = """
            SELECT a.id, a.asset_code, a.serial_number, a.required_access_level, a.operational_status,
                   a.calibration_required, a.calibration_due_at, a.archived_at,
                   m.id AS model_id, m.name AS model_name, m.manufacturer AS model_manufacturer,
                   m.model_number AS model_model_number,
                   l.id AS placement_locker_id, l.code AS placement_locker_code,
                   c.id AS placement_compartment_id, c.code AS placement_compartment_code
            FROM aegis.assets a
            JOIN aegis.asset_models m ON m.id = a.asset_model_id
            LEFT JOIN aegis.asset_placements p ON p.asset_id = a.id AND p.removed_at IS NULL
            LEFT JOIN aegis.compartments c ON c.id = p.compartment_id
            LEFT JOIN aegis.lockers l ON l.id = c.locker_id
            """;
    private static final String SEARCH =
            "WHERE (lower(a.asset_code) LIKE :pattern ESCAPE '\\' OR lower(m.name) LIKE :pattern ESCAPE '\\') ";

    private final JdbcClient jdbc;

    AssetRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    UUID insert(AssetRequest asset, Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.assets
                    (asset_model_id, asset_code, serial_number, required_access_level, operational_status,
                     calibration_required, calibration_due_at, created_at, updated_at)
                VALUES (:assetModelId, :assetCode, :serialNumber, :requiredAccessLevel, :operationalStatus,
                        :calibrationRequired, :calibrationDueAt, :now, :now)
                RETURNING id
                """)
                .params(parameters(asset))
                .param("now", utc(now))
                .query((row, number) -> row.getObject("id", UUID.class))
                .single();
    }

    Optional<AssetRecord> find(UUID id) {
        return jdbc.sql(SELECT_ASSET + "WHERE a.id = :id").param("id", id).query(AssetRepository::map).optional();
    }

    /** Serializes edits and archival of one asset; the model row is not locked here. */
    Optional<AssetRecord> lockForUpdate(UUID id) {
        return jdbc.sql(SELECT_ASSET + "WHERE a.id = :id FOR UPDATE OF a")
                .param("id", id)
                .query(AssetRepository::map)
                .optional();
    }

    void update(UUID id, AssetRequest asset, Instant now) {
        jdbc.sql("""
                UPDATE aegis.assets
                SET asset_model_id = :assetModelId, asset_code = :assetCode, serial_number = :serialNumber,
                    required_access_level = :requiredAccessLevel, operational_status = :operationalStatus,
                    calibration_required = :calibrationRequired, calibration_due_at = :calibrationDueAt,
                    updated_at = :now
                WHERE id = :id
                """)
                .params(parameters(asset))
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    void archive(UUID id, Instant now) {
        jdbc.sql("UPDATE aegis.assets SET archived_at = :now, updated_at = :now WHERE id = :id")
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    /** Archived assets stay listed: their history remains reachable from the administration. */
    List<AssetRecord> page(PageQuery page, Optional<String> pattern, AssetSort sort) {
        return search(SELECT_ASSET, pattern, "ORDER BY " + sort.orderBy() + " LIMIT :limit OFFSET :offset")
                .param("limit", page.size())
                .param("offset", page.offset())
                .query(AssetRepository::map)
                .list();
    }

    long count(Optional<String> pattern) {
        String select = "SELECT count(*) FROM aegis.assets a JOIN aegis.asset_models m ON m.id = a.asset_model_id ";
        return search(select, pattern, "").query(Long.class).single();
    }

    private JdbcClient.StatementSpec search(String select, Optional<String> pattern, String suffix) {
        JdbcClient.StatementSpec statement = jdbc.sql(select + (pattern.isPresent() ? SEARCH : "") + suffix);
        return pattern.map(value -> statement.param("pattern", value)).orElse(statement);
    }

    private static Map<String, Object> parameters(AssetRequest asset) {
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("assetModelId", asset.assetModelId());
        parameters.put("assetCode", asset.assetCode());
        parameters.put("serialNumber", asset.serialNumber());
        parameters.put("requiredAccessLevel", asset.requiredAccessLevel().name());
        parameters.put("operationalStatus", asset.operationalStatus().name());
        parameters.put("calibrationRequired", asset.calibrationRequired());
        parameters.put("calibrationDueAt", utc(asset.calibrationDueAt()));
        return parameters;
    }

    private static AssetRecord map(ResultSet row, int rowNumber) throws SQLException {
        return new AssetRecord(
                row.getObject("id", UUID.class),
                new AssetModelSummary(row.getObject("model_id", UUID.class), row.getString("model_name"),
                        row.getString("model_manufacturer"), row.getString("model_model_number")),
                row.getString("asset_code"),
                row.getString("serial_number"),
                AccessLevel.valueOf(row.getString("required_access_level")),
                OperationalStatus.valueOf(row.getString("operational_status")),
                row.getBoolean("calibration_required"),
                instant(row, "calibration_due_at"),
                instant(row, "archived_at"),
                placement(row));
    }

    private static PlacementSummary placement(ResultSet row) throws SQLException {
        UUID compartment = row.getObject("placement_compartment_id", UUID.class);
        return compartment == null ? null : new PlacementSummary(row.getObject("placement_locker_id", UUID.class),
                row.getString("placement_locker_code"), compartment, row.getString("placement_compartment_code"));
    }
}
