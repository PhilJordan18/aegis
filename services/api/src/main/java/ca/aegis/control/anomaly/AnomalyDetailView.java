package ca.aegis.control.anomaly;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.identity.UserSummary;

/** {@link AnomalyView} with the {@code evidence} section of document 09, section 18.1, for the detail route only. */
record AnomalyDetailView(
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
        String summary,
        List<EvidenceView> evidence) {

    static AnomalyDetailView of(AnomalyView view, List<EvidenceView> evidence) {
        return new AnomalyDetailView(view.id(), view.type(), view.severity(), view.status(), view.lockerOperationId(),
                view.assetId(), view.compartmentId(), view.detectedAt(), view.acknowledgedAt(), view.acknowledgedBy(),
                view.acknowledgementNote(), view.resolvedAt(), view.resolutionEvidenceObservationId(),
                view.resolutionNote(), view.summary(), List.copyOf(evidence));
    }
}
