package ca.aegis.control.locker;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.identity.CurrentAccount;

/** Routes of document 09, section 13. A PUT is idempotent by definition and takes no Idempotency-Key (§20.1). */
@RestController
class AdminOperatingScheduleController {

    private static final String PATH = "/api/v1/admin/lockers/{lockerId}/operating-schedule";

    private final OperatingScheduleService schedules;

    AdminOperatingScheduleController(OperatingScheduleService schedules) {
        this.schedules = schedules;
    }

    @GetMapping(PATH)
    OperatingScheduleView active(@PathVariable UUID lockerId) {
        return schedules.active(lockerId);
    }

    @PutMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
    OperatingScheduleView replace(@AuthenticationPrincipal CurrentAccount actor, @PathVariable UUID lockerId,
            @Valid @RequestBody OperatingScheduleRequest request) {
        return schedules.replace(lockerId, request, actor.id());
    }
}
