package ca.aegis.control.reservation;

import java.util.List;
import java.util.UUID;

import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.reservation.LockerOperationReads.AdminFilter;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.QueryFilters;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Read-only routes of document 09, section 17, reserved to administrators by {@code ApiRoutes}. There is no
 * confirm-operation route: an operation only moves through its backend state machine (document 05, section 5).
 */
@RestController
@RequestMapping("/api/v1/admin/locker-operations")
class AdminLockerOperationController {

    private final LockerOperationReads operations;

    AdminLockerOperationController(LockerOperationReads operations) {
        this.operations = operations;
    }

    /** The count and the page see one snapshot. */
    @GetMapping
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResponse<LockerOperationView> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String assetId, @RequestParam(required = false) String userId,
            @RequestParam(required = false) String lockerId, @RequestParam(required = false) String from,
            @RequestParam(required = false) String to, @RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        QueryFilters filters = new QueryFilters();
        AdminFilter filter = new AdminFilter(filters.enumeration("status", status, LockerOperationStatus.class),
                filters.uuid("assetId", assetId), filters.uuid("userId", userId),
                filters.uuid("lockerId", lockerId), filters.instant("from", from), filters.instant("to", to));
        filters.requireOrdered(filter.from(), filter.to());
        filters.validate();
        PageQuery query = PageQuery.parse(page, size);
        long total = operations.count(filter);
        return PageResponse.of(total == 0 ? List.of() : operations.page(filter, query), query, total);
    }

    @GetMapping("/{operationId}")
    LockerOperationView get(@PathVariable UUID operationId) {
        return operations.find(operationId).orElseThrow(ResourceNotFoundException::new);
    }
}
