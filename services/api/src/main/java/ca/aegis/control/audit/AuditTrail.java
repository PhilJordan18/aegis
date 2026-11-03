package ca.aegis.control.audit;

import java.time.ZoneOffset;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.json.JsonMapper;

/**
 * Appends audit events in the transaction of the mutation they describe, so that an event exists exactly when its
 * mutation commits. Called without a transaction, it fails instead of writing an event that a later rollback of the
 * mutation could not take back. The application never updates or deletes an event (document 08, section 12.1).
 */
@Component
public class AuditTrail {

    private final JdbcClient jdbc;
    private final JsonMapper jsonMapper;

    AuditTrail(JdbcClient jdbc, JsonMapper jsonMapper) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(AuditEvent event) {
        jdbc.sql("""
                INSERT INTO aegis.audit_events
                    (event_type, actor_user_id, subject_type, subject_id, result, details, occurred_at)
                VALUES (:type, :actor, :subjectType, :subjectId, :result, CAST(:details AS jsonb), :occurredAt)
                """)
                .param("type", event.type().name())
                .param("actor", event.actorUserId())
                .param("subjectType", event.subjectType().name())
                .param("subjectId", event.subjectId())
                .param("result", event.result() == null ? null : event.result().name())
                .param("details", jsonMapper.writeValueAsString(event.details()))
                .param("occurredAt", event.occurredAt().atOffset(ZoneOffset.UTC))
                .update();
    }
}
