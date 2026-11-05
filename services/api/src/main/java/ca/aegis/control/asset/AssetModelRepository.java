package ca.aegis.control.asset;

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

import ca.aegis.control.shared.web.PageQuery;

@Repository
class AssetModelRepository {

    private static final String SELECT_MODEL = """
            SELECT id, name, manufacturer, model_number, description, default_calibration_required, archived_at
            FROM aegis.asset_models
            """;

    private final JdbcClient jdbc;

    AssetModelRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    UUID insert(AssetModelRequest model, Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_models
                    (name, manufacturer, model_number, description, default_calibration_required,
                     created_at, updated_at)
                VALUES (:name, :manufacturer, :modelNumber, :description, :defaultCalibrationRequired, :now, :now)
                RETURNING id
                """)
                .param("name", model.name())
                .param("manufacturer", model.manufacturer())
                .param("modelNumber", model.modelNumber())
                .param("description", model.description())
                .param("defaultCalibrationRequired", model.defaultCalibrationRequired())
                .param("now", utc(now))
                .query((row, number) -> row.getObject("id", UUID.class))
                .single();
    }

    Optional<AssetModelRecord> find(UUID id) {
        return select(SELECT_MODEL + "WHERE id = :id", id);
    }

    /** Serializes edits and archival of one model. */
    Optional<AssetModelRecord> lockForUpdate(UUID id) {
        return select(SELECT_MODEL + "WHERE id = :id FOR UPDATE", id);
    }

    /**
     * Lets several assets reference the model concurrently while blocking its archival until they commit, so that
     * archival always sees them. Waiting here for an archival in progress also makes the active check read the
     * committed archival; the foreign key's own key-share lock would not, since it is taken only at insert time.
     */
    Optional<AssetModelRecord> lockForReference(UUID id) {
        return select(SELECT_MODEL + "WHERE id = :id FOR SHARE", id);
    }

    void update(UUID id, AssetModelRequest model, Instant now) {
        jdbc.sql("""
                UPDATE aegis.asset_models
                SET name = :name, manufacturer = :manufacturer, model_number = :modelNumber,
                    description = :description, default_calibration_required = :defaultCalibrationRequired,
                    updated_at = :now
                WHERE id = :id
                """)
                .param("name", model.name())
                .param("manufacturer", model.manufacturer())
                .param("modelNumber", model.modelNumber())
                .param("description", model.description())
                .param("defaultCalibrationRequired", model.defaultCalibrationRequired())
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    void archive(UUID id, Instant now) {
        jdbc.sql("UPDATE aegis.asset_models SET archived_at = :now, updated_at = :now WHERE id = :id")
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    boolean usedByUnarchivedAsset(UUID id) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.assets WHERE asset_model_id = :id AND archived_at IS NULL
                )
                """)
                .param("id", id)
                .query(Boolean.class)
                .single();
    }

    /** Archived models stay listed so that their assets' history keeps its reference. */
    List<AssetModelRecord> page(PageQuery page) {
        return jdbc.sql(SELECT_MODEL + "ORDER BY lower(name), id LIMIT :limit OFFSET :offset")
                .param("limit", page.size())
                .param("offset", page.offset())
                .query(AssetModelRepository::map)
                .list();
    }

    long count() {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_models").query(Long.class).single();
    }

    private Optional<AssetModelRecord> select(String sql, UUID id) {
        return jdbc.sql(sql).param("id", id).query(AssetModelRepository::map).optional();
    }

    private static AssetModelRecord map(ResultSet row, int rowNumber) throws SQLException {
        return new AssetModelRecord(
                row.getObject("id", UUID.class),
                row.getString("name"),
                row.getString("manufacturer"),
                row.getString("model_number"),
                row.getString("description"),
                row.getBoolean("default_calibration_required"),
                instant(row, "archived_at"));
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
