package ca.aegis.control.asset;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Personal readiness of an asset (document 09, section 8.1). {@code reasons} are distinct and in the order of
 * {@link ReadinessReason}; {@code READY} always has none.
 */
public record ReadinessAssessment(
        UUID assetId,
        UUID evaluatedForUserId,
        ReadinessResult result,
        List<ReadinessReason> reasons,
        Instant evaluatedAt) {

    public ReadinessAssessment {
        reasons = List.copyOf(reasons);
        if ((result == ReadinessResult.READY) != reasons.isEmpty()) {
            throw new IllegalArgumentException("READY, and only READY, has no reason");
        }
    }
}
