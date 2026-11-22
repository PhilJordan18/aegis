package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.device.PresenceEvidence;
import ca.aegis.control.device.PresenceEvidence.Expectation;
import ca.aegis.control.device.PresenceEvidence.Verdict;

/**
 * Recovery of an uncertain checkout (document 06, section 15.2; document 05, sections 6 and 7): the anomaly of a
 * checkout attempt that ended in {@code ANOMALY} is resolved once the expected asset is seen again in its cell, door
 * closed and location stable, by a scan received after the anomaly was detected. No loan is created. The reservation
 * that the anomaly held is then re-evaluated: usable again while its window is open (the {@code CHECKOUT} guards
 * apply), expired otherwise.
 * <p>
 * "Present" is {@link PresenceEvidence} at the time of the decision, so a scan voided by a later door movement, an
 * unobserved cell, a lapsed connection or the tag standing in another cell resolves nothing. Each asset is decided in
 * its own short transaction that locks the asset first, as every writer of an attempt's anomalies must
 * ({@link CheckoutAttemptRepository}). Nothing outside PostgreSQL is awaited.
 */
@Service
class CheckoutAnomalyRecovery {

    static final String RESOLUTION_NOTE =
            "Résolue par la présence stable de l'actif dans sa cellule fermée, sans prêt (06 §15.2).";

    private static final Logger log = LoggerFactory.getLogger(CheckoutAnomalyRecovery.class);

    private static final String UNRESOLVED = """
            FROM aegis.anomalies a
            JOIN aegis.locker_operations o ON o.id = a.locker_operation_id
            WHERE o.type = 'CHECKOUT' AND o.status = 'ANOMALY' AND a.status IN ('OPEN', 'ACKNOWLEDGED')
            """;

    private final JdbcClient jdbc;
    private final PresenceEvidence presence;
    private final ReservableAssets assets;
    private final ReservationExpiry expiry;
    private final AuditTrail audit;
    private final TransactionTemplate transactions;
    private final Clock clock;

    CheckoutAnomalyRecovery(JdbcClient jdbc, PresenceEvidence presence, ReservableAssets assets,
            ReservationExpiry expiry, AuditTrail audit, PlatformTransactionManager transactionManager, Clock clock) {
        this.jdbc = jdbc;
        this.presence = presence;
        this.assets = assets;
        this.expiry = expiry;
        this.audit = audit;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        this.clock = clock;
    }

    /**
     * The scheduled pass: every asset with an unresolved checkout anomaly, skipping an asset another transaction
     * holds. Presence depends on time (a connection may lapse), so a scan that arrived while the asset was held is
     * decided here rather than lost.
     *
     * @return the number of anomalies resolved
     */
    int run() {
        return decideAll(jdbc.sql("SELECT DISTINCT o.asset_id " + UNRESOLVED + "ORDER BY o.asset_id")
                .query(UUID.class).list(), false);
    }

    /** After an accepted scan of {@code compartmentId}: the assets whose checkout anomaly names that cell. */
    int afterScan(UUID compartmentId) {
        return decideAll(jdbc.sql("SELECT DISTINCT o.asset_id " + UNRESOLVED
                        + "AND o.compartment_id = :compartment ORDER BY o.asset_id")
                .param("compartment", compartmentId).query(UUID.class).list(), true);
    }

    private int decideAll(List<UUID> assetIds, boolean wait) {
        int resolved = 0;
        for (UUID assetId : assetIds) {
            try {
                Decision decision = transactions.execute(status -> decide(assetId, wait));
                resolved += decision.resolved();
                decision.reservations().forEach(reservation -> expiry.expire(reservation, now(), true));
            } catch (RuntimeException failure) {
                // A database message may quote row values: the type only. A failed decision was rolled back and a later
                // pass retries it; a failed expiry is left to the expiry job.
                log.warn("Checkout anomaly recovery of asset {} failed ({}); a later pass retries it", assetId,
                        failure.getClass().getName());
            }
        }
        return resolved;
    }

    private record Decision(int resolved, List<UUID> reservations) {

        static final Decision NONE = new Decision(0, List.of());
    }

    private record Unresolved(UUID id, UUID operationId, UUID reservationId, UUID compartmentId, String type,
            String severity, String status, Instant detectedAt) {
    }

    private record Evidence(UUID observationId, UUID scanMessageId) {
    }

    private Decision decide(UUID assetId, boolean wait) {
        boolean locked = wait ? assets.lockForCustody(assetId) : assets.tryLockForCustody(assetId);
        if (!locked) {
            return Decision.NONE;
        }
        List<Unresolved> anomalies = lockUnresolved(assetId);
        if (anomalies.isEmpty()) {
            return Decision.NONE;
        }
        Optional<Expectation> expected = expectation(assetId);
        Instant now = now();
        if (expected.isEmpty()
                || presence.evaluate(List.of(expected.get()), now).get(expected.get()) != Verdict.PRESENT) {
            return Decision.NONE;
        }
        int resolved = 0;
        List<UUID> reservations = new ArrayList<>();
        for (Unresolved anomaly : anomalies) {
            // Back in its own cell: an asset placed elsewhere since the attempt proves nothing about that cell.
            if (!anomaly.compartmentId().equals(expected.get().compartmentId())) {
                continue;
            }
            Optional<Evidence> evidence = evidenceAfter(expected.get(), anomaly.detectedAt());
            if (evidence.isEmpty()) {
                continue;
            }
            resolve(anomaly, evidence.get(), now);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("type", anomaly.type());
            details.put("severity", anomaly.severity());
            details.put("assetId", assetId);
            details.put("reservationId", anomaly.reservationId());
            details.put("evidenceObservationId", evidence.get().observationId());
            details.put("scanMessageId", evidence.get().scanMessageId());
            audit.recordAboutInboundMessage(new AuditEvent(AuditEventType.ANOMALY_RESOLVED, null,
                    AuditSubjectType.ANOMALY, anomaly.id(), anomaly.operationId(), anomaly.status(), "RESOLVED",
                    AuditResult.ACCEPTED, null, details, now), evidence.get().scanMessageId());
            log.info("Checkout anomaly resolved by the asset's stable presence: anomalyId={}, operationId={}",
                    anomaly.id(), anomaly.operationId());
            resolved++;
            if (anomaly.reservationId() != null && !reservations.contains(anomaly.reservationId())) {
                reservations.add(anomaly.reservationId());
            }
        }
        return new Decision(resolved, List.copyOf(reservations));
    }

    private List<Unresolved> lockUnresolved(UUID assetId) {
        return jdbc.sql("SELECT a.id, a.locker_operation_id, o.reservation_id, o.compartment_id, a.type, a.severity, "
                        + "a.status, a.detected_at " + UNRESOLVED
                        + "AND o.asset_id = :asset ORDER BY a.detected_at, a.id FOR UPDATE OF a")
                .param("asset", assetId)
                .query((row, number) -> new Unresolved(row.getObject("id", UUID.class),
                        row.getObject("locker_operation_id", UUID.class), row.getObject("reservation_id", UUID.class),
                        row.getObject("compartment_id", UUID.class), row.getString("type"), row.getString("severity"),
                        row.getString("status"), row.getObject("detected_at", OffsetDateTime.class).toInstant()))
                .list();
    }

    /** The cell of the asset's current placement with its active UHF tag, as {@code ObservedPhysicalPresence}. */
    private Optional<Expectation> expectation(UUID assetId) {
        return jdbc.sql("""
                SELECT p.compartment_id, i.identifier_value, greatest(p.assigned_at, i.assigned_at) AS bound_since
                FROM aegis.asset_placements p
                JOIN aegis.asset_identifiers i
                  ON i.asset_id = p.asset_id AND i.active AND i.identifier_type = 'RFID_UHF'
                WHERE p.asset_id = :asset AND p.removed_at IS NULL
                """).param("asset", assetId)
                .query((row, number) -> new Expectation(row.getObject("compartment_id", UUID.class),
                        row.getString("identifier_value"),
                        row.getObject("bound_since", OffsetDateTime.class).toInstant()))
                .optional();
    }

    /**
     * Document 05, section 6.3: the resolution needs a new physical proof. The latest presence verdict of the tag in
     * the cell received after the anomaly; {@link PresenceEvidence} already decided that the latest usable scan says
     * PRESENT, so an older verdict alone never resolves.
     */
    private Optional<Evidence> evidenceAfter(Expectation expected, Instant detectedAt) {
        return jdbc.sql("""
                SELECT p.id, p.inbound_message_id FROM aegis.physical_observations p
                JOIN aegis.inbound_device_messages m ON m.id = p.inbound_message_id
                WHERE p.compartment_id = :compartment AND p.type = 'ASSET_PRESENT'
                  AND p.identifier_value = :tag AND m.received_at > :detected
                ORDER BY m.received_at DESC, p.id DESC LIMIT 1
                """).param("compartment", expected.compartmentId()).param("tag", expected.rfidValue())
                .param("detected", detectedAt.atOffset(ZoneOffset.UTC))
                .query((row, number) -> new Evidence(row.getObject("id", UUID.class),
                        row.getObject("inbound_message_id", UUID.class)))
                .optional();
    }

    private void resolve(Unresolved anomaly, Evidence evidence, Instant now) {
        int resolved = jdbc.sql("""
                UPDATE aegis.anomalies
                SET status = 'RESOLVED', resolved_at = :now, resolution_evidence_observation_id = :evidence,
                    resolution_note = :note
                WHERE id = :id AND status IN ('OPEN', 'ACKNOWLEDGED')
                """).param("now", now.atOffset(ZoneOffset.UTC)).param("evidence", evidence.observationId())
                .param("note", RESOLUTION_NOTE).param("id", anomaly.id()).update();
        if (resolved != 1) {
            throw new IllegalStateException("A locked anomaly changed state: " + anomaly.id());
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
