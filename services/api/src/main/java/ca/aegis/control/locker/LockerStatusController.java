package ca.aegis.control.locker;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Document 09, section 16.1; the route is open to technicians and administrators (ApiRoutes). */
@RestController
class LockerStatusController {

    private final LockerStatusService statuses;

    LockerStatusController(LockerStatusService statuses) {
        this.statuses = statuses;
    }

    @GetMapping("/api/v1/lockers/{lockerId}/status")
    LockerStatusView status(@PathVariable UUID lockerId) {
        return statuses.status(lockerId);
    }
}
