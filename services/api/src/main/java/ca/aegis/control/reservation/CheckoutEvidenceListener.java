package ca.aegis.control.reservation;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import ca.aegis.control.device.PhysicalEvidenceStored;

/** Evaluates an operation as soon as one of its facts is committed, rather than at the next scheduled pass (#47). */
@Component
class CheckoutEvidenceListener {

    private final CheckoutConfirmation confirmation;

    CheckoutEvidenceListener(CheckoutConfirmation confirmation) {
        this.confirmation = confirmation;
    }

    @EventListener
    void on(PhysicalEvidenceStored stored) {
        confirmation.evaluate(stored.operationId());
    }
}
