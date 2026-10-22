package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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

import ca.aegis.control.support.TestDatabaseServer;
import ca.aegis.control.support.TestDatabases;

/** Applies the real migrations to a new empty PostgreSQL database with the application's Flyway settings. */
class FlywayMigrationTests {

    private final TestDatabases databases = TestDatabases.shared();
    private final TestDatabaseServer server = databases.server();

    private String database;
    private JdbcClient jdbc;

    @BeforeEach
    void emptyDatabase() {
        database = databases.create("migration");
        jdbc = JdbcClient.create(new DriverManagerDataSource(server.url(database), server.user(), server.password()));
    }

    @AfterEach
    void dropDatabase() {
        databases.drop(database);
    }

    @Test
    void migratesAnEmptyDatabaseOnceAndValidatesAfterwards() {
        assertEquals(3, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);

        assertEquals(List.of("001", "002", "002.1"), appliedVersions());
        assertEquals(List.of("asset_identifiers", "asset_models", "assets", "rest_idempotency_keys", "users"),
                jdbc.sql("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'aegis' ORDER BY table_name
                """).query(String.class).list());
    }

    @Test
    void upgradesADatabaseCreatedByTheFirstMigration() {
        assertEquals(1, flyway("001").migrate().migrationsExecuted);
        assertEquals(List.of("001"), appliedVersions());

        assertEquals(2, flyway(null).migrate().migrationsExecuted);
        assertEquals(List.of("001", "002", "002.1"), appliedVersions());
    }

    /** Every database applied V001 and V002 only when V002_1 was added, so it upgrades them in order. */
    @Test
    void upgradesADatabaseAtTheCatalogMigrationWithItsData() {
        assertEquals(2, flyway("2").migrate().migrationsExecuted);
        assertEquals(List.of("001", "002"), appliedVersions());
        UUID user = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");
        UUID model = insertModel("Oscilloscope");

        assertEquals(1, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);
        assertEquals(List.of("001", "002", "002.1"), appliedVersions());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.users WHERE id = :id").param("id", user)
                .query(Long.class).single());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE id = :id").param("id", model)
                .query(Long.class).single());
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys").query(Long.class).single());
    }

    @Test
    void restIdempotencyKeysEnforceTheirScopeAndLifecycle() {
        flyway(null).migrate();
        UUID actor = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");
        UUID other = insertUser("Autre", "other@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");
        byte[] hash = new byte[32];

        UUID key = insertKey(actor, "POST /admin/asset-models", "k".repeat(128), hash);
        Map<String, Object> defaults = jdbc.sql("""
                SELECT status, completed_at, response_status, response_body FROM aegis.rest_idempotency_keys
                WHERE id = :id
                """).param("id", key).query().singleRow();
        assertEquals("IN_PROGRESS", defaults.get("status"));
        assertEquals(null, defaults.get("completed_at"));
        insertKey(other, "POST /admin/asset-models", "k".repeat(128), hash);
        insertKey(actor, "POST /admin/assets", "k".repeat(128), hash);

        assertViolation("23505", "uq_rest_idempotency_scope",
                () -> insertKey(actor, "POST /admin/asset-models", "k".repeat(128), hash));
        assertViolation("23514", "ck_rest_idempotency_key_length",
                () -> insertKey(actor, "POST /admin/asset-models", "k".repeat(129), hash));
        assertViolation("23514", "ck_rest_idempotency_key_length",
                () -> insertKey(actor, "POST /admin/asset-models", "", hash));
        assertViolation("23514", "ck_rest_idempotency_hash",
                () -> insertKey(actor, "POST /admin/asset-models", "short-hash", new byte[31]));
        assertViolation("23514", "ck_rest_idempotency_endpoint", () -> insertKey(actor, " ", "blank", hash));
        assertViolation("23503", "fk_rest_idempotency_actor",
                () -> insertKey(UUID.randomUUID(), "POST /admin/asset-models", "unknown-actor", hash));
        assertViolation("23514", "ck_rest_idempotency_dates", () -> jdbc.sql("""
                INSERT INTO aegis.rest_idempotency_keys
                    (actor_user_id, endpoint, idempotency_key, request_hash, expires_at)
                VALUES (:actor, 'POST /admin/assets', 'expired-at-birth', :hash, now())
                """).param("actor", actor).param("hash", hash).update());
        assertViolation("23514", "ck_rest_idempotency_lifecycle", () -> jdbc.sql(
                "UPDATE aegis.rest_idempotency_keys SET status = 'COMPLETED' WHERE id = :id")
                .param("id", key).update());
        assertViolation("23514", "ck_rest_idempotency_lifecycle", () -> jdbc.sql(
                "UPDATE aegis.rest_idempotency_keys SET response_body = '{}'::jsonb WHERE id = :id")
                .param("id", key).update());
        assertViolation("23514", "ck_rest_idempotency_resource_pair", () -> jdbc.sql(
                "UPDATE aegis.rest_idempotency_keys SET resource_type = 'ASSET' WHERE id = :id")
                .param("id", key).update());
        assertViolation("23514", "ck_rest_idempotency_response_status", () -> jdbc.sql("""
                UPDATE aegis.rest_idempotency_keys
                SET status = 'COMPLETED', completed_at = now(), response_status = 600 WHERE id = :id
                """).param("id", key).update());

        assertEquals(1, jdbc.sql("""
                UPDATE aegis.rest_idempotency_keys
                SET status = 'COMPLETED', completed_at = now(), response_status = 201,
                    response_body = '{"id": 1}'::jsonb, resource_type = 'ASSET_MODEL', resource_id = :resource
                WHERE id = :id
                """).param("resource", UUID.randomUUID()).param("id", key).update());
    }

    @Test
    void usersEnforceTheIdentityInvariants() {
        flyway(null).migrate();
        UUID id = insertUser("Technicien", "technician@aegis.test", "TECHNICIAN", "STANDARD", "{bcrypt}$2a$10$x");

        Map<String, Object> defaults = jdbc.sql("SELECT status, created_at, archived_at FROM aegis.users WHERE id = :id")
                .param("id", id).query().singleRow();
        assertEquals("ACTIVE", defaults.get("status"));
        assertNotNull(defaults.get("created_at"));
        assertEquals(null, defaults.get("archived_at"));

        assertViolation("23505", "ux_users_email_ci",
                () -> insertUser("Autre", "Technician@AEGIS.test", "TECHNICIAN", "STANDARD", "hash"));
        assertViolation("23514", "ck_users_role",
                () -> insertUser("Autre", "owner@aegis.test", "OWNER", "STANDARD", "hash"));
        assertViolation("23514", "ck_users_access_level",
                () -> insertUser("Autre", "secret@aegis.test", "TECHNICIAN", "SECRET", "hash"));
        assertViolation("23514", "ck_users_email_non_blank",
                () -> insertUser("Autre", " padded@aegis.test", "TECHNICIAN", "STANDARD", "hash"));
        assertViolation("23514", "ck_users_display_name_non_blank",
                () -> insertUser("   ", "blank-name@aegis.test", "TECHNICIAN", "STANDARD", "hash"));
        assertViolation("23514", "ck_users_password_hash_non_blank",
                () -> insertUser("Autre", "blank-hash@aegis.test", "TECHNICIAN", "STANDARD", " "));
        assertViolation("23514", "ck_users_status",
                () -> jdbc.sql("UPDATE aegis.users SET status = 'LOCKED' WHERE id = :id").param("id", id).update());
        assertViolation("23514", "ck_users_archived_disabled",
                () -> jdbc.sql("UPDATE aegis.users SET archived_at = now() WHERE id = :id").param("id", id).update());

        assertEquals(1, jdbc.sql("UPDATE aegis.users SET status = 'DISABLED', archived_at = now() WHERE id = :id")
                .param("id", id).update());
    }

    @Test
    void catalogueEnforcesItsUniquenessAndLifecycleRules() {
        flyway(null).migrate();
        UUID archivedModel = insertModel("Multimeter");
        assertViolation("23505", "ux_asset_models_name_ci", () -> insertModel("MULTIMETER"));
        jdbc.sql("UPDATE aegis.asset_models SET archived_at = now() WHERE id = :id").param("id", archivedModel).update();
        UUID model = insertModel("MULTIMETER");

        UUID asset = insertAsset(model, "AEG-001", false, null);
        UUID otherAsset = insertAsset(model, "AEG-002", true, OffsetDateTime.of(2027, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        assertEquals("SERVICEABLE", jdbc.sql("SELECT operational_status FROM aegis.assets WHERE id = :id")
                .param("id", asset).query(String.class).single());
        assertViolation("23505", "ux_assets_code_ci", () -> insertAsset(model, "aeg-001", false, null));
        assertViolation("23514", "ck_assets_calibration_pair", () -> insertAsset(model, "AEG-003", true, null));
        assertViolation("23514", "ck_assets_calibration_pair",
                () -> insertAsset(model, "AEG-004", false, OffsetDateTime.now(ZoneOffset.UTC)));
        assertViolation("23503", "fk_assets_asset_model", () -> insertAsset(UUID.randomUUID(), "AEG-005", false, null));
        assertViolation("23514", "ck_assets_operational_status", () -> jdbc.sql(
                "UPDATE aegis.assets SET operational_status = 'LOST' WHERE id = :id").param("id", asset).update());
        assertViolation("23514", "ck_assets_access_level", () -> jdbc.sql(
                "UPDATE aegis.assets SET required_access_level = 'SECRET' WHERE id = :id").param("id", asset).update());

        UUID tag = insertIdentifier(asset, "RFID_UHF", "E200-0001");
        insertIdentifier(asset, "NFC", "E200-0001");
        assertViolation("23505", "ux_asset_identifiers_active_value",
                () -> insertIdentifier(otherAsset, "RFID_UHF", "E200-0001"));
        assertViolation("23514", "ck_asset_identifiers_type", () -> insertIdentifier(asset, "BARCODE", "E200-0002"));
        assertViolation("23514", "ck_asset_identifiers_lifecycle", () -> jdbc.sql(
                "UPDATE aegis.asset_identifiers SET active = false WHERE id = :id").param("id", tag).update());
        assertViolation("23503", "fk_asset_identifiers_asset",
                () -> insertIdentifier(UUID.randomUUID(), "QR", "E200-0003"));

        jdbc.sql("UPDATE aegis.asset_identifiers SET active = false, revoked_at = now() WHERE id = :id")
                .param("id", tag).update();
        insertIdentifier(otherAsset, "RFID_UHF", "E200-0001");
    }

    private Flyway flyway(String target) {
        FluentConfiguration configuration = Flyway.configure()
                .dataSource(server.url(database), server.user(), server.password())
                .locations("classpath:db/migration")
                .defaultSchema("public")
                .validateOnMigrate(true);
        if (target != null) {
            configuration.target(target);
        }
        return configuration.load();
    }

    private List<String> appliedVersions() {
        return jdbc.sql("SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank")
                .query(String.class).list();
    }

    private UUID insertUser(String displayName, String email, String role, String level, String passwordHash) {
        return jdbc.sql("""
                INSERT INTO aegis.users (display_name, email, password_hash, role, maximum_access_level)
                VALUES (:displayName, :email, :passwordHash, :role, :level)
                RETURNING id
                """)
                .param("displayName", displayName).param("email", email).param("passwordHash", passwordHash)
                .param("role", role).param("level", level)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    private UUID insertKey(UUID actor, String endpoint, String key, byte[] hash) {
        return jdbc.sql("""
                INSERT INTO aegis.rest_idempotency_keys
                    (actor_user_id, endpoint, idempotency_key, request_hash, expires_at)
                VALUES (:actor, :endpoint, :key, :hash, now() + interval '24 hours')
                RETURNING id
                """)
                .param("actor", actor).param("endpoint", endpoint).param("key", key).param("hash", hash)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    private UUID insertModel(String name) {
        return jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", name)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    private UUID insertAsset(UUID model, String code, boolean calibrationRequired, OffsetDateTime calibrationDueAt) {
        return jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level,
                                          calibration_required, calibration_due_at)
                VALUES (:model, :code, 'STANDARD', :calibrationRequired, :calibrationDueAt)
                RETURNING id
                """)
                .param("model", model).param("code", code).param("calibrationRequired", calibrationRequired)
                .param("calibrationDueAt", calibrationDueAt)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    private UUID insertIdentifier(UUID asset, String type, String value) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value)
                VALUES (:asset, :type, :value)
                RETURNING id
                """)
                .param("asset", asset).param("type", type).param("value", value)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    private static void assertViolation(String sqlState, String constraint, Executable statement) {
        DataAccessException failure = assertThrows(DataAccessException.class, statement);
        PSQLException cause = assertInstanceOf(PSQLException.class, failure.getMostSpecificCause());
        assertEquals(sqlState, cause.getSQLState(), cause::getMessage);
        assertEquals(constraint, cause.getServerErrorMessage().getConstraint(), cause::getMessage);
    }
}
