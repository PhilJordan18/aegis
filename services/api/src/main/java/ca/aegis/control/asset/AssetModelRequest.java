package ca.aegis.control.asset;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import ca.aegis.control.shared.web.PlainText;

/**
 * {@code CreateAssetModelRequest} and {@code UpdateAssetModelRequest} of document 09, section 12.1; both carry the
 * same fields. Every field is required: a nullable field must be sent, and an explicit null clears it.
 */
record AssetModelRequest(
        @NotBlank(message = "Le nom est requis.")
        @Size(max = 160, message = "Le nom dépasse 160 caractères.")
        @PlainText(message = "Le nom contient un caractère non autorisé.")
        String name,

        @JsonProperty(required = true)
        @Size(max = 120, message = "Le fabricant dépasse 120 caractères.")
        @PlainText(message = "Le fabricant contient un caractère non autorisé.")
        String manufacturer,

        @JsonProperty(required = true)
        @Size(max = 120, message = "Le numéro de modèle dépasse 120 caractères.")
        @PlainText(message = "Le numéro de modèle contient un caractère non autorisé.")
        String modelNumber,

        @JsonProperty(required = true)
        @Size(max = 2000, message = "La description dépasse 2000 caractères.")
        @PlainText(multiline = true, message = "La description contient un caractère non autorisé.")
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
