package ca.aegis.control.locker;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read access to the active schedule of a locker for the business guards of other features, such as the creation of a
 * reservation (document 06, section 5.2). It joins the caller's transaction and takes no lock: a schedule change only
 * applies to the decisions taken after it commits.
 */
@Component
public class LockerSchedules {

    private final OperatingScheduleRepository schedules;

    LockerSchedules(OperatingScheduleRepository schedules) {
        this.schedules = schedules;
    }

    /** The active schedule of the locker, or empty when it has none. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<WeeklySchedule> activeScheduleOf(UUID lockerId) {
        return schedules.activeOf(lockerId).map(schedules::weekOf);
    }
}
