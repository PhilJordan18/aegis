package ca.aegis.control.locker;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;
import java.util.List;
import java.util.Optional;

/**
 * The operating-hours guard of a reservation (document 06, sections 5.1 and 5.2), free of any persistence or web
 * concern. A window is read in the local date of {@code now} in the schedule's zone; P0 windows never cross midnight,
 * so no other day can be open at that instant.
 */
public final class OperatingHours {

    private OperatingHours() {
    }

    /** The window open at {@code now}: opening is inclusive and closing exclusive. */
    public static OpenWindow requireOpenOperatingWindow(WeeklySchedule schedule, Instant now) {
        LocalDate today = now.atZone(schedule.timeZone()).toLocalDate();
        return windowOn(schedule, today)
                .filter(window -> window.contains(now))
                .orElseThrow(() -> new OperatingHoursException(OperatingHoursException.Reason.OUTSIDE_OPERATING_HOURS));
    }

    /** {@code now < until <= window.closesAt}: a reservation may end exactly at closing. */
    public static void requireUntilWithinWindow(OpenWindow window, Instant now, Instant until) {
        if (!until.isAfter(now)) {
            throw new OperatingHoursException(OperatingHoursException.Reason.UNTIL_NOT_AFTER_NOW);
        }
        if (until.isAfter(window.closesAt())) {
            throw new OperatingHoursException(OperatingHoursException.Reason.UNTIL_AFTER_CLOSING);
        }
    }

    /**
     * The window of {@code date} as instants, or empty for a closed day. A local time that falls in a daylight-saving
     * gap or overlap has two candidate instants, one per offset around the transition; opening takes the later and
     * closing the earlier, so a transition can shorten a window but never extend it. A window left empty by that
     * choice counts as closed.
     */
    public static Optional<OpenWindow> windowOn(WeeklySchedule schedule, LocalDate date) {
        DailyWindow day = schedule.on(date.getDayOfWeek());
        if (!day.enabled()) {
            return Optional.empty();
        }
        Instant opensAt = resolve(date, day.opensAt(), schedule.timeZone(), true);
        Instant closesAt = resolve(date, day.closesAt(), schedule.timeZone(), false);
        return opensAt.isBefore(closesAt) ? Optional.of(new OpenWindow(opensAt, closesAt)) : Optional.empty();
    }

    private static Instant resolve(LocalDate date, LocalTime time, ZoneId zone, boolean latest) {
        LocalDateTime local = date.atTime(time);
        ZoneRules rules = zone.getRules();
        List<ZoneOffset> offsets = rules.getValidOffsets(local);
        if (offsets.isEmpty()) {
            ZoneOffsetTransition gap = rules.getTransition(local);
            offsets = List.of(gap.getOffsetBefore(), gap.getOffsetAfter());
        }
        Instant one = local.toInstant(offsets.getFirst());
        Instant other = local.toInstant(offsets.getLast());
        Instant later = one.isAfter(other) ? one : other;
        Instant earlier = one.isAfter(other) ? other : one;
        return latest ? later : earlier;
    }
}
