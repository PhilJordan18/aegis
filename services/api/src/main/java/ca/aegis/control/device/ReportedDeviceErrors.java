package ca.aegis.control.device;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@code DEVICE_ERROR} reports of a locker's current device session, grouped for display (document 09, section
 * 8.6, approved on 6 November 2026, #29). They are reported errors, not proof of an active fault: document 10 defines
 * no clearing message, and nothing here changes a connection status, a readiness, a reservation, a loan or an
 * authorization.
 */
@Component
public class ReportedDeviceErrors {

    /** One {@code (errorCode, compartmentId)} group; {@code severity} is CRITICAL when any report of it was. */
    public record Group(String errorCode, String severity, UUID compartmentId, Instant firstReceivedAt,
            Instant lastReceivedAt, long occurrences) {
    }

    static final int LIMIT = 20;

    /*
     * The current session is the one of the active device's projection, since provisioning. A REJECTED row never
     * counts; a duplicate delivery is never stored (uq_inbound_messages_device_message). A row without a parsed
     * payload carries no readable code and is left out. A compartmentId that is not a cell of this locker reads as
     * null, so the group stays visible without naming a foreign cell. The text comparison cannot fail on a stored
     * value that is not a UUID, which would otherwise break this read for good.
     */
    private static final String GROUPS = """
            WITH reports AS (
                SELECT m.parsed_payload ->> 'errorCode' AS error_code,
                       m.parsed_payload ->> 'severity' = 'CRITICAL' AS critical,
                       c.id AS compartment_id, m.received_at
                FROM aegis.locker_devices d
                JOIN aegis.inbound_device_messages m
                  ON m.locker_device_id = d.id
                 AND m.device_session_id = d.device_session_id AND m.boot_count = d.boot_count
                LEFT JOIN aegis.compartments c
                  ON c.locker_id = d.locker_id AND c.id::text = m.parsed_payload ->> 'compartmentId'
                WHERE d.locker_id = :locker AND d.disabled_at IS NULL
                  AND m.message_type = 'DEVICE_ERROR' AND m.processing_status <> 'REJECTED'
                  AND m.received_at >= d.provisioned_at AND m.parsed_payload IS NOT NULL
            )
            SELECT error_code, bool_or(critical) AS critical, compartment_id,
                   min(received_at) AS first_received_at, max(received_at) AS last_received_at,
                   count(*) AS occurrences
            FROM reports
            GROUP BY error_code, compartment_id
            ORDER BY bool_or(critical) DESC, max(received_at) DESC, error_code, compartment_id NULLS FIRST
            LIMIT :limit
            """;

    private final JdbcClient jdbc;

    ReportedDeviceErrors(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** At most {@value #LIMIT} groups; empty without an active device or before its first session. */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<Group> ofCurrentSession(UUID lockerId) {
        return jdbc.sql(GROUPS).param("locker", lockerId).param("limit", LIMIT)
                .query((row, number) -> new Group(row.getString("error_code"),
                        row.getBoolean("critical") ? "CRITICAL" : "WARNING",
                        row.getObject("compartment_id", UUID.class),
                        row.getObject("first_received_at", OffsetDateTime.class).toInstant(),
                        row.getObject("last_received_at", OffsetDateTime.class).toInstant(),
                        row.getLong("occurrences")))
                .list();
    }
}
