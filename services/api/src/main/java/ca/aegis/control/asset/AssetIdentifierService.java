package ca.aegis.control.asset;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Physical identifiers of an asset (document 09, section 12.3). Both mutations lock the asset row first, like every
 * catalog mutation of that asset, so assignment, revocation and archival of one asset are serialized. An active
 * {@code type + value} pair belongs to one asset at most; {@code ux_asset_identifiers_active_value} settles a race
 * between two assets.
 */
@Service
class AssetIdentifierService {

    private final AssetRepository assets;
    private final AssetIdentifierRepository identifiers;
    private final CatalogAudit audit;
    private final Clock clock;

    AssetIdentifierService(AssetRepository assets, AssetIdentifierRepository identifiers, CatalogAudit audit,
            Clock clock) {
        this.assets = assets;
        this.identifiers = identifiers;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * An asset carries at most one active identifier of each type (decided on 28 October 2026): a new one revokes the previous
     * one of its type in the same transaction, and both changes are audited. Locker operations do not exist yet; the
     * slice that creates them must refuse here with {@code 409 ASSET_OPERATION_IN_PROGRESS} while a non-terminal
     * operation concerns the asset.
     */
    @Transactional
    AssetIdentifierView assign(UUID assetId, AssetIdentifierRequest request, UUID actor) {
        IdentifierType type = IdentifierType.parse(request.type())
                .orElseThrow(() -> new CatalogConflictException(ApiError.IDENTIFIER_TYPE_UNSUPPORTED));
        AssetRecord asset = assets.lockForUpdate(assetId).orElseThrow(ResourceNotFoundException::new);
        if (asset.archived()) {
            throw new CatalogConflictException(ApiError.ASSET_ARCHIVED);
        }
        if (identifiers.activeValueExists(type, request.value())) {
            throw new CatalogConflictException(ApiError.IDENTIFIER_ALREADY_ASSIGNED);
        }
        Instant now = now();
        Optional<AssetIdentifierView> replaced = identifiers.lockActiveOfType(assetId, type);
        UUID id;
        try {
            replaced.ifPresent(previous -> identifiers.revoke(previous.id(), now));
            id = identifiers.insert(assetId, type, request.value(), now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        replaced.ifPresent(previous -> audit.identifierRevoked(identifiers.find(previous.id()).orElseThrow(), actor,
                now, false));
        AssetIdentifierView assigned = identifiers.find(id).orElseThrow();
        audit.identifierAssigned(assigned, actor, now);
        return assigned;
    }

    /**
     * Revocation keeps the row and its history. Revoking a revoked identifier returns it unchanged and is audited as
     * already applied, like a repeated archival. Locker operations do not exist yet; the slice that creates them must
     * refuse here while a physical operation uses this identifier.
     */
    @Transactional
    AssetIdentifierView revoke(UUID assetId, UUID identifierId, UUID actor) {
        AssetRecord asset = assets.lockForUpdate(assetId).orElseThrow(ResourceNotFoundException::new);
        if (asset.archived()) {
            throw new CatalogConflictException(ApiError.ASSET_ARCHIVED);
        }
        AssetIdentifierView current = identifiers.lockOfAsset(assetId, identifierId)
                .orElseThrow(ResourceNotFoundException::new);
        Instant now = now();
        if (!current.active()) {
            audit.identifierRevoked(current, actor, now, true);
            return current;
        }
        identifiers.revoke(identifierId, now);
        AssetIdentifierView revoked = identifiers.find(identifierId).orElseThrow();
        audit.identifierRevoked(revoked, actor, now, false);
        return revoked;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
