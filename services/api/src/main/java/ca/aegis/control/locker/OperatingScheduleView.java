package ca.aegis.control.locker;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Response of document 09, sections 13.1 and 13.2: one immutable version of a locker's schedule, with its seven
 * days from MONDAY to SUNDAY. Each change creates a version, so {@code createdAt} and {@code createdByUserId} are
 * the {@code updatedAt} and {@code updatedBy} of document 03, section 4.10.
 */
record OperatingScheduleView(UUID id, UUID lockerId, String timeZone, Instant createdAt, UUID createdByUserId,
        List<OperatingWindowView> windows) {
}
