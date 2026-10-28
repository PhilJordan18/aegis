package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Concurrent replacements of one locker's schedule: the locker row lock serializes them, so every change archives
 * the version committed before it, exactly one version stays active, and identical requests create one version.
 */
class OperatingScheduleConcurrencyTests extends ApiIntegrationTest {

    private static final int ATTEMPTS = 8;

    @Autowired
    OperatingScheduleService schedules;

    @Autowired
    JdbcClient jdbc;

    private ExecutorService executor;
    private UUID locker;
    private UUID actor;

    @BeforeEach
    void startExecutor() {
        executor = Executors.newFixedThreadPool(ATTEMPTS);
        locker = ScheduleFixtures.locker(jdbc);
        actor = accounts.admin().id();
    }

    @AfterEach
    void stopExecutor() {
        executor.shutdownNow();
    }

    @Test
    void differentConcurrentSchedulesBecomeSuccessiveVersionsWithOneActive() throws Exception {
        List<OperatingScheduleRequest> requests = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            requests.add(request(LocalTime.of(8, i)));
        }

        List<OperatingScheduleView> results = race(requests);

        assertEquals(ATTEMPTS, results.stream().map(OperatingScheduleView::id).distinct().count());
        assertEquals(Map.of(true, 1L, false, (long) ATTEMPTS - 1), activeCounts());
        assertEquals(ATTEMPTS, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events e JOIN aegis.operating_schedules s ON s.id = e.subject_id
                WHERE e.event_type = 'SCHEDULE_UPDATED' AND s.locker_id = :locker
                """).param("locker", locker).query(Long.class).single());
        assertEquals(ATTEMPTS - 1, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events e JOIN aegis.operating_schedules s ON s.id = e.subject_id
                WHERE e.event_type = 'SCHEDULE_UPDATED' AND s.locker_id = :locker
                  AND (e.details ->> 'previousScheduleId')::uuid IN (
                      SELECT id FROM aegis.operating_schedules WHERE locker_id = :locker AND NOT active)
                """).param("locker", locker).query(Long.class).single(),
                "every change but the first names the version it archived");
        assertEquals(ATTEMPTS * 7L, jdbc.sql("""
                SELECT count(*) FROM aegis.operating_windows w
                JOIN aegis.operating_schedules s ON s.id = w.operating_schedule_id WHERE s.locker_id = :locker
                """).param("locker", locker).query(Long.class).single());
    }

    @Test
    void identicalConcurrentSchedulesCreateOneVersionAndOneEvent() throws Exception {
        List<OperatingScheduleRequest> requests = new ArrayList<>();
        for (int i = 0; i < ATTEMPTS; i++) {
            requests.add(request(LocalTime.of(9, 0)));
        }

        List<OperatingScheduleView> results = race(requests);

        assertEquals(1, results.stream().map(OperatingScheduleView::id).distinct().count());
        assertEquals(Map.of(true, 1L), activeCounts());
        assertEquals(1, jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events e JOIN aegis.operating_schedules s ON s.id = e.subject_id
                WHERE e.event_type = 'SCHEDULE_UPDATED' AND s.locker_id = :locker
                """).param("locker", locker).query(Long.class).single());
    }

    private static OperatingScheduleRequest request(LocalTime opensAt) {
        List<OperatingWindowRequest> windows = new ArrayList<>();
        for (DayOfWeek day : DayOfWeek.values()) {
            windows.add(new OperatingWindowRequest(day.name(), true, opensAt, LocalTime.of(17, 0)));
        }
        return new OperatingScheduleRequest("America/Toronto", windows);
    }

    private Map<Boolean, Long> activeCounts() {
        Map<Boolean, Long> counts = new HashMap<>();
        jdbc.sql("SELECT active, count(*) AS versions FROM aegis.operating_schedules WHERE locker_id = :locker "
                + "GROUP BY active").param("locker", locker)
                .query((row, number) -> counts.put(row.getBoolean("active"), row.getLong("versions"))).list();
        return counts;
    }

    private List<OperatingScheduleView> race(List<OperatingScheduleRequest> requests) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<Future<OperatingScheduleView>> attempts = new ArrayList<>();
        for (OperatingScheduleRequest request : requests) {
            attempts.add(executor.submit(() -> {
                start.await();
                return schedules.replace(locker, request, actor);
            }));
        }
        start.countDown();
        List<OperatingScheduleView> results = new ArrayList<>();
        for (Future<OperatingScheduleView> attempt : attempts) {
            results.add(attempt.get(30, TimeUnit.SECONDS));
        }
        return results;
    }
}
