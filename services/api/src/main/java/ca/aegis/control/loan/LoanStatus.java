package ca.aegis.control.loan;

/** Document 05, section 4: a loan stays open, ACTIVE or RETURN_PENDING, until a confirmed return completes it. */
public enum LoanStatus {
    ACTIVE,
    RETURN_PENDING,
    COMPLETED
}
