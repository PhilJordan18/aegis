package ca.aegis.control.device;

import java.time.Duration;
import java.time.Instant;

/**
 * Document 10, sections 12.1, 12.2 and 17.2: whether a scan is a stabilized reading. Only such a scan gives the
 * expected tag a verdict, and only such a scan may count another asset's tag against a return.
 */
public final class ScanStability {

    private ScanStability() {
    }

    public static boolean stable(String readerStatus, Instant windowStartedAt, Instant windowEndedAt,
            Instant occurredAt, Instant receivedAt) {
        return RfidScan.HEALTHY.equals(readerStatus) && windowStartedAt != null && windowEndedAt != null
                && Duration.between(windowStartedAt, windowEndedAt).compareTo(RfidScan.STABLE_WINDOW) >= 0
                && !occurredAt.isAfter(receivedAt.plus(InboundMessages.MAX_CLOCK_LEAD))
                && !receivedAt.isAfter(occurredAt.plus(RfidScanNormalization.MAX_DELIVERY_DELAY));
    }
}
