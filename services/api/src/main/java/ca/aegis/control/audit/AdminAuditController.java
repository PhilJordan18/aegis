package ca.aegis.control.audit;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.audit.AuditEventReads.Filter;
import ca.aegis.control.shared.web.QueryFilters;

/**
 * The audit timeline of document 09, section 19.1, reserved to administrators by {@code ApiRoutes}. It only reads:
 * the application role cannot change an audit event (document 08, section 12.1).
 */
@RestController
@RequestMapping("/api/v1/admin/audit-events")
class AdminAuditController {

    /** Provisional rule D10 of the 11 November 2026 matrix (#67); the contract bounds the limit to 1-100. */
    static final int DEFAULT_LIMIT = 50;

    private final AuditEventReads events;

    AdminAuditController(AuditEventReads events) {
        this.events = events;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public AuditPage list(@RequestParam(required = false) String eventType,
            @RequestParam(required = false) String subjectType, @RequestParam(required = false) String subjectId,
            @RequestParam(required = false) String operationId, @RequestParam(required = false) String actorUserId,
            @RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String limit, @RequestParam(required = false) String cursor) {
        QueryFilters filters = new QueryFilters();
        Filter filter = new Filter(filters.oneOf("eventType", eventType, AuditEventReads.EVENT_TYPES),
                filters.oneOf("subjectType", subjectType, AuditEventReads.SUBJECT_TYPES),
                filters.uuid("subjectId", subjectId), filters.uuid("operationId", operationId),
                filters.uuid("actorUserId", actorUserId), filters.instant("from", from), filters.instant("to", to));
        filters.requireOrdered(filter.from(), filter.to());
        int size = filters.integer("limit", limit, 1, 100, DEFAULT_LIMIT);
        filters.validate();
        AuditCursor after = cursor == null ? null : AuditCursor.decode(cursor, filter.hash());
        return events.page(filter, after, size);
    }
}
