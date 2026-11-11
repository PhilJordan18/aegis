package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandAcknowledgements;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.HubDisplayOutbox;
import ca.aegis.control.loan.LoanStatus;
import ca.aegis.control.reservation.CheckoutProof.Fact;
import ca.aegis.control.reservation.CheckoutProof.Finding;
import ca.aegis.control.reservation.CheckoutProof.Kind;
import ca.aegis.control.reservation.CheckoutProof.Result;
import ca.aegis.control.reservation.CheckoutProof.Stage;
import ca.aegis.control.reservation.CheckoutProof.TagReading;
import ca.aegis.control.reservation.CheckoutProof.Verdict;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;

/**
 * CHK-02 (#47): turns the stored physical facts of an authorized {@code CHECKOUT} into its outcome, and nothing else
 * does. Document 05, sections 5.3 to 5.5 and 7.1; document 06, sections 10, 11 and 14.2; document 08, section 7.4.
 *
 * <ul>
 * <li>A coherent proof confirms the operation, fulfils the reservation and creates the single {@code ACTIVE} loan,
 * all in one transaction.</li>
 * <li>A contradictory proof after a complete door sequence ends the operation in {@code ANOMALY} with an open
 * {@code INCONSISTENT_PHYSICAL_STATE} anomaly and no loan; the reservation stays {@code ACTIVE} to block any other
 * attempt.</li>
 * <li>An incomplete proof waits until {@code expiresAt}; then a door that certainly never opened ends it
 * {@code EXPIRED}, and every other case ends it in {@code ANOMALY}.</li>
 * </ul>
 *
 * An authorized {@code RETURN} (#50) goes through the same milestones but is only concluded at its deadline, by
 * document 06, section 13.1; its positive proof comes with #51.
 *
 * Each operation is decided in a transaction of its own, under the locks of document 08, section 7.1, at an instant read
 * after them; a terminal operation is never changed again. It runs after each stored acknowledgement, door event or
 * scan of the operation, and on a schedule for the deadline. It never waits for MQTT.
 */
@Service
public class CheckoutConfirmation {

    /** {@code failure_reason} of an authorized checkout that ended without any physical interaction. */
    static final String OPERATION_EXPIRED = "OPERATION_EXPIRED";

    static final String INCONSISTENT_PHYSICAL_STATE = "INCONSISTENT_PHYSICAL_STATE";
    static final String DOOR_NOT_CLOSED_BEFORE_EXPIRY = "DOOR_NOT_CLOSED_BEFORE_EXPIRY";
    static final String DEVICE_OFFLINE_DURING_OPERATION = "DEVICE_OFFLINE_DURING_OPERATION";

    private static final Logger log = LoggerFactory.getLogger(CheckoutConfirmation.class);

    private static final List<String> OPEN_AFTER_AUTHORIZATION = List.of("AUTHORIZED", "COMMAND_SENT",
            "COMMAND_ACKNOWLEDGED", "DOOR_OPENED", "OBSERVATION_RECEIVED");

    private record Target(UUID id, String type, UUID userId, UUID assetId, UUID reservationId, UUID loanId,
            UUID lockerId, UUID compartmentId) {

        boolean isReturn() {
            return LockerOperationType.RETURN.name().equals(type);
        }
    }

    private record Operation(UUID id, LockerOperationStatus status, Instant authorizedAt, Instant expiresAt,
            Instant acknowledgedAt, Instant doorOpenedAt, String expectedTag) {
    }

    private record CellState(String connectionStatus, String readerStatus, String doorState) {
    }

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final ReservationRepository reservations;
    private final ReturnRepository loans;
    private final ReservableAssets assets;
    private final PreparationRepository preparation;
    private final LockerAvailability availability;
    private final HubDisplayOutbox display;
    private final AuditTrail audit;
    private final Clock clock;

    CheckoutConfirmation(JdbcClient jdbc, TransactionTemplate transactions, ReservationRepository reservations,
            ReturnRepository loans, ReservableAssets assets, PreparationRepository preparation, LockerAvailability availability,
            HubDisplayOutbox display, AuditTrail audit, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.reservations = reservations;
        this.loans = loans;
        this.assets = assets;
        this.preparation = preparation;
        this.availability = availability;
        this.display = display;
        this.audit = audit;
        this.clock = clock;
    }

    /** One pass over the authorized checkouts and returns not yet decided; returns the number that reached a terminal state. */
    public int run(int max) {
        int ended = 0;
        for (UUID operation : jdbc.sql("""
                SELECT id FROM aegis.locker_operations
                WHERE authorized_at IS NOT NULL AND status IN (:open)
                ORDER BY expires_at, id
                LIMIT :max
                """).param("open", OPEN_AFTER_AUTHORIZATION).param("max", max).query(UUID.class).list()) {
            if (evaluate(operation).filter(LockerOperationStatus::terminal).isPresent()) {
                ended++;
            }
        }
        return ended;
    }

    /**
     * Evaluates one operation in a transaction of its own. A failure is logged and left to the next pass: the caller,
     * an ingestion or the scheduler, must never fail because of it.
     *
     * @return the status after the evaluation, empty when the operation does not exist
     */
    public Optional<LockerOperationStatus> evaluate(UUID operationId) {
        try {
            return transactions.execute(status -> decide(operationId));
        } catch (RuntimeException failure) {
            log.error("Checkout not evaluated: operationId={}, cause={}", operationId,
                    failure.getClass().getSimpleName(), failure);
            return Optional.empty();
        }
    }

    private Optional<LockerOperationStatus> decide(UUID operationId) {
        Optional<Target> target = jdbc.sql("""
                SELECT id, type, user_id, asset_id, reservation_id, loan_id, locker_id, compartment_id
                FROM aegis.locker_operations WHERE id = :id
                """).param("id", operationId)
                .query((row, number) -> new Target(row.getObject("id", UUID.class), row.getString("type"),
                        row.getObject("user_id", UUID.class), row.getObject("asset_id", UUID.class),
                        row.getObject("reservation_id", UUID.class), row.getObject("loan_id", UUID.class),
                        row.getObject("locker_id", UUID.class), row.getObject("compartment_id", UUID.class)))
                .optional();
        if (target.isEmpty()) {
            return Optional.empty();
        }
        Target t = target.get();
        // The hub's device row first, as the ingestion takes it (FOR UPDATE): a fact of this locker and this
        // evaluation never interleave, so neither waits for the other's later locks (KEY SHARE on the operation and
        // the locker from stored facts, compartment and locker updates). FOR NO KEY UPDATE leaves free the KEY SHARE
        // of an API transaction that queues a display row or a command.
        lockDevices(t.lockerId());
        reservations.lockUser(t.userId());
        assets.lockForCustody(t.assetId());
        ReservationRow reservation = null;
        if (t.isReturn()) {
            loans.lock(t.loanId()).orElseThrow();
        } else {
            reservation = reservations.lock(t.reservationId()).orElseThrow();
        }
        preparation.lockLocker(t.lockerId());
        CellState cell = lockCell(t.compartmentId());
        Operation operation = lockOperation(t.id());
        if (operation.status().terminal()) {
            // Document 05, section 5.6: a late fact stays as technical evidence and changes nothing.
            processed(t.id());
            return Optional.of(operation.status());
        }
        if (operation.authorizedAt() == null) {
            return Optional.of(operation.status());
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        // A fact received at or after expiresAt proves nothing (document 05, section 5.5): the deadline already decides,
        // however late the evaluation that reads it runs.
        List<Fact> inTime = facts(t.id(), operation.expectedTag()).stream()
                .filter(fact -> fact.receivedAt().isBefore(operation.expiresAt())).toList();
        Result proof = CheckoutProof.evaluate(t.compartmentId(), inTime, tagElsewhere(t.compartmentId(), operation));
        LockerOperationStatus status = advance(operation, proof, now);
        if (t.isReturn()) {
            // #50: an authorized return is bounded by its deadline. Its physical proof, which completes the loan,
            // comes with #51; until then a return never confirms and never frees the asset.
            return Optional.of(now.isBefore(operation.expiresAt()) ? status
                    : returnAtDeadline(t, operation, status, proof, cell, now));
        }

        if (proof.verdict() == Verdict.COHERENT) {
            return Optional.of(confirm(t, reservation, status, proof, now));
        }
        if (proof.verdict() == Verdict.INCONSISTENT) {
            return Optional.of(anomaly(t, status, INCONSISTENT_PHYSICAL_STATE, proof.finding(), now));
        }
        if (now.isBefore(operation.expiresAt())) {
            return Optional.of(status);
        }
        return Optional.of(atDeadline(t, operation, status, proof, cell, now));
    }

    /**
     * Records the milestones the facts justify (document 05, section 5.3), each once and in order, before any terminal
     * decision. A milestone instant is the backend reception of its fact, never earlier than the previous one.
     */
    private LockerOperationStatus advance(Operation operation, Result proof, Instant now) {
        LockerOperationStatus status = operation.status();
        if (operation.acknowledgedAt() == null || proof.opened().isEmpty()) {
            return status;
        }
        Instant doorOpenedAt = operation.doorOpenedAt();
        if (status == LockerOperationStatus.COMMAND_ACKNOWLEDGED) {
            Fact opened = proof.opened().get();
            doorOpenedAt = later(opened.receivedAt(), operation.acknowledgedAt());
            move(operation.id(), status, LockerOperationStatus.DOOR_OPENED, "door_opened_at", doorOpenedAt);
            audit.recordAboutInboundMessage(AuditEvent.transition(AuditEventType.DOOR_OPENED, null,
                    AuditSubjectType.LOCKER_OPERATION, operation.id(), operation.id(), status,
                    LockerOperationStatus.DOOR_OPENED, null, Map.of("messageId", opened.messageId()), now),
                    opened.messageId());
            status = LockerOperationStatus.DOOR_OPENED;
        }
        if (status == LockerOperationStatus.DOOR_OPENED && proof.stage() == Stage.OBSERVED) {
            Fact scan = proof.scan().orElseThrow();
            move(operation.id(), status, LockerOperationStatus.OBSERVATION_RECEIVED, "observation_received_at",
                    later(scan.receivedAt(), doorOpenedAt));
            audit.recordAboutInboundMessage(AuditEvent.transition(AuditEventType.OBSERVATION_RECEIVED, null,
                    AuditSubjectType.LOCKER_OPERATION, operation.id(), operation.id(), status,
                    LockerOperationStatus.OBSERVATION_RECEIVED, null, Map.of("messageId", scan.messageId(),
                            "readerStatus", scan.reader()), now), scan.messageId());
            status = LockerOperationStatus.OBSERVATION_RECEIVED;
        }
        return status;
    }

    /** Document 06, section 11.1, steps 3 to 8; document 08, section 7.4. */
    private LockerOperationStatus confirm(Target t, ReservationRow reservation, LockerOperationStatus from,
            Result proof, Instant now) {
        if (reservation.status() != ReservationStatus.ACTIVE) {
            // The expiry waits for an authorized checkout and cancellation is refused after authorization: reaching
            // here means another writer broke document 05, section 7. Nothing is fabricated.
            throw new IllegalStateException("Checkout proven for a reservation that is not ACTIVE: " + t.id());
        }
        end(t.id(), from, LockerOperationStatus.CONFIRMED, null, now);
        int fulfilled = jdbc.sql("""
                UPDATE aegis.reservations SET status = 'FULFILLED', fulfilled_at = :now
                WHERE id = :id AND status = 'ACTIVE'
                """).param("id", reservation.id()).param("now", utc(now)).update();
        if (fulfilled != 1) {
            throw new IllegalStateException("A locked reservation changed state: " + reservation.id());
        }
        // uq_loans_checkout_operation and ux_loans_one_open_per_asset are the final guards (document 08, section 7.4).
        UUID loan = jdbc.sql("""
                INSERT INTO aegis.loans (asset_id, holder_user_id, checkout_operation_id, status, checked_out_at, due_at)
                VALUES (:asset, :holder, :operation, 'ACTIVE', :now, :due)
                RETURNING id
                """).param("asset", t.assetId()).param("holder", t.userId()).param("operation", t.id())
                .param("now", utc(now)).param("due", utc(reservation.reservedUntil())).query(UUID.class).single();
        UUID scan = proof.scan().orElseThrow().messageId();
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("reservationId", reservation.id());
        evidence.put("loanId", loan);
        evidence.put("acknowledgementMessageId", proof.acknowledgement().orElseThrow().messageId());
        evidence.put("doorOpenedMessageId", proof.opened().orElseThrow().messageId());
        evidence.put("doorClosedMessageId", proof.closed().orElseThrow().messageId());
        evidence.put("scanMessageId", scan);
        audit.recordAboutInboundMessage(AuditEvent.transition(AuditEventType.OPERATION_CONFIRMED, null,
                AuditSubjectType.LOCKER_OPERATION, t.id(), t.id(), from, LockerOperationStatus.CONFIRMED, null,
                evidence, now), scan);
        audit.record(AuditEvent.transition(AuditEventType.RESERVATION_FULFILLED, null, AuditSubjectType.RESERVATION,
                reservation.id(), t.id(), ReservationStatus.ACTIVE, ReservationStatus.FULFILLED, null,
                Map.of("assetId", t.assetId(), "loanId", loan), now));
        audit.recordAboutInboundMessage(new AuditEvent(AuditEventType.CHECKOUT_CONFIRMED, null, AuditSubjectType.LOAN,
                loan, t.id(), null, null, AuditResult.ACCEPTED, null,
                Map.of("assetId", t.assetId(), "reservationId", reservation.id(), "status", LoanStatus.ACTIVE.name(),
                        "dueAt", reservation.reservedUntil().toString()), now), scan);
        log.info("Checkout confirmed: operationId={}, loanId={}", t.id(), loan);
        return LockerOperationStatus.CONFIRMED;
    }

    /**
     * Document 06, section 14.2, after {@code expiresAt}: {@code EXPIRED} only when no physical effect is certain,
     * {@code ANOMALY} otherwise. Decision of 11 November 2026 (#47): a healthy scan that still sees the expected tag
     * after a complete door sequence is {@code INCONSISTENT_PHYSICAL_STATE}. A proof that never arrived is not an
     * inconsistency: it is an execution that cannot be determined (document 05, section 5.4).
     */
    private LockerOperationStatus atDeadline(Target t, Operation operation, LockerOperationStatus status,
            Result proof, CellState cell, Instant now) {
        if (proof.closed().isPresent()) {
            return anomaly(t, status, proof.finding() == Finding.EXPECTED_ASSET_STILL_PRESENT
                    ? INCONSISTENT_PHYSICAL_STATE : DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
        }
        if (proof.opened().isPresent()) {
            return anomaly(t, status, DOOR_NOT_CLOSED_BEFORE_EXPIRY, proof.finding(), now);
        }
        if (doorMaySinceHaveOpened(t, operation)) {
            return anomaly(t, status, DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
        }
        if (neverSent(t.id()) || certainlyClosed(t, cell, now)) {
            end(t.id(), status, LockerOperationStatus.EXPIRED, OPERATION_EXPIRED, now);
            audit.record(AuditEvent.transition(AuditEventType.OPERATION_EXPIRED, null,
                    AuditSubjectType.LOCKER_OPERATION, t.id(), t.id(), status, LockerOperationStatus.EXPIRED,
                    OPERATION_EXPIRED, Map.of("reservationId", t.reservationId(), "finding", proof.finding().name()),
                    now));
            return LockerOperationStatus.EXPIRED;
        }
        return anomaly(t, status, DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
    }

    /**
     * Document 06, section 13.1, after {@code expiresAt}: the loan goes back to {@code ACTIVE} only when the return
     * certainly had no physical effect (never sent, refused by the hub before any unlock, or door certainly kept
     * closed); every other case ends in {@code ANOMALY} and the loan stays {@code RETURN_PENDING}.
     */
    private LockerOperationStatus returnAtDeadline(Target t, Operation operation, LockerOperationStatus status,
            Result proof, CellState cell, Instant now) {
        if (proof.closed().isPresent()) {
            return anomaly(t, status, DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
        }
        if (proof.opened().isPresent()) {
            return anomaly(t, status, DOOR_NOT_CLOSED_BEFORE_EXPIRY, proof.finding(), now);
        }
        if (doorMaySinceHaveOpened(t, operation)) {
            return anomaly(t, status, DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
        }
        if (hasOpenAnomaly(t.id())) {
            // An uncertain command report (#41) already left the cell's state unknown; that anomaly is kept.
            return anomaly(t, status, INCONSISTENT_PHYSICAL_STATE, proof.finding(), now);
        }
        Optional<String> rejection = safeRejection(t.id());
        if (rejection.isPresent()) {
            String reason = "COMMAND_REJECTED_" + rejection.get();
            end(t.id(), status, LockerOperationStatus.FAILED, reason, now);
            audit.record(AuditEvent.transition(AuditEventType.OPERATION_FAILED, null,
                    AuditSubjectType.LOCKER_OPERATION, t.id(), t.id(), status, LockerOperationStatus.FAILED, reason,
                    Map.of("loanId", t.loanId()), now));
            revertLoan(t, reason, now);
            return LockerOperationStatus.FAILED;
        }
        if (neverSent(t.id()) || certainlyClosed(t, cell, now)) {
            end(t.id(), status, LockerOperationStatus.EXPIRED, OPERATION_EXPIRED, now);
            audit.record(AuditEvent.transition(AuditEventType.OPERATION_EXPIRED, null,
                    AuditSubjectType.LOCKER_OPERATION, t.id(), t.id(), status, LockerOperationStatus.EXPIRED,
                    OPERATION_EXPIRED, Map.of("loanId", t.loanId(), "finding", proof.finding().name()), now));
            revertLoan(t, OPERATION_EXPIRED, now);
            return LockerOperationStatus.EXPIRED;
        }
        return anomaly(t, status, DEVICE_OFFLINE_DURING_OPERATION, proof.finding(), now);
    }

    private void revertLoan(Target t, String reason, Instant now) {
        loans.revert(t.loanId(), now);
        audit.record(AuditEvent.transition(AuditEventType.LOAN_RETURN_REVERTED_SAFE, null, AuditSubjectType.LOAN,
                t.loanId(), t.id(), LoanStatus.RETURN_PENDING, LoanStatus.ACTIVE, reason,
                Map.of("assetId", t.assetId()), now));
        log.info("Return ended without physical effect, loan active again: operationId={}, loanId={}, reason={}",
                t.id(), t.loanId(), reason);
    }

    private boolean hasOpenAnomaly(UUID operationId) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM aegis.anomalies
                               WHERE locker_operation_id = :id AND status IN ('OPEN', 'ACKNOWLEDGED'))
                """).param("id", operationId).query(Boolean.class).single();
    }

    /**
     * The reason of the hub's refusal of the operation's command, when it is one that guarantees no actuation
     * (document 10, section 9.1). An uncertain refusal is never read as safe, even once its anomaly is resolved.
     */
    private Optional<String> safeRejection(UUID operationId) {
        return jdbc.sql("""
                SELECT m.parsed_payload ->> 'reason'
                FROM aegis.inbound_device_messages m
                JOIN aegis.command_outbox c ON c.operation_id = m.operation_id AND c.status = 'REJECTED'
                WHERE m.operation_id = :id AND m.message_type = 'COMMAND_REJECTED'
                  AND m.processing_status <> 'REJECTED'
                ORDER BY m.received_at, m.id
                """).param("id", operationId).query(String.class).list().stream()
                .filter(CommandAcknowledgements.SAFE_REJECTIONS::contains).findFirst();
    }

    /**
     * Ends the operation in {@code ANOMALY} with one open HIGH anomaly. An anomaly the operation already has, opened by
     * an uncertain command report (#41), is kept rather than duplicated ({@code ux_anomalies_one_open_per_operation}).
     */
    private LockerOperationStatus anomaly(Target t, LockerOperationStatus from, String type, Finding finding,
            Instant now) {
        end(t.id(), from, LockerOperationStatus.ANOMALY, type, now);
        Optional<UUID> created = jdbc.sql("""
                INSERT INTO aegis.anomalies (type, severity, locker_operation_id, asset_id, compartment_id, detected_at,
                                             details)
                VALUES (:type, 'HIGH', :operation, :asset, :compartment, :now, CAST(:details AS jsonb))
                ON CONFLICT (locker_operation_id) WHERE locker_operation_id IS NOT NULL
                    AND status IN ('OPEN', 'ACKNOWLEDGED') DO NOTHING
                RETURNING id
                """).param("type", type).param("operation", t.id()).param("asset", t.assetId())
                .param("compartment", t.compartmentId()).param("now", utc(now))
                .param("details", "{\"finding\": \"" + finding.name() + "\"}")
                .query(UUID.class).optional();
        UUID anomaly = created.orElseGet(() -> jdbc.sql("""
                SELECT id FROM aegis.anomalies
                WHERE locker_operation_id = :operation AND status IN ('OPEN', 'ACKNOWLEDGED')
                """).param("operation", t.id()).query(UUID.class).single());
        audit.record(new AuditEvent(AuditEventType.ANOMALY_CREATED, null, AuditSubjectType.ANOMALY, anomaly, t.id(),
                from.name(), LockerOperationStatus.ANOMALY.name(), AuditResult.ACCEPTED, type,
                Map.of("anomalyType", type, "finding", finding.name(), "anomalyCreated", created.isPresent()), now));
        log.warn("Operation ended in anomaly: operationId={}, anomalyId={}, type={}, finding={}", t.id(), anomaly, type,
                finding);
        return LockerOperationStatus.ANOMALY;
    }

    /**
     * The terminal write shared by every outcome: the status, a command still waiting in the outbox (it can no longer
     * be sent), the stored facts of the operation now interpreted, and the backend-confirmed screen status without any
     * secret (document 10, section 27.3).
     */
    private void end(UUID operationId, LockerOperationStatus from, LockerOperationStatus terminal, String reason,
            Instant now) {
        int ended = jdbc.sql("""
                UPDATE aegis.locker_operations
                SET status = :status, terminal_at = :now, failure_reason = :reason,
                    confirmed_at = CASE WHEN :status = 'CONFIRMED' THEN CAST(:now AS timestamptz) END
                WHERE id = :id AND status = :from
                """).param("status", terminal.name()).param("now", utc(now)).param("reason", reason)
                .param("id", operationId).param("from", from.name()).update();
        if (ended != 1) {
            throw new IllegalStateException("A locked operation changed state: " + operationId);
        }
        jdbc.sql("""
                UPDATE aegis.command_outbox SET status = 'CANCELLED', claim_until = NULL
                WHERE operation_id = :id AND status = 'PENDING'
                """).param("id", operationId).update();
        processed(operationId);
        display.enqueueStatus(operationId, terminal.name(), reason, now);
    }

    private void processed(UUID operationId) {
        jdbc.sql("""
                UPDATE aegis.inbound_device_messages SET processing_status = 'PROCESSED'
                WHERE operation_id = :id AND processing_status = 'RECEIVED'
                """).param("id", operationId).update();
    }

    private void move(UUID operationId, LockerOperationStatus from, LockerOperationStatus to, String column,
            Instant at) {
        int moved = jdbc.sql("UPDATE aegis.locker_operations SET status = :to, " + column + " = :at "
                + "WHERE id = :id AND status = :from")
                .param("to", to.name()).param("at", utc(at)).param("id", operationId).param("from", from.name())
                .update();
        if (moved != 1) {
            throw new IllegalStateException("A locked operation changed state: " + operationId);
        }
    }

    private void lockDevices(UUID lockerId) {
        jdbc.sql("""
                SELECT id FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NULL
                ORDER BY id FOR NO KEY UPDATE
                """).param("locker", lockerId).query(UUID.class).list();
    }

    private CellState lockCell(UUID compartmentId) {
        return jdbc.sql("""
                SELECT connection_status, rfid_reader_status, door_state FROM aegis.compartments
                WHERE id = :id FOR SHARE
                """).param("id", compartmentId)
                .query((row, number) -> new CellState(row.getString("connection_status"),
                        row.getString("rfid_reader_status"), row.getString("door_state")))
                .single();
    }

    private Operation lockOperation(UUID operationId) {
        return jdbc.sql("""
                SELECT o.status, o.authorized_at, o.expires_at, o.acknowledged_at, o.door_opened_at,
                       i.identifier_value
                FROM aegis.locker_operations o
                JOIN aegis.asset_identifiers i ON i.id = o.expected_asset_identifier_id
                WHERE o.id = :id
                FOR NO KEY UPDATE OF o
                """).param("id", operationId)
                .query((row, number) -> new Operation(operationId,
                        LockerOperationStatus.valueOf(row.getString("status")), instant(row.getObject("authorized_at",
                                OffsetDateTime.class)), instant(row.getObject("expires_at", OffsetDateTime.class)),
                        instant(row.getObject("acknowledged_at", OffsetDateTime.class)),
                        instant(row.getObject("door_opened_at", OffsetDateTime.class)),
                        row.getString("identifier_value")))
                .single();
    }

    /**
     * The accepted facts stored for the operation. A scan's tag reading comes from the observations the ingestion
     * normalized from it (document 10, section 12.2): {@code ASSET_ABSENT} for the expected value, any detection of
     * it, or neither when the scan was not stable enough to conclude.
     */
    private List<Fact> facts(UUID operationId, String expectedTag) {
        return jdbc.sql("""
                SELECT m.id, m.message_type, m.parsed_payload ->> 'compartmentId' AS compartment_id,
                       m.device_session_id, m.boot_count, m.sequence, m.occurred_at, m.received_at,
                       m.parsed_payload ->> 'readerStatus' AS reader_status,
                       m.parsed_payload ->> 'windowStartedAt' AS window_started_at,
                       EXISTS (SELECT 1 FROM aegis.physical_observations p
                               WHERE p.inbound_message_id = m.id AND p.type = 'ASSET_ABSENT'
                                 AND p.identifier_value = :tag) AS absent,
                       EXISTS (SELECT 1 FROM aegis.physical_observations p
                               WHERE p.inbound_message_id = m.id AND p.type IN ('ASSET_PRESENT',
                                     'ASSET_IDENTIFIER_DETECTED') AND p.identifier_value = :tag) AS seen
                FROM aegis.inbound_device_messages m
                WHERE m.operation_id = :id AND m.processing_status <> 'REJECTED'
                  AND m.message_type IN ('COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'DOOR_CLOSED', 'RFID_SCAN_COMPLETED')
                  AND m.device_session_id IS NOT NULL
                """).param("id", operationId).param("tag", expectedTag)
                .query((row, number) -> {
                    Kind kind = switch (row.getString("message_type")) {
                        case "COMMAND_ACKNOWLEDGED" -> Kind.ACKNOWLEDGEMENT;
                        case "DOOR_OPENED" -> Kind.DOOR_OPENED;
                        case "DOOR_CLOSED" -> Kind.DOOR_CLOSED;
                        default -> Kind.RFID_SCAN;
                    };
                    String compartment = row.getString("compartment_id");
                    String window = row.getString("window_started_at");
                    TagReading tag = row.getBoolean("seen") ? TagReading.SEEN
                            : row.getBoolean("absent") ? TagReading.ABSENT : TagReading.NO_VERDICT;
                    return new Fact(row.getObject("id", UUID.class), kind,
                            kind == Kind.ACKNOWLEDGEMENT || compartment == null ? null : uuid(compartment),
                            row.getObject("device_session_id", UUID.class), row.getLong("boot_count"),
                            row.getLong("sequence"), instant(row.getObject("occurred_at", OffsetDateTime.class)),
                            instant(row.getObject("received_at", OffsetDateTime.class)),
                            row.getString("reader_status"), window == null ? null : parse(window), tag);
                })
                .list();
    }

    /** Document 06, section 10.1, condition 6: another cell detected the expected tag since the authorization. */
    private boolean tagElsewhere(UUID compartmentId, Operation operation) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.physical_observations p
                    JOIN aegis.inbound_device_messages m ON m.id = p.inbound_message_id
                    WHERE p.type IN ('ASSET_PRESENT', 'ASSET_IDENTIFIER_DETECTED') AND p.identifier_value = :tag
                      AND p.compartment_id <> :compartment AND m.received_at >= :authorized
                )
                """).param("tag", operation.expectedTag()).param("compartment", compartmentId)
                .param("authorized", utc(operation.authorizedAt())).query(Boolean.class).single();
    }

    /**
     * Any sign since the authorization that the cell's door may have opened: an opening of the cell, whatever its
     * operation or session, or a door message the ingestion rejected, whose cell cannot be trusted.
     */
    private boolean doorMaySinceHaveOpened(Target t, Operation operation) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.inbound_device_messages m
                    JOIN aegis.locker_devices d ON d.id = m.locker_device_id
                    WHERE d.locker_id = :locker AND m.received_at >= :authorized
                      AND ((m.message_type = 'DOOR_OPENED' AND m.processing_status <> 'REJECTED'
                            AND m.parsed_payload ->> 'compartmentId' = :compartment)
                           OR (m.message_type IN ('DOOR_OPENED', 'DOOR_CLOSED')
                               AND m.processing_status = 'REJECTED'))
                )
                """).param("locker", t.lockerId()).param("authorized", utc(operation.authorizedAt()))
                .param("compartment", t.compartmentId().toString()).query(Boolean.class).single();
    }

    /**
     * The command never left the outbox: never claimed, never attempted, never published; or the dispatcher cancelled
     * it at its deadline knowing no attempt could have published ({@code COMMAND_EXPIRED}, which it leaves for this
     * expiry on a return).
     */
    private boolean neverSent(UUID operationId) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.command_outbox
                    WHERE operation_id = :id AND published_at IS NULL
                      AND ((status = 'PENDING' AND attempt_count = 0 AND claimed_at IS NULL)
                           OR (status = 'CANCELLED' AND last_error = 'COMMAND_EXPIRED'))
                )
                """).param("id", operationId).query(Boolean.class).single();
    }

    /**
     * Document 05, section 5.4: "locker en ligne et porte certainement restée fermée". The hub is ONLINE in the boot
     * the command targeted, and the cell is connected with its door projected closed.
     */
    private boolean certainlyClosed(Target t, CellState cell, Instant now) {
        if (availability.of(t.lockerId(), now).status() != ConnectionStatus.ONLINE
                || !"CONNECTED".equals(cell.connectionStatus()) || !"CLOSED".equals(cell.doorState())) {
            return false;
        }
        UUID current = preparation.activeDevice(t.lockerId()).map(PreparationRepository.Device::deviceSessionId)
                .orElse(null);
        return current != null && jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.command_outbox x
                    JOIN aegis.local_access_challenges c ON c.operation_id = x.operation_id
                    WHERE x.operation_id = :id AND c.target_device_session_id = :session
                )
                """).param("id", t.id()).param("session", current).query(Boolean.class).single();
    }

    private static Instant later(Instant a, Instant b) {
        return b == null || a.isAfter(b) ? a : b;
    }

    private static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }

    private static Instant parse(String value) {
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (RuntimeException malformed) {
            return null;
        }
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    private static OffsetDateTime utc(Instant value) {
        return value.atOffset(ZoneOffset.UTC);
    }
}
