package ca.aegis.control.identity;

import java.time.Clock;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Bounded retention of ADR-017: deletes browser sessions 30 days after they ended, in batches. Open sessions and audit
 * events are never touched. Tests turn it off with {@code aegis.security.browser-session.purge.scheduled=false} and
 * call {@link #run()} themselves.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.security.browser-session.purge.scheduled", havingValue = "true",
        matchIfMissing = true)
class BrowserSessionPurgeJob {

    static final Duration RETENTION = Duration.ofDays(30);

    private final BrowserSessions sessions;
    private final Clock clock;
    private final int batchSize;

    BrowserSessionPurgeJob(BrowserSessions sessions, Clock clock,
            @Value("${aegis.security.browser-session.purge.batch-size:500}") int batchSize) {
        this.sessions = sessions;
        this.clock = clock;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${aegis.security.browser-session.purge.interval:PT1H}",
            initialDelayString = "${aegis.security.browser-session.purge.interval:PT1H}")
    void run() {
        int deleted;
        do {
            deleted = sessions.purgeEndedBefore(clock.instant().minus(RETENTION), batchSize);
        } while (deleted == batchSize);
    }
}
