package ca.aegis.control.audit;

/** The results written so far; the complete list is {@code ck_audit_events_result}. */
public enum AuditResult {
    ACCEPTED,
    /** A request refused by a business rule whose refusal itself changed state, such as a counted wrong secret. */
    REJECTED,
    /** A repeated request found its effect already applied and changed nothing (document 09, section 12.1). */
    ALREADY_APPLIED
}
