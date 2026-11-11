package ca.aegis.control.anomaly;

import java.time.Instant;
import java.util.UUID;

import ca.aegis.control.identity.UserSummary;

/** Document 09, section 8.7. The stored {@code details} are never part of it. */
record AnomalyView(
        UUID id,
        AnomalyType type,
        AnomalySeverity severity,
        AnomalyStatus status,
        UUID lockerOperationId,
        UUID assetId,
        UUID compartmentId,
        Instant detectedAt,
        Instant acknowledgedAt,
        UserSummary acknowledgedBy,
        String acknowledgementNote,
        Instant resolvedAt,
        UUID resolutionEvidenceObservationId,
        String resolutionNote,
        String summary) {
}
