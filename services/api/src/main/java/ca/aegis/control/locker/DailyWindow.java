package ca.aegis.control.locker;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Objects;

/**
 * The opening of one weekday, in the local time of its schedule (document 03, section 4.11). P0 allows one
 * continuous window per day that never crosses midnight; a closed day has no hours.
 */
public record DailyWindow(DayOfWeek dayOfWeek, boolean enabled, LocalTime opensAt, LocalTime closesAt) {

    public DailyWindow {
        Objects.requireNonNull(dayOfWeek, "dayOfWeek");
        if (enabled && (opensAt == null || closesAt == null || !opensAt.isBefore(closesAt))) {
            throw new IllegalArgumentException("An enabled day opens strictly before it closes");
        }
        if (!enabled && (opensAt != null || closesAt != null)) {
            throw new IllegalArgumentException("A closed day has no hours");
        }
    }

    public static DailyWindow open(DayOfWeek dayOfWeek, LocalTime opensAt, LocalTime closesAt) {
        return new DailyWindow(dayOfWeek, true, opensAt, closesAt);
    }

    public static DailyWindow closed(DayOfWeek dayOfWeek) {
        return new DailyWindow(dayOfWeek, false, null, null);
    }
}
