package ca.aegis.control.device;

import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.device.LockerDeviceRepository.ActiveDevice;
import ca.aegis.control.device.PhysicalObservationRepository.CompartmentState;
import ca.aegis.control.device.PhysicalObservationRepository.ConnectionStart;
import ca.aegis.control.device.PhysicalObservationRepository.Detection;
import ca.aegis.control.device.PhysicalObservationRepository.Observation;
import ca.aegis.control.device.PhysicalObservationRepository.PhysicalEvent;
import ca.aegis.control.device.PhysicalObservationRepository.Type;
import ca.aegis.control.device.PhysicalObservationRepository.UnobservedCell;

/**
 * Whether an expected tag is in its cell now, derived at every read from stored facts (document 04, section 13:
 * "la dernière séquence physique stable et cohérente"; document 06, sections 4.2 and 4.4). Anything short of
 * coherent proof is {@code UNKNOWN}: silence, a missing message or an old fact never proves absence (document 10,
 * section 12.1). Nothing here is persisted, locked or written.
 */
@Component
public class PresenceEvidence {

    public enum Verdict {
        PRESENT,
        ABSENT,
        UNKNOWN
    }

    /**
     * @param boundSince when the asset became expected with this tag in this cell: the later of its placement and of
     *     its identifier assignment
     */
    public record Expectation(UUID compartmentId, String rfidValue, Instant boundSince) {
    }

    /** The facts of one locker that every expectation in it shares. */
    private record LockerFacts(ConnectionStart start, List<PhysicalEvent> events, List<UnobservedCell> unobserved,
            List<Rejected> rejected) {
    }

    /**
     * A rejected door or scan message that may void a scan: when it claims a sequence of the current session it voids
     * the scans not after that sequence, whenever it arrived; otherwise it voids the scans received before it.
     */
    private record Rejected(Instant receivedAt, Long sequence) {

        boolean voids(PhysicalEvent scan) {
            return sequence != null ? sequence >= scan.sequence() : !receivedAt.isBefore(scan.receivedAt());
        }
    }

    private final LockerDeviceRepository devices;
    private final PhysicalObservationRepository observations;

    PresenceEvidence(LockerDeviceRepository devices, PhysicalObservationRepository observations) {
        this.devices = devices;
        this.observations = observations;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Map<Expectation, Verdict> evaluate(Collection<Expectation> expectations, Instant now) {
        Map<Expectation, Verdict> verdicts = new HashMap<>();
        if (expectations.isEmpty()) {
            return verdicts;
        }
        Map<UUID, CompartmentState> cells = observations.compartments(expectations.stream()
                        .map(Expectation::compartmentId).collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(CompartmentState::id, Function.identity()));
        Map<UUID, Optional<LockerFacts>> lockers = new HashMap<>();
        cells.values().stream()
                .collect(Collectors.groupingBy(CompartmentState::lockerId,
                        Collectors.mapping(CompartmentState::id, Collectors.toList())))
                .forEach((locker, compartments) -> lockers.put(locker, lockerFacts(locker, compartments, now)));
        Map<String, Set<UUID>> standing = observations.standingDetections(expectations.stream()
                        .map(Expectation::rfidValue).collect(Collectors.toSet())).stream()
                .collect(Collectors.groupingBy(Detection::identifierValue,
                        Collectors.mapping(Detection::compartmentId, Collectors.toSet())));

        Map<Expectation, PhysicalEvent> latestScans = new HashMap<>();
        for (Expectation expectation : expectations) {
            CompartmentState cell = cells.get(expectation.compartmentId());
            Optional<LockerFacts> facts = cell == null ? Optional.empty() : lockers.get(cell.lockerId());
            Optional<PhysicalEvent> scan = facts.flatMap(locker -> usableScan(expectation, cell, locker));
            if (scan.isPresent()) {
                latestScans.put(expectation, scan.get());
            } else {
                verdicts.put(expectation, Verdict.UNKNOWN);
            }
        }
        Map<UUID, List<Observation>> recorded = latestScans.isEmpty() ? Map.of()
                : observations.verdicts(latestScans.values().stream().map(PhysicalEvent::id).toList()).stream()
                        .collect(Collectors.groupingBy(Observation::inboundMessageId));
        latestScans.forEach((expectation, scan) -> {
            CompartmentState cell = cells.get(expectation.compartmentId());
            verdicts.put(expectation, verdict(expectation, scan, lockers.get(cell.lockerId()).orElseThrow(),
                    recorded.getOrDefault(scan.id(), List.of()), standing.getOrDefault(expectation.rfidValue(),
                            Set.of())));
        });
        return verdicts;
    }

    /** Facts of the current connection of an ONLINE locker; empty otherwise, which leaves its cells UNKNOWN. */
    private Optional<LockerFacts> lockerFacts(UUID lockerId, List<UUID> compartmentIds, Instant now) {
        Optional<ActiveDevice> active = devices.active(lockerId);
        if (active.isEmpty()
                || AvailabilityProjection.evaluate(active.get().projection(), now) != ConnectionStatus.ONLINE) {
            return Optional.empty();
        }
        ActiveDevice device = active.get();
        return observations.connectionStart(device.id(), device.projection(), device.provisionedAt())
                .map(start -> new LockerFacts(start,
                        observations.events(device.id(), device.projection(), device.provisionedAt(),
                                start.sequence()),
                        observations.unobservedCells(device.id(), device.projection(), device.provisionedAt(),
                                start.sequence(), compartmentIds),
                        rejected(device, start)));
    }

    /**
     * Rejected messages since the connection started. One from an earlier boot was made before every scan of this
     * one and is ignored; one that claims no readable position of this boot cannot be ordered by sequence.
     */
    private List<Rejected> rejected(ActiveDevice device, ConnectionStart start) {
        DeviceProjection projection = device.projection();
        return observations.rejectedDoorOrScanMessages(device.id(), device.provisionedAt(), start.receivedAt())
                .stream()
                .filter(message -> message.claimed()
                        .map(claimed -> claimed.bootCount() >= projection.bootCount()).orElse(true))
                .map(message -> new Rejected(message.receivedAt(), message.claimed()
                        .filter(claimed -> claimed.bootCount() == projection.bootCount()
                                && claimed.deviceSessionId().equals(projection.deviceSessionId()))
                        .map(InboundMessages.Position::sequence).orElse(null)))
                .toList();
    }

    /**
     * The latest scan of the cell, when it can still speak for it: the cell is enabled, connected, its reader healthy
     * and its door closed now; the scan is healthy, made inside the current connection after the asset became
     * expected, and no door event of the cell follows it or falls inside its window. Document 04, section 13, and
     * document 06, sections 4.4 and 9.3: stored evidence that the door may have moved since also voids it, namely a
     * later heartbeat of the session that does not report the cell connected with its door closed (while the cell's
     * link is down its door is not observed), or a door or scan message of the device rejected after the scan, whose
     * cell is unknown: after it in the sequence its payload claims, or received after it when no sequence can be read.
     */
    private static Optional<PhysicalEvent> usableScan(Expectation expectation, CompartmentState cell,
            LockerFacts facts) {
        if (!cell.enabled() || !"CONNECTED".equals(cell.connectionStatus())
                || !RfidScan.HEALTHY.equals(cell.readerStatus()) || !"CLOSED".equals(cell.doorState())) {
            return Optional.empty();
        }
        // A message whose cell cannot be read counts as a scan or a door event of every cell.
        Optional<PhysicalEvent> latest = facts.events().stream()
                .filter(event -> event.type() == InboundMessageType.RFID_SCAN_COMPLETED || !event.attributable())
                .filter(event -> !event.attributable() || event.compartmentId().equals(cell.id()))
                .max(Comparator.comparingLong(PhysicalEvent::sequence));
        if (latest.isEmpty() || !latest.get().attributable()
                || latest.get().type() != InboundMessageType.RFID_SCAN_COMPLETED) {
            return Optional.empty();
        }
        PhysicalEvent scan = latest.get();
        if (!RfidScan.HEALTHY.equals(scan.readerStatus()) || scan.windowStartedAt() == null
                || scan.windowStartedAt().isBefore(facts.start().occurredAt())
                || !scan.windowStartedAt().isAfter(expectation.boundSince())
                || !scan.receivedAt().isAfter(expectation.boundSince())) {
            return Optional.empty();
        }
        boolean doorMovedSince = facts.events().stream()
                .filter(event -> !event.attributable() || (event.compartmentId().equals(cell.id())
                        && event.type() != InboundMessageType.RFID_SCAN_COMPLETED))
                .anyMatch(event -> event.sequence() > scan.sequence()
                        || (event.type() == InboundMessageType.DOOR_OPENED
                                && !event.occurredAt().isBefore(scan.windowStartedAt()))
                        || event.occurredAt().isAfter(scan.windowStartedAt()));
        boolean unobservedSince = facts.unobserved().stream()
                .anyMatch(report -> report.sequence() > scan.sequence() && report.compartmentId().equals(cell.id()));
        boolean rejectedSince = facts.rejected().stream().anyMatch(rejected -> rejected.voids(scan));
        return doorMovedSince || unobservedSince || rejectedSince ? Optional.empty() : Optional.of(scan);
    }

    private static Verdict verdict(Expectation expectation, PhysicalEvent scan, LockerFacts facts,
            List<Observation> recorded, Set<UUID> standingIn) {
        // Document 10, section 12.2, and document 06, section 10.2: a tag another cell still reports is ambiguous.
        if (standingIn.stream().anyMatch(compartment -> !compartment.equals(expectation.compartmentId()))) {
            return Verdict.UNKNOWN;
        }
        Optional<Type> recordedVerdict = recorded.stream()
                .filter(observation -> expectation.rfidValue().equals(observation.identifierValue()))
                .map(Observation::type).findFirst();
        if (recordedVerdict.isEmpty()) {
            return Verdict.UNKNOWN;
        }
        if (recordedVerdict.get() == Type.ASSET_PRESENT) {
            return Verdict.PRESENT;
        }
        return closedAfterOpening(expectation.compartmentId(), scan, facts) ? Verdict.ABSENT : Verdict.UNKNOWN;
    }

    /**
     * Document 03, section 4.16: ABSENT also needs a complete door sequence. The last door event of the cell before
     * the scan is its closing, at the latest when the window starts, and an opening of that cell precedes it, both
     * inside the current connection.
     */
    private static boolean closedAfterOpening(UUID compartmentId, PhysicalEvent scan, LockerFacts facts) {
        List<PhysicalEvent> doors = facts.events().stream()
                .filter(event -> event.sequence() < scan.sequence())
                .filter(event -> !event.attributable() || (event.compartmentId().equals(compartmentId)
                        && event.type() != InboundMessageType.RFID_SCAN_COMPLETED))
                .sorted(Comparator.comparingLong(PhysicalEvent::sequence))
                .toList();
        if (doors.isEmpty()) {
            return false;
        }
        PhysicalEvent closing = doors.getLast();
        if (!closing.attributable() || closing.type() != InboundMessageType.DOOR_CLOSED
                || closing.occurredAt().isAfter(scan.windowStartedAt())) {
            return false;
        }
        return doors.stream().anyMatch(event -> event.attributable()
                && event.type() == InboundMessageType.DOOR_OPENED && event.sequence() < closing.sequence());
    }
}
