package ca.aegis.control.reservation;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * The scheduled half of document 06, section 14: expires due reservations every
 * {@code aegis.reservations.expiry.interval}. The other half is the re-evaluation at the start of each action, so a
 * late or stopped scheduler delays an expiry but never lets an action use a due reservation. Tests that control time
 * turn it off with {@code aegis.reservations.expiry.scheduled=false} and call {@link ReservationExpiry} themselves.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.reservations.expiry.scheduled", havingValue = "true", matchIfMissing = true)
class ReservationExpiryJob {

    private final ReservationExpiry expiry;
    private final int batchSize;

    ReservationExpiryJob(ReservationExpiry expiry, @Value("${aegis.reservations.expiry.batch-size:100}") int batchSize) {
        this.expiry = expiry;
        this.batchSize = batchSize;
    }

    /**
     * One pass over every due reservation, read in pages of {@code batch-size}; a pass never overlaps another in this
     * instance. Scheduling itself is enabled by {@code SchedulingConfiguration}, not by this conditional job.
     */
    @Scheduled(fixedDelayString = "${aegis.reservations.expiry.interval:PT15S}",
            initialDelayString = "${aegis.reservations.expiry.interval:PT15S}")
    void run() {
        expiry.expireDue(batchSize);
    }
}
