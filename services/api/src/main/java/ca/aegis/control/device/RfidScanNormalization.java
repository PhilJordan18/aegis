package ca.aegis.control.device;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import ca.aegis.control.device.Inspection.Fact;
import ca.aegis.control.device.PhysicalObservationRepository.ExpectedTag;
import ca.aegis.control.device.PhysicalObservationRepository.Observation;
import ca.aegis.control.device.PhysicalObservationRepository.Type;
import ca.aegis.control.device.RfidScan.ObservedIdentifier;

/**
 * Normalizes an accepted {@code RFID_SCAN_COMPLETED} into physical observations (document 10, section 12.2;
 * document 06, section 9.2), in the transaction that stored the message. An observation is a fact about one scan
 * of one cell: it grants nothing, and no loan, reservation or operation changes here. Whether the asset is present
 * now is decided at read time by {@link PresenceEvidence}.
 */
@Component
class RfidScanNormalization {

    /** Document 10, section 17.2: a later delivery is kept but proves nothing without re-evaluation. */
    static final Duration MAX_DELIVERY_DELAY = Duration.ofSeconds(30);

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final PhysicalObservationRepository observations;

    RfidScanNormalization(PhysicalObservationRepository observations) {
        this.observations = observations;
    }

    /**
     * @param projection the device projection after this fact, which tells whether the scan belongs to the current
     *     session and is newer than the reference heartbeat
     */
    void normalize(UUID lockerId, UUID deviceId, UUID inboundMessageId, UUID operationId, Fact fact,
            Instant occurredAt, Instant receivedAt, DeviceProjection projection) {
        RfidScan scan = fact.rfidScan();
        UUID compartmentId = fact.compartmentId();
        for (ObservedIdentifier identifier : scan.identifiers()) {
            ObjectNode value = JSON.createObjectNode();
            value.put("identifierType", RfidScan.IDENTIFIER_TYPE);
            value.put("readCount", identifier.readCount());
            value.put("readerStatus", scan.readerStatus());
            observations.insert(new Observation(inboundMessageId, lockerId, compartmentId, operationId,
                    Type.ASSET_IDENTIFIER_DETECTED, scan.windowEndedAt(), identifier.value(),
                    JSON.writeValueAsString(value)));
        }
        if (stable(scan, occurredAt, receivedAt)) {
            observations.expectedTag(compartmentId)
                    .filter(expected -> expected.boundSince().isBefore(scan.windowStartedAt())
                            && expected.boundSince().isBefore(receivedAt))
                    .flatMap(expected -> verdict(scan, expected))
                    .ifPresent(verdict -> observations.insert(new Observation(inboundMessageId, lockerId,
                            compartmentId, operationId, verdict.type(), scan.windowEndedAt(),
                            verdict.expected().value(), verdict.valueJson())));
        }
        if (projection.deviceSessionId() != null && projection.deviceSessionId().equals(fact.deviceSessionId())
                && projection.bootCount() == fact.bootCount() && projection.heartbeatSequence() != null
                && fact.sequence() > projection.heartbeatSequence()) {
            observations.applyReaderStatus(lockerId, deviceId, compartmentId, fact.deviceSessionId(), fact.bootCount(),
                    fact.sequence(), scan.readerStatus(), receivedAt);
        }
    }

    /**
     * Section 12.1: a FAULTED or UNKNOWN scan confirms neither presence nor absence. A scan delivered too late, or
     * dated too far ahead of the backend, is kept without a verdict (section 17.2).
     */
    static boolean stable(RfidScan scan, Instant occurredAt, Instant receivedAt) {
        return scan.healthy() && scan.coversStableWindow()
                && !occurredAt.isAfter(receivedAt.plus(InboundMessages.MAX_CLOCK_LEAD))
                && !receivedAt.isAfter(occurredAt.plus(MAX_DELIVERY_DELAY));
    }

    private record Verdict(Type type, ExpectedTag expected, Integer readCount) {

        String valueJson() {
            ObjectNode value = JSON.createObjectNode();
            value.put("assetId", expected.assetId().toString());
            if (readCount != null) {
                value.put("readCount", readCount);
            }
            return JSON.writeValueAsString(value);
        }
    }

    /**
     * Present on three coherent reads of the expected tag; absent when the stable window did not see it at all. One
     * or two reads prove neither. ANO-01 (#52): a presence observed while the asset's loan is open is where document
     * 06, section 12.4, creates {@code ASSET_PRESENT_WITH_ACTIVE_LOAN}; the loan stays open and the asset BORROWED.
     */
    private static Optional<Verdict> verdict(RfidScan scan, ExpectedTag expected) {
        Optional<ObservedIdentifier> observed = scan.observed(expected.value());
        if (observed.isEmpty()) {
            return Optional.of(new Verdict(Type.ASSET_ABSENT, expected, null));
        }
        int reads = observed.get().readCount();
        return reads >= RfidScan.STABLE_READS
                ? Optional.of(new Verdict(Type.ASSET_PRESENT, expected, reads))
                : Optional.empty();
    }
}
