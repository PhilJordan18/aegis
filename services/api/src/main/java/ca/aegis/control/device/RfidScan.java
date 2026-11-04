package ca.aegis.control.device;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** The validated body of an {@code RFID_SCAN_COMPLETED} (document 10, section 12.1). */
record RfidScan(Instant windowStartedAt, Instant windowEndedAt, String readerStatus,
        List<ObservedIdentifier> identifiers) {

    static final String HEALTHY = "HEALTHY";
    static final String IDENTIFIER_TYPE = "RFID_UHF";
    static final int MAX_IDENTIFIERS = 32;
    static final int MAX_IDENTIFIER_LENGTH = 255;
    static final int MAX_READ_COUNT = 65_535;
    static final Duration MAX_WINDOW = Duration.ofSeconds(10);
    /** Document 10, section 12.2, and document 03, section 4.16: a stable reading covers three seconds. */
    static final Duration STABLE_WINDOW = Duration.ofSeconds(3);
    /** Document 10, sections 12.2 and 23.3, point 4: three coherent reads of the expected tag. */
    static final int STABLE_READS = 3;

    record ObservedIdentifier(String value, int readCount) {
    }

    RfidScan {
        identifiers = List.copyOf(identifiers);
    }

    boolean healthy() {
        return HEALTHY.equals(readerStatus);
    }

    boolean coversStableWindow() {
        return Duration.between(windowStartedAt, windowEndedAt).compareTo(STABLE_WINDOW) >= 0;
    }

    Optional<ObservedIdentifier> observed(String value) {
        return identifiers.stream().filter(identifier -> identifier.value().equals(value)).findFirst();
    }
}
