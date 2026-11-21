package ca.aegis.control.anomaly;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.anomaly.AnomalyRepository.AdminFilter;
import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResult;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.QueryFilters;

/**
 * Routes of document 09, section 18, reserved to administrators by {@code ApiRoutes}. There is no resolve route. The
 * acknowledgement is an idempotent mutation of section 20.1 whose audited actor is the authenticated account.
 */
@RestController
@RequestMapping("/api/v1/admin/anomalies")
class AdminAnomalyController {

    private final AnomalyService anomalies;
    private final IdempotencyService idempotency;

    AdminAnomalyController(AnomalyService anomalies, IdempotencyService idempotency) {
        this.anomalies = anomalies;
        this.idempotency = idempotency;
    }

    @GetMapping
    PageResponse<AnomalyView> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String type, @RequestParam(required = false) String severity,
            @RequestParam(required = false) String assetId,
            @RequestParam(required = false) String lockerOperationId, @RequestParam(required = false) String from,
            @RequestParam(required = false) String to, @RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        QueryFilters filters = new QueryFilters();
        AdminFilter filter = new AdminFilter(filters.enumeration("status", status, AnomalyStatus.class),
                filters.enumeration("type", type, AnomalyType.class),
                filters.enumeration("severity", severity, AnomalySeverity.class), filters.uuid("assetId", assetId),
                filters.uuid("lockerOperationId", lockerOperationId), filters.instant("from", from),
                filters.instant("to", to));
        filters.requireOrdered(filter.from(), filter.to());
        filters.validate();
        return anomalies.list(filter, PageQuery.parse(page, size));
    }

    @GetMapping("/{anomalyId}")
    AnomalyDetailView get(@PathVariable UUID anomalyId) {
        return anomalies.detail(anomalyId);
    }

    @PostMapping(path = "/{anomalyId}/acknowledge", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<JsonNode> acknowledge(IdempotentRequest idempotentRequest, @PathVariable UUID anomalyId,
            @Valid @RequestBody AcknowledgeAnomalyRequest request) {
        return idempotency.execute(idempotentRequest, request, () -> IdempotentResult.ok(
                anomalies.acknowledge(anomalyId, idempotentRequest.actorUserId(), request.note())));
    }
}
