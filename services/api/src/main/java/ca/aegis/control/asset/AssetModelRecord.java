package ca.aegis.control.asset;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** A row of {@code aegis.asset_models}. */
record AssetModelRecord(
        UUID id,
        String name,
        String manufacturer,
        String modelNumber,
        String description,
        boolean defaultCalibrationRequired,
        Instant archivedAt) {

    boolean archived() {
        return archivedAt != null;
    }

    /** Whether the request would leave every editable field unchanged. */
    boolean sameAs(AssetModelRequest request) {
        return name.equals(request.name())
                && Objects.equals(manufacturer, request.manufacturer())
                && Objects.equals(modelNumber, request.modelNumber())
                && Objects.equals(description, request.description())
                && defaultCalibrationRequired == request.defaultCalibrationRequired();
    }
}
