package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.identity.UserSummary;

/**
 * The administrative reservation of document 09, section 17: {@link ReservationView} plus {@code user}, the summary
 * of {@code userId}, added by rule G1 approved on 11 November 2026 (#67). Never null, since every reservation has a
 * user. The technician's {@link ReservationView} is unchanged.
 */
public record AdminReservationView(
        UUID id,
        AssetSummary asset,
        UUID userId,
        UserSummary user,
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
