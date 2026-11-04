package ca.aegis.control.reservation;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResource;
import ca.aegis.control.shared.idempotency.IdempotentResult;

/**
 * Technician reservation routes of document 09, sections 14.1 to 14.4, reserved to technicians by {@code ApiRoutes}.
 * Creation and cancellation are idempotent mutations (section 20.1): {@link IdempotencyService} owns their
 * transaction. Each one first expires, in a transaction of its own, the due reservations it could meet (document 06,
 * section 14), so that the scheduler's delay never decides its outcome.
 */
@RestController
class ReservationController {

    private final ReservationService reservations;
    private final ReservationExpiry expiry;
    private final IdempotencyService idempotency;

    ReservationController(ReservationService reservations, ReservationExpiry expiry, IdempotencyService idempotency) {
        this.reservations = reservations;
        this.expiry = expiry;
        this.idempotency = idempotency;
    }

    @PostMapping(path = "/api/v1/reservations", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<JsonNode> create(IdempotentRequest idempotentRequest,
            @Valid @RequestBody CreateReservationRequest request) {
        expiry.expireDueBefore(idempotentRequest.actorUserId(), request.assetId());
        return idempotency.execute(idempotentRequest, request, () -> {
            ReservationView created = reservations.create(idempotentRequest.actorUserId(), request);
            return IdempotentResult.created(IdempotentResource.RESERVATION, created.id(), created);
        });
    }

    /**
     * Document 09, section 14.4: the body is absent or an empty JSON object, so both requests have the same hash; any
     * property is refused by {@code fail-on-unknown-properties}.
     */
    @PostMapping("/api/v1/reservations/{reservationId}/cancel")
    ResponseEntity<JsonNode> cancel(IdempotentRequest idempotentRequest, @PathVariable UUID reservationId,
            @RequestBody(required = false) CancelReservationRequest request) {
        expiry.expireDueBefore(idempotentRequest.actorUserId(), null);
        return idempotency.execute(idempotentRequest, () -> IdempotentResult.ok(
                reservations.cancel(idempotentRequest.actorUserId(), reservationId)));
    }

    @GetMapping("/api/v1/me/reservation")
    ReservationView mine(@AuthenticationPrincipal CurrentAccount technician) {
        return reservations.activeOf(technician.id());
    }

    @GetMapping("/api/v1/reservations/{reservationId}")
    ReservationView get(@AuthenticationPrincipal CurrentAccount technician, @PathVariable UUID reservationId) {
        return reservations.ownedBy(technician.id(), reservationId);
    }
}
