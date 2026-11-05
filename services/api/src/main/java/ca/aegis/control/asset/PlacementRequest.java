package ca.aegis.control.asset;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import ca.aegis.control.shared.web.PlainText;

/** Body of {@code PUT /admin/assets/{assetId}/placement} (document 09, section 12.4). */
record PlacementRequest(
        @NotNull(message = "Le compartiment est requis.")
        UUID compartmentId,

        @NotBlank(message = "Le motif est requis.")
        @Size(max = 500, message = "Le motif dépasse 500 caractères.")
        @PlainText(message = "Le motif contient un caractère non autorisé.")
        String reason) {

    PlacementRequest {
        reason = CatalogText.required(reason);
    }
}
