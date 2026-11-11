package ca.aegis.control.audit;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.identity.UserSummary;
import ca.aegis.control.shared.jdbc.Where;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reads of the audit timeline (document 09, section 19.1) in {@code occurred_at DESC, id DESC} order, the order of
 * {@code ix_audit_events_time}, continued by keyset rather than by offset so that a page never repeats or skips an
 * event appended meanwhile.
 */
@Repository
public class AuditEventReads {

    /** Every value of {@code ck_audit_events_type}, so that a filter on a type not written yet is still valid. */
    static final Set<String> EVENT_TYPES = Set.of(
            "AUTHENTICATION_SUCCEEDED", "AUTHENTICATION_REJECTED",
            "ASSET_CREATED", "ASSET_UPDATED", "ASSET_ARCHIVED",
            "ASSET_IDENTIFIER_ASSIGNED", "ASSET_PLACEMENT_CHANGED",
            "SCHEDULE_UPDATED", "READINESS_EVALUATED",
            "RESERVATION_CREATED", "RESERVATION_CANCELLED",
            "RESERVATION_FULFILLED", "RESERVATION_EXPIRED",
            "OPERATION_REQUESTED", "OPERATION_AUTHORIZED",
            "LOCAL_CHALLENGE_CREATED", "LOCAL_CHALLENGE_DISPLAYED",
            "LOCAL_CHALLENGE_CONSUMED", "LOCAL_CHALLENGE_REJECTED",
            "LOCAL_CHALLENGE_EXPIRED", "LOCAL_CHALLENGE_INVALIDATED",
            "COMMAND_SENT", "COMMAND_ACKNOWLEDGED", "COMMAND_REJECTED",
            "DOOR_OPENED", "OBSERVATION_RECEIVED",
            "OPERATION_CONFIRMED", "OPERATION_FAILED", "OPERATION_EXPIRED",
            "LOAN_RETURN_STARTED", "LOAN_RETURN_REVERTED_SAFE", "LOAN_COMPLETED",
            "ANOMALY_CREATED",
            "ANOMALY_ACKNOWLEDGED", "ANOMALY_RESOLVED",
            "CHECKOUT_CONFIRMED", "RETURN_CONFIRMED",
            "MQTT_MESSAGE_DUPLICATE_IGNORED",
            "LOCKER_ONLINE", "LOCKER_OFFLINE");

    /** Every value of {@code ck_audit_events_subject_type}. */
    static final Set<String> SUBJECT_TYPES = Set.of(
            "USER", "ASSET_MODEL", "ASSET", "ASSET_IDENTIFIER",
            "LOCKER", "COMPARTMENT", "OPERATING_SCHEDULE",
            "OPERATING_WINDOW", "RESERVATION", "LOAN",
            "LOCKER_OPERATION", "COMMAND_OUTBOX",
            "LOCAL_ACCESS_CHALLENGE", "HUB_DISPLAY_OUTBOX",
            "INBOUND_DEVICE_MESSAGE", "PHYSICAL_OBSERVATION", "ANOMALY");

    private final JdbcClient jdbc;
    private final JsonMapper jsonMapper;

    AuditEventReads(JdbcClient jdbc, JsonMapper jsonMapper) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
    }

    public record Filter(String eventType, String subjectType, UUID subjectId, UUID operationId, UUID actorUserId,
            Instant from, Instant to) {

        String hash() {
            return AuditCursor.hash(eventType, subjectType, subjectId, operationId, actorUserId, from, to);
        }
    }

    /** At most {@code limit} events after {@code after}, or from the latest one; one more tells whether more exist. */
    public AuditPage page(Filter filter, AuditCursor after, int limit) {
        Where where = new Where().equal("a.event_type", filter.eventType())
                .equal("a.subject_type", filter.subjectType()).equal("a.subject_id", filter.subjectId())
                .equal("a.operation_id", filter.operationId()).equal("a.actor_user_id", filter.actorUserId())
                .interval("a.occurred_at", filter.from(), filter.to());
        if (after != null) {
            where.before("a.occurred_at", "a.id", after.occurredAt(), after.id());
        }
        List<AuditEventView> rows = where.bind(jdbc.sql("""
                SELECT a.id, a.event_type, a.actor_user_id, u.display_name AS actor_name, a.subject_type, a.subject_id,
                       a.operation_id, a.from_state, a.to_state, a.result, a.reason, a.occurred_at,
                       a.details::text AS details
                FROM aegis.audit_events a
                LEFT JOIN aegis.users u ON u.id = a.actor_user_id
                """ + where.sql() + " ORDER BY a.occurred_at DESC, a.id DESC LIMIT " + (limit + 1)))
                .query(this::view).list();
        boolean hasMore = rows.size() > limit;
        List<AuditEventView> items = hasMore ? rows.subList(0, limit) : rows;
        String next = null;
        if (hasMore) {
            AuditEventView last = items.getLast();
            next = new AuditCursor(last.occurredAt(), last.id(), filter.hash()).encode();
        }
        return new AuditPage(List.copyOf(items), next, hasMore);
    }

    private AuditEventView view(ResultSet rs, int row) throws SQLException {
        UUID actorId = rs.getObject("actor_user_id", UUID.class);
        String eventType = rs.getString("event_type");
        @SuppressWarnings("unchecked")
        Map<String, Object> details = jsonMapper.readValue(rs.getString("details"), LinkedHashMap.class);
        return new AuditEventView(rs.getObject("id", UUID.class), eventType,
                actorId == null ? null : new UserSummary(actorId, rs.getString("actor_name")),
                rs.getString("subject_type"), rs.getObject("subject_id", UUID.class),
                rs.getObject("operation_id", UUID.class), rs.getString("from_state"), rs.getString("to_state"),
                rs.getString("result"), rs.getString("reason"),
                rs.getObject("occurred_at", OffsetDateTime.class).toInstant(),
                AuditDetailsFilter.filter(eventType, details));
    }
}
