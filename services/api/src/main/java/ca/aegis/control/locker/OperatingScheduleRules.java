package ca.aegis.control.locker;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.ProblemResponse.Violation;

/**
 * The rules of document 09, section 13.2 that Bean Validation cannot express alone. They run after the field
 * constraints, as document 09, section 7.1 requires, and report every violation found together.
 */
final class OperatingScheduleRules {

    private OperatingScheduleRules() {
    }

    static WeeklySchedule validate(OperatingScheduleRequest request) {
        List<Violation> violations = new ArrayList<>();
        // Region identifiers only, in their exact case: a fixed offset such as "+01:00" or "UTC+1" ignores
        // daylight-saving time, and ZoneId.of would accept it.
        if (!ZoneId.getAvailableZoneIds().contains(request.timeZone())) {
            violations.add(new Violation("timeZone", "INVALID_VALUE",
                    "Le fuseau horaire doit être un identifiant IANA, par exemple America/Toronto."));
        }
        Set<DayOfWeek> seen = EnumSet.noneOf(DayOfWeek.class);
        List<DailyWindow> windows = new ArrayList<>();
        for (int index = 0; index < request.windows().size(); index++) {
            OperatingWindowRequest window = request.windows().get(index);
            String field = "windows[" + index + "].";
            DayOfWeek day = day(window.dayOfWeek());
            if (day == null) {
                violations.add(new Violation(field + "dayOfWeek", "INVALID_VALUE",
                        "Le jour doit valoir MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY ou SUNDAY."));
            } else if (!seen.add(day)) {
                violations.add(new Violation(field + "dayOfWeek", "DUPLICATE_DAY_OF_WEEK",
                        "Ce jour figure déjà dans l'horaire."));
            }
            int before = violations.size();
            hours(window, field, violations);
            if (day != null && violations.size() == before) {
                windows.add(new DailyWindow(day, window.enabled(), window.opensAt(), window.closesAt()));
            }
        }
        if (!violations.isEmpty()) {
            throw InvalidRequestException.of(violations);
        }
        return new WeeklySchedule(ZoneId.of(request.timeZone()), windows);
    }

    private static void hours(OperatingWindowRequest window, String field, List<Violation> violations) {
        LocalTime opensAt = window.opensAt();
        LocalTime closesAt = window.closesAt();
        if (window.enabled()) {
            if (opensAt == null) {
                violations.add(new Violation(field + "opensAt", "REQUIRED_WHEN_ENABLED",
                        "L'heure d'ouverture est requise pour un jour ouvert."));
            }
            if (closesAt == null) {
                violations.add(new Violation(field + "closesAt", "REQUIRED_WHEN_ENABLED",
                        "L'heure de fermeture est requise pour un jour ouvert."));
            }
        } else {
            if (opensAt != null) {
                violations.add(new Violation(field + "opensAt", "NOT_ALLOWED_WHEN_DISABLED",
                        "Un jour fermé n'a pas d'heure d'ouverture."));
            }
            if (closesAt != null) {
                violations.add(new Violation(field + "closesAt", "NOT_ALLOWED_WHEN_DISABLED",
                        "Un jour fermé n'a pas d'heure de fermeture."));
            }
        }
        boolean wholeSeconds = wholeSeconds(opensAt, field + "opensAt", violations)
                & wholeSeconds(closesAt, field + "closesAt", violations);
        // A window crossing midnight, such as 22:00 to 02:00, is refused here too: P0 excludes it.
        if (window.enabled() && wholeSeconds && opensAt != null && closesAt != null && !opensAt.isBefore(closesAt)) {
            violations.add(new Violation(field + "closesAt", "NOT_AFTER_OPENS_AT",
                    "La fermeture doit suivre l'ouverture le même jour."));
        }
    }

    private static boolean wholeSeconds(LocalTime time, String field, List<Violation> violations) {
        if (time == null || time.getNano() == 0) {
            return true;
        }
        violations.add(new Violation(field, "INVALID_VALUE",
                "L'heure s'exprime en heures, minutes et secondes, sans fraction."));
        return false;
    }

    private static DayOfWeek day(String name) {
        for (DayOfWeek day : DayOfWeek.values()) {
            if (day.name().equals(name)) {
                return day;
            }
        }
        return null;
    }
}
