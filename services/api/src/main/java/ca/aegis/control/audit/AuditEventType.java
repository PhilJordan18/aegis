package ca.aegis.control.audit;

/** The event types written so far; the complete list is {@code ck_audit_events_type} (document 08, section 4.9). */
public enum AuditEventType {
    ASSET_CREATED,
    ASSET_UPDATED,
    ASSET_ARCHIVED,
    ASSET_IDENTIFIER_ASSIGNED,
    ASSET_PLACEMENT_CHANGED,
    SCHEDULE_UPDATED,
    RESERVATION_CREATED
}
