package ca.aegis.control.locker;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Schedule versions are archived, never updated in place or deleted: the history of a locker stays complete. */
@Repository
class OperatingScheduleRepository {

    /** One version and its creator, before its windows are read. */
    record Version(UUID id, UUID lockerId, String timeZone, Instant createdAt, UUID createdByUserId) {
    }

    private static final String SELECT_VERSION = """
            SELECT id, locker_id, time_zone, created_at, created_by_user_id FROM aegis.operating_schedules
            """;

    private final JdbcClient jdbc;

    OperatingScheduleRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    boolean lockerExists(UUID lockerId) {
        return jdbc.sql("SELECT count(*) FROM aegis.lockers WHERE id = :id").param("id", lockerId)
                .query(Long.class).single() > 0;
    }

    /**
     * Serializes the schedule changes of one locker (document 08, section 7.1): a second writer waits here, then
     * reads the version the first one committed.
     */
    boolean lockLocker(UUID lockerId) {
        return jdbc.sql("SELECT id FROM aegis.lockers WHERE id = :id FOR UPDATE").param("id", lockerId)
                .query(UUID.class).optional().isPresent();
    }

    Optional<Version> activeOf(UUID lockerId) {
        return jdbc.sql(SELECT_VERSION + "WHERE locker_id = :lockerId AND active")
                .param("lockerId", lockerId).query(OperatingScheduleRepository::version).optional();
    }

    Optional<Version> find(UUID id) {
        return jdbc.sql(SELECT_VERSION + "WHERE id = :id").param("id", id)
                .query(OperatingScheduleRepository::version).optional();
    }

    WeeklySchedule weekOf(Version version) {
        List<DailyWindow> windows = jdbc.sql("""
                SELECT day_of_week, enabled, opens_at, closes_at FROM aegis.operating_windows
                WHERE operating_schedule_id = :id ORDER BY day_of_week
                """).param("id", version.id())
                .query((row, number) -> new DailyWindow(DayOfWeek.of(row.getInt("day_of_week")),
                        row.getBoolean("enabled"), row.getObject("opens_at", LocalTime.class),
                        row.getObject("closes_at", LocalTime.class)))
                .list();
        return new WeeklySchedule(ZoneId.of(version.timeZone()), windows);
    }

    void archive(UUID id, Instant now) {
        jdbc.sql("""
                UPDATE aegis.operating_schedules SET active = false, archived_at = :now WHERE id = :id AND active
                """).param("now", utc(now)).param("id", id).update();
    }

    UUID insert(UUID lockerId, WeeklySchedule schedule, UUID actor, Instant now) {
        UUID id = jdbc.sql("""
                INSERT INTO aegis.operating_schedules (locker_id, time_zone, created_by_user_id, created_at)
                VALUES (:lockerId, :timeZone, :actor, :now)
                RETURNING id
                """)
                .param("lockerId", lockerId)
                .param("timeZone", schedule.timeZone().getId())
                .param("actor", actor)
                .param("now", utc(now))
                .query(UUID.class)
                .single();
        for (DailyWindow window : schedule.windows()) {
            jdbc.sql("""
                    INSERT INTO aegis.operating_windows (operating_schedule_id, day_of_week, enabled, opens_at, closes_at)
                    VALUES (:id, :day, :enabled, :opensAt, :closesAt)
                    """)
                    .param("id", id)
                    .param("day", window.dayOfWeek().getValue())
                    .param("enabled", window.enabled())
                    .param("opensAt", window.opensAt())
                    .param("closesAt", window.closesAt())
                    .update();
        }
        return id;
    }

    private static Version version(ResultSet row, int rowNumber) throws SQLException {
        return new Version(
                row.getObject("id", UUID.class),
                row.getObject("locker_id", UUID.class),
                row.getString("time_zone"),
                row.getObject("created_at", OffsetDateTime.class).toInstant(),
                row.getObject("created_by_user_id", UUID.class));
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
