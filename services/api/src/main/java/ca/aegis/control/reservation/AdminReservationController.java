package ca.aegis.control.reservation;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.reservation.ReservationRepository.AdminFilter;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.QueryFilters;

/**
 * Read-only routes of document 09, section 17, reserved to administrators by {@code ApiRoutes}. No route here changes
 * a reservation, a loan, an operation or the custody of an asset.
 */
@RestController
@RequestMapping("/api/v1/admin/reservations")
class AdminReservationController {

    private final ReservationService reservations;

    AdminReservationController(ReservationService reservations) {
        this.reservations = reservations;
    }

    @GetMapping
    PageResponse<AdminReservationView> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String assetId, @RequestParam(required = false) String userId,
            @RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size) {
        QueryFilters filters = new QueryFilters();
        AdminFilter filter = new AdminFilter(filters.enumeration("status", status, ReservationStatus.class),
                filters.uuid("assetId", assetId), filters.uuid("userId", userId), filters.instant("from", from),
                filters.instant("to", to));
        filters.requireOrdered(filter.from(), filter.to());
        filters.validate();
        return reservations.adminList(filter, PageQuery.parse(page, size));
    }

    @GetMapping("/{reservationId}")
    AdminReservationView get(@PathVariable UUID reservationId) {
        return reservations.adminGet(reservationId);
    }
}
