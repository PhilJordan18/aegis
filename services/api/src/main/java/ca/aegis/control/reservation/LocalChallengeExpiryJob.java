package ca.aegis.control.reservation;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Ends unconsumed local challenges every {@code aegis.display.expiry.interval}. A late pass never lets a challenge be
 * consumed after its deadline: consumption checks {@code expires_at} itself. Tests that control time turn it off with
 * {@code aegis.display.expiry.scheduled=false} and call {@link LocalChallengeExpiry} themselves.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.display.expiry.scheduled", havingValue = "true", matchIfMissing = true)
class LocalChallengeExpiryJob {

    private final LocalChallengeExpiry expiry;
    private final int batchSize;

    LocalChallengeExpiryJob(LocalChallengeExpiry expiry,
            @Value("${aegis.display.expiry.batch-size:100}") int batchSize) {
        this.expiry = expiry;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${aegis.display.expiry.interval:PT5S}",
            initialDelayString = "${aegis.display.expiry.interval:PT5S}")
    void run() {
        expiry.run(batchSize);
    }
}
