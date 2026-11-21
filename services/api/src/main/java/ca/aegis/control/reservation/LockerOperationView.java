package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.UUID;

/**
 * Document 09, section 8.5. It names the local access challenge by its id and instants only: neither the token, nor
 * its hash, nor the display payload is ever part of it.
 *
 * @param anomalyId the latest anomaly raised for this operation, if any
 */
record LockerOperationView(
        UUID id,
        LockerOperationType type,
        LockerOperationStatus status,
        UUID userId,
        UUID assetId,
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
}
