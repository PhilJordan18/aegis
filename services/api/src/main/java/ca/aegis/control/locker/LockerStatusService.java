package ca.aegis.control.locker;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.device.ReportedDeviceErrors;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * A read-only view for display (document 09, section 16.1). It grants nothing: every action revalidates its guards in
 * its own transaction.
 */
@Service
class LockerStatusService {

    private record Locker(UUID id, String code, String name, String topology) {
    }

    private final JdbcClient jdbc;
    private final LockerAvailability availability;
    private final LockerSchedules schedules;
    private final ReportedDeviceErrors deviceErrors;
    private final Clock clock;

    LockerStatusService(JdbcClient jdbc, LockerAvailability availability, LockerSchedules schedules,
            ReportedDeviceErrors deviceErrors, Clock clock) {
        this.jdbc = jdbc;
        this.availability = availability;
        this.schedules = schedules;
        this.deviceErrors = deviceErrors;
        this.clock = clock;
    }

    /** One snapshot, so that the connection status and the device errors describe the same device session. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    LockerStatusView status(UUID lockerId) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Locker locker = jdbc.sql("SELECT id, code, name, topology FROM aegis.lockers WHERE id = :id")
                .param("id", lockerId)
                .query((row, number) -> new Locker(row.getObject("id", UUID.class), row.getString("code"),
                        row.getString("name"), row.getString("topology")))
                .optional()
                .orElseThrow(ResourceNotFoundException::new);
        LockerAvailability.Availability hub = availability.of(lockerId, now);
        CurrentWindowView window = schedules.activeScheduleOf(lockerId)
                .map(schedule -> {
                    OperatingHours.WindowState state = OperatingHours.windowAt(schedule, now);
                    return new CurrentWindowView(schedule.timeZone().getId(), state.open(), state.closesAt(),
                            state.nextOpensAt());
                })
                .orElse(CurrentWindowView.NONE);
        return new LockerStatusView(locker.id(), locker.code(), locker.name(), locker.topology(), hub.status(),
                hub.lastSeenAt(), now, window, compartments(lockerId), deviceErrors(lockerId));
    }

    private List<DeviceErrorView> deviceErrors(UUID lockerId) {
        return deviceErrors.ofCurrentSession(lockerId).stream()
                .map(group -> new DeviceErrorView(group.errorCode(), group.severity(), group.compartmentId(),
                        group.firstReceivedAt(), group.lastReceivedAt(), group.occurrences()))
                .toList();
    }

    private List<CompartmentStatusView> compartments(UUID lockerId) {
        return jdbc.sql("""
                SELECT id, code, enabled, connection_status, rfid_reader_status, door_state, lock_state,
                       last_observed_at
                FROM aegis.compartments WHERE locker_id = :lockerId ORDER BY local_address, code
                """)
                .param("lockerId", lockerId)
                .query(LockerStatusService::compartment)
                .list();
    }

    private static CompartmentStatusView compartment(ResultSet row, int number) throws SQLException {
        OffsetDateTime observed = row.getObject("last_observed_at", OffsetDateTime.class);
        return new CompartmentStatusView(row.getObject("id", UUID.class), row.getString("code"),
                row.getBoolean("enabled"), row.getString("connection_status"), row.getString("rfid_reader_status"),
                row.getString("door_state"), row.getString("lock_state"),
                observed == null ? null : observed.toInstant());
    }
}
