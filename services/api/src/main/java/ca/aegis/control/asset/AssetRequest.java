package ca.aegis.control.asset;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import ca.aegis.control.identity.AccessLevel;

/**
 * {@code CreateAssetRequest} and {@code UpdateAssetRequest} of document 09, section 12.2. Readiness, availability
 * and presence are derived and have no field here; an unknown field is refused like any other.
 */
record AssetRequest(
        @NotNull(message = "Le modèle est requis.")
        UUID assetModelId,

        @NotBlank(message = "Le code d'actif est requis.")
        @Size(max = 64, message = "Le code d'actif dépasse 64 caractères.")
        String assetCode,

        @JsonProperty(required = true)
        @Size(max = 120, message = "Le numéro de série dépasse 120 caractères.")
        String serialNumber,

        @NotNull(message = "Le niveau d'accès requis est obligatoire.")
        AccessLevel requiredAccessLevel,

        @NotNull(message = "L'état opérationnel est requis.")
        OperationalStatus operationalStatus,

        @NotNull(message = "L'exigence de calibration est requise.")
        Boolean calibrationRequired,

        @JsonProperty(required = true)
        Instant calibrationDueAt) {

    AssetRequest {
        assetCode = CatalogText.required(assetCode);
        serialNumber = CatalogText.optional(serialNumber);
        // PostgreSQL keeps microseconds; storing the same precision makes an identical replacement a no-op.
        calibrationDueAt = calibrationDueAt == null ? null : calibrationDueAt.truncatedTo(ChronoUnit.MICROS);
    }
}
