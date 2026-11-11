package ca.aegis.control.device;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.postgresql.util.PSQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.command.CommandAcknowledgements;
import ca.aegis.control.display.DisplayAcknowledgements;
import ca.aegis.control.display.DisplayAcknowledgements.DisplayReport;
import ca.aegis.control.command.CommandAcknowledgements.CommandReport;
import ca.aegis.control.device.Inspection.Fact;
import ca.aegis.control.device.Inspection.Storable;
import ca.aegis.control.device.Inspection.Unstorable;
import ca.aegis.control.device.InboundMessageRepository.OperationRef;
import ca.aegis.control.device.InboundMessageRepository.Row;
import ca.aegis.control.device.LockerDeviceRepository.ActiveDevice;

/**
 * The backend ingestion of hub messages (document 10, section 19.1; document 06, section 9; document 08, section
 * 8.2). The payload is inspected outside any transaction; one short transaction then locks the device, reserves the
 * pair (device, messageId), applies the availability projection and normalizes an RFID scan into observations.
 * Nothing here waits for MQTT, and no fact advances a reservation, a loan or a readiness verdict. The one exception
 * for an operation is a command report: {@link CommandAcknowledgements} applies it in the same transaction (document
 * 08, section 9.3).
 */
@Service
public class DeviceMessageIngestion {

    /** How a delivery ended; the transport acknowledges every outcome, since none of them can improve by retrying. */
    public enum Outcome {
        ACCEPTED,
        REJECTED,
        DUPLICATE,
        /** Kept as a technical log line only: no row can hold it without a made-up value (section 19.2). */
        LOGGED
    }

    private static final Logger log = LoggerFactory.getLogger(DeviceMessageIngestion.class);

    /** The facts that can advance an operation's proof (document 06, section 10.3). */
    private static final Set<InboundMessageType> PROOF_TYPES = Set.of(InboundMessageType.COMMAND_ACKNOWLEDGED,
            InboundMessageType.DOOR_OPENED, InboundMessageType.DOOR_CLOSED, InboundMessageType.RFID_SCAN_COMPLETED);

    private final LockerDeviceRepository devices;
    private final InboundMessageRepository messages;
    private final PhysicalObservationRepository observations;
    private final RfidScanNormalization scans;
    private final AuditTrail audit;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final CommandAcknowledgements acknowledgements;
    private final DisplayAcknowledgements displays;
    private final ApplicationEventPublisher events;

    DeviceMessageIngestion(LockerDeviceRepository devices, InboundMessageRepository messages,
            PhysicalObservationRepository observations, RfidScanNormalization scans, AuditTrail audit,
            TransactionTemplate transactions, Clock clock, CommandAcknowledgements acknowledgements,
            DisplayAcknowledgements displays, ApplicationEventPublisher events) {
        this.devices = devices;
        this.messages = messages;
        this.observations = observations;
        this.scans = scans;
        this.audit = audit;
        this.transactions = transactions;
        this.clock = clock;
        this.acknowledgements = acknowledgements;
        this.displays = displays;
        this.events = events;
    }

    public Outcome ingest(String topic, byte[] payload) {
        Instant receivedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Optional<InboundTopic> parsed = InboundTopic.parse(topic);
        if (parsed.isEmpty()) {
            log.warn("Device message ignored: processingError={}, topic outside the contract",
                    ProcessingError.TOPIC_NOT_AUTHORIZED);
            return Outcome.LOGGED;
        }
        InboundTopic inbound = parsed.get();
        Inspection inspection = InboundMessages.inspect(inbound, payload, receivedAt);
        if (inspection instanceof Unstorable unstorable) {
            logOnly(inbound, unstorable.error(), unstorable.messageId(), payload.length);
            return Outcome.LOGGED;
        }
        Storable storable = (Storable) inspection;
        Outcome outcome;
        try {
            outcome = transactions.execute(status -> store(inbound, storable, payload, receivedAt));
        } catch (DataIntegrityViolationException refused) {
            // Deterministic: a redelivery would be refused again. PgJDBC's own message quotes the failing row,
            // hence the payload, so only the SQLState and the constraint name are logged.
            log.error("Device message refused by a database constraint and not stored: lockerId={}, messageId={}, "
                    + "sqlState={}, constraint={}", inbound.lockerId(), storable.messageId(), sqlState(refused),
                    constraint(refused));
            return Outcome.LOGGED;
        }
        if (outcome == Outcome.ACCEPTED && storable.fact() != null && storable.fact().operationId() != null
                && PROOF_TYPES.contains(storable.type())) {
            // After the commit, never inside it: the evaluation locks the operation's owners in the order of document
            // 08, section 7.1, which the device lock taken above would invert (#47).
            events.publishEvent(new PhysicalEvidenceStored(storable.fact().operationId()));
        }
        return outcome;
    }

    private static String sqlState(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql) {
                return sql.getSQLState();
            }
        }
        return null;
    }

    private static String constraint(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres && postgres.getServerErrorMessage() != null) {
                return postgres.getServerErrorMessage().getConstraint();
            }
        }
        return null;
    }

    private Outcome store(InboundTopic topic, Storable message, byte[] payload, Instant receivedAt) {
        Optional<ActiveDevice> active = devices.lockActive(topic.lockerId());
        if (active.isEmpty()) {
            logOnly(topic, devices.hasDisabledDevice(topic.lockerId())
                    ? ProcessingError.DEVICE_DISABLED : ProcessingError.DEVICE_UNKNOWN, message.messageId(),
                    payload.length);
            return Outcome.LOGGED;
        }
        ActiveDevice device = active.get();
        ProcessingError rejection = message.rejection();
        Fact fact = message.fact();

        if (message.type().commandCorrelated() || message.type().displayCorrelated()) {
            // ck_inbound_messages_command_correlation and _display_correlation require an existing reference even
            // on a rejected row, so a rejected or uncorrelated acknowledgement cannot be kept as a row.
            boolean correlated = rejection == null && (message.type().commandCorrelated()
                    ? messages.commandExists(fact.commandMessageId())
                    : messages.displayExists(fact.displayMessageId()));
            if (!correlated) {
                logOnly(topic, rejection == null ? ProcessingError.COMMAND_CORRELATION_INVALID : rejection,
                        message.messageId(), payload.length);
                return Outcome.LOGGED;
            }
        }

        UUID operationId = null;
        if (rejection == null && fact.operationId() != null) {
            Optional<OperationRef> operation = messages.operation(fact.operationId());
            if (operation.isEmpty()) {
                rejection = ProcessingError.OPERATION_NOT_FOUND;
            } else {
                operationId = operation.get().id();
                if (!operation.get().lockerId().equals(device.lockerId())) {
                    rejection = ProcessingError.OPERATION_LOCKER_MISMATCH;
                } else if (fact.compartmentId() != null
                        && !operation.get().compartmentId().equals(fact.compartmentId())) {
                    rejection = ProcessingError.OPERATION_COMPARTMENT_MISMATCH;
                }
            }
            if (rejection != null && message.type().displayCorrelated()) {
                logOnly(topic, rejection, message.messageId(), payload.length);
                return Outcome.LOGGED;
            }
        }
        boolean rfidScan = rejection == null && message.type() == InboundMessageType.RFID_SCAN_COMPLETED;
        if (rfidScan && !observations.compartmentOf(device.lockerId(), fact.compartmentId())) {
            // Section 21 has no code for a cell outside the locker; the observation could not reference it.
            rejection = ProcessingError.REQUIRED_FIELD_MISSING;
            rfidScan = false;
        }

        Row row = rejection != null
                ? new Row(device.id(), message.messageId(), topic.value(), message.type(), operationId,
                        fact != null && message.type().commandCorrelated() ? fact.commandMessageId() : null,
                        null, message.schemaVersion(), null, null, null, null, null, message.occurredAt(),
                        receivedAt, payload, null, "REJECTED", rejection)
                : new Row(device.id(), message.messageId(), topic.value(), message.type(), operationId,
                        fact.commandMessageId(), fact.displayMessageId(), message.schemaVersion(),
                        fact.deviceSessionId(), fact.bootCount(), fact.sequence(), fact.connectionId(),
                        fact.availabilityStatus(), message.occurredAt(), receivedAt, payload, fact.parsedJson(),
                        processed(message.type(), operationId) ? "PROCESSED" : "RECEIVED", null);
        Optional<UUID> inserted = messages.insert(row);
        if (inserted.isEmpty()) {
            UUID existing = messages.idOf(device.id(), message.messageId());
            audit.recordAboutInboundMessage(new AuditEvent(AuditEventType.MQTT_MESSAGE_DUPLICATE_IGNORED, null,
                    AuditSubjectType.INBOUND_DEVICE_MESSAGE, existing, AuditResult.ALREADY_APPLIED,
                    Map.of("lockerId", device.lockerId().toString(), "messageType", message.type().name()),
                    receivedAt), existing);
            log.debug("Duplicate device message ignored: lockerId={}, messageId={}", device.lockerId(),
                    message.messageId());
            return Outcome.DUPLICATE;
        }
        if (rejection != null) {
            log.warn("Device message rejected: lockerId={}, lockerDeviceId={}, messageId={}, type={}, "
                    + "schemaVersion={}, processingError={}", device.lockerId(), device.id(), message.messageId(),
                    message.type(), printable(message.schemaVersion()), rejection);
            return Outcome.REJECTED;
        }
        DeviceProjection projection = project(device, message, fact, receivedAt);
        if (message.type().commandCorrelated()) {
            return applyCommandReport(device, message, fact, inserted.get(), receivedAt);
        }
        if (message.type().displayCorrelated()) {
            return applyDisplayReport(device, message, fact, inserted.get(), receivedAt);
        }
        if (rfidScan) {
            scans.normalize(device.lockerId(), device.id(), inserted.get(), operationId, fact, message.occurredAt(),
                    receivedAt, projection);
        }
        return Outcome.ACCEPTED;
    }

    /** IOT-02 #41: the stored report decides its command and operation in this same transaction. */
    private Outcome applyCommandReport(ActiveDevice device, Storable message, Fact fact, UUID inboundId,
            Instant receivedAt) {
        Optional<CommandReport> report = CommandReport.stored(inboundId, message.type().name(),
                fact.commandMessageId(), fact.operationId(), device.lockerId(), fact.compartmentId(), fact.parsedJson(),
                receivedAt);
        ProcessingError rejection = report.isEmpty() ? ProcessingError.REQUIRED_FIELD_MISSING : switch (
                acknowledgements.apply(report.get())) {
            case APPLIED, ALREADY_APPLIED, ANOMALY_RAISED -> null;
            case NOT_CORRELATED -> ProcessingError.COMMAND_CORRELATION_INVALID;
            case OUTSIDE_VALIDITY_WINDOW -> ProcessingError.TIMESTAMP_OUT_OF_RANGE;
            case TERMINAL_IGNORED -> ProcessingError.TERMINAL_OPERATION_EVENT_IGNORED;
        };
        if (rejection == null) {
            messages.markProcessed(inboundId);
            return Outcome.ACCEPTED;
        }
        messages.markRejected(inboundId, rejection);
        log.warn("Command report not applied: lockerId={}, messageId={}, type={}, processingError={}",
                device.lockerId(), message.messageId(), message.type(), rejection);
        return Outcome.REJECTED;
    }

    /** #43: the stored display report decides its challenge and its instruction in this same transaction. */
    private Outcome applyDisplayReport(ActiveDevice device, Storable message, Fact fact, UUID inboundId,
            Instant receivedAt) {
        ProcessingError rejection = switch (displays.apply(new DisplayReport(inboundId,
                message.type() == InboundMessageType.ACCESS_CHALLENGE_DISPLAYED, fact.displayMessageId(),
                fact.operationId(), device.lockerId(), fact.deviceSessionId(), fact.parsedJson(), receivedAt))) {
            case APPLIED, ALREADY_APPLIED -> null;
            case NOT_CORRELATED -> ProcessingError.COMMAND_CORRELATION_INVALID;
            case MALFORMED -> ProcessingError.REQUIRED_FIELD_MISSING;
            case OUTSIDE_VALIDITY_WINDOW -> ProcessingError.TIMESTAMP_OUT_OF_RANGE;
            case TERMINAL_IGNORED -> ProcessingError.TERMINAL_OPERATION_EVENT_IGNORED;
        };
        if (rejection == null) {
            messages.markProcessed(inboundId);
            return Outcome.ACCEPTED;
        }
        messages.markRejected(inboundId, rejection);
        log.warn("Display report not applied: lockerId={}, messageId={}, type={}, processingError={}",
                device.lockerId(), message.messageId(), message.type(), rejection);
        return Outcome.REJECTED;
    }

    /**
     * A technical fact is fully processed here. So is an RFID scan outside any operation, once normalized; inside one,
     * its observations are stored but the operation workflow that interprets them keeps it RECEIVED.
     */
    private static boolean processed(InboundMessageType type, UUID operationId) {
        return type.technical() || (type == InboundMessageType.RFID_SCAN_COMPLETED && operationId == null);
    }

    private DeviceProjection project(ActiveDevice device, Storable message, Fact fact, Instant receivedAt) {
        AvailabilityProjection.Outcome outcome = AvailabilityProjection.apply(device.projection(), message.type(),
                fact, receivedAt, connection -> devices.connectionClosed(device.id(), fact.bootCount(), connection,
                        device.provisionedAt()));
        if (outcome.sessionConflict()) {
            log.warn("Device counter not conforming, projection unchanged: lockerId={}, lockerDeviceId={}, "
                    + "messageId={}, bootCount={} carried by two deviceSessionId values", device.lockerId(),
                    device.id(), message.messageId(), fact.bootCount());
        }
        if (message.type() == InboundMessageType.DEVICE_ERROR) {
            log.warn("Device error reported: lockerId={}, lockerDeviceId={}, messageId={}, errorCode={}",
                    device.lockerId(), device.id(), message.messageId(), fact.errorCode());
        }
        ConnectionStatus status = AvailabilityProjection.evaluate(outcome.projection(), receivedAt);
        if (!outcome.projection().equals(device.projection()) || status != device.cachedStatus()) {
            devices.save(device, outcome.projection(), status, receivedAt);
        }
        if (outcome.newReference()) {
            List<UUID> applied = new ArrayList<>();
            for (CompartmentReport report : fact.compartments()) {
                if (devices.applyCompartment(device, fact, report, receivedAt)) {
                    applied.add(report.compartmentId());
                } else {
                    log.warn("Heartbeat cell ignored: lockerId={}, messageId={}, compartmentId={} is not a cell "
                            + "of this locker at cellAddress {}", device.lockerId(), message.messageId(),
                            report.compartmentId(), report.cellAddress());
                }
            }
            devices.forgetCompartmentsOtherThan(device.lockerId(), applied, receivedAt);
        }
        return outcome.projection();
    }

    private static void logOnly(InboundTopic topic, ProcessingError error, UUID messageId, int size) {
        log.warn("Device message not stored: lockerId={}, messageId={}, processingError={}, payloadBytes={}",
                topic.lockerId(), messageId, error, size);
    }

    private static String printable(String value) {
        return value.replaceAll("[^\\x20-\\x7E]", "?");
    }
}
