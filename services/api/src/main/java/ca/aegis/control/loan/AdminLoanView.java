package ca.aegis.control.loan;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.identity.UserSummary;

/**
 * The administrative loan of document 09, section 17: {@link LoanView} plus {@code holder}, the summary of
 * {@code holderUserId}, added by rule G1 approved on 11 November 2026 (#67). Never null, since every loan has a
 * holder. The technician's {@link LoanView} is unchanged.
 */
public record AdminLoanView(
        UUID id,
        AssetSummary asset,
        UUID holderUserId,
        UserSummary holder,
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

    static AdminLoanView of(LoanView loan, UserSummary holder) {
        return new AdminLoanView(loan.id(), loan.asset(), loan.holderUserId(), holder, loan.status(),
                loan.checkedOutAt(), loan.dueAt(), loan.overdue(), loan.returnRequestedAt(), loan.returnedAt(),
                loan.checkoutOperationId(), loan.returnOperationId(), loan.currentOperationId(),
                loan.availableActions());
    }
}
