package ca.aegis.control.asset;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Administration of asset models (document 09, section 12.1). A model is never deleted: archival keeps it as the
 * reference of its assets' history and frees its name for a new active model.
 */
@Service
class AssetModelService {

    private final AssetModelRepository models;
    private final CatalogAudit audit;
    private final Clock clock;

    AssetModelService(AssetModelRepository models, CatalogAudit audit, Clock clock) {
        this.models = models;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    AssetModelView create(AssetModelRequest request, UUID actor) {
        Instant now = now();
        UUID id;
        try {
            id = models.insert(request, now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        AssetModelRecord created = models.find(id).orElseThrow();
        audit.modelCreated(created, actor, now);
        return AssetModelView.of(created);
    }

    @Transactional(readOnly = true)
    AssetModelView get(UUID id) {
        return models.find(id).map(AssetModelView::of).orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional(readOnly = true)
    PageResponse<AssetModelView> list(PageQuery page) {
        return PageResponse.of(models.page(page).stream().map(AssetModelView::of).toList(), page, models.count());
    }

    /** An identical replacement changes nothing, not even {@code updated_at} (document 09, section 12.1). */
    @Transactional
    AssetModelView replace(UUID id, AssetModelRequest request, UUID actor) {
        AssetModelRecord current = models.lockForUpdate(id).orElseThrow(ResourceNotFoundException::new);
        if (current.archived()) {
            throw new CatalogConflictException(ApiError.ASSET_MODEL_ARCHIVED);
        }
        if (current.sameAs(request)) {
            return AssetModelView.of(current);
        }
        Instant now = now();
        try {
            models.update(id, request, now);
        } catch (DataIntegrityViolationException violation) {
            throw CatalogConflictException.translate(violation);
        }
        AssetModelRecord updated = models.find(id).orElseThrow();
        audit.modelUpdated(current, updated, actor, now);
        return AssetModelView.of(updated);
    }

    /**
     * The model row lock waits for any transaction that references the model for a new or edited asset, so the
     * usage check below sees those assets once they commit. Archiving an archived model returns it unchanged and is
     * audited as already applied.
     */
    @Transactional
    AssetModelView archive(UUID id, UUID actor) {
        AssetModelRecord current = models.lockForUpdate(id).orElseThrow(ResourceNotFoundException::new);
        Instant now = now();
        if (current.archived()) {
            audit.modelArchived(current, actor, now, true);
            return AssetModelView.of(current);
        }
        if (models.usedByUnarchivedAsset(id)) {
            throw new CatalogConflictException(ApiError.ASSET_MODEL_IN_USE);
        }
        models.archive(id, now);
        AssetModelRecord archived = models.find(id).orElseThrow();
        audit.modelArchived(archived, actor, now, false);
        return AssetModelView.of(archived);
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
