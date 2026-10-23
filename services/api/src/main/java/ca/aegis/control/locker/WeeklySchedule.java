package ca.aegis.control.locker;

import java.time.DayOfWeek;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * The seven daily windows of a locker and the IANA zone in which they are read (document 03, sections 4.10 and
 * 4.11). The windows are kept from MONDAY to SUNDAY, so two schedules are equal exactly when they open the same
 * hours in the same zone.
 */
public record WeeklySchedule(ZoneId timeZone, List<DailyWindow> windows) {

    public WeeklySchedule {
        Objects.requireNonNull(timeZone, "timeZone");
        windows = windows.stream().sorted(Comparator.comparing(DailyWindow::dayOfWeek)).toList();
        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        windows.forEach(window -> days.add(window.dayOfWeek()));
        if (windows.size() != 7 || days.size() != 7) {
            throw new IllegalArgumentException("A weekly schedule has each of the seven days exactly once");
        }
    }

    public DailyWindow on(DayOfWeek day) {
        return windows.get(day.getValue() - 1);
    }
}
