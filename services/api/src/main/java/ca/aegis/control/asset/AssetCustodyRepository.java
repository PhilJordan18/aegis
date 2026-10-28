package ca.aegis.control.asset;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.shared.web.ApiError;

/**
 * Custody facts of assets (document 03, section 5.2), from the stored states of document 08: a reservation counts
 * while {@code ACTIVE}, a loan while {@code ACTIVE} or {@code RETURN_PENDING}, whatever its due date, so a late loan
 * never frees an asset. A page costs two statements whatever its size (document 09, section 24); callers run them
 * in the same read-only snapshot as the asset rows. The indexes {@code ux_reservations_one_active_per_asset} and
 * {@code ux_loans_one_open_per_asset} serve both lookups and keep them to one row per asset.
 */
@Repository
class AssetCustodyRepository {

    private static final String ACTIVE_RESERVATIONS =
            "SELECT asset_id, user_id FROM aegis.reservations WHERE status = 'ACTIVE' AND asset_id IN (:ids)";
    private static final String OPEN_LOANS =
            "SELECT asset_id FROM aegis.loans WHERE status IN ('ACTIVE', 'RETURN_PENDING') AND asset_id IN (:ids)";

    private final JdbcClient jdbc;

    AssetCustodyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The custody that forbids archiving the asset (document 09, section 12.2), in the order the refusal reports it:
     * an active reservation, an unfinished loan, then a non-terminal locker operation. The rows found are locked
     * after the asset row, in the order of document 08, section 7.1, so that none of them ends or starts unseen
     * while the archival decides.
     */
    Optional<ApiError> archivalBlocker(UUID assetId) {
        if (exists("SELECT id FROM aegis.reservations WHERE asset_id = :id AND status = 'ACTIVE' FOR UPDATE",
                assetId)) {
            return Optional.of(ApiError.ASSET_ALREADY_RESERVED);
        }
        if (exists("""
                SELECT id FROM aegis.loans WHERE asset_id = :id AND status IN ('ACTIVE', 'RETURN_PENDING') FOR UPDATE
                """, assetId)) {
            return Optional.of(ApiError.ASSET_HAS_OPEN_LOAN);
        }
        if (exists("""
                SELECT id FROM aegis.locker_operations
                WHERE asset_id = :id AND status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY') FOR UPDATE
                """, assetId)) {
            return Optional.of(ApiError.ASSET_OPERATION_IN_PROGRESS);
        }
        return Optional.empty();
    }

    private boolean exists(String sql, UUID assetId) {
        return !jdbc.sql(sql).param("id", assetId).query(UUID.class).list().isEmpty();
    }

    /** Custody of one asset, for a detail or a mutation result. */
    Custody of(AssetRecord asset) {
        return of(List.of(asset)).get(asset.id());
    }

    /** Custody of every given asset, in two statements; an empty collection reads nothing. */
    Map<UUID, Custody> of(Collection<AssetRecord> assets) {
        if (assets.isEmpty()) {
            return Map.of();
        }
        Set<UUID> ids = new HashSet<>();
        assets.forEach(asset -> ids.add(asset.id()));
        Map<UUID, UUID> holders = new HashMap<>();
        jdbc.sql(ACTIVE_RESERVATIONS).param("ids", ids).query(row -> {
            holders.put(row.getObject("asset_id", UUID.class), row.getObject("user_id", UUID.class));
        });
        Set<UUID> borrowed = jdbc.sql(OPEN_LOANS).param("ids", ids).query(UUID.class).set();
        Map<UUID, Custody> custody = new HashMap<>();
        for (AssetRecord asset : assets) {
            custody.putIfAbsent(asset.id(),
                    new Custody(asset.archived(), holders.get(asset.id()), borrowed.contains(asset.id())));
        }
        return custody;
    }
}
