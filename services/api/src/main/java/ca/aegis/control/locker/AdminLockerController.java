package ca.aegis.control.locker;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;

/** Document 09, section 16.2; administrators only (section 9.3). Unknown query parameters are ignored. */
@RestController
class AdminLockerController {

    private final AdminLockerService lockers;

    AdminLockerController(AdminLockerService lockers) {
        this.lockers = lockers;
    }

    @GetMapping("/api/v1/admin/lockers")
    PageResponse<AdminLockerView> list(@RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        return lockers.list(PageQuery.parse(page, size));
    }
}
