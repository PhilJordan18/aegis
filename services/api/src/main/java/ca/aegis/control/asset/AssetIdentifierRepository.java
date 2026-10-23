package ca.aegis.control.asset;

import static ca.aegis.control.asset.AssetModelRepository.instant;
import static ca.aegis.control.asset.AssetModelRepository.utc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Identifiers are revoked, never deleted: their history stays attached to the asset. */
@Repository
class AssetIdentifierRepository {

    private static final String SELECT_IDENTIFIER = """
            SELECT id, asset_id, identifier_type, identifier_value, active, assigned_at, revoked_at
            FROM aegis.asset_identifiers
            """;

    private final JdbcClient jdbc;

    AssetIdentifierRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    UUID insert(UUID assetId, IdentifierType type, String value, Instant now) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:assetId, :type, :value, :now)
                RETURNING id
                """)
                .param("assetId", assetId)
                .param("type", type.name())
                .param("value", value)
                .param("now", utc(now))
                .query(UUID.class)
                .single();
    }

    Optional<AssetIdentifierView> find(UUID id) {
        return jdbc.sql(SELECT_IDENTIFIER + "WHERE id = :id").param("id", id)
                .query(AssetIdentifierRepository::map).optional();
    }

    /** The caller holds the asset lock; this row lock only guards against a writer that skipped it. */
    Optional<AssetIdentifierView> lockOfAsset(UUID assetId, UUID id) {
        return jdbc.sql(SELECT_IDENTIFIER + "WHERE id = :id AND asset_id = :assetId FOR UPDATE")
                .param("id", id)
                .param("assetId", assetId)
                .query(AssetIdentifierRepository::map)
                .optional();
    }

    boolean activeValueExists(IdentifierType type, String value) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.asset_identifiers
                    WHERE identifier_type = :type AND identifier_value = :value AND active)
                """).param("type", type.name()).param("value", value).query(Boolean.class).single();
    }

    void revoke(UUID id, Instant now) {
        jdbc.sql("UPDATE aegis.asset_identifiers SET active = false, revoked_at = :now WHERE id = :id AND active")
                .param("now", utc(now))
                .param("id", id)
                .update();
    }

    private static AssetIdentifierView map(ResultSet row, int rowNumber) throws SQLException {
        return new AssetIdentifierView(
                row.getObject("id", UUID.class),
                row.getObject("asset_id", UUID.class),
                IdentifierType.valueOf(row.getString("identifier_type")),
                row.getString("identifier_value"),
                row.getBoolean("active"),
                instant(row, "assigned_at"),
                instant(row, "revoked_at"));
    }
}
