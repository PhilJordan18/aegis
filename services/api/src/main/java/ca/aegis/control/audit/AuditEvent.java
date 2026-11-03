package ca.aegis.control.audit;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * One row of {@code aegis.audit_events}. {@code fromState} and {@code toState} are set together for a transition of
 * a state machine of document 05, as {@code ck_audit_events_state_pair} requires, and stay null otherwise; the
 * catalog has no state machine.
 *
 * @param actorUserId the human actor, or {@code null} for a decision of the backend itself, such as an expiry
 * @param operationId the locker operation concerned, if any (document 06, section 16.2)
 * @param reason the machine-readable reason of the decision, if any
 * @param details bounded business data serialized to JSON; never a credential, token or request identifier
 * @param occurredAt the instant written by the audited mutation itself
 */
public record AuditEvent(AuditEventType type, UUID actorUserId, AuditSubjectType subjectType, UUID subjectId,
        UUID operationId, String fromState, String toState, AuditResult result, String reason,
        Map<String, ?> details, Instant occurredAt) {

    public AuditEvent {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(subjectType, "subjectType");
        Objects.requireNonNull(subjectId, "subjectId");
        Objects.requireNonNull(details, "details");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if ((fromState == null) != (toState == null)) {
            throw new IllegalArgumentException("A transition records both its states, or neither");
        }
    }

    /** An event that is not a state transition and concerns no locker operation. */
    public AuditEvent(AuditEventType type, UUID actorUserId, AuditSubjectType subjectType, UUID subjectId,
            AuditResult result, Map<String, ?> details, Instant occurredAt) {
        this(type, actorUserId, subjectType, subjectId, null, null, null, result, null, details, occurredAt);
    }

    /** A transition of {@code subjectId} from {@code fromState} to {@code toState}. */
    public static AuditEvent transition(AuditEventType type, UUID actorUserId, AuditSubjectType subjectType,
            UUID subjectId, UUID operationId, Enum<?> fromState, Enum<?> toState, String reason,
            Map<String, ?> details, Instant occurredAt) {
        return new AuditEvent(type, actorUserId, subjectType, subjectId, operationId,
                Objects.requireNonNull(fromState, "fromState").name(), Objects.requireNonNull(toState, "toState").name(),
                AuditResult.ACCEPTED, reason, details, occurredAt);
    }
}
