package ca.aegis.control.locker;

import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

/** Lockers inserted directly: no route creates them in P0 (document 09 has none). */
final class ScheduleFixtures {

    private ScheduleFixtures() {
    }

    static UUID locker(JdbcClient jdbc) {
        return jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier horaire', 'HUB_CELL')
                RETURNING id
                """).param("code", "H-" + UUID.randomUUID().toString().substring(0, 8)).query(UUID.class).single();
    }
}
