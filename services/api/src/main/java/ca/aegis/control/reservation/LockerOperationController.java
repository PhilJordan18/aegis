package ca.aegis.control.reservation;

import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Document 09, section 15.4: the initiator follows an operation by polling it. Another user's operation is not
 * visible, so it is not found (section 26.2). The view never carries a secret of the challenge.
 */
@RestController
class LockerOperationController {

    private final LockerOperationReads operations;

    LockerOperationController(LockerOperationReads operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/locker-operations/{operationId}")
    ResponseEntity<LockerOperationView> get(@AuthenticationPrincipal CurrentAccount technician,
            @PathVariable UUID operationId) {
        LockerOperationView view = operations.find(operationId)
                .filter(operation -> operation.userId().equals(technician.id()))
                .orElseThrow(ResourceNotFoundException::new);
        ResponseEntity.BodyBuilder response = ResponseEntity.ok().cacheControl(CacheControl.noStore());
        if (view.requiredAction() != RequiredAction.NONE) {
            response.header(HttpHeaders.RETRY_AFTER, "1");
        }
        return response.body(view);
    }
}
