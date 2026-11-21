package ca.aegis.control.anomaly;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import ca.aegis.control.identity.UserSummary;
import ca.aegis.control.shared.jdbc.Where;
import ca.aegis.control.shared.web.PageQuery;

/**
 * {@code aegis.anomalies} (document 08, section 4.9). The application never deletes an anomaly; the only write here is
 * the acknowledgement, which never resolves it.
 */
@Repository
class AnomalyRepository {

    /** At most this many observations are returned as evidence (shape D7 approved on 11 November 2026, #67). */
    static final int EVIDENCE_LIMIT = 50;

    private static final String SELECT = """
            SELECT a.id, a.type, a.severity, a.status, a.locker_operation_id, a.asset_id, a.compartment_id,
                   a.detected_at, a.acknowledged_at, a.acknowledged_by_user_id, u.display_name AS acknowledged_by_name,
                   a.acknowledgement_note, a.resolved_at, a.resolution_evidence_observation_id, a.resolution_note
            FROM aegis.anomalies a
            LEFT JOIN aegis.users u ON u.id = a.acknowledged_by_user_id
            """;

    /**
     * Filters of {@code GET /admin/anomalies} (document 09, section 18.1). Rule D2 approved on 11 November
     * 2026 (#67): {@code from} and {@code to} bound {@code detected_at}.
     */
    record AdminFilter(AnomalyStatus status, AnomalyType type, AnomalySeverity severity, UUID assetId,
            UUID lockerOperationId, Instant from, Instant to) {

        Where where() {
            return new Where().equal("a.status", status).equal("a.type", type).equal("a.severity", severity)
                    .equal("a.asset_id", assetId).equal("a.locker_operation_id", lockerOperationId)
                    .interval("a.detected_at", from, to);
        }
    }

    private final JdbcClient jdbc;

    AnomalyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<AnomalyView> find(UUID id) {
        return jdbc.sql(SELECT + " WHERE a.id = :id").param("id", id).query(AnomalyRepository::map).optional();
    }

    /** Order D1 approved on 11 November 2026 (#67): latest detection first, {@code id} breaking ties. */
    List<AnomalyView> page(AdminFilter filter, PageQuery page) {
        Where where = filter.where();
        return where.bind(jdbc.sql(SELECT + where.sql()
                        + " ORDER BY a.detected_at DESC, a.id DESC LIMIT :limit OFFSET :offset"))
                .param("limit", page.size()).param("offset", page.offset())
                .query(AnomalyRepository::map).list();
    }

    long count(AdminFilter filter) {
        Where where = filter.where();
        return where.bind(jdbc.sql("SELECT count(*) FROM aegis.anomalies a" + where.sql())).query(Long.class)
                .single();
    }

    /**
     * The observations of the anomaly's operation and its resolution observation, latest first. Only normalized
     * columns are read: never {@code identifier_value}, {@code value_json} or the inbound message.
     */
    List<EvidenceView> evidence(UUID operationId, UUID resolutionObservationId) {
        if (operationId == null && resolutionObservationId == null) {
            return List.of();
        }
        return jdbc.sql("""
                SELECT id, type, compartment_id, operation_id, observed_at, created_at
                FROM aegis.physical_observations
                WHERE operation_id = :operation OR id = :resolution
                ORDER BY observed_at DESC, id DESC
                LIMIT :limit
                """)
                .param("operation", operationId).param("resolution", resolutionObservationId)
                .param("limit", EVIDENCE_LIMIT)
                .query((row, number) -> new EvidenceView(row.getObject("id", UUID.class), row.getString("type"),
                        row.getObject("compartment_id", UUID.class), row.getObject("operation_id", UUID.class),
                        instant(row, "observed_at"), instant(row, "created_at")))
                .list();
    }

    /** Locks the anomaly row for its acknowledgement and returns its status, if it exists. */
    Optional<AnomalyStatus> lockStatus(UUID id) {
        return jdbc.sql("SELECT status FROM aegis.anomalies WHERE id = :id FOR UPDATE").param("id", id)
                .query((row, number) -> AnomalyStatus.valueOf(row.getString("status"))).optional();
    }

    /** {@code OPEN} to {@code ACKNOWLEDGED}; the caller holds the row lock and has checked the status. */
    void acknowledge(UUID id, UUID actorUserId, String note, Instant at) {
        int updated = jdbc.sql("""
                UPDATE aegis.anomalies
                SET status = 'ACKNOWLEDGED', acknowledged_at = :at, acknowledged_by_user_id = :actor,
                    acknowledgement_note = :note
                WHERE id = :id AND status = 'OPEN'
                """).param("id", id).param("actor", actorUserId).param("note", note)
                .param("at", at.atOffset(ZoneOffset.UTC)).update();
        if (updated != 1) {
            throw new IllegalStateException("A locked open anomaly changed state: " + id);
        }
    }

    private static AnomalyView map(ResultSet row, int number) throws SQLException {
        AnomalyType type = AnomalyType.valueOf(row.getString("type"));
        UUID acknowledgedBy = row.getObject("acknowledged_by_user_id", UUID.class);
        return new AnomalyView(row.getObject("id", UUID.class), type,
                AnomalySeverity.valueOf(row.getString("severity")), AnomalyStatus.valueOf(row.getString("status")),
                row.getObject("locker_operation_id", UUID.class), row.getObject("asset_id", UUID.class),
                row.getObject("compartment_id", UUID.class), instant(row, "detected_at"),
                instant(row, "acknowledged_at"),
                acknowledgedBy == null ? null
                        : new UserSummary(acknowledgedBy, row.getString("acknowledged_by_name")),
                row.getString("acknowledgement_note"), instant(row, "resolved_at"),
                row.getObject("resolution_evidence_observation_id", UUID.class), row.getString("resolution_note"),
                type.summary());
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
