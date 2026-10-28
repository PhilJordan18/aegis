package ca.aegis.control.asset;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Personal readiness of an asset (document 09, section 8.1). {@code reasons} are distinct and in the order of
 * {@link ReadinessReason}. {@code READY} has none, {@code UNKNOWN} has only {@code UNKNOWN_PHYSICAL_STATE}, and
 * {@code BLOCKED} has only certain reasons, so an uncertain state never hides a certain block (document 06, section 4).
 */
public record ReadinessAssessment(
        UUID assetId,
        UUID evaluatedForUserId,
        ReadinessResult result,
        List<ReadinessReason> reasons,
        Instant evaluatedAt) {

    public ReadinessAssessment {
        reasons = List.copyOf(reasons);
        for (int i = 1; i < reasons.size(); i++) {
            if (reasons.get(i - 1).compareTo(reasons.get(i)) >= 0) {
                throw new IllegalArgumentException("Reasons must be distinct and in their documented order");
            }
        }
        boolean consistent = switch (result) {
            case READY -> reasons.isEmpty();
            case UNKNOWN -> reasons.equals(List.of(ReadinessReason.UNKNOWN_PHYSICAL_STATE));
            case BLOCKED -> !reasons.isEmpty() && !reasons.contains(ReadinessReason.UNKNOWN_PHYSICAL_STATE);
        };
        if (!consistent) {
            throw new IllegalArgumentException(result + " cannot have the reasons " + reasons);
        }
    }
}
