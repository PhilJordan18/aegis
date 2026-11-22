package ca.aegis.control.loan;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;

/**
 * Document 09, section 8.4.
 *
 * @param overdue derived on each read (document 06, section 14.3); it never closes the loan or frees the asset
 * @param availableActions {@code ["RETURN"]} for the holder when a return would be accepted now, otherwise empty;
 *        always empty in an administrator view (section 8.10)
 */
public record LoanView(
        UUID id,
        AssetSummary asset,
        UUID holderUserId,
        LoanStatus status,
        Instant checkedOutAt,
        Instant dueAt,
        boolean overdue,
        Instant returnRequestedAt,
        Instant returnedAt,
        UUID checkoutOperationId,
        UUID returnOperationId,
        UUID currentOperationId,
        List<String> availableActions) {
}
