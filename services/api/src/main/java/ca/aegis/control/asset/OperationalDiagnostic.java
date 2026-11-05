package ca.aegis.control.asset;

import java.time.Instant;
import java.util.List;

/**
 * Non-personal impediments of an asset (document 09, section 8.9). An empty list only means that none was detected;
 * it is not a {@code READY} result and grants nobody a checkout.
 */
public record OperationalDiagnostic(Instant evaluatedAt, List<ReadinessReason> reasons) {

    public OperationalDiagnostic {
        reasons = List.copyOf(reasons);
    }
}
