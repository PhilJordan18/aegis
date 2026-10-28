package ca.aegis.control.locker;

import java.time.LocalTime;

import jakarta.validation.constraints.NotNull;

/**
 * One day of {@link OperatingScheduleRequest}. {@code dayOfWeek} is read as text so that only the exact names
 * MONDAY to SUNDAY are accepted, never an enum ordinal. An omitted time is read as {@code null}.
 */
record OperatingWindowRequest(
        @NotNull(message = "Le jour de la semaine est requis.")
        String dayOfWeek,

        @NotNull(message = "L'ouverture du jour est requise.")
        Boolean enabled,

        LocalTime opensAt,

        LocalTime closesAt) {
}
