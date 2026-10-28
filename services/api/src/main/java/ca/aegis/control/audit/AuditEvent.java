package ca.aegis.control.audit;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * One row of {@code aegis.audit_events}. {@code fromState} and {@code toState} stay null until a subject has a state
 * machine in document 05; the catalog has none.
 *
 * @param details bounded business data serialized to JSON; never a credential, token or request identifier
 * @param occurredAt the instant written by the audited mutation itself
 */
public record AuditEvent(AuditEventType type, UUID actorUserId, AuditSubjectType subjectType, UUID subjectId,
        AuditResult result, Map<String, ?> details, Instant occurredAt) {

    public AuditEvent {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(subjectType, "subjectType");
        Objects.requireNonNull(subjectId, "subjectId");
        Objects.requireNonNull(details, "details");
        Objects.requireNonNull(occurredAt, "occurredAt");
    }
}
