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
import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Administration of assets (document 09, section 12.2). Lock order: the asset row first, then its model row in
 * shared mode; model archival only locks the model, so the two never wait on each other in a cycle.
 */
@Service
class AdminAssetService {

    private final AssetRepository assets;
    private final AssetModelRepository models;
    private final CatalogAudit audit;
    private final Clock clock;

    AdminAssetService(AssetRepository assets, AssetModelRepository models, CatalogAudit audit, Clock clock) {
        this.assets = assets;
        this.models = models;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    AdminAssetView create(AssetRequest request, UUID actor) {
        requireCoherentCalibration(request);
        requireActiveModel(request.assetModelId());
        Instant now = now();
        UUID id;
        try {
            id = assets.insert(request, now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        AssetRecord created = assets.find(id).orElseThrow();
        audit.assetCreated(created, actor, now);
        return view(created);
    }

    @Transactional(readOnly = true)
    AdminAssetView get(UUID id) {
        return assets.find(id).map(this::view).orElseThrow(ResourceNotFoundException::new);
    }

    /** Every item of a page is evaluated at the same instant (document 09, section 24). */
    @Transactional(readOnly = true)
    PageResponse<AdminAssetView> list(PageQuery page, Optional<String> pattern, AssetSort sort) {
        Instant evaluatedAt = evaluationInstant();
        return PageResponse.of(assets.page(page, pattern, sort).stream()
                .map(asset -> AdminAssetView.of(asset, evaluatedAt))
                .toList(), page, assets.count(pattern));
    }

    /** An identical replacement changes nothing, not even {@code updated_at}. */
    @Transactional
    AdminAssetView replace(UUID id, AssetRequest request, UUID actor) {
        requireCoherentCalibration(request);
        AssetRecord current = assets.lockForUpdate(id).orElseThrow(ResourceNotFoundException::new);
        if (current.archived()) {
            throw new CatalogConflictException(ApiError.ASSET_ARCHIVED);
        }
        requireActiveModel(request.assetModelId());
        if (current.sameAs(request)) {
            return view(current);
        }
        Instant now = now();
        try {
            assets.update(id, request, now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        AssetRecord updated = assets.find(id).orElseThrow();
        audit.assetUpdated(current, updated, actor, now);
        return view(updated);
    }

    /**
     * Archival keeps the asset row, its identifiers and every future reference to it. Archiving an archived asset
     * returns it unchanged and is audited as already applied. Reservations, loans and locker operations do not exist
     * yet; their slices must refuse archival here while one of them is open (document 09, section 12.2).
     */
    @Transactional
    AdminAssetView archive(UUID id, UUID actor) {
        AssetRecord current = assets.lockForUpdate(id).orElseThrow(ResourceNotFoundException::new);
        Instant now = now();
        if (current.archived()) {
            audit.assetArchived(current, actor, now, true);
            return view(current);
        }
        assets.archive(id, now);
        AssetRecord archived = assets.find(id).orElseThrow();
        audit.assetArchived(archived, actor, now, false);
        return view(archived);
    }

    /** Document 08, constraint {@code ck_assets_calibration_pair}, reported as a field error. */
    private static void requireCoherentCalibration(AssetRequest request) {
        if (request.calibrationRequired() && request.calibrationDueAt() == null) {
            throw InvalidRequestException.of("calibrationDueAt", "REQUIRED_WHEN_CALIBRATION_REQUIRED",
                    "L'échéance de calibration est requise lorsque la calibration est exigée.");
        }
        if (!request.calibrationRequired() && request.calibrationDueAt() != null) {
            throw InvalidRequestException.of("calibrationDueAt", "NOT_ALLOWED_WITHOUT_CALIBRATION",
                    "Aucune échéance de calibration n'est acceptée lorsque la calibration n'est pas exigée.");
        }
    }

    /** Holds the model in shared mode until commit, so that it cannot be archived under the new reference. */
    private void requireActiveModel(UUID modelId) {
        boolean active = models.lockForReference(modelId).filter(model -> !model.archived()).isPresent();
        if (!active) {
            throw InvalidRequestException.of("assetModelId", "ASSET_MODEL_NOT_ACTIVE",
                    "Le modèle est introuvable ou archivé.");
        }
    }

    private AdminAssetView view(AssetRecord asset) {
        return AdminAssetView.of(asset, evaluationInstant());
    }

    private Instant evaluationInstant() {
        return clock.instant().truncatedTo(ChronoUnit.SECONDS);
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
