package ca.aegis.control.asset;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import ca.aegis.control.identity.AccessLevel;

/** A row of {@code aegis.assets} with the summary of its model. */
record AssetRecord(
        UUID id,
        AssetModelSummary model,
        String assetCode,
        String serialNumber,
        AccessLevel requiredAccessLevel,
        OperationalStatus operationalStatus,
        boolean calibrationRequired,
        Instant calibrationDueAt,
        Instant archivedAt) {

    boolean archived() {
        return archivedAt != null;
    }

    /** Whether the request would leave every editable field unchanged. */
    boolean sameAs(AssetRequest request) {
        return model.id().equals(request.assetModelId())
                && assetCode.equals(request.assetCode())
                && Objects.equals(serialNumber, request.serialNumber())
                && requiredAccessLevel == request.requiredAccessLevel()
                && operationalStatus == request.operationalStatus()
                && calibrationRequired == request.calibrationRequired()
                && Objects.equals(calibrationDueAt, request.calibrationDueAt());
    }
}
