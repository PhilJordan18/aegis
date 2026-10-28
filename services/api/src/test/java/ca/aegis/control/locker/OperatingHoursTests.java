package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

import ca.aegis.control.locker.OperatingHoursException.Reason;

/**
 * Document 06, sections 5.1 and 5.2, in {@code America/Toronto}. In 2026, clocks spring forward on Sunday 8 March
 * at 02:00 (EST, UTC-5, to EDT, UTC-4) and fall back on Sunday 1 November at 02:00 (EDT to EST).
 */
class OperatingHoursTests {

    private static final ZoneId TORONTO = ZoneId.of("America/Toronto");
    private static final LocalTime NINE = LocalTime.of(9, 0);
    private static final LocalTime FIVE_PM = LocalTime.of(17, 0);

    /** Monday 28 September 2026, EDT: 09:00-17:00 local is 13:00Z-21:00Z. */
    private static final Instant MONDAY_OPENING = Instant.parse("2026-09-28T13:00:00Z");
    private static final Instant MONDAY_CLOSING = Instant.parse("2026-09-28T21:00:00Z");

    private final WeeklySchedule weekdays = schedule(NINE, FIVE_PM, true);

    @Test
    void theWindowIsOpenFromOpeningInclusiveToClosingExclusive() {
        OpenWindow expected = new OpenWindow(MONDAY_OPENING, MONDAY_CLOSING);

        assertOutside(() -> OperatingHours.requireOpenOperatingWindow(weekdays, MONDAY_OPENING.minusNanos(1000)));
        assertEquals(expected, OperatingHours.requireOpenOperatingWindow(weekdays, MONDAY_OPENING));
        assertEquals(expected, OperatingHours.requireOpenOperatingWindow(weekdays, MONDAY_CLOSING.minusSeconds(1)));
        assertOutside(() -> OperatingHours.requireOpenOperatingWindow(weekdays, MONDAY_CLOSING));
    }

    @Test
    void aClosedDayHasNoWindow() {
        Instant saturdayNoon = Instant.parse("2026-10-03T16:00:00Z");

        assertOutside(() -> OperatingHours.requireOpenOperatingWindow(weekdays, saturdayNoon));
        assertEquals(Optional.empty(), OperatingHours.windowOn(weekdays, LocalDate.of(2026, 10, 3)));
    }

    /** The local date decides: 23:30 on Monday in Toronto is already Tuesday in UTC. */
    @Test
    void theLocalDateOfNowSelectsTheDay() {
        WeeklySchedule lateMonday = new WeeklySchedule(TORONTO, week(day -> day == DayOfWeek.MONDAY
                ? DailyWindow.open(day, LocalTime.of(20, 0), LocalTime.of(23, 59))
                : DailyWindow.closed(day)));

        assertEquals(new OpenWindow(Instant.parse("2026-09-29T00:00:00Z"), Instant.parse("2026-09-29T03:59:00Z")),
                OperatingHours.requireOpenOperatingWindow(lateMonday, Instant.parse("2026-09-29T03:30:00Z")));
    }

    @Test
    void aReservationEndsAfterNowAndAtTheLatestAtClosing() {
        Instant now = MONDAY_OPENING.plus(Duration.ofHours(2));
        OpenWindow window = OperatingHours.requireOpenOperatingWindow(weekdays, now);

        OperatingHours.requireUntilWithinWindow(window, now, now.plusSeconds(1));
        OperatingHours.requireUntilWithinWindow(window, now, MONDAY_CLOSING);
        assertReason(Reason.UNTIL_NOT_AFTER_NOW, () -> OperatingHours.requireUntilWithinWindow(window, now, now));
        assertReason(Reason.UNTIL_NOT_AFTER_NOW,
                () -> OperatingHours.requireUntilWithinWindow(window, now, now.minusSeconds(1)));
        assertReason(Reason.UNTIL_AFTER_CLOSING,
                () -> OperatingHours.requireUntilWithinWindow(window, now, MONDAY_CLOSING.plusNanos(1000)));
        assertReason(Reason.UNTIL_AFTER_CLOSING,
                () -> OperatingHours.requireUntilWithinWindow(window, now, MONDAY_OPENING.plus(Duration.ofDays(1))));
    }

    @Test
    void aNineToFiveWindowFollowsTheLocalClockAcrossDaylightSavingTime() {
        WeeklySchedule everyDay = schedule(NINE, FIVE_PM, false);

        assertWindow(everyDay, LocalDate.of(2026, 1, 12), "2026-01-12T14:00:00Z", "2026-01-12T22:00:00Z");
        assertWindow(everyDay, LocalDate.of(2026, 3, 7), "2026-03-07T14:00:00Z", "2026-03-07T22:00:00Z");
        assertWindow(everyDay, LocalDate.of(2026, 3, 8), "2026-03-08T13:00:00Z", "2026-03-08T21:00:00Z");
        assertWindow(everyDay, LocalDate.of(2026, 7, 6), "2026-07-06T13:00:00Z", "2026-07-06T21:00:00Z");
        assertWindow(everyDay, LocalDate.of(2026, 10, 31), "2026-10-31T13:00:00Z", "2026-10-31T21:00:00Z");
        assertWindow(everyDay, LocalDate.of(2026, 11, 1), "2026-11-01T14:00:00Z", "2026-11-01T22:00:00Z");
        for (LocalDate switchDay : List.of(LocalDate.of(2026, 3, 8), LocalDate.of(2026, 11, 1))) {
            OpenWindow window = OperatingHours.windowOn(everyDay, switchDay).orElseThrow();
            assertEquals(Duration.ofHours(8), Duration.between(window.opensAt(), window.closesAt()));
        }
        assertEquals(new OpenWindow(Instant.parse("2026-03-08T13:00:00Z"), Instant.parse("2026-03-08T21:00:00Z")),
                OperatingHours.requireOpenOperatingWindow(everyDay, Instant.parse("2026-03-08T13:00:00Z")));
        assertOutside(() -> OperatingHours.requireOpenOperatingWindow(everyDay,
                Instant.parse("2026-11-01T13:59:59Z")));
    }

    /**
     * 02:30 does not exist on 8 March 2026: read at EST it is 07:30Z, read at EDT 06:30Z. Opening takes 07:30Z (03:30
     * EDT) and closing 06:30Z (01:30 EST), so the gap shortens the window from both sides instead of extending it.
     */
    @Test
    void aTimeInTheSpringGapOpensLateAndClosesEarly() {
        LocalDate springForward = LocalDate.of(2026, 3, 8);
        LocalTime inGap = LocalTime.of(2, 30);

        assertWindow(schedule(inGap, LocalTime.of(6, 0), false), springForward,
                "2026-03-08T07:30:00Z", "2026-03-08T10:00:00Z");
        assertWindow(schedule(LocalTime.of(0, 30), inGap, false), springForward,
                "2026-03-08T05:30:00Z", "2026-03-08T06:30:00Z");
    }

    /**
     * 01:30 occurs twice on 1 November 2026: 05:30Z at EDT, then 06:30Z at EST. Opening takes the second occurrence
     * and closing the first, so the repeated hour is never counted twice in the window's favour.
     */
    @Test
    void aTimeInTheFallOverlapOpensAtItsSecondOccurrenceAndClosesAtItsFirst() {
        LocalDate fallBack = LocalDate.of(2026, 11, 1);
        LocalTime inOverlap = LocalTime.of(1, 30);

        assertWindow(schedule(inOverlap, LocalTime.of(6, 0), false), fallBack,
                "2026-11-01T06:30:00Z", "2026-11-01T11:00:00Z");
        assertWindow(schedule(LocalTime.of(0, 30), inOverlap, false), fallBack,
                "2026-11-01T04:30:00Z", "2026-11-01T05:30:00Z");
        WeeklySchedule insideOverlap = schedule(LocalTime.of(1, 10), LocalTime.of(1, 50), false);
        assertEquals(Optional.empty(), OperatingHours.windowOn(insideOverlap, fallBack),
                "01:10 at EST (06:10Z) is after 01:50 at EDT (05:50Z): the window is empty, hence closed");
        assertOutside(() -> OperatingHours.requireOpenOperatingWindow(insideOverlap,
                Instant.parse("2026-11-01T06:00:00Z")));
    }

    @Test
    void aScheduleHasEachDayOnceAndCoherentHours() {
        List<DailyWindow> six = new ArrayList<>(week(DailyWindow::closed));
        six.removeLast();
        assertThrows(IllegalArgumentException.class, () -> new WeeklySchedule(TORONTO, six));
        List<DailyWindow> duplicate = new ArrayList<>(six);
        duplicate.add(DailyWindow.closed(DayOfWeek.MONDAY));
        assertThrows(IllegalArgumentException.class, () -> new WeeklySchedule(TORONTO, duplicate));
        assertThrows(IllegalArgumentException.class, () -> DailyWindow.open(DayOfWeek.MONDAY, FIVE_PM, NINE));
        assertThrows(IllegalArgumentException.class, () -> DailyWindow.open(DayOfWeek.MONDAY, NINE, NINE));
        assertThrows(IllegalArgumentException.class, () -> new DailyWindow(DayOfWeek.MONDAY, false, NINE, null));
    }

    private static WeeklySchedule schedule(LocalTime opensAt, LocalTime closesAt, boolean weekdaysOnly) {
        return new WeeklySchedule(TORONTO, week(day -> weekdaysOnly && day.getValue() > 5
                ? DailyWindow.closed(day)
                : DailyWindow.open(day, opensAt, closesAt)));
    }

    private static List<DailyWindow> week(Function<DayOfWeek, DailyWindow> window) {
        List<DailyWindow> windows = new ArrayList<>();
        for (DayOfWeek day : DayOfWeek.values()) {
            windows.add(window.apply(day));
        }
        return windows;
    }

    private static void assertWindow(WeeklySchedule schedule, LocalDate date, String opensAt, String closesAt) {
        assertEquals(Optional.of(new OpenWindow(Instant.parse(opensAt), Instant.parse(closesAt))),
                OperatingHours.windowOn(schedule, date), date::toString);
    }

    private static void assertOutside(Executable executable) {
        assertReason(Reason.OUTSIDE_OPERATING_HOURS, executable);
    }

    private static void assertReason(Reason reason, Executable executable) {
        assertEquals(reason, assertThrows(OperatingHoursException.class, executable).reason());
    }
}
