package ca.aegis.control.asset;

import java.time.Instant;
import java.util.UUID;

import ca.aegis.control.identity.AccessLevel;

/**
 * Administrative asset representation (document 09, section 8.9): the technician view without {@code readiness},
 * plus {@code serialNumber} and {@code operationalDiagnostic}. {@code archivedAt} is an addition proposed with
 * CAT-01 so that an archived asset stays recognisable in the administrative list.
 */
public record AdminAssetView(
        UUID id,
        String assetCode,
        String serialNumber,
        AssetModelSummary model,
        AccessLevel requiredAccessLevel,
        OperationalStatus operationalStatus,
        CalibrationView calibration,
        Availability availability,
        Presence presence,
        PlacementSummary placement,
        OperationalDiagnostic operationalDiagnostic,
        Instant archivedAt) {

    static AdminAssetView of(AssetRecord asset, Custody custody, Presence presence, Instant evaluatedAt) {
        AssetConditions conditions = AssetConditions.of(asset, custody, presence, evaluatedAt);
        return new AdminAssetView(asset.id(), asset.assetCode(), asset.serialNumber(), asset.model(),
                asset.requiredAccessLevel(), asset.operationalStatus(),
                new CalibrationView(asset.calibrationRequired(), asset.calibrationDueAt(), conditions.calibration()),
                conditions.availability(), conditions.presence(), asset.placement(),
                new OperationalDiagnostic(evaluatedAt, conditions.diagnosticReasons()), asset.archivedAt());
    }
}
