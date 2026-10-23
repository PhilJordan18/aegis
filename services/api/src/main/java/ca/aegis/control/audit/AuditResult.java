package ca.aegis.control.audit;

/** The results written so far; the complete list is {@code ck_audit_events_result}. */
public enum AuditResult {
    ACCEPTED,
    /** A repeated request found its effect already applied and changed nothing (document 09, section 12.1). */
    ALREADY_APPLIED
}
