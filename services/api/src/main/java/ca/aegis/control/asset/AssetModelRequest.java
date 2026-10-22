package ca.aegis.control.asset;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * {@code CreateAssetModelRequest} and {@code UpdateAssetModelRequest} of document 09, section 12.1; both carry the
 * same fields. Every field is required: a nullable field must be sent, and an explicit null clears it.
 */
record AssetModelRequest(
        @NotBlank(message = "Le nom est requis.")
        @Size(max = 160, message = "Le nom dépasse 160 caractères.")
        String name,

        @JsonProperty(required = true)
        @Size(max = 120, message = "Le fabricant dépasse 120 caractères.")
        String manufacturer,

        @JsonProperty(required = true)
        @Size(max = 120, message = "Le numéro de modèle dépasse 120 caractères.")
        String modelNumber,

        @JsonProperty(required = true)
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
