package ca.aegis.control.audit;

/** The subject types written so far; the complete list is {@code ck_audit_events_subject_type}. */
public enum AuditSubjectType {
    ASSET_MODEL,
    ASSET,
    ASSET_IDENTIFIER,
    OPERATING_SCHEDULE,
    RESERVATION,
    LOAN,
    LOCKER_OPERATION,
    COMMAND_OUTBOX,
    ANOMALY,
    LOCAL_ACCESS_CHALLENGE,
    HUB_DISPLAY_OUTBOX,
    INBOUND_DEVICE_MESSAGE
}
