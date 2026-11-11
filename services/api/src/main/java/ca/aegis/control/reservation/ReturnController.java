package ca.aegis.control.reservation;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResource;
import ca.aegis.control.shared.idempotency.IdempotentResult;

/** Document 09, section 15.2, reserved to technicians by {@code ApiRoutes}; the body is empty, as for a checkout. */
@RestController
class ReturnController {

    private final ReturnPreparation returns;
    private final IdempotencyService idempotency;

    ReturnController(ReturnPreparation returns, IdempotencyService idempotency) {
        this.returns = returns;
        this.idempotency = idempotency;
    }

    @PostMapping("/api/v1/loans/{loanId}/return")
    ResponseEntity<JsonNode> prepare(IdempotentRequest idempotentRequest, @PathVariable UUID loanId,
            @RequestBody(required = false) ReturnRequest request) {
        return idempotency.execute(idempotentRequest, () -> {
            LockerOperationView prepared = returns.prepare(idempotentRequest.actorUserId(), loanId);
            return IdempotentResult.accepted(IdempotentResource.LOCKER_OPERATION, prepared.id(), prepared);
        });
    }
}
