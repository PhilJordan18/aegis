package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.identity.UserSummary;

/**
 * The administrative operation of document 09, section 17: {@link LockerOperationView} plus {@code user} after
 * {@code userId} and {@code asset} after {@code assetId}, both never null (R7, #48). The technician's
 * {@link LockerOperationView} is unchanged.
 */
record AdminLockerOperationView(
        UUID id,
        LockerOperationType type,
        LockerOperationStatus status,
        UUID userId,
        UserSummary user,
        UUID assetId,
        AssetSummary asset,
        UUID lockerId,
        UUID compartmentId,
        UUID reservationId,
        UUID loanId,
        Instant createdAt,
        Instant authorizedAt,
        UUID localAccessChallengeId,
        Instant localProofExpiresAt,
        Instant localProofDisplayedAt,
        Instant localProofValidatedAt,
        RequiredAction requiredAction,
        Instant expiresAt,
        Instant commandSentAt,
        Instant acknowledgedAt,
        Instant doorOpenedAt,
        Instant observationReceivedAt,
        Instant confirmedAt,
        Instant terminalAt,
        String failureReason,
        UUID anomalyId) {

    static AdminLockerOperationView of(LockerOperationView o, UserSummary user, AssetSummary asset) {
        return new AdminLockerOperationView(o.id(), o.type(), o.status(), o.userId(), user, o.assetId(), asset,
                o.lockerId(), o.compartmentId(), o.reservationId(), o.loanId(), o.createdAt(), o.authorizedAt(),
                o.localAccessChallengeId(), o.localProofExpiresAt(), o.localProofDisplayedAt(),
                o.localProofValidatedAt(), o.requiredAction(), o.expiresAt(), o.commandSentAt(), o.acknowledgedAt(),
                o.doorOpenedAt(), o.observationReceivedAt(), o.confirmedAt(), o.terminalAt(), o.failureReason(),
                o.anomalyId());
    }
}
