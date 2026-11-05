package ca.aegis.control.asset;

import java.time.Instant;
import java.util.UUID;

/**
 * Administrative model representation ({@code AssetModelView}, document 09, section 12.1): the request fields with
 * the identifier and the archival instant.
 */
public record AssetModelView(
        UUID id,
        String name,
        String manufacturer,
        String modelNumber,
        String description,
        boolean defaultCalibrationRequired,
        Instant archivedAt) {

    static AssetModelView of(AssetModelRecord model) {
        return new AssetModelView(model.id(), model.name(), model.manufacturer(), model.modelNumber(),
                model.description(), model.defaultCalibrationRequired(), model.archivedAt());
    }
}
