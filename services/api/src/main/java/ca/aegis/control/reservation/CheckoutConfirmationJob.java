package ca.aegis.control.reservation;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Re-evaluates the authorized checkouts not yet decided every {@code aegis.operations.evaluation.interval}: this pass
 * alone ends an operation whose {@code expiresAt} passed without a coherent proof, and it retries an evaluation an
 * ingestion trigger could not complete. It then retries the recovery of uncertain checkouts (document 06, section
 * 15.2), whose proof may have arrived while their asset was held. Tests that control time turn it off with
 * {@code aegis.operations.evaluation.scheduled=false} and call {@link CheckoutConfirmation} themselves.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.operations.evaluation.scheduled", havingValue = "true", matchIfMissing = true)
class CheckoutConfirmationJob {

    private final CheckoutConfirmation confirmation;
    private final CheckoutAnomalyRecovery recovery;
    private final int batchSize;

    CheckoutConfirmationJob(CheckoutConfirmation confirmation, CheckoutAnomalyRecovery recovery,
            @Value("${aegis.operations.evaluation.batch-size:100}") int batchSize) {
        this.confirmation = confirmation;
        this.recovery = recovery;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${aegis.operations.evaluation.interval:PT1S}",
            initialDelayString = "${aegis.operations.evaluation.interval:PT1S}")
    void run() {
        confirmation.run(batchSize);
        recovery.run();
    }
}
