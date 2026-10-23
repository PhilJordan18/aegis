package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import ca.aegis.control.support.TestDatabaseServer;
import ca.aegis.control.support.TestDatabases;

/** V004, document 08, sections 4.5 and 5.1: versioned operating schedules and their daily windows. */
class OperatingScheduleMigrationTests {

    private final TestDatabases databases = TestDatabases.shared();
    private final TestDatabaseServer server = databases.server();
    private final String absentRole = "aegis_test_absent_" + UUID.randomUUID().toString().substring(0, 8);

    private String database;
    private JdbcClient jdbc;

    @BeforeEach
    void emptyDatabase() {
        database = databases.create("schedule");
        jdbc = JdbcClient.create(new DriverManagerDataSource(server.url(database), server.user(), server.password()));
    }

    @AfterEach
    void dropDatabase() {
        databases.drop(database);
    }

    /** Databases standing at V003 keep their history rows and data; V004 only adds the two empty tables. */
    @Test
    void upgradesADatabaseAtTheLockerMigrationWithoutRewritingItsHistory() {
        assertEquals(5, flyway("3").migrate().migrationsExecuted);
        UUID locker = insertLocker("AEGIS-DEMO-01");
        List<Map<String, Object>> history = history();

        assertEquals(1, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);
        assertEquals(List.of("001", "002", "002.1", "002.2", "003", "004"), jdbc.sql(
                "SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank")
                .query(String.class).list());
        assertEquals(history, history().subList(0, history.size()));
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.lockers WHERE id = :id").param("id", locker)
                .query(Long.class).single());
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.operating_schedules").query(Long.class).single());
    }

    @Test
    void schedulesKeepOneActiveVersionPerLockerAndACoherentArchive() {
        flyway(null).migrate();
        UUID admin = insertUser();
        UUID locker = insertLocker("L1");

        UUID first = insertSchedule(locker, admin, "America/Toronto");
        assertEquals("America/Toronto", jdbc.sql("""
                SELECT time_zone FROM aegis.operating_schedules WHERE id = :id
                """).param("id", first).query(String.class).single());
        assertViolation("23505", "ux_operating_schedules_one_active_per_locker",
                () -> insertSchedule(locker, admin, "America/Toronto"));
        assertViolation("23514", "ck_operating_schedules_active_archive", () -> jdbc.sql(
                "UPDATE aegis.operating_schedules SET active = false WHERE id = :id").param("id", first).update());
        assertViolation("23514", "ck_operating_schedules_active_archive", () -> jdbc.sql(
                "UPDATE aegis.operating_schedules SET archived_at = now() WHERE id = :id").param("id", first)
                .update());
        assertViolation("23514", "ck_operating_schedules_timezone",
                () -> insertSchedule(insertLocker("L2"), admin, " "));
        assertViolation("23503", "fk_operating_schedules_locker",
                () -> insertSchedule(UUID.randomUUID(), admin, "America/Toronto"));
        assertViolation("23503", "fk_operating_schedules_creator",
                () -> insertSchedule(insertLocker("L3"), UUID.randomUUID(), "America/Toronto"));

        jdbc.sql("UPDATE aegis.operating_schedules SET active = false, archived_at = now() WHERE id = :id")
                .param("id", first).update();
        insertSchedule(locker, admin, "America/Toronto");
        assertEquals(List.of(false, true), jdbc.sql("""
                SELECT active FROM aegis.operating_schedules WHERE locker_id = :locker ORDER BY active
                """).param("locker", locker).query(Boolean.class).list());
    }

    @Test
    void windowsHaveOneRowPerIsoDayAndCoherentHours() {
        flyway(null).migrate();
        UUID schedule = insertSchedule(insertLocker("L1"), insertUser(), "America/Toronto");
        LocalTime nine = LocalTime.of(9, 0);
        LocalTime five = LocalTime.of(17, 0);

        insertWindow(schedule, 1, true, nine, five);
        insertWindow(schedule, 7, false, null, null);
        assertViolation("23505", "ux_operating_windows_one_per_day", () -> insertWindow(schedule, 1, false, null,
                null));
        assertViolation("23514", "ck_operating_windows_day", () -> insertWindow(schedule, 0, false, null, null));
        assertViolation("23514", "ck_operating_windows_day", () -> insertWindow(schedule, 8, false, null, null));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, true, five, nine));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, true, nine, nine));
        assertViolation("23514", "ck_operating_windows_order",
                () -> insertWindow(schedule, 2, true, LocalTime.of(22, 0), LocalTime.of(2, 0)));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, true, nine, null));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, true, null, five));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, false, nine, five));
        assertViolation("23514", "ck_operating_windows_order", () -> insertWindow(schedule, 2, false, nine, null));
        assertViolation("23503", "fk_operating_windows_schedule",
                () -> insertWindow(UUID.randomUUID(), 2, false, null, null));
        assertEquals(2, jdbc.sql("SELECT count(*) FROM aegis.operating_windows").query(Long.class).single());
    }

    /** The afterMigrate callback grants the new tables like every business table: DML, never TRUNCATE. */
    @Test
    void theApplicationRoleGetsDataPrivilegesOnTheScheduleTables() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            assertEquals(6, flyway(null, role).migrate().migrationsExecuted);
            for (String table : List.of("operating_schedules", "operating_windows")) {
                assertEquals(List.of(table + ":DELETE,INSERT,SELECT,UPDATE"), privileges(role, table));
            }
            UUID admin = insertUser();
            UUID locker = insertLocker("L1");

            try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database),
                    server.user(), server.password(), true)) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                application.sql("SELECT id FROM aegis.lockers WHERE id = :id FOR UPDATE").param("id", locker)
                        .query(UUID.class).single();
                UUID schedule = application.sql("""
                        INSERT INTO aegis.operating_schedules (locker_id, created_by_user_id)
                        VALUES (:locker, :admin) RETURNING id
                        """).param("locker", locker).param("admin", admin).query(UUID.class).single();
                application.sql("""
                        INSERT INTO aegis.operating_windows (operating_schedule_id, day_of_week, opens_at, closes_at)
                        VALUES (:schedule, 1, '09:00', '17:00')
                        """).param("schedule", schedule).update();
                assertEquals(1, application.sql("""
                        UPDATE aegis.operating_schedules SET active = false, archived_at = now() WHERE id = :id
                        """).param("id", schedule).update());
                assertEquals(1, application.sql("SELECT count(*) FROM aegis.operating_windows")
                        .query(Long.class).single());
                assertRefused("42501", () -> application.sql("TRUNCATE aegis.operating_windows").update());
                assertEquals(1, application.sql("DELETE FROM aegis.operating_windows WHERE operating_schedule_id = :id")
                        .param("id", schedule).update());
                assertEquals(1, application.sql("DELETE FROM aegis.operating_schedules WHERE id = :id")
                        .param("id", schedule).update());
                application.sql("RESET ROLE").update();
            }
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    private Flyway flyway(String target) {
        return flyway(target, absentRole);
    }

    private Flyway flyway(String target, String applicationRole) {
        FluentConfiguration configuration = Flyway.configure()
                .dataSource(server.url(database), server.user(), server.password())
                .locations("classpath:db/migration")
                .defaultSchema("public")
                .placeholders(Map.of("application_role", applicationRole))
                .validateOnMigrate(true);
        if (target != null) {
            configuration.target(target);
        }
        return configuration.load();
    }

    private List<Map<String, Object>> history() {
        return jdbc.sql("""
                SELECT installed_rank, version, script, checksum, installed_by, installed_on, success
                FROM public.flyway_schema_history ORDER BY installed_rank
                """).query().listOfRows();
    }

    private List<String> privileges(String role, String table) {
        return jdbc.sql("""
                SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type)
                FROM information_schema.role_table_grants
                WHERE grantee = :role AND table_schema = 'aegis' AND table_name = :table
                GROUP BY table_name
                """).param("role", role).param("table", table).query(String.class).list();
    }

    private UUID insertUser() {
        return jdbc.sql("""
                INSERT INTO aegis.users (display_name, email, password_hash, role, maximum_access_level)
                VALUES ('Administratrice', :email, '{bcrypt}$2a$10$x', 'ADMIN', 'STANDARD')
                RETURNING id
                """).param("email", UUID.randomUUID() + "@aegis.test").query(UUID.class).single();
    }

    private UUID insertLocker(String code) {
        return jdbc.sql("INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier', 'HUB_CELL') "
                + "RETURNING id").param("code", code).query(UUID.class).single();
    }

    private UUID insertSchedule(UUID locker, UUID creator, String timeZone) {
        return jdbc.sql("""
                INSERT INTO aegis.operating_schedules (locker_id, created_by_user_id, time_zone)
                VALUES (:locker, :creator, :zone) RETURNING id
                """).param("locker", locker).param("creator", creator).param("zone", timeZone)
                .query(UUID.class).single();
    }

    private void insertWindow(UUID schedule, int day, boolean enabled, LocalTime opensAt, LocalTime closesAt) {
        jdbc.sql("""
                INSERT INTO aegis.operating_windows (operating_schedule_id, day_of_week, enabled, opens_at, closes_at)
                VALUES (:schedule, :day, :enabled, :opensAt, :closesAt)
                """).param("schedule", schedule).param("day", day).param("enabled", enabled)
                .param("opensAt", opensAt).param("closesAt", closesAt).update();
    }

    private static void assertRefused(String sqlState, Executable statement) {
        DataAccessException failure = assertThrows(DataAccessException.class, statement);
        PSQLException cause = assertInstanceOf(PSQLException.class, failure.getMostSpecificCause());
        assertEquals(sqlState, cause.getSQLState(), cause::getMessage);
    }

    private static void assertViolation(String sqlState, String constraint, Executable statement) {
        DataAccessException failure = assertThrows(DataAccessException.class, statement);
        PSQLException cause = assertInstanceOf(PSQLException.class, failure.getMostSpecificCause());
        assertEquals(sqlState, cause.getSQLState(), cause::getMessage);
        assertEquals(constraint, cause.getServerErrorMessage().getConstraint(), cause::getMessage);
    }
}
