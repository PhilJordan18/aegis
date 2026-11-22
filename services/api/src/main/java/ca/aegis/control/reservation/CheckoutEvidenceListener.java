package ca.aegis.control.reservation;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import ca.aegis.control.device.PhysicalEvidenceStored;
import ca.aegis.control.device.PresenceScanStored;

/** Evaluates an operation as soon as one of its facts is committed, rather than at the next scheduled pass (#47). */
@Component
class CheckoutEvidenceListener {

    private final CheckoutConfirmation confirmation;
    private final CheckoutAnomalyRecovery recovery;

    CheckoutEvidenceListener(CheckoutConfirmation confirmation, CheckoutAnomalyRecovery recovery) {
        this.confirmation = confirmation;
        this.recovery = recovery;
    }

    @EventListener
    void on(PhysicalEvidenceStored stored) {
        confirmation.evaluate(stored.operationId());
    }

    /** Document 06, section 15.2: a scan of a cell may be the proof that an uncertain checkout left its asset there. */
    @EventListener
    void on(PresenceScanStored stored) {
        recovery.afterScan(stored.compartmentId());
    }
}
