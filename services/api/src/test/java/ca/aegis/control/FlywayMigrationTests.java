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
import org.flywaydb.core.api.FlywayException;
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

/** Applies the real migrations to a new empty PostgreSQL database with the application's Flyway settings. */
class FlywayMigrationTests {

    private static final List<String> ALL_VERSIONS = List.of("001", "002", "002.1", "002.2", "003", "004");

    private final TestDatabases databases = TestDatabases.shared();
    private final TestDatabaseServer server = databases.server();

    /** The grant callback skips a role that does not exist, like the default role on a local database. */
    private final String absentRole = "aegis_test_absent_" + UUID.randomUUID().toString().substring(0, 8);

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
        assertEquals(6, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);

        assertEquals(ALL_VERSIONS, appliedVersions());
        assertEquals(List.of("asset_identifiers", "asset_models", "asset_placements", "assets", "audit_events",
                "compartments", "locker_devices", "lockers", "operating_schedules", "operating_windows",
                "rest_idempotency_keys", "users"), jdbc.sql("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'aegis' ORDER BY table_name COLLATE "C"
                """).query(String.class).list());
    }

    @Test
    void upgradesADatabaseCreatedByTheFirstMigration() {
        assertEquals(1, flyway("001").migrate().migrationsExecuted);
        assertEquals(List.of("001"), appliedVersions());

        assertEquals(5, flyway(null).migrate().migrationsExecuted);
        assertEquals(ALL_VERSIONS, appliedVersions());
    }

    /** Dev databases stood at V002_1 when V002_2 was added; existing rows get no backfilled event. */
    @Test
    void upgradesADatabaseAtTheIdempotencyMigrationWithoutInventingHistory() {
        assertEquals(3, flyway("2.1").migrate().migrationsExecuted);
        UUID user = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");
        UUID model = insertModel("Oscilloscope");

        assertEquals(3, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);
        assertEquals(ALL_VERSIONS, appliedVersions());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE id = :id").param("id", model)
                .query(Long.class).single());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.users WHERE id = :id").param("id", user)
                .query(Long.class).single());
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single());
    }

    /**
     * The three proof references of document 08, section 4.9, arrive with the tables they reference (V006, V008),
     * so no reference column exists without its foreign key.
     */
    @Test
    void auditEventsEnforceTheirConstraintsWithoutReferencesToMissingTables() {
        flyway(null).migrate();
        UUID actor = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");

        assertEquals(List.of("id", "event_type", "actor_user_id", "subject_type", "subject_id", "from_state",
                "to_state", "result", "reason", "details", "occurred_at"), jdbc.sql("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'aegis' AND table_name = 'audit_events' ORDER BY ordinal_position
                """).query(String.class).list());
        UUID event = insertEvent(actor, "ASSET_CREATED", "ASSET", "ACCEPTED");
        Map<String, Object> defaults = jdbc.sql("SELECT details::text AS details, occurred_at FROM aegis.audit_events "
                + "WHERE id = :id").param("id", event).query().singleRow();
        assertEquals("{}", defaults.get("details"));
        assertNotNull(defaults.get("occurred_at"));
        insertEvent(null, "LOCKER_OFFLINE", "LOCKER", null);

        assertViolation("23514", "ck_audit_events_type", () -> insertEvent(actor, "ASSET_DELETED", "ASSET", null));
        assertViolation("23514", "ck_audit_events_subject_type",
                () -> insertEvent(actor, "ASSET_CREATED", "CATALOG", null));
        assertViolation("23514", "ck_audit_events_result", () -> insertEvent(actor, "ASSET_CREATED", "ASSET", "OK"));
        assertViolation("23503", "fk_audit_events_actor",
                () -> insertEvent(UUID.randomUUID(), "ASSET_CREATED", "ASSET", null));
        assertViolation("23514", "ck_audit_events_state_pair", () -> jdbc.sql("""
                INSERT INTO aegis.audit_events (event_type, subject_type, subject_id, from_state)
                VALUES ('RESERVATION_CREATED', 'RESERVATION', gen_random_uuid(), 'ACTIVE')
                """).update());
        assertViolation("23514", "ck_audit_events_state_pair", () -> jdbc.sql("""
                INSERT INTO aegis.audit_events (event_type, subject_type, subject_id, from_state, to_state)
                VALUES ('RESERVATION_CREATED', 'RESERVATION', gen_random_uuid(), ' ', 'ACTIVE')
                """).update());
    }

    /**
     * Defense in depth only: the owner meets the triggers, but can disable them, and a superuser skips them with
     * {@code session_replication_role}. The application role's privileges are the protection (document 08, 12.1).
     */
    @Test
    void auditEventsRefuseRewritesFromTheOwnerButNotFromASuperuserBypassingTriggers() {
        flyway(null).migrate();
        UUID event = insertEvent(null, "LOCKER_ONLINE", "LOCKER", null);

        assertRefused("23001", () -> jdbc.sql("UPDATE aegis.audit_events SET reason = 'x' WHERE id = :id")
                .param("id", event).update());
        assertRefused("23001", () -> jdbc.sql("DELETE FROM aegis.audit_events WHERE id = :id")
                .param("id", event).update());
        assertRefused("23001", () -> jdbc.sql("TRUNCATE aegis.audit_events").update());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single());

        assertTrue(jdbc.sql("SELECT rolsuper FROM pg_roles WHERE rolname = current_user").query(Boolean.class)
                .single(), "the bypass below needs the superuser of the test server");
        try (SingleConnectionDataSource session = session()) {
            JdbcClient superuser = JdbcClient.create(session);
            superuser.sql("SET session_replication_role = replica").update();
            assertEquals(1, superuser.sql("DELETE FROM aegis.audit_events WHERE id = :id").param("id", event)
                    .update());
        }
    }

    @Test
    void theApplicationRoleMayAppendAuditEventsButNeverRewriteThem() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            assertEquals(6, flyway(null, role).migrate().migrationsExecuted);
            assertEquals(0, flyway(null, role).migrate().migrationsExecuted);
            assertTrue(flyway(null, role).validateWithResult().validationSuccessful);
            UUID actor = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");

            assertEquals(List.of("audit_events:INSERT,SELECT"), privileges(role, "audit_events"));
            assertEquals(List.of("assets:DELETE,INSERT,SELECT,UPDATE"), privileges(role, "assets"));
            assertEquals(List.of("rest_idempotency_keys:DELETE,INSERT,SELECT,UPDATE"),
                    privileges(role, "rest_idempotency_keys"));
            for (String table : List.of("lockers", "compartments", "locker_devices", "asset_placements")) {
                assertEquals(List.of(table + ":DELETE,INSERT,SELECT,UPDATE"), privileges(role, table));
            }

            try (SingleConnectionDataSource session = session()) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                UUID model = application.sql("INSERT INTO aegis.asset_models (name) VALUES ('Sonde') RETURNING id")
                        .query(UUID.class).single();
                application.sql("SELECT id FROM aegis.asset_models WHERE id = :id FOR UPDATE").param("id", model)
                        .query(UUID.class).single();
                assertEquals(1, application.sql("UPDATE aegis.asset_models SET description = 'x' WHERE id = :id")
                        .param("id", model).update());
                UUID event = application.sql("""
                        INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, result)
                        VALUES ('ASSET_CREATED', :actor, 'ASSET_MODEL', :model, 'ACCEPTED')
                        RETURNING id
                        """).param("actor", actor).param("model", model).query(UUID.class).single();
                assertEquals(1, application.sql("SELECT count(*) FROM aegis.audit_events WHERE id = :id")
                        .param("id", event).query(Long.class).single());

                assertRefused("42501", () -> application
                        .sql("UPDATE aegis.audit_events SET reason = 'x' WHERE id = :id").param("id", event).update());
                assertRefused("42501", () -> application.sql("DELETE FROM aegis.audit_events WHERE id = :id")
                        .param("id", event).update());
                assertRefused("42501", () -> application.sql("TRUNCATE aegis.audit_events").update());
                assertRefused("42501", () -> application.sql("TRUNCATE aegis.asset_models").update());
                assertRefused("42501", () -> application.sql("CREATE TABLE aegis.intruder (id int)").update());
                assertRefused("42501", () -> application.sql("ALTER TABLE aegis.audit_events DISABLE TRIGGER ALL")
                        .update());
                assertEquals(1, application.sql("DELETE FROM aegis.asset_models WHERE id = :id").param("id", model)
                        .update());
                application.sql("RESET ROLE").update();
            }
            assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single());
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    /** Granting to the owner would revoke its own privileges, and a superuser ignores them. */
    @Test
    void theGrantCallbackRefusesTheOwnerAsApplicationRole() {
        assertThrows(FlywayException.class, () -> flyway(null, server.user()).migrate());
    }

    /** A membership without inheritance still allows {@code SET ROLE} to the owner, and from there any rewrite. */
    @Test
    void theGrantCallbackRefusesAMemberOfAnOwnerEvenWithoutInheritance() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String owner = "aegis_test_owner_" + suffix;
        String member = "aegis_test_member_" + suffix;
        flyway(null).migrate();
        jdbc.sql("CREATE ROLE " + owner + " NOLOGIN NOSUPERUSER").update();
        jdbc.sql("CREATE ROLE " + member + " NOLOGIN NOSUPERUSER").update();
        try {
            jdbc.sql("ALTER TABLE aegis.rest_idempotency_keys OWNER TO " + owner).update();
            jdbc.sql("GRANT " + owner + " TO " + member + " WITH INHERIT FALSE, SET TRUE").update();
            assertTrue(jdbc.sql("SELECT NOT pg_has_role('" + member + "', '" + owner + "', 'USAGE')")
                    .query(Boolean.class).single(), "the membership must not inherit for this case to mean anything");

            assertThrows(FlywayException.class, () -> flyway(null, member).migrate());
            assertEquals(List.of(), privileges(member, "audit_events"));
        } finally {
            jdbc.sql("REASSIGN OWNED BY " + owner + " TO " + server.user()).update();
            jdbc.sql("DROP OWNED BY " + member).update();
            jdbc.sql("DROP OWNED BY " + owner).update();
            jdbc.sql("DROP ROLE " + member).update();
            jdbc.sql("DROP ROLE " + owner).update();
        }
    }

    /** Every database applied V001 and V002 only when V002_1 was added; V002_1 and V002_2 follow in order. */
    @Test
    void upgradesADatabaseAtTheCatalogMigrationWithItsData() {
        assertEquals(2, flyway("2").migrate().migrationsExecuted);
        assertEquals(List.of("001", "002"), appliedVersions());
        UUID user = insertUser("Administratrice", "admin@aegis.test", "ADMIN", "STANDARD", "{bcrypt}$2a$10$x");
        UUID model = insertModel("Oscilloscope");

        assertEquals(4, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);
        assertEquals(ALL_VERSIONS, appliedVersions());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.users WHERE id = :id").param("id", user)
                .query(Long.class).single());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE id = :id").param("id", model)
                .query(Long.class).single());
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys").query(Long.class).single());
    }

    /** Dev databases stood at V002_2 when V003 was added: their history and rows are kept as they were. */
    @Test
    void upgradesADatabaseAtTheAuditMigrationWithoutRewritingItsHistory() {
        assertEquals(4, flyway("2.2").migrate().migrationsExecuted);
        UUID model = insertModel("Oscilloscope");
        UUID asset = insertAsset(model, "AEG-001", false, null);
        insertIdentifier(asset, "RFID_UHF", "E200-0001");
        insertEvent(null, "ASSET_CREATED", "ASSET", "ACCEPTED");
        List<Map<String, Object>> history = history();

        assertEquals(2, flyway(null).migrate().migrationsExecuted);
        assertEquals(0, flyway(null).migrate().migrationsExecuted);
        assertTrue(flyway(null).validateWithResult().validationSuccessful);
        assertEquals(ALL_VERSIONS, appliedVersions());
        assertEquals(history, history().subList(0, history.size()));
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.asset_identifiers WHERE asset_id = :id")
                .param("id", asset).query(Long.class).single());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single());
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.asset_placements").query(Long.class).single());
    }

    @Test
    void lockersAndPlacementsEnforceTheirInvariants() {
        flyway(null).migrate();
        UUID locker = insertLocker("AEGIS-DEMO-01");
        assertViolation("23505", "ux_lockers_code_ci", () -> insertLocker("aegis-demo-01"));
        assertViolation("23514", "ck_lockers_topology", () -> jdbc.sql(
                "INSERT INTO aegis.lockers (code, name, topology) VALUES ('L2', 'Casier', 'RING')").update());
        assertEquals("UNKNOWN", jdbc.sql("SELECT status FROM aegis.lockers WHERE id = :id").param("id", locker)
                .query(String.class).single());

        UUID first = insertCompartment(locker, "A1", 1, 1);
        UUID second = insertCompartment(locker, "A2", 2, 2);
        assertViolation("23505", "ux_compartments_locker_code", () -> insertCompartment(locker, "A1", 3, 3));
        assertViolation("23505", "ux_compartments_locker_address", () -> insertCompartment(locker, "A3", 1, 3));
        assertViolation("23505", "uq_compartments_hub_port", () -> insertCompartment(locker, "A3", 3, 1));
        assertViolation("23514", "ck_compartments_local_address", () -> insertCompartment(locker, "A3", 248, 3));
        assertViolation("23514", "compartments_hub_port_check", () -> insertCompartment(locker, "A3", 3, 0));
        assertViolation("23503", "fk_compartments_locker", () -> insertCompartment(UUID.randomUUID(), "B1", 1, 1));

        insertDevice(locker, "sim-a");
        assertViolation("23505", "ux_locker_devices_one_active_per_locker", () -> insertDevice(locker, "sim-b"));
        assertViolation("23505", "ux_locker_devices_device_key", () -> insertDevice(insertLocker("L2"), "sim-a"));
        assertViolation("23514", "ck_locker_devices_session_pair", () -> jdbc.sql("""
                UPDATE aegis.locker_devices SET boot_count = 1 WHERE device_key = 'sim-a'
                """).update());
        assertViolation("23514", "ck_locker_devices_heartbeat_reference", () -> jdbc.sql("""
                UPDATE aegis.locker_devices
                SET device_session_id = gen_random_uuid(), boot_count = 1,
                    heartbeat_connection_id = gen_random_uuid(), heartbeat_sequence = 0, last_valid_heartbeat_at = now()
                WHERE device_key = 'sim-a'
                """).update());

        UUID model = insertModel("Multimeter");
        UUID asset = insertAsset(model, "AEG-001", false, null);
        UUID other = insertAsset(model, "AEG-002", false, null);
        UUID placement = insertPlacement(asset, first);
        assertViolation("23505", "ux_asset_placements_one_current_per_asset", () -> insertPlacement(asset, second));
        assertViolation("23505", "ux_asset_placements_one_current_per_compartment",
                () -> insertPlacement(other, first));
        assertViolation("23503", "fk_asset_placements_compartment", () -> insertPlacement(other, UUID.randomUUID()));
        assertViolation("23503", "fk_asset_placements_asset", () -> insertPlacement(UUID.randomUUID(), second));
        assertViolation("23514", "ck_asset_placements_dates", () -> jdbc.sql(
                "UPDATE aegis.asset_placements SET removed_at = assigned_at - interval '1 second' WHERE id = :id")
                .param("id", placement).update());
        assertViolation("23514", "ck_asset_placements_reason_non_blank", () -> jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason) VALUES (:asset, :compartment, ' ')
                """).param("asset", other).param("compartment", second).update());

        jdbc.sql("UPDATE aegis.asset_placements SET removed_at = now() WHERE id = :id").param("id", placement)
                .update();
        insertPlacement(other, first);
        insertPlacement(asset, second);
        assertEquals(3, jdbc.sql("SELECT count(*) FROM aegis.asset_placements").query(Long.class).single());
    }

    /** CAT-02, decided on 28 October 2026: an asset carries at most one active identifier of each type. */
    @Test
    void anAssetCarriesAtMostOneActiveIdentifierOfEachType() {
        flyway(null).migrate();
        UUID asset = insertAsset(insertModel("Multimeter"), "AEG-001", false, null);
        UUID tag = insertIdentifier(asset, "RFID_UHF", "E200-0001");
        insertIdentifier(asset, "NFC", "N-0001");

        assertViolation("23505", "ux_asset_identifiers_one_active_per_type",
                () -> insertIdentifier(asset, "RFID_UHF", "E200-0002"));
        jdbc.sql("UPDATE aegis.asset_identifiers SET active = false, revoked_at = now() WHERE id = :id")
                .param("id", tag).update();
        insertIdentifier(asset, "RFID_UHF", "E200-0002");
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

    private List<String> appliedVersions() {
        return jdbc.sql("SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank")
                .query(String.class).list();
    }

    private List<Map<String, Object>> history() {
        return jdbc.sql("""
                SELECT installed_rank, version, script, checksum, installed_by, installed_on, success
                FROM public.flyway_schema_history ORDER BY installed_rank
                """).query().listOfRows();
    }

    private UUID insertLocker(String code) {
        return jdbc.sql("INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier', 'HUB_CELL') "
                + "RETURNING id").param("code", code).query(UUID.class).single();
    }

    private UUID insertCompartment(UUID locker, String code, int address, int port) {
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                VALUES (:locker, :code, :address, :port)
                RETURNING id
                """).param("locker", locker).param("code", code).param("address", address).param("port", port)
                .query(UUID.class).single();
    }

    private void insertDevice(UUID locker, String deviceKey) {
        jdbc.sql("""
                INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version)
                VALUES (:locker, :key, '0.1.0-sim')
                """).param("locker", locker).param("key", deviceKey).update();
    }

    private UUID insertPlacement(UUID asset, UUID compartment) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason)
                VALUES (:asset, :compartment, 'Affectation initiale')
                RETURNING id
                """).param("asset", asset).param("compartment", compartment).query(UUID.class).single();
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

    private UUID insertEvent(UUID actor, String type, String subjectType, String result) {
        return jdbc.sql("""
                INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, result)
                VALUES (:type, :actor, :subjectType, gen_random_uuid(), :result)
                RETURNING id
                """)
                .param("type", type).param("actor", actor).param("subjectType", subjectType).param("result", result)
                .query((row, number) -> row.getObject("id", UUID.class)).single();
    }

    /** One session, so that {@code SET ROLE} and session settings apply to the following statements. */
    private SingleConnectionDataSource session() {
        return new SingleConnectionDataSource(server.url(database), server.user(), server.password(), true);
    }

    private List<String> privileges(String role, String table) {
        return jdbc.sql("""
                SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type)
                FROM information_schema.role_table_grants
                WHERE grantee = :role AND table_schema = 'aegis' AND table_name = :table
                GROUP BY table_name
                """).param("role", role).param("table", table).query(String.class).list();
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
