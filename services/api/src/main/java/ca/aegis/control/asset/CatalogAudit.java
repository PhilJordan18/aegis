package ca.aegis.control.asset;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.stereotype.Component;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;

/**
 * Audit events of the catalog mutations, written in their transaction. Details hold only catalog fields, bounded by
 * their own validation limits: a snapshot for a creation, the changed fields with their previous and new values for
 * an update, the archival instant for an archival. No event is written for a change that did not happen.
 */
@Component
class CatalogAudit {

    private final AuditTrail trail;

    CatalogAudit(AuditTrail trail) {
        this.trail = trail;
    }

    void modelCreated(AssetModelRecord model, UUID actor, Instant at) {
        record(AuditEventType.ASSET_CREATED, AuditSubjectType.ASSET_MODEL, model.id(), actor, AuditResult.ACCEPTED,
                Map.of("created", snapshot(model)), at);
    }

    void modelUpdated(AssetModelRecord before, AssetModelRecord after, UUID actor, Instant at) {
        record(AuditEventType.ASSET_UPDATED, AuditSubjectType.ASSET_MODEL, after.id(), actor, AuditResult.ACCEPTED,
                Map.of("changes", changes(snapshot(before), snapshot(after))), at);
    }

    void modelArchived(AssetModelRecord model, UUID actor, Instant at, boolean alreadyArchived) {
        archived(AuditSubjectType.ASSET_MODEL, model.id(), model.archivedAt(), actor, at, alreadyArchived);
    }

    void assetCreated(AssetRecord asset, UUID actor, Instant at) {
        record(AuditEventType.ASSET_CREATED, AuditSubjectType.ASSET, asset.id(), actor, AuditResult.ACCEPTED,
                Map.of("created", snapshot(asset)), at);
    }

    void assetUpdated(AssetRecord before, AssetRecord after, UUID actor, Instant at) {
        record(AuditEventType.ASSET_UPDATED, AuditSubjectType.ASSET, after.id(), actor, AuditResult.ACCEPTED,
                Map.of("changes", changes(snapshot(before), snapshot(after))), at);
    }

    void assetArchived(AssetRecord asset, UUID actor, Instant at, boolean alreadyArchived) {
        archived(AuditSubjectType.ASSET, asset.id(), asset.archivedAt(), actor, at, alreadyArchived);
    }

    void identifierAssigned(AssetIdentifierView identifier, UUID actor, Instant at) {
        record(AuditEventType.ASSET_IDENTIFIER_ASSIGNED, AuditSubjectType.ASSET_IDENTIFIER, identifier.id(), actor,
                AuditResult.ACCEPTED, Map.of("assigned", snapshot(identifier)), at);
    }

    /**
     * Document 08 has no revocation event type; {@code ASSET_UPDATED} on the identifier is the closest one. Like a
     * repeated archival, a repeated revocation keeps the first {@code revokedAt} and is {@code ALREADY_APPLIED}.
     */
    void identifierRevoked(AssetIdentifierView identifier, UUID actor, Instant at, boolean alreadyRevoked) {
        record(AuditEventType.ASSET_UPDATED, AuditSubjectType.ASSET_IDENTIFIER, identifier.id(), actor,
                alreadyRevoked ? AuditResult.ALREADY_APPLIED : AuditResult.ACCEPTED,
                Map.of("revoked", snapshot(identifier), "revokedAt", identifier.revokedAt().toString()), at);
    }

    /** A repeated archival keeps the first {@code archivedAt} and is recorded as {@code ALREADY_APPLIED}. */
    private void archived(AuditSubjectType subjectType, UUID id, Instant archivedAt, UUID actor, Instant at,
            boolean alreadyArchived) {
        record(AuditEventType.ASSET_ARCHIVED, subjectType, id, actor,
                alreadyArchived ? AuditResult.ALREADY_APPLIED : AuditResult.ACCEPTED,
                Map.of("archivedAt", archivedAt.toString()), at);
    }

    private void record(AuditEventType type, AuditSubjectType subjectType, UUID id, UUID actor, AuditResult result,
            Map<String, ?> details, Instant at) {
        trail.record(new AuditEvent(type, actor, subjectType, id, result, details, at));
    }

    private static Map<String, Object> snapshot(AssetModelRecord model) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", model.name());
        fields.put("manufacturer", model.manufacturer());
        fields.put("modelNumber", model.modelNumber());
        fields.put("description", model.description());
        fields.put("defaultCalibrationRequired", model.defaultCalibrationRequired());
        return fields;
    }

    private static Map<String, Object> snapshot(AssetRecord asset) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("assetModelId", asset.model().id().toString());
        fields.put("assetCode", asset.assetCode());
        fields.put("serialNumber", asset.serialNumber());
        fields.put("requiredAccessLevel", asset.requiredAccessLevel().name());
        fields.put("operationalStatus", asset.operationalStatus().name());
        fields.put("calibrationRequired", asset.calibrationRequired());
        fields.put("calibrationDueAt", asset.calibrationDueAt() == null ? null : asset.calibrationDueAt().toString());
        return fields;
    }

    private static Map<String, Object> snapshot(AssetIdentifierView identifier) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("assetId", identifier.assetId().toString());
        fields.put("type", identifier.type().name());
        fields.put("value", identifier.value());
        return fields;
    }

    private static Map<String, Object> changes(Map<String, Object> before, Map<String, Object> after) {
        Map<String, Object> changes = new LinkedHashMap<>();
        before.forEach((field, previous) -> {
            Object next = after.get(field);
            if (!Objects.equals(previous, next)) {
                Map<String, Object> change = new LinkedHashMap<>();
                change.put("from", previous);
                change.put("to", next);
                changes.put(field, change);
            }
        });
        return changes;
    }
}
