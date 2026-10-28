package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;

/**
 * Document 09, section 8.3.
 *
 * @param availableActions always empty in this slice: no reservation mutation route exists yet, so none is admissible
 *        (section 8.10); the cancellation and checkout slices add {@code CANCEL} and {@code CHECKOUT}
 */
public record ReservationView(
        UUID id,
        AssetSummary asset,
        UUID userId,
        ReservationStatus status,
        Instant reservedFrom,
        Instant reservedUntil,
        Instant createdAt,
        Instant cancelledAt,
        Instant fulfilledAt,
        Instant expiredAt,
        UUID currentOperationId,
        List<String> availableActions) {
}
