package ca.aegis.control.locker;

import java.time.DayOfWeek;
import java.time.format.DateTimeFormatter;

/** One day of {@link OperatingScheduleView}; the hours are local, written {@code HH:mm:ss}, or null when closed. */
record OperatingWindowView(DayOfWeek dayOfWeek, boolean enabled, String opensAt, String closesAt) {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    static OperatingWindowView of(DailyWindow window) {
        return new OperatingWindowView(window.dayOfWeek(), window.enabled(),
                window.opensAt() == null ? null : TIME.format(window.opensAt()),
                window.closesAt() == null ? null : TIME.format(window.closesAt()));
    }
}
