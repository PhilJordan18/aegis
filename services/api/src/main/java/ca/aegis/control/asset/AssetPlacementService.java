package ca.aegis.control.asset;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Expected placement of an asset (document 09, section 12.4; document 04, section 4.2). A change ends the previous
 * placement instead of deleting it. Lock order: the asset row, then the target and previous compartments in
 * identifier order; the partial unique indexes of V003 remain the final guard.
 */
@Service
class AssetPlacementService {

    private final AssetRepository assets;
    private final AssetPlacementRepository placements;
    private final CatalogAudit audit;
    private final Clock clock;

    AssetPlacementService(AssetRepository assets, AssetPlacementRepository placements, CatalogAudit audit,
            Clock clock) {
        this.assets = assets;
        this.placements = placements;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Placing an asset where it already is changes nothing, not even the reason, and writes no event. Reservations,
     * loans and locker operations do not exist yet; their slices must refuse a placement change here while one of
     * them is active, open or non-terminal for the asset.
     */
    @Transactional
    AssetPlacementView place(UUID assetId, PlacementRequest request, UUID actor) {
        AssetRecord asset = assets.lockForUpdate(assetId).orElseThrow(ResourceNotFoundException::new);
        if (asset.archived()) {
            throw new CatalogConflictException(ApiError.ASSET_ARCHIVED);
        }
        Optional<AssetPlacementView> previous = placements.currentOf(assetId);
        if (previous.filter(current -> current.compartmentId().equals(request.compartmentId())).isPresent()) {
            return previous.get();
        }
        Set<UUID> touched = new LinkedHashSet<>();
        touched.add(request.compartmentId());
        previous.ifPresent(current -> touched.add(current.compartmentId()));
        CompartmentRecord target = placements.lockCompartments(touched).stream()
                .filter(compartment -> compartment.id().equals(request.compartmentId()))
                .findFirst()
                .orElseThrow(() -> InvalidRequestException.of("compartmentId", "COMPARTMENT_NOT_FOUND",
                        "Le compartiment est introuvable."));
        if (!target.enabled()) {
            throw new CatalogConflictException(ApiError.COMPARTMENT_DISABLED);
        }
        if (placements.currentOccupant(target.id()).isPresent()) {
            throw new CatalogConflictException(ApiError.COMPARTMENT_ALREADY_OCCUPIED);
        }
        Instant now = now();
        UUID id;
        try {
            previous.ifPresent(current -> placements.end(current.id(), now));
            id = placements.insert(assetId, target.id(), request.reason(), now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        AssetPlacementView placed = placements.find(id).orElseThrow();
        audit.placementChanged(assetId, previous.orElse(null), placed, actor, now);
        return placed;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
