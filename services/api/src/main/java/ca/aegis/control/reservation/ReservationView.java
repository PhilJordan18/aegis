package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;

/**
 * Document 09, section 8.3.
 *
 * @param availableActions {@code CANCEL} when the cancellation would be accepted at the time of the response (section
 *        8.10); {@code CHECKOUT} arrives with the checkout route
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
