package ca.aegis.control.asset;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Repository;

/**
 * Custody facts of assets, read in one statement per kind whatever the page size (document 09, section 24).
 * Reservations and loans are not stored yet: until DB-02, custody comes from archival only.
 */
@Repository
class AssetCustodyRepository {

    Map<UUID, Custody> of(Collection<AssetRecord> assets) {
        return assets.stream().collect(Collectors.toMap(AssetRecord::id,
                asset -> Custody.archivalOnly(asset.archived()), (first, second) -> first));
    }
}
