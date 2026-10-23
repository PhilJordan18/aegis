package ca.aegis.control.asset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import ca.aegis.control.shared.web.PlainText;

/**
 * Body of {@code POST /admin/assets/{assetId}/identifiers} (document 09, section 12.3). {@code type} stays a string
 * here so that an unknown technology is answered {@code 422 IDENTIFIER_TYPE_UNSUPPORTED} rather than as a malformed
 * body. The value is compared exactly, as a reader reports it; only outer spaces are removed.
 */
record AssetIdentifierRequest(
        @NotBlank(message = "Le type d'identifiant est requis.")
        String type,

        @NotBlank(message = "La valeur de l'identifiant est requise.")
        @Size(max = 128, message = "La valeur de l'identifiant dépasse 128 caractères.")
        @PlainText(message = "La valeur de l'identifiant contient un caractère non autorisé.")
        String value) {

    AssetIdentifierRequest {
        value = CatalogText.required(value);
    }
}
