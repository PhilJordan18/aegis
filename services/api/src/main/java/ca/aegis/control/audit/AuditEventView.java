package ca.aegis.control.audit;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import ca.aegis.control.identity.UserSummary;

/**
 * An audit event as administrators read it (document 09, section 19.1). {@code actor} is null for a decision of the
 * backend itself (rule D8 approved on 11 November 2026, #67); {@code details} are filtered by
 * {@link AuditDetailsFilter}.
 */
public record AuditEventView(UUID id, String eventType, UserSummary actor, String subjectType, UUID subjectId,
        UUID operationId, String fromState, String toState, String result, String reason, Instant occurredAt,
        Map<String, Object> details) {
}
