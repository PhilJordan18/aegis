package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Body of {@code POST /reservations} (document 09, section 14.1). {@code reservedFrom} is never accepted: the backend
 * takes it from its own clock.
 */
record CreateReservationRequest(
        @NotNull(message = "L'actif est requis.")
        UUID assetId,

        @NotNull(message = "La fin de la réservation est requise.")
        Instant reservedUntil) {
}
