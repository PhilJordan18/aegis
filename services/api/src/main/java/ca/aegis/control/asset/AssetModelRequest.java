package ca.aegis.control.asset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * {@code CreateAssetModelRequest} and {@code UpdateAssetModelRequest} of document 09, section 12.1; both carry the
 * same fields. A nullable field that is omitted is read as null, so a replacement clears it.
 */
record AssetModelRequest(
        @NotBlank(message = "Le nom est requis.")
        @Size(max = 160, message = "Le nom dépasse 160 caractères.")
        String name,

        @Size(max = 120, message = "Le fabricant dépasse 120 caractères.")
        String manufacturer,

        @Size(max = 120, message = "Le numéro de modèle dépasse 120 caractères.")
        String modelNumber,

        @Size(max = 2000, message = "La description dépasse 2000 caractères.")
        String description,

        @NotNull(message = "La calibration par défaut est requise.")
        Boolean defaultCalibrationRequired) {

    AssetModelRequest {
        name = CatalogText.required(name);
        manufacturer = CatalogText.optional(manufacturer);
        modelNumber = CatalogText.optional(modelNumber);
        description = CatalogText.optional(description);
    }
}
