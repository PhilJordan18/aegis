package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.postgresql.util.PGobject;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import ca.aegis.control.support.TestDatabaseServer;
import ca.aegis.control.support.TestDatabases;

/**
 * V007 to V009, document 08, sections 4.6 to 4.9, 5.1, 8.2 and 9: local access challenges, the display outbox, the
 * command outbox, inbound device messages, physical observations, their audit references and anomalies. Every
 * refusal below comes from PostgreSQL itself; each invalid row breaks exactly one constraint so that the name is
 * certain, except where a comment says which constraint PostgreSQL reports first.
 */
class IotEvidenceSchemaTests {

    private static final int MIGRATIONS = 11;
    private static final OffsetDateTime CREATED = OffsetDateTime.of(2026, 11, 2, 13, 0, 0, 0, ZoneOffset.UTC);
    private static final OffsetDateTime DISPLAYED = CREATED.plusSeconds(5);
    private static final OffsetDateTime CONSUMED = CREATED.plusSeconds(20);
    private static final OffsetDateTime AUTHORIZED = CONSUMED;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** The claim of section 9.2, returning the id only: one due row, taken without waiting for another dispatcher. */
    private static final String CLAIM = """
            WITH candidate AS (
                SELECT id
                FROM aegis.command_outbox
                WHERE (
                    status = 'PENDING'
                    OR (status = 'CLAIMED' AND claim_until < now())
                )
                  AND next_attempt_at <= now()
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE aegis.command_outbox AS command
            SET status = 'CLAIMED',
                attempt_count = command.attempt_count + 1,
                claimed_at = now(),
                claim_until = now() + interval '15 seconds'
            FROM candidate
            WHERE command.id = candidate.id
            RETURNING command.id
            """;

    private final TestDatabases databases = TestDatabases.shared();
    private final TestDatabaseServer server = databases.server();
    private final String absentRole = "aegis_test_absent_" + UUID.randomUUID().toString().substring(0, 8);

    private String database;
    private JdbcClient jdbc;
    private UUID model;

    /** A technician with an active reservation of an asset expected in one compartment of a locker and its hub. */
    private record Site(UUID user, UUID asset, UUID identifier, UUID locker, UUID compartment, UUID device,
            UUID session, UUID reservation) {
    }

    @BeforeEach
    void migratedDatabase() {
        database = databases.create("evidence");
        jdbc = JdbcClient.create(new DriverManagerDataSource(server.url(database), server.user(), server.password()));
        assertEquals(MIGRATIONS, flyway(absentRole).migrate().migrationsExecuted);
        model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES ('Multimeter') RETURNING id")
                .query(UUID.class).single();
    }

    @AfterEach
    void dropDatabase() {
        databases.drop(database);
    }

    @Test
    void theEvidenceTablesDeclareTheConstraintsAndIndexesOfDocument08() {
        assertEquals(List.of(
                "ck_local_challenge_attempts:c", "ck_local_challenge_closed:c", "ck_local_challenge_consumed:c",
                "ck_local_challenge_consumption_time:c", "ck_local_challenge_dates:c", "ck_local_challenge_status:c",
                "ck_local_challenge_window:c", "fk_local_challenge_device:f", "fk_local_challenge_operation:f",
                "local_access_challenges_failed_attempts_check:c", "local_access_challenges_operation_id_key:u",
                "local_access_challenges_pkey:p", "local_access_challenges_token_hash_check:c",
                "local_access_challenges_token_hash_key:u", "uq_local_challenge_id_operation:u"),
                constraints("local_access_challenges"));
        assertEquals(List.of(
                "ck_display_challenge:c", "ck_display_claim:c", "ck_display_dates:c", "ck_display_schema_non_blank:c",
                "ck_display_sendable_payload:c", "ck_display_status:c", "ck_display_type:c", "fk_display_challenge:f",
                "fk_display_device:f",
                "fk_display_operation:f", "hub_display_outbox_attempt_count_check:c",
                "hub_display_outbox_display_revision_check:c", "hub_display_outbox_encryption_key_id_check:c",
                "hub_display_outbox_message_id_key:u", "hub_display_outbox_pkey:p", "hub_display_outbox_topic_check:c",
                "uq_display_revision:u"), constraints("hub_display_outbox"));
        assertEquals(List.of(
                "ck_command_outbox_ack:c", "ck_command_outbox_attempts:c", "ck_command_outbox_claim:c",
                "ck_command_outbox_dates:c", "ck_command_outbox_schema_non_blank:c", "ck_command_outbox_status:c",
                "ck_command_outbox_topic_non_blank:c", "ck_command_outbox_type:c", "command_outbox_pkey:p",
                "fk_command_outbox_compartment_locker:f", "fk_command_outbox_operation:f",
                "uq_command_outbox_message:u", "uq_command_outbox_operation:u"), constraints("command_outbox"));
        assertEquals(List.of(
                "ck_inbound_messages_accepted_envelope:c", "ck_inbound_messages_availability_status:c",
                "ck_inbound_messages_boot_count:c", "ck_inbound_messages_command_correlation:c",
                "ck_inbound_messages_connection:c", "ck_inbound_messages_display_correlation:c",
                "ck_inbound_messages_error:c", "ck_inbound_messages_schema_non_blank:c",
                "ck_inbound_messages_sequence:c", "ck_inbound_messages_status:c",
                "ck_inbound_messages_status_without_operation:c", "ck_inbound_messages_topic_non_blank:c",
                "ck_inbound_messages_type:c", "fk_inbound_messages_command:f", "fk_inbound_messages_device:f",
                "fk_inbound_messages_display:f", "fk_inbound_messages_operation:f", "inbound_device_messages_pkey:p",
                "uq_inbound_messages_device_message:u"), constraints("inbound_device_messages"));
        assertEquals(List.of(
                "ck_physical_observations_compartment:c", "ck_physical_observations_confidence:c",
                "ck_physical_observations_identifier:c", "ck_physical_observations_type:c",
                "fk_physical_observations_compartment_locker:f", "fk_physical_observations_message:f",
                "fk_physical_observations_operation:f", "physical_observations_pkey:p"),
                constraints("physical_observations"));
        assertEquals(List.of(
                "anomalies_pkey:p", "ck_anomalies_acknowledgement_note:c", "ck_anomalies_dates:c",
                "ck_anomalies_lifecycle:c", "ck_anomalies_resolution_note:c", "ck_anomalies_severity:c",
                "ck_anomalies_status:c", "ck_anomalies_type:c", "fk_anomalies_acknowledger:f", "fk_anomalies_asset:f",
                "fk_anomalies_compartment:f", "fk_anomalies_operation:f", "fk_anomalies_resolution_observation:f"),
                constraints("anomalies"));

        // No cascade anywhere: command and proof history is never deleted through a parent row.
        assertEquals(List.of(
                "fk_command_outbox_compartment_locker FOREIGN KEY (compartment_id, locker_id) "
                        + "REFERENCES compartments(id, locker_id)",
                "fk_command_outbox_operation FOREIGN KEY (operation_id) REFERENCES locker_operations(id)",
                "fk_display_challenge FOREIGN KEY (challenge_id, operation_id) "
                        + "REFERENCES local_access_challenges(id, operation_id)",
                "fk_display_device FOREIGN KEY (locker_device_id, locker_id) REFERENCES locker_devices(id, locker_id)",
                "fk_display_operation FOREIGN KEY (operation_id, locker_id) "
                        + "REFERENCES locker_operations(id, locker_id)",
                "fk_local_challenge_device FOREIGN KEY (locker_device_id, locker_id) "
                        + "REFERENCES locker_devices(id, locker_id)",
                "fk_local_challenge_operation FOREIGN KEY (operation_id, locker_id) "
                        + "REFERENCES locker_operations(id, locker_id)"),
                foreignKeys("local_access_challenges", "hub_display_outbox", "command_outbox"));
        assertEquals(List.of(
                "fk_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)",
                "fk_audit_events_message FOREIGN KEY (inbound_message_id) REFERENCES inbound_device_messages(id)",
                "fk_audit_events_observation FOREIGN KEY (physical_observation_id) "
                        + "REFERENCES physical_observations(id)",
                "fk_audit_events_operation FOREIGN KEY (operation_id) REFERENCES locker_operations(id)",
                "fk_inbound_messages_command FOREIGN KEY (command_message_id) REFERENCES command_outbox(message_id)",
                "fk_inbound_messages_device FOREIGN KEY (locker_device_id) REFERENCES locker_devices(id)",
                "fk_inbound_messages_display FOREIGN KEY (display_message_id) "
                        + "REFERENCES hub_display_outbox(message_id)",
                "fk_inbound_messages_operation FOREIGN KEY (operation_id) REFERENCES locker_operations(id)",
                "fk_physical_observations_compartment_locker FOREIGN KEY (compartment_id, locker_id) "
                        + "REFERENCES compartments(id, locker_id)",
                "fk_physical_observations_message FOREIGN KEY (inbound_message_id) "
                        + "REFERENCES inbound_device_messages(id)",
                "fk_physical_observations_operation FOREIGN KEY (operation_id) REFERENCES locker_operations(id)"),
                foreignKeys("inbound_device_messages", "physical_observations", "audit_events"));
        assertEquals(List.of(
                "fk_anomalies_acknowledger FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id)",
                "fk_anomalies_asset FOREIGN KEY (asset_id) REFERENCES assets(id)",
                "fk_anomalies_compartment FOREIGN KEY (compartment_id) REFERENCES compartments(id)",
                "fk_anomalies_operation FOREIGN KEY (locker_operation_id) REFERENCES locker_operations(id)",
                "fk_anomalies_resolution_observation FOREIGN KEY (resolution_evidence_observation_id) "
                        + "REFERENCES physical_observations(id)"), foreignKeys("anomalies"));

        // Invariant, expiry, claim and deduplication indexes only; the read indexes of section 5.2 are left to V011.
        assertEquals(List.of("ix_local_challenges_pending_expiry", "local_access_challenges_operation_id_key",
                "local_access_challenges_pkey", "local_access_challenges_token_hash_key",
                "uq_local_challenge_id_operation"), indexes("local_access_challenges"));
        assertEquals(List.of("hub_display_outbox_message_id_key", "hub_display_outbox_pkey", "ix_display_claimable",
                "uq_display_revision", "ux_display_one_challenge_per_operation"), indexes("hub_display_outbox"));
        assertEquals(List.of("command_outbox_pkey", "ix_command_outbox_claimable", "uq_command_outbox_message",
                "uq_command_outbox_operation"), indexes("command_outbox"));
        assertEquals(List.of("inbound_device_messages_pkey", "uq_inbound_messages_device_message"),
                indexes("inbound_device_messages"));
        assertEquals(List.of("physical_observations_pkey"), indexes("physical_observations"));
        assertEquals(List.of("anomalies_pkey", "ux_anomalies_one_open_per_operation"), indexes("anomalies"));
        assertEquals("CREATE UNIQUE INDEX ux_anomalies_one_open_per_operation ON aegis.anomalies USING btree "
                + "(locker_operation_id) WHERE ((locker_operation_id IS NOT NULL) "
                + "AND (status = ANY (ARRAY['OPEN'::text, 'ACKNOWLEDGED'::text])))",
                indexDefinition("ux_anomalies_one_open_per_operation"));
        assertEquals("CREATE UNIQUE INDEX ux_display_one_challenge_per_operation ON aegis.hub_display_outbox "
                + "USING btree (operation_id) WHERE (message_type = 'DISPLAY_ACCESS_CHALLENGE'::text)",
                indexDefinition("ux_display_one_challenge_per_operation"));
        assertEquals("CREATE INDEX ix_local_challenges_pending_expiry ON aegis.local_access_challenges "
                + "USING btree (expires_at) WHERE (status = 'PENDING'::text)",
                indexDefinition("ix_local_challenges_pending_expiry"));
        assertEquals("CREATE INDEX ix_display_claimable ON aegis.hub_display_outbox USING btree "
                + "(next_attempt_at, created_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'DISPATCHED'::text]))",
                indexDefinition("ix_display_claimable"));
        assertEquals("CREATE INDEX ix_command_outbox_claimable ON aegis.command_outbox USING btree "
                + "(next_attempt_at, created_at, id) WHERE (status = ANY (ARRAY['PENDING'::text, 'CLAIMED'::text]))",
                indexDefinition("ix_command_outbox_claimable"));
    }

    /**
     * One challenge per operation, whatever its status: the unique operation_id is stricter than one active
     * challenge, since an expired or invalidated challenge ends its operation (document 08, section 7.6).
     */
    @Test
    void aLocalChallengeBelongsToOneOperationAndClosesCoherently() {
        Site site = site("A");
        Site elsewhere = site("B");
        UUID operation = operation(site, "AWAITING_LOCAL_PROOF");
        UUID abandoned = operation(site, "FAILED");
        Map<String, Object> pending = challenge(site, operation);
        UUID challenge = insert("local_access_challenges", pending);
        Map<String, Object> defaults = jdbc.sql("""
                SELECT status, failed_attempts FROM aegis.local_access_challenges WHERE id = :id
                """).param("id", challenge).query().singleRow();
        assertEquals("PENDING", defaults.get("status"));
        assertEquals(0, ((Number) defaults.get("failed_attempts")).intValue());

        assertViolation("23505", "local_access_challenges_operation_id_key",
                () -> insert("local_access_challenges", challenge(site, operation)));
        assertViolation("23505", "local_access_challenges_token_hash_key", () -> insert("local_access_challenges",
                with(challenge(site, abandoned), "token_hash", pending.get("token_hash"))));
        assertViolation("23514", "local_access_challenges_token_hash_check", () -> insert("local_access_challenges",
                with(challenge(site, abandoned), "token_hash", new byte[31])));
        // The challenge, its operation and the hub it targets belong to one locker.
        assertViolation("23503", "fk_local_challenge_operation",
                () -> insert("local_access_challenges", challenge(elsewhere, abandoned)));
        assertViolation("23503", "fk_local_challenge_device", () -> insert("local_access_challenges",
                with(challenge(site, abandoned), "locker_device_id", elsewhere.device())));

        Map<String, Object> other = challenge(site, abandoned);
        assertViolation("23514", "ck_local_challenge_window", () -> insert("local_access_challenges",
                with(other, "expires_at", CREATED.plusSeconds(61))));
        assertViolation("23514", "ck_local_challenge_window", () -> insert("local_access_challenges",
                with(other, "expires_at", CREATED)));
        assertViolation("23514", "ck_local_challenge_status", () -> insert("local_access_challenges",
                with(other, "status", "USED", "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_closed", () -> insert("local_access_challenges",
                with(other, "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_closed", () -> insert("local_access_challenges",
                with(other, "status", "EXPIRED")));
        assertViolation("23514", "ck_local_challenge_consumed", () -> insert("local_access_challenges",
                with(other, "status", "CONSUMED", "displayed_at", DISPLAYED, "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_consumed", () -> insert("local_access_challenges",
                with(other, "status", "EXPIRED", "displayed_at", DISPLAYED, "consumed_at", CONSUMED,
                        "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_consumption_time", () -> insert("local_access_challenges",
                with(other, "status", "CONSUMED", "consumed_at", CONSUMED, "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_consumption_time", () -> insert("local_access_challenges",
                with(other, "status", "CONSUMED", "displayed_at", CONSUMED.plusSeconds(1), "consumed_at", CONSUMED,
                        "closed_at", CONSUMED)));
        assertViolation("23514", "ck_local_challenge_consumption_time", () -> insert("local_access_challenges",
                with(other, "status", "CONSUMED", "displayed_at", DISPLAYED, "consumed_at", CREATED.plusSeconds(60),
                        "closed_at", CREATED.plusSeconds(60))));
        assertViolation("23514", "ck_local_challenge_consumption_time", () -> insert("local_access_challenges",
                with(other, "status", "CONSUMED", "displayed_at", DISPLAYED, "consumed_at", CONSUMED,
                        "closed_at", CONSUMED.plusSeconds(1))));
        assertViolation("23514", "ck_local_challenge_dates", () -> insert("local_access_challenges",
                with(other, "displayed_at", CREATED.minusSeconds(1))));
        assertViolation("23514", "ck_local_challenge_dates", () -> insert("local_access_challenges",
                with(other, "displayed_at", CREATED.plusSeconds(60))));
        assertViolation("23514", "ck_local_challenge_dates", () -> insert("local_access_challenges",
                with(other, "status", "EXPIRED", "closed_at", CREATED.minusSeconds(1))));
        assertViolation("23514", "ck_local_challenge_attempts", () -> insert("local_access_challenges",
                with(other, "failed_attempts", 5)));
        assertViolation("23514", "local_access_challenges_failed_attempts_check", () -> insert(
                "local_access_challenges", with(other, "status", "INVALIDATED", "closed_at", CONSUMED,
                        "failed_attempts", 6)));

        // Four wrong secrets, the display acknowledgement, then the consumption that authorizes the operation.
        update("local_access_challenges", challenge, Map.of("failed_attempts", 4));
        update("local_access_challenges", challenge, Map.of("displayed_at", DISPLAYED));
        update("local_access_challenges", challenge, Map.of("status", "CONSUMED", "consumed_at", CONSUMED,
                "closed_at", CONSUMED));
        // The fifth wrong secret closes a challenge; an unanswered one expires at its deadline.
        UUID invalidated = insert("local_access_challenges", other);
        update("local_access_challenges", invalidated, Map.of("status", "INVALIDATED", "failed_attempts", 5,
                "closed_at", CONSUMED));
        UUID expired = insert("local_access_challenges", challenge(site, operation(site, "FAILED")));
        update("local_access_challenges", expired, Map.of("status", "EXPIRED", "closed_at",
                CREATED.plusSeconds(60)));
        assertEquals(List.of("CONSUMED", "EXPIRED", "INVALIDATED"), jdbc.sql(
                "SELECT status FROM aegis.local_access_challenges WHERE locker_id = :locker ORDER BY status")
                .param("locker", site.locker()).query(String.class).list());
    }

    @Test
    void aDisplayInstructionCarriesOneChallengePerOperationAndAStrictRevision() {
        Site site = site("A");
        Site elsewhere = site("B");
        UUID operation = operation(site, "AWAITING_LOCAL_PROOF");
        UUID abandoned = operation(site, "FAILED");
        UUID challenge = insert("local_access_challenges", challenge(site, operation));
        UUID abandonedChallenge = insert("local_access_challenges", challenge(site, abandoned));
        Map<String, Object> shown = display(site, operation, challenge, 1);
        // No default MQTT schema version: a row that omits it would carry a version the hub may refuse.
        DataAccessException unversioned = assertThrows(DataAccessException.class,
                () -> insert("hub_display_outbox", with(shown, "schema_version", null)));
        PSQLException missing = assertInstanceOf(PSQLException.class, unversioned.getMostSpecificCause());
        assertEquals("23502", missing.getSQLState(), missing::getMessage);
        assertEquals("schema_version", missing.getServerErrorMessage().getColumn(), missing::getMessage);
        assertEquals(List.of("command_outbox", "hub_display_outbox", "inbound_device_messages"), jdbc.sql("""
                SELECT table_name FROM information_schema.columns
                WHERE table_schema = 'aegis' AND column_name = 'schema_version' AND is_nullable = 'NO'
                  AND column_default IS NULL
                ORDER BY table_name COLLATE "C"
                """).query(String.class).list());
        UUID instruction = insert("hub_display_outbox", shown);
        Map<String, Object> defaults = jdbc.sql("""
                SELECT status, schema_version, attempt_count, next_attempt_at, created_at
                FROM aegis.hub_display_outbox WHERE id = :id
                """).param("id", instruction).query().singleRow();
        assertEquals("PENDING", defaults.get("status"));
        assertEquals(shown.get("schema_version"), defaults.get("schema_version"));
        assertEquals(0, defaults.get("attempt_count"));
        assertNotNull(defaults.get("next_attempt_at"));
        assertNotNull(defaults.get("created_at"));

        // One challenge instruction per operation; status instructions follow with higher revisions.
        assertViolation("23505", "ux_display_one_challenge_per_operation",
                () -> insert("hub_display_outbox", display(site, operation, challenge, 2)));
        insert("hub_display_outbox", display(site, operation, null, 2));
        insert("hub_display_outbox", display(site, operation, null, 3));
        assertViolation("23505", "uq_display_revision",
                () -> insert("hub_display_outbox", display(site, abandoned, null, 3)));
        // Revisions are allocated per locker.
        insert("hub_display_outbox", display(elsewhere, operation(elsewhere, "AWAITING_LOCAL_PROOF"), null, 3));
        assertViolation("23505", "hub_display_outbox_message_id_key", () -> insert("hub_display_outbox",
                with(display(site, abandoned, null, 4), "message_id", shown.get("message_id"))));

        Map<String, Object> next = display(site, abandoned, null, 4);
        assertViolation("23503", "fk_display_challenge",
                () -> insert("hub_display_outbox", display(site, abandoned, challenge, 4)));
        assertViolation("23503", "fk_display_operation",
                () -> insert("hub_display_outbox", display(elsewhere, abandoned, null, 4)));
        assertViolation("23503", "fk_display_device", () -> insert("hub_display_outbox",
                with(next, "locker_device_id", elsewhere.device())));
        assertViolation("23514", "ck_display_type", () -> insert("hub_display_outbox",
                with(next, "message_type", "DISPLAY_QR")));
        assertViolation("23514", "ck_display_challenge", () -> insert("hub_display_outbox",
                with(display(site, abandoned, abandonedChallenge, 4), "challenge_id", null)));
        assertViolation("23514", "ck_display_challenge", () -> insert("hub_display_outbox",
                with(next, "challenge_id", abandonedChallenge)));
        assertViolation("23514", "ck_display_dates", () -> insert("hub_display_outbox",
                with(next, "expires_at", CREATED)));
        assertViolation("23514", "ck_display_schema_non_blank", () -> insert("hub_display_outbox",
                with(next, "schema_version", " ")));
        assertViolation("23514", "ck_display_status", () -> insert("hub_display_outbox",
                with(next, "status", "SENT")));
        assertViolation("23514", "ck_display_claim", () -> insert("hub_display_outbox",
                with(next, "status", "CLAIMED")));
        assertViolation("23514", "ck_display_claim", () -> insert("hub_display_outbox",
                with(next, "claim_until", CREATED.plusSeconds(15))));
        assertViolation("23514", "ck_display_sendable_payload", () -> insert("hub_display_outbox",
                with(next, "encrypted_payload", null)));
        assertViolation("23514", "hub_display_outbox_display_revision_check",
                () -> insert("hub_display_outbox", display(site, abandoned, null, 0)));
        assertViolation("23514", "hub_display_outbox_topic_check", () -> insert("hub_display_outbox",
                with(next, "topic", " ")));
        assertViolation("23514", "hub_display_outbox_encryption_key_id_check", () -> insert("hub_display_outbox",
                with(next, "encryption_key_id", " ")));
        assertViolation("23514", "hub_display_outbox_attempt_count_check", () -> insert("hub_display_outbox",
                with(next, "attempt_count", -1)));

        // Claimed, published, then acknowledged once rendered; the QR ciphertext is purged as soon as it is unusable,
        // which a row still to be sent cannot do.
        update("hub_display_outbox", instruction, Map.of("status", "CLAIMED", "attempt_count", 1, "claim_until",
                CREATED.plusSeconds(15)));
        assertViolation("23514", "ck_display_claim", () -> jdbc.sql(
                "UPDATE aegis.hub_display_outbox SET status = 'DISPATCHED', published_at = :at WHERE id = :id")
                .param("at", CREATED.plusSeconds(1)).param("id", instruction).update());
        assertEquals(1, jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'DISPATCHED', published_at = :at, claim_until = NULL WHERE id = :id
                """).param("at", CREATED.plusSeconds(1)).param("id", instruction).update());
        assertViolation("23514", "ck_display_sendable_payload", () -> jdbc.sql(
                "UPDATE aegis.hub_display_outbox SET encrypted_payload = NULL WHERE id = :id")
                .param("id", instruction).update());
        assertEquals(1, jdbc.sql("""
                UPDATE aegis.hub_display_outbox
                SET status = 'ACKNOWLEDGED', acknowledged_at = :at, encrypted_payload = NULL WHERE id = :id
                """).param("at", DISPLAYED).param("id", instruction).update());
    }

    @Test
    void aCommandIsTheSingleDurableUnlockOfItsOperation() {
        Site site = site("A");
        Site elsewhere = site("B");
        UUID operation = operation(site, "AUTHORIZED");
        UUID abandoned = operation(site, "FAILED");
        Map<String, Object> unlock = command(site, operation);
        UUID command = insert("command_outbox", unlock);
        Map<String, Object> defaults = jdbc.sql("""
                SELECT status, attempt_count, next_attempt_at, created_at FROM aegis.command_outbox WHERE id = :id
                """).param("id", command).query().singleRow();
        assertEquals("PENDING", defaults.get("status"));
        assertEquals(0, defaults.get("attempt_count"));
        assertNotNull(defaults.get("next_attempt_at"));
        assertNotNull(defaults.get("created_at"));

        // A retry or a replayed authorization never produces a second command for the same operation.
        assertViolation("23505", "uq_command_outbox_operation",
                () -> insert("command_outbox", command(site, operation)));
        assertViolation("23505", "uq_command_outbox_message", () -> insert("command_outbox",
                with(command(site, abandoned), "message_id", unlock.get("message_id"))));
        assertViolation("23503", "fk_command_outbox_operation",
                () -> insert("command_outbox", command(site, UUID.randomUUID())));
        assertViolation("23503", "fk_command_outbox_compartment_locker", () -> insert("command_outbox",
                with(command(site, abandoned), "compartment_id", elsewhere.compartment())));

        Map<String, Object> other = command(site, abandoned);
        assertViolation("23514", "ck_command_outbox_type", () -> insert("command_outbox",
                with(other, "command_type", "LOCK_COMPARTMENT")));
        assertViolation("23514", "ck_command_outbox_topic_non_blank", () -> insert("command_outbox",
                with(other, "topic", " ")));
        assertViolation("23514", "ck_command_outbox_schema_non_blank", () -> insert("command_outbox",
                with(other, "schema_version", "")));
        assertViolation("23514", "ck_command_outbox_dates", () -> insert("command_outbox",
                with(other, "expires_at", AUTHORIZED)));
        assertViolation("23514", "ck_command_outbox_status", () -> insert("command_outbox",
                with(other, "status", "SENT")));
        assertViolation("23514", "ck_command_outbox_attempts", () -> insert("command_outbox",
                with(other, "attempt_count", -1)));
        assertViolation("23514", "ck_command_outbox_claim", () -> insert("command_outbox",
                with(other, "status", "CLAIMED")));
        assertViolation("23514", "ck_command_outbox_claim", () -> insert("command_outbox",
                with(other, "claim_until", AUTHORIZED.plusSeconds(15))));
        assertViolation("23514", "ck_command_outbox_ack", () -> insert("command_outbox",
                with(other, "status", "ACKNOWLEDGED", "acknowledged_at", AUTHORIZED.plusSeconds(2))));
        assertViolation("23514", "ck_command_outbox_ack", () -> insert("command_outbox",
                with(other, "status", "REJECTED", "published_at", AUTHORIZED.plusSeconds(1))));

        // Section 9.2 to 9.3: claimed, published outside any transaction, then acknowledged by the hub.
        assertEquals(Optional.of(command), jdbc.sql(CLAIM).query(UUID.class).optional());
        assertEquals(1, jdbc.sql("""
                UPDATE aegis.command_outbox
                SET status = 'DISPATCHED', published_at = now(), claim_until = NULL WHERE id = :id
                """).param("id", command).update());
        assertEquals(Optional.empty(), jdbc.sql(CLAIM).query(UUID.class).optional());
        update("command_outbox", command, Map.of("status", "ACKNOWLEDGED", "acknowledged_at", OffsetDateTime.now()));
        assertEquals(1, jdbc.sql("""
                SELECT attempt_count FROM aegis.command_outbox WHERE id = :id AND claimed_at IS NOT NULL
                """).param("id", command).query(Integer.class).single());
    }

    /**
     * Section 9.2: while one dispatcher holds its claim open, a second one skips the locked row instead of waiting
     * for it and takes the next due command. A lease that ended makes a claimed row due again; a live lease, a
     * dispatched command and a later retry are left alone.
     */
    @Test
    void twoDispatchersClaimDistinctDueCommandsWithoutWaiting() throws Exception {
        OffsetDateTime now = jdbc.sql("SELECT now()").query(OffsetDateTime.class).single();
        UUID expiredLease = insert("command_outbox", with(command(site("A"), "AUTHORIZED"),
                "created_at", now.minusMinutes(3), "next_attempt_at", now.minusMinutes(3),
                "status", "CLAIMED", "attempt_count", 1, "claim_until", now.minusSeconds(1)));
        UUID first = insert("command_outbox", with(command(site("B"), "AUTHORIZED"),
                "created_at", now.minusMinutes(2), "next_attempt_at", now.minusMinutes(2)));
        UUID second = insert("command_outbox", with(command(site("C"), "AUTHORIZED"),
                "created_at", now.minusMinutes(1), "next_attempt_at", now.minusMinutes(1)));
        List<UUID> untouched = List.of(
                insert("command_outbox", with(command(site("D"), "AUTHORIZED"), "created_at", now.minusMinutes(4),
                        "next_attempt_at", now.plusMinutes(1), "attempt_count", 1, "last_error", "broker down")),
                insert("command_outbox", with(command(site("E"), "AUTHORIZED"), "created_at", now.minusMinutes(4),
                        "next_attempt_at", now.minusMinutes(4), "status", "CLAIMED", "attempt_count", 1,
                        "claim_until", now.plusMinutes(1))),
                insert("command_outbox", with(command(site("F"), "AUTHORIZED"), "created_at", now.minusMinutes(4),
                        "next_attempt_at", now.minusMinutes(4), "status", "DISPATCHED", "attempt_count", 1,
                        "published_at", now.minusMinutes(4))));
        String untouchedRows = """
                SELECT id, status, attempt_count, claim_until FROM aegis.command_outbox
                WHERE id IN (:ids) ORDER BY id
                """;
        List<Map<String, Object>> before = jdbc.sql(untouchedRows).param("ids", untouched).query().listOfRows();

        try (SingleConnectionDataSource firstSession = transaction();
                SingleConnectionDataSource secondSession = transaction()) {
            JdbcClient firstDispatcher = JdbcClient.create(firstSession);
            JdbcClient secondDispatcher = JdbcClient.create(secondSession);
            secondDispatcher.sql("SET LOCAL lock_timeout = '2s'").update();

            assertEquals(Optional.of(expiredLease), firstDispatcher.sql(CLAIM).query(UUID.class).optional());
            assertEquals(Optional.of(first), secondDispatcher.sql(CLAIM).query(UUID.class).optional());
            firstSession.getConnection().commit();
            secondSession.getConnection().commit();
        }
        assertEquals(Optional.of(second), jdbc.sql(CLAIM).query(UUID.class).optional());
        assertEquals(Optional.empty(), jdbc.sql(CLAIM).query(UUID.class).optional());

        assertEquals(List.of(expiredLease + ":2", first + ":1", second + ":1"), jdbc.sql("""
                SELECT id::text || ':' || attempt_count FROM aegis.command_outbox
                WHERE id IN (:ids) AND status = 'CLAIMED' AND claimed_at IS NOT NULL AND claim_until > now()
                ORDER BY created_at
                """).param("ids", List.of(expiredLease, first, second)).query(String.class).list());
        assertEquals(before, jdbc.sql(untouchedRows).param("ids", untouched).query().listOfRows());
    }

    /** Workload evidence for ix_command_outbox_claimable: the claim's predicate implies the partial index. */
    @Test
    void theClaimQueryCanReadTheClaimableIndex() {
        try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database), server.user(),
                server.password(), true)) {
            JdbcClient client = JdbcClient.create(session);
            client.sql("SET enable_seqscan = off").update();
            String plan = String.join("\n", client.sql("EXPLAIN " + CLAIM).query(String.class).list());
            assertTrue(plan.contains("ix_command_outbox_claimable"), plan);
        }
    }

    /**
     * Section 8.2: one canonical row per (locker_device_id, message_id). A redelivery is never reinserted: the
     * ingestion meets the unique key and records nothing. The same message id from another hub is another message.
     */
    @Test
    void anInboundMessageIsRecordedOncePerDevice() {
        Site site = site("A");
        Site other = site("B");
        Map<String, Object> heartbeat = inbound(site, "HEARTBEAT", 1);
        UUID recorded = insert("inbound_device_messages", with(heartbeat, "processing_status", null));
        Map<String, Object> defaults = jdbc.sql("""
                SELECT processing_status, received_at FROM aegis.inbound_device_messages WHERE id = :id
                """).param("id", recorded).query().singleRow();
        assertEquals("RECEIVED", defaults.get("processing_status"));
        assertNotNull(defaults.get("received_at"));

        Map<String, Object> redelivery = with(heartbeat, "sequence", 2L, "raw_payload", randomBytes(24));
        assertViolation("23505", "uq_inbound_messages_device_message",
                () -> insert("inbound_device_messages", redelivery));
        assertEquals(Optional.empty(), ingest(jdbc, redelivery));
        UUID elsewhere = ingest(jdbc, with(heartbeat, "locker_device_id", other.device(), "device_session_id",
                other.session())).orElseThrow();

        assertEquals(List.of(recorded + ":1", elsewhere + ":1"), jdbc.sql("""
                SELECT id::text || ':' || sequence FROM aegis.inbound_device_messages
                WHERE message_id = :message ORDER BY locker_device_id = :device DESC
                """).param("message", heartbeat.get("message_id")).param("device", site.device())
                .query(String.class).list());
    }

    /**
     * Two deliveries of the same message race in READ COMMITTED: the second ingestion waits on the first
     * transaction's key, then finds the committed row and inserts nothing, without an error to retry.
     */
    @Test
    void aConcurrentRedeliveryIsIgnoredOnceTheFirstCommits() throws Exception {
        Site site = site("A");
        Map<String, Object> delivery = inbound(site, "DEVICE_RESTARTED", 1);
        byte[] firstPayload = (byte[]) delivery.get("raw_payload");
        ExecutorService executor = Executors.newSingleThreadExecutor();
        UUID recorded;
        try (SingleConnectionDataSource firstSession = transaction();
                SingleConnectionDataSource secondSession = transaction()) {
            JdbcClient firstIngestion = JdbcClient.create(firstSession);
            JdbcClient secondIngestion = JdbcClient.create(secondSession);
            int firstPid = firstIngestion.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            int secondPid = secondIngestion.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            recorded = ingest(firstIngestion, delivery).orElseThrow();

            CountDownLatch secondStarted = new CountDownLatch(1);
            Future<Optional<UUID>> redelivery = executor.submit(() -> {
                secondStarted.countDown();
                return ingest(secondIngestion, with(delivery, "raw_payload", randomBytes(24)));
            });
            assertTrue(secondStarted.await(10, TimeUnit.SECONDS));
            awaitBlocked(secondPid, firstPid);
            firstSession.getConnection().commit();

            assertEquals(Optional.empty(), redelivery.get(10, TimeUnit.SECONDS));
            secondSession.getConnection().commit();
        } finally {
            executor.shutdownNow();
        }
        Map<String, Object> kept = jdbc.sql("""
                SELECT id, raw_payload FROM aegis.inbound_device_messages WHERE message_id = :message
                """).param("message", delivery.get("message_id")).query().singleRow();
        assertEquals(recorded, kept.get("id"));
        assertArrayEquals(firstPayload, (byte[]) kept.get("raw_payload"));
    }

    /**
     * Section 4.8: an accepted message carries its envelope (document 10, section 15.3), a status message carries its
     * connection and no operation, and an acknowledgement or display report carries its correlation. A message
     * rejected before extraction keeps none of them but states its error.
     */
    @Test
    void anInboundMessageKeepsItsEnvelopeAndCorrelationsCoherent() {
        Site site = site("A");
        UUID operation = operation(site, "AUTHORIZED");
        Map<String, Object> command = command(site, operation);
        insert("command_outbox", command);
        UUID challenge = insert("local_access_challenges", challenge(site, operation));
        Map<String, Object> instruction = display(site, operation, challenge, 1);
        insert("hub_display_outbox", instruction);

        Map<String, Object> heartbeat = inbound(site, "HEARTBEAT", 1);
        Map<String, Object> availability = inbound(site, "DEVICE_AVAILABILITY", 2);
        Map<String, Object> door = with(inbound(site, "DOOR_OPENED", 3), "operation_id", operation);
        Map<String, Object> acknowledged = with(inbound(site, "COMMAND_ACKNOWLEDGED", 4), "operation_id", operation,
                "command_message_id", command.get("message_id"));
        Map<String, Object> displayed = with(inbound(site, "ACCESS_CHALLENGE_DISPLAYED", 5), "operation_id",
                operation, "display_message_id", instruction.get("message_id"));
        for (Map<String, Object> accepted : List.of(heartbeat, availability, door, acknowledged, displayed,
                inbound(site, "DEVICE_ERROR", 6))) {
            insert("inbound_device_messages", accepted);
        }
        insert("inbound_device_messages", with(inbound(site, "DEVICE_AVAILABILITY", 7), "device_session_id", null,
                "boot_count", null, "sequence", null, "connection_id", null, "availability_status", null,
                "parsed_payload", null, "processing_status", "REJECTED", "processing_error", "UNSUPPORTED_SCHEMA"));

        assertViolation("23514", "ck_inbound_messages_topic_non_blank",
                () -> insert("inbound_device_messages", renewed(door, "topic", " ")));
        assertViolation("23514", "ck_inbound_messages_type",
                () -> insert("inbound_device_messages", renewed(door, "message_type", "DOOR_SLAMMED")));
        assertViolation("23514", "ck_inbound_messages_schema_non_blank",
                () -> insert("inbound_device_messages", renewed(door, "schema_version", " ")));
        assertViolation("23514", "ck_inbound_messages_status",
                () -> insert("inbound_device_messages", renewed(door, "processing_status", "IGNORED")));
        assertViolation("23514", "ck_inbound_messages_error",
                () -> insert("inbound_device_messages", renewed(door, "processing_status", "REJECTED")));
        assertViolation("23514", "ck_inbound_messages_status_without_operation",
                () -> insert("inbound_device_messages", renewed(heartbeat, "operation_id", operation)));
        assertViolation("23514", "ck_inbound_messages_command_correlation",
                () -> insert("inbound_device_messages", renewed(door, "message_type", "COMMAND_ACKNOWLEDGED")));
        assertViolation("23514", "ck_inbound_messages_command_correlation", () -> insert("inbound_device_messages",
                renewed(door, "command_message_id", command.get("message_id"))));
        assertViolation("23514", "ck_inbound_messages_display_correlation", () -> insert("inbound_device_messages",
                renewed(door, "message_type", "ACCESS_CHALLENGE_DISPLAYED")));
        assertViolation("23514", "ck_inbound_messages_display_correlation",
                () -> insert("inbound_device_messages", renewed(displayed, "operation_id", null)));
        assertViolation("23514", "ck_inbound_messages_display_correlation", () -> insert("inbound_device_messages",
                renewed(door, "display_message_id", instruction.get("message_id"))));
        assertViolation("23514", "ck_inbound_messages_boot_count",
                () -> insert("inbound_device_messages", renewed(door, "boot_count", 0L)));
        assertViolation("23514", "ck_inbound_messages_boot_count",
                () -> insert("inbound_device_messages", renewed(door, "boot_count", 4_294_967_296L)));
        assertViolation("23514", "ck_inbound_messages_sequence",
                () -> insert("inbound_device_messages", renewed(door, "sequence", -1L)));
        assertViolation("23514", "ck_inbound_messages_accepted_envelope",
                () -> insert("inbound_device_messages", renewed(door, "device_session_id", null)));
        assertViolation("23514", "ck_inbound_messages_accepted_envelope", () -> insert("inbound_device_messages",
                renewed(door, "processing_status", "RECEIVED", "sequence", null)));
        assertViolation("23514", "ck_inbound_messages_connection",
                () -> insert("inbound_device_messages", renewed(heartbeat, "connection_id", null)));
        assertViolation("23514", "ck_inbound_messages_connection",
                () -> insert("inbound_device_messages", renewed(door, "connection_id", UUID.randomUUID())));
        assertViolation("23514", "ck_inbound_messages_availability_status",
                () -> insert("inbound_device_messages", renewed(availability, "availability_status", null)));
        assertViolation("23514", "ck_inbound_messages_availability_status", () -> insert("inbound_device_messages",
                renewed(availability, "availability_status", "DEGRADED")));
        assertViolation("23514", "ck_inbound_messages_availability_status",
                () -> insert("inbound_device_messages", renewed(heartbeat, "availability_status", "ONLINE")));

        assertViolation("23503", "fk_inbound_messages_device", () -> insert("inbound_device_messages",
                renewed(door, "locker_device_id", UUID.randomUUID())));
        assertViolation("23503", "fk_inbound_messages_operation",
                () -> insert("inbound_device_messages", renewed(door, "operation_id", UUID.randomUUID())));
        assertViolation("23503", "fk_inbound_messages_command", () -> insert("inbound_device_messages",
                renewed(acknowledged, "command_message_id", UUID.randomUUID())));
        assertViolation("23503", "fk_inbound_messages_display", () -> insert("inbound_device_messages",
                renewed(displayed, "display_message_id", UUID.randomUUID())));
    }

    /**
     * Section 4.8: an observation is a fact normalized from a recorded message, in a compartment of its locker unless
     * it reports a restart of the hub; an identifier detection names the identifier read.
     */
    @Test
    void aPhysicalObservationIsAFactOfARecordedMessage() {
        Site site = site("A");
        Site elsewhere = site("B");
        UUID operation = operation(site, "AUTHORIZED");
        UUID opened = insert("inbound_device_messages", with(inbound(site, "DOOR_OPENED", 1), "operation_id",
                operation));
        UUID scanned = insert("inbound_device_messages", with(inbound(site, "RFID_SCAN_COMPLETED", 2),
                "operation_id", operation));
        UUID restarted = insert("inbound_device_messages", inbound(site, "DEVICE_RESTARTED", 3));

        Map<String, Object> door = with(observation(site, opened, "DOOR_OPENED"), "operation_id", operation,
                "value_json", json("true"));
        insert("physical_observations", door);
        UUID detected = insert("physical_observations", with(observation(site, scanned, "ASSET_IDENTIFIER_DETECTED"),
                "operation_id", operation, "identifier_value", "E200-A", "confidence", new BigDecimal("0.9876")));
        insert("physical_observations", with(observation(site, scanned, "ASSET_PRESENT"), "operation_id", operation,
                "value_json", json("true"), "confidence", BigDecimal.ONE));
        insert("physical_observations", with(observation(site, restarted, "DEVICE_RESTARTED"), "compartment_id",
                null));
        Map<String, Object> stored = jdbc.sql("""
                SELECT confidence, created_at FROM aegis.physical_observations WHERE id = :id
                """).param("id", detected).query().singleRow();
        assertEquals(new BigDecimal("0.9876"), stored.get("confidence"));
        assertNotNull(stored.get("created_at"));

        assertViolation("23514", "ck_physical_observations_type",
                () -> insert("physical_observations", with(door, "type", "DOOR_SLAMMED")));
        assertViolation("23514", "ck_physical_observations_compartment",
                () -> insert("physical_observations", with(door, "compartment_id", null)));
        assertViolation("23514", "ck_physical_observations_identifier", () -> insert("physical_observations",
                observation(site, scanned, "ASSET_IDENTIFIER_DETECTED")));
        assertViolation("23514", "ck_physical_observations_confidence",
                () -> insert("physical_observations", with(door, "confidence", new BigDecimal("1.0001"))));
        assertViolation("23514", "ck_physical_observations_confidence",
                () -> insert("physical_observations", with(door, "confidence", new BigDecimal("-0.0001"))));
        assertViolation("23503", "fk_physical_observations_compartment_locker", () -> insert(
                "physical_observations", with(door, "compartment_id", elsewhere.compartment())));
        assertViolation("23503", "fk_physical_observations_message",
                () -> insert("physical_observations", with(door, "inbound_message_id", UUID.randomUUID())));
        assertViolation("23503", "fk_physical_observations_operation",
                () -> insert("physical_observations", with(door, "operation_id", UUID.randomUUID())));
    }

    /**
     * V008 completes audit_events as V002_2 announced: each reference column arrives with its foreign key, and the
     * table stays append-only.
     */
    @Test
    void anAuditEventReferencesTheMessageAndObservationItRecords() {
        Site site = site("A");
        UUID message = insert("inbound_device_messages", inbound(site, "DOOR_OPENED", 1));
        UUID observation = insert("physical_observations", observation(site, message, "DOOR_OPENED"));
        Map<String, Object> received = auditEvent("OBSERVATION_RECEIVED", "PHYSICAL_OBSERVATION", observation,
                message, observation);
        UUID event = insert("audit_events", received);
        insert("audit_events", auditEvent("MQTT_MESSAGE_DUPLICATE_IGNORED", "INBOUND_DEVICE_MESSAGE", message,
                message, null));
        assertEquals(message + ":" + observation, jdbc.sql("""
                SELECT inbound_message_id::text || ':' || physical_observation_id FROM aegis.audit_events
                WHERE id = :id
                """).param("id", event).query(String.class).single());

        assertViolation("23503", "fk_audit_events_message",
                () -> insert("audit_events", with(received, "inbound_message_id", UUID.randomUUID())));
        assertViolation("23503", "fk_audit_events_observation",
                () -> insert("audit_events", with(received, "physical_observation_id", UUID.randomUUID())));
        assertRefused("23001", () -> jdbc.sql("UPDATE aegis.audit_events SET inbound_message_id = NULL WHERE id = :id")
                .param("id", event).update());
    }

    /**
     * Section 12.1: the application role records device messages and marks them processed or rejected (section 8.2),
     * appends observations it can never rewrite, and deletes neither.
     */
    @Test
    void theApplicationRoleAppendsObservationsAndNeverDeletesDeviceMessages() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            assertEquals(0, flyway(role).migrate().migrationsExecuted);
            assertEquals(List.of("inbound_device_messages:INSERT,SELECT,UPDATE"),
                    privileges(role, "inbound_device_messages"));
            assertEquals(List.of("physical_observations:INSERT,SELECT"), privileges(role, "physical_observations"));
            Site site = site("A");
            Map<String, Object> delivery = with(inbound(site, "DOOR_OPENED", 1), "processing_status", "RECEIVED");
            Map<String, UUID> rows = new LinkedHashMap<>();

            try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database),
                    server.user(), server.password(), true)) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                UUID message = ingest(application, delivery).orElseThrow();
                assertEquals(Optional.empty(), ingest(application, delivery));
                UUID observation = insert(application, "physical_observations",
                        observation(site, message, "DOOR_OPENED"));
                update(application, "inbound_device_messages", message, Map.of("processing_status", "PROCESSED"));
                insert(application, "audit_events", auditEvent("OBSERVATION_RECEIVED", "PHYSICAL_OBSERVATION",
                        observation, message, observation));
                assertRefused("42501", () -> application.sql("""
                        UPDATE aegis.physical_observations SET confidence = 1 WHERE id = :id
                        """).param("id", observation).update());
                rows.put("inbound_device_messages", message);
                rows.put("physical_observations", observation);

                for (Map.Entry<String, UUID> row : rows.entrySet()) {
                    assertRefused("42501", () -> application.sql("DELETE FROM aegis." + row.getKey()
                            + " WHERE id = :id").param("id", row.getValue()).update());
                    assertRefused("42501", () -> application.sql("TRUNCATE aegis." + row.getKey()).update());
                }
                application.sql("RESET ROLE").update();
            }
            assertEquals("PROCESSED", jdbc.sql("""
                    SELECT processing_status FROM aegis.inbound_device_messages WHERE id = :id
                    """).param("id", rows.get("inbound_device_messages")).query(String.class).single());
            assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.physical_observations WHERE id = :id")
                    .param("id", rows.get("physical_observations")).query(Long.class).single());
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    /**
     * Section 4.9: an anomaly is acknowledged by a named user with a note, which never resolves it, and is resolved
     * only with the observation that proves the resolution, acknowledged first or not.
     */
    @Test
    void anAnomalyIsResolvedOnlyByAnObservation() {
        Site site = site("A");
        UUID operation = operation(site, "AUTHORIZED");
        UUID evidence = evidence(site, operation);
        UUID unattached = insert("anomalies", with(anomaly(site, null, "INCONSISTENT_PHYSICAL_STATE"),
                "detected_at", null));
        Map<String, Object> defaults = jdbc.sql("""
                SELECT status, detected_at, details::text AS details FROM aegis.anomalies WHERE id = :id
                """).param("id", unattached).query().singleRow();
        assertEquals("OPEN", defaults.get("status"));
        assertNotNull(defaults.get("detected_at"));
        assertEquals("{}", defaults.get("details"));

        UUID anomaly = insert("anomalies", anomaly(site, operation, "EXPECTED_ASSET_NOT_OBSERVED"));
        update("anomalies", anomaly, acknowledgement(site));
        update("anomalies", anomaly, resolution(evidence));
        insert("anomalies", with(anomaly(site, null, "UNEXPECTED_ASSET_OBSERVED"), resolution(evidence)));
        assertEquals(List.of("RESOLVED:3", "RESOLVED:0"), jdbc.sql("""
                SELECT status || ':' || num_nonnulls(acknowledged_at, acknowledged_by_user_id, acknowledgement_note)
                FROM aegis.anomalies WHERE resolution_evidence_observation_id = :evidence
                ORDER BY acknowledged_at NULLS LAST
                """).param("evidence", evidence).query(String.class).list());

        Map<String, Object> open = anomaly(site, null, "EXPECTED_ASSET_NOT_OBSERVED");
        Map<String, Object> acknowledged = with(open, acknowledgement(site));
        Map<String, Object> resolved = with(open, resolution(evidence));
        assertViolation("23514", "ck_anomalies_type",
                () -> insert("anomalies", with(open, "type", "DOOR_JAMMED")));
        assertViolation("23514", "ck_anomalies_severity",
                () -> insert("anomalies", with(open, "severity", "CRITICAL")));
        assertViolation("23514", "ck_anomalies_acknowledgement_note", () -> insert("anomalies",
                with(with(resolved, acknowledgement(site)), "status", "RESOLVED", "acknowledgement_note", " ")));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(open, "acknowledged_at", CREATED.plusMinutes(1))));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(acknowledged, "acknowledged_by_user_id", null)));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(acknowledged, "resolved_at", CREATED.plusMinutes(2))));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(resolved, "resolution_evidence_observation_id", null)));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(resolved, "acknowledged_at", CREATED.plusMinutes(1))));
        // An unknown status and a blank resolution note also break the lifecycle, which PostgreSQL checks first
        // (constraints are checked in name order): ck_anomalies_status and ck_anomalies_resolution_note restate it.
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(open, "status", "CLOSED")));
        assertViolation("23514", "ck_anomalies_lifecycle",
                () -> insert("anomalies", with(resolved, "resolution_note", " ")));
        assertViolation("23514", "ck_anomalies_dates",
                () -> insert("anomalies", with(acknowledged, "acknowledged_at", CREATED.minusSeconds(1))));
        assertViolation("23514", "ck_anomalies_dates",
                () -> insert("anomalies", with(resolved, "resolved_at", CREATED.minusSeconds(1))));

        assertViolation("23503", "fk_anomalies_operation",
                () -> insert("anomalies", with(open, "locker_operation_id", UUID.randomUUID())));
        assertViolation("23503", "fk_anomalies_asset",
                () -> insert("anomalies", with(open, "asset_id", UUID.randomUUID())));
        assertViolation("23503", "fk_anomalies_compartment",
                () -> insert("anomalies", with(open, "compartment_id", UUID.randomUUID())));
        assertViolation("23503", "fk_anomalies_acknowledger",
                () -> insert("anomalies", with(acknowledged, "acknowledged_by_user_id", UUID.randomUUID())));
        assertViolation("23503", "fk_anomalies_resolution_observation", () -> insert("anomalies",
                with(resolved, "resolution_evidence_observation_id", UUID.randomUUID())));
    }

    /**
     * Section 5.1, invariant 5: an open or acknowledged anomaly holds its operation, on insert and on update alike; a
     * resolved one frees it. Anomalies outside any operation are not limited.
     */
    @Test
    void anOperationHoldsAtMostOneActiveAnomaly() {
        Site site = site("A");
        UUID operation = operation(site, "AUTHORIZED");
        UUID evidence = evidence(site, operation);
        UUID first = insert("anomalies", anomaly(site, operation, "EXPECTED_ASSET_NOT_OBSERVED"));
        Map<String, Object> another = anomaly(site, operation, "DOOR_NOT_CLOSED_BEFORE_EXPIRY");
        assertViolation("23505", "ux_anomalies_one_open_per_operation", () -> insert("anomalies", another));
        update("anomalies", first, acknowledgement(site));
        assertViolation("23505", "ux_anomalies_one_open_per_operation", () -> insert("anomalies", another));
        update("anomalies", first, resolution(evidence));
        insert("anomalies", another);
        assertViolation("23505", "ux_anomalies_one_open_per_operation", () -> jdbc.sql("""
                UPDATE aegis.anomalies
                SET status = 'OPEN', acknowledged_at = NULL, acknowledged_by_user_id = NULL,
                    acknowledgement_note = NULL, resolved_at = NULL, resolution_evidence_observation_id = NULL,
                    resolution_note = NULL
                WHERE id = :id
                """).param("id", first).update());
        insert("anomalies", anomaly(site, null, "ASSET_PRESENT_WITH_ACTIVE_LOAN"));
        insert("anomalies", anomaly(site, null, "ASSET_PRESENT_WITH_ACTIVE_LOAN"));

        assertEquals(List.of("OPEN:1", "RESOLVED:1"), jdbc.sql("""
                SELECT status || ':' || count(*) FROM aegis.anomalies WHERE locker_operation_id = :operation
                GROUP BY status ORDER BY status
                """).param("operation", operation).query(String.class).list());
    }

    /**
     * Two detectors pass the application check in READ COMMITTED, since neither sees the other's uncommitted row; the
     * second insert waits on the first one's index entry, then PostgreSQL refuses it and one active anomaly remains.
     */
    @Test
    void twoDetectorsCannotOpenTwoAnomaliesForOneOperation() throws Exception {
        Site site = site("A");
        UUID operation = operation(site, "AUTHORIZED");
        String precheck = """
                SELECT count(*) FROM aegis.anomalies
                WHERE locker_operation_id = :operation AND status IN ('OPEN', 'ACKNOWLEDGED')
                """;
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try (SingleConnectionDataSource firstSession = transaction();
                SingleConnectionDataSource secondSession = transaction()) {
            JdbcClient firstDetector = JdbcClient.create(firstSession);
            JdbcClient secondDetector = JdbcClient.create(secondSession);
            assertEquals(0, firstDetector.sql(precheck).param("operation", operation).query(Long.class).single());
            assertEquals(0, secondDetector.sql(precheck).param("operation", operation).query(Long.class).single());
            int firstPid = firstDetector.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            int secondPid = secondDetector.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            insert(firstDetector, "anomalies", anomaly(site, operation, "EXPECTED_ASSET_NOT_OBSERVED"));

            CountDownLatch secondStarted = new CountDownLatch(1);
            Future<UUID> secondInsert = executor.submit(() -> {
                secondStarted.countDown();
                return insert(secondDetector, "anomalies", anomaly(site, operation, "DOOR_NOT_CLOSED_BEFORE_EXPIRY"));
            });
            assertTrue(secondStarted.await(10, TimeUnit.SECONDS));
            awaitBlocked(secondPid, firstPid);
            firstSession.getConnection().commit();

            ExecutionException failure = assertThrows(ExecutionException.class,
                    () -> secondInsert.get(10, TimeUnit.SECONDS));
            DataAccessException refusal = assertInstanceOf(DataAccessException.class, failure.getCause());
            PSQLException cause = assertInstanceOf(PSQLException.class, refusal.getMostSpecificCause());
            assertEquals("23505", cause.getSQLState(), cause::getMessage);
            assertEquals("ux_anomalies_one_open_per_operation", cause.getServerErrorMessage().getConstraint(),
                    cause::getMessage);
            secondSession.getConnection().rollback();
        } finally {
            executor.shutdownNow();
        }
        assertEquals(1, jdbc.sql(precheck).param("operation", operation).query(Long.class).single());
    }

    /** Section 12.1: the application role opens, acknowledges and resolves anomalies but never deletes them. */
    @Test
    void theApplicationRoleMovesAnomaliesForwardButNeverDeletesThem() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            assertEquals(0, flyway(role).migrate().migrationsExecuted);
            assertEquals(List.of("anomalies:INSERT,SELECT,UPDATE"), privileges(role, "anomalies"));
            Site site = site("A");
            UUID operation = operation(site, "AUTHORIZED");
            UUID evidence = evidence(site, operation);
            UUID anomaly;

            try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database),
                    server.user(), server.password(), true)) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                anomaly = insert(application, "anomalies", anomaly(site, operation, "EXPECTED_ASSET_NOT_OBSERVED"));
                update(application, "anomalies", anomaly, acknowledgement(site));
                update(application, "anomalies", anomaly, resolution(evidence));
                assertRefused("42501", () -> application.sql("DELETE FROM aegis.anomalies WHERE id = :id")
                        .param("id", anomaly).update());
                assertRefused("42501", () -> application.sql("TRUNCATE aegis.anomalies").update());
                application.sql("RESET ROLE").update();
            }
            assertEquals("RESOLVED", jdbc.sql("SELECT status FROM aegis.anomalies WHERE id = :id")
                    .param("id", anomaly).query(String.class).single());
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    /**
     * Command and proof history is never destructively erased (AGENTS.md, document 08, section 12.1): the
     * application role records challenges, display instructions and commands, takes the claim lock and moves their
     * states forward, but cannot delete or truncate them.
     */
    @Test
    void theApplicationRoleRecordsAndUpdatesCommandsButNeverDeletesThem() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            assertEquals(0, flyway(role).migrate().migrationsExecuted);
            for (String table : List.of("local_access_challenges", "hub_display_outbox", "command_outbox")) {
                assertEquals(List.of(table + ":INSERT,SELECT,UPDATE"), privileges(role, table));
            }
            Site site = site("A");
            UUID operation = operation(site, "AWAITING_LOCAL_PROOF");
            Map<String, UUID> rows = new LinkedHashMap<>();

            try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database),
                    server.user(), server.password(), true)) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                UUID challenge = insert(application, "local_access_challenges", challenge(site, operation));
                UUID instruction = insert(application, "hub_display_outbox", display(site, operation, challenge, 1));
                application.sql("SELECT id FROM aegis.local_access_challenges WHERE id = :id FOR UPDATE")
                        .param("id", challenge).query(UUID.class).single();
                update(application, "local_access_challenges", challenge, Map.of("failed_attempts", 1,
                        "displayed_at", DISPLAYED));
                update(application, "local_access_challenges", challenge, Map.of("status", "CONSUMED",
                        "consumed_at", CONSUMED, "closed_at", CONSUMED));
                assertEquals(1, application.sql("""
                        UPDATE aegis.hub_display_outbox
                        SET status = 'CANCELLED', encrypted_payload = NULL WHERE id = :id
                        """).param("id", instruction).update());
                UUID command = insert(application, "command_outbox", command(site, operation));
                assertEquals(Optional.of(command), application.sql(CLAIM).query(UUID.class).optional());
                rows.put("local_access_challenges", challenge);
                rows.put("hub_display_outbox", instruction);
                rows.put("command_outbox", command);

                for (Map.Entry<String, UUID> row : rows.entrySet()) {
                    assertRefused("42501", () -> application.sql("DELETE FROM aegis." + row.getKey()
                            + " WHERE id = :id").param("id", row.getValue()).update());
                    assertRefused("42501", () -> application.sql("TRUNCATE aegis." + row.getKey()).update());
                }
                application.sql("RESET ROLE").update();
            }
            for (Map.Entry<String, UUID> row : rows.entrySet()) {
                assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis." + row.getKey() + " WHERE id = :id")
                        .param("id", row.getValue()).query(Long.class).single());
            }
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    /** Waits until PostgreSQL reports the waiter as blocked by the holder, proving the two writes overlap. */
    private void awaitBlocked(int waiter, int holder) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!jdbc.sql("SELECT :holder = ANY (pg_blocking_pids(:waiter))").param("holder", holder)
                .param("waiter", waiter).query(Boolean.class).single()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError("Session " + waiter + " was never blocked by session " + holder);
            }
            Thread.sleep(20);
        }
    }

    /** One connection with autocommit off, kept open across statements until it is closed. */
    private SingleConnectionDataSource transaction() {
        SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database), server.user(),
                server.password(), true);
        session.setAutoCommit(false);
        return session;
    }

    private Flyway flyway(String applicationRole) {
        return Flyway.configure()
                .dataSource(server.url(database), server.user(), server.password())
                .locations("classpath:db/migration")
                .defaultSchema("public")
                .placeholders(Map.of("application_role", applicationRole))
                .validateOnMigrate(true)
                .load();
    }

    /** A new technician, asset, locker with one compartment and its hub, and an active reservation. */
    private Site site(String code) {
        UUID locker = jdbc.sql("INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier', 'HUB_CELL') "
                + "RETURNING id").param("code", "L-" + code).query(UUID.class).single();
        UUID user = jdbc.sql("""
                INSERT INTO aegis.users (display_name, email, password_hash, role, maximum_access_level)
                VALUES (:name, :email, '{bcrypt}$2a$10$x', 'TECHNICIAN', 'STANDARD')
                RETURNING id
                """).param("name", "Technicien " + code).param("email", code.toLowerCase() + "@aegis.test")
                .query(UUID.class).single();
        UUID asset = jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, calibration_required)
                VALUES (:model, :code, 'STANDARD', false)
                RETURNING id
                """).param("model", model).param("code", "AEG-" + code).query(UUID.class).single();
        UUID identifier = jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value)
                VALUES (:asset, 'RFID_UHF', :value)
                RETURNING id
                """).param("asset", asset).param("value", "E200-" + code).query(UUID.class).single();
        UUID compartment = jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                VALUES (:locker, 'A1', 1, 1)
                RETURNING id
                """).param("locker", locker).query(UUID.class).single();
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason)
                VALUES (:asset, :compartment, 'Affectation initiale')
                """).param("asset", asset).param("compartment", compartment).update();
        UUID session = UUID.randomUUID();
        UUID device = jdbc.sql("""
                INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, device_session_id, boot_count)
                VALUES (:locker, :key, '0.1.0-sim', :session, 1)
                RETURNING id
                """).param("locker", locker).param("key", "hub-" + code.toLowerCase()).param("session", session)
                .query(UUID.class).single();
        UUID reservation = jdbc.sql("""
                INSERT INTO aegis.reservations (asset_id, user_id, reserved_from, reserved_until, created_at)
                VALUES (:asset, :user, :from, :until, :from)
                RETURNING id
                """).param("asset", asset).param("user", user).param("from", CREATED.minusMinutes(5))
                .param("until", CREATED.plusHours(1)).query(UUID.class).single();
        return new Site(user, asset, identifier, locker, compartment, device, session, reservation);
    }

    /** A checkout of the site's reservation, waiting for its QR proof, authorized, or failed before authorization. */
    private UUID operation(Site site, String status) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("type", "CHECKOUT");
        columns.put("status", status);
        columns.put("user_id", site.user());
        columns.put("asset_id", site.asset());
        columns.put("locker_id", site.locker());
        columns.put("compartment_id", site.compartment());
        columns.put("reservation_id", site.reservation());
        columns.put("expected_asset_identifier_id", site.identifier());
        columns.put("created_at", CREATED);
        switch (status) {
            case "AWAITING_LOCAL_PROOF" -> {
            }
            case "AUTHORIZED" -> {
                columns.put("authorized_at", AUTHORIZED);
                columns.put("local_proof_validated_at", AUTHORIZED);
                columns.put("expires_at", AUTHORIZED.plusSeconds(120));
            }
            case "FAILED" -> {
                columns.put("terminal_at", CREATED.plusSeconds(60));
                columns.put("failure_reason", "LOCAL_CHALLENGE_EXPIRED");
            }
            default -> throw new IllegalArgumentException(status);
        }
        return insert("locker_operations", columns);
    }

    /** A pending challenge of the operation, displayed by the site's hub, valid for the 60 seconds of ADR-009. */
    private static Map<String, Object> challenge(Site site, UUID operation) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("operation_id", operation);
        columns.put("locker_id", site.locker());
        columns.put("locker_device_id", site.device());
        columns.put("target_device_session_id", site.session());
        columns.put("token_hash", randomBytes(32));
        columns.put("created_at", CREATED);
        columns.put("expires_at", CREATED.plusSeconds(60));
        return columns;
    }

    /** A pending display instruction: the operation's challenge, or a status message when challenge is null. */
    private static Map<String, Object> display(Site site, UUID operation, UUID challenge, long revision) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("message_id", UUID.randomUUID());
        columns.put("operation_id", operation);
        columns.put("locker_id", site.locker());
        columns.put("locker_device_id", site.device());
        columns.put("target_device_session_id", site.session());
        if (challenge != null) {
            columns.put("challenge_id", challenge);
        }
        columns.put("message_type", challenge != null ? "DISPLAY_ACCESS_CHALLENGE" : "DISPLAY_OPERATION_STATUS");
        columns.put("display_revision", revision);
        columns.put("topic", "aegis/v1/lockers/" + site.locker() + "/display");
        columns.put("schema_version", "3.0");
        columns.put("encrypted_payload", randomBytes(64));
        columns.put("encryption_key_id", "display-key-1");
        columns.put("issued_at", CREATED);
        columns.put("expires_at", CREATED.plusSeconds(60));
        return columns;
    }

    /** A new operation of the site in the given status, and its pending unlock command. */
    private Map<String, Object> command(Site site, String operationStatus) {
        return command(site, operation(site, operationStatus));
    }

    /** The pending unlock command of the operation, with the minimal payload of document 08, section 4.7. */
    private static Map<String, Object> command(Site site, UUID operation) {
        UUID message = UUID.randomUUID();
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("message_id", message);
        columns.put("operation_id", operation);
        columns.put("locker_id", site.locker());
        columns.put("compartment_id", site.compartment());
        columns.put("command_type", "UNLOCK_COMPARTMENT");
        columns.put("topic", "aegis/v1/lockers/" + site.locker() + "/commands");
        columns.put("schema_version", "3.0");
        columns.put("issued_at", AUTHORIZED);
        columns.put("expires_at", AUTHORIZED.plusSeconds(120));
        columns.put("payload", json("""
                {"messageId": "%s", "operationId": "%s", "lockerId": "%s", "compartmentId": "%s",
                 "type": "UNLOCK_COMPARTMENT", "issuedAt": "%s", "expiresAt": "%s", "schemaVersion": "3.0"}
                """.formatted(message, operation, site.locker(), site.compartment(), AUTHORIZED,
                AUTHORIZED.plusSeconds(120))));
        return columns;
    }

    /**
     * A message of the site's hub accepted and processed, with the envelope of document 10, section 15.3: status
     * messages carry their connection, and an availability report says ONLINE.
     */
    private static Map<String, Object> inbound(Site site, String type, long sequence) {
        boolean status = type.equals("HEARTBEAT") || type.equals("DEVICE_AVAILABILITY");
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("locker_device_id", site.device());
        columns.put("message_id", UUID.randomUUID());
        columns.put("topic", "aegis/v1/lockers/" + site.locker() + (status ? "/status" : "/events"));
        columns.put("message_type", type);
        columns.put("schema_version", "3.0");
        columns.put("device_session_id", site.session());
        columns.put("boot_count", 1L);
        columns.put("sequence", sequence);
        if (status) {
            columns.put("connection_id", UUID.randomUUID());
        }
        if (type.equals("DEVICE_AVAILABILITY")) {
            columns.put("availability_status", "ONLINE");
        }
        columns.put("occurred_at", CREATED);
        columns.put("raw_payload", randomBytes(48));
        columns.put("parsed_payload", json("{\"type\": \"" + type + "\"}"));
        columns.put("processing_status", "PROCESSED");
        return columns;
    }

    /** The same message under a new message id, so that only the given changes can break a constraint. */
    private static Map<String, Object> renewed(Map<String, Object> message, Object... changes) {
        return with(with(message, "message_id", UUID.randomUUID()), changes);
    }

    /** An observation of the message in the site's compartment, without operation, value or confidence. */
    private static Map<String, Object> observation(Site site, UUID message, String type) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("inbound_message_id", message);
        columns.put("locker_id", site.locker());
        columns.put("compartment_id", site.compartment());
        columns.put("type", type);
        columns.put("observed_at", CREATED);
        return columns;
    }

    /** An audit event of the subject, with its message and observation references; a null reference is omitted. */
    private static Map<String, Object> auditEvent(String type, String subjectType, UUID subject, UUID message,
            UUID observation) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("event_type", type);
        columns.put("subject_type", subjectType);
        columns.put("subject_id", subject);
        if (message != null) {
            columns.put("inbound_message_id", message);
        }
        if (observation != null) {
            columns.put("physical_observation_id", observation);
        }
        columns.put("result", "ACCEPTED");
        return columns;
    }

    /** An open anomaly detected at CREATED on the site's asset and compartment, within the operation if given. */
    private static Map<String, Object> anomaly(Site site, UUID operation, String type) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("type", type);
        columns.put("severity", "HIGH");
        if (operation != null) {
            columns.put("locker_operation_id", operation);
        }
        columns.put("asset_id", site.asset());
        columns.put("compartment_id", site.compartment());
        columns.put("detected_at", CREATED);
        return columns;
    }

    /** The acknowledgement of an anomaly by the site's user, one minute after its detection. */
    private static Map<String, Object> acknowledgement(Site site) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("status", "ACKNOWLEDGED");
        columns.put("acknowledged_at", CREATED.plusMinutes(1));
        columns.put("acknowledged_by_user_id", site.user());
        columns.put("acknowledgement_note", "Cellule inspectée, actif absent");
        return columns;
    }

    /** The resolution of an anomaly by the observation that proves it, two minutes after its detection. */
    private static Map<String, Object> resolution(UUID evidence) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("status", "RESOLVED");
        columns.put("resolved_at", CREATED.plusMinutes(2));
        columns.put("resolution_evidence_observation_id", evidence);
        columns.put("resolution_note", "Actif replacé et détecté");
        return columns;
    }

    /** An identifier detection in the site's compartment during the operation, recorded from a new RFID scan. */
    private UUID evidence(Site site, UUID operation) {
        UUID scan = insert("inbound_device_messages", with(inbound(site, "RFID_SCAN_COMPLETED", 1), "operation_id",
                operation));
        return insert("physical_observations", with(observation(site, scan, "ASSET_IDENTIFIER_DETECTED"),
                "operation_id", operation, "identifier_value", "E200-0001"));
    }

    private static PGobject json(String value) {
        PGobject json = new PGobject();
        json.setType("jsonb");
        try {
            json.setValue(value);
        } catch (SQLException impossible) {
            throw new IllegalStateException(impossible);
        }
        return json;
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    /** A copy with the given columns added or replaced. */
    private static Map<String, Object> with(Map<String, Object> columns, Map<String, Object> changes) {
        Map<String, Object> copy = new LinkedHashMap<>(columns);
        copy.putAll(changes);
        return copy;
    }

    /** A copy with the given column values; a null value removes the column, so its default or NULL applies. */
    private static Map<String, Object> with(Map<String, Object> columns, Object... changes) {
        Map<String, Object> copy = new LinkedHashMap<>(columns);
        for (int i = 0; i < changes.length; i += 2) {
            if (changes[i + 1] == null) {
                copy.remove((String) changes[i]);
            } else {
                copy.put((String) changes[i], changes[i + 1]);
            }
        }
        return copy;
    }

    private UUID insert(String table, Map<String, Object> columns) {
        return insert(jdbc, table, columns);
    }

    private static UUID insert(JdbcClient client, String table, Map<String, Object> columns) {
        return insertion(client, table, columns, " RETURNING id").query(UUID.class).single();
    }

    /** The ingestion of section 8.2, step 4: a message already recorded for its device inserts nothing. */
    private static Optional<UUID> ingest(JdbcClient client, Map<String, Object> columns) {
        return insertion(client, "inbound_device_messages", columns,
                " ON CONFLICT ON CONSTRAINT uq_inbound_messages_device_message DO NOTHING RETURNING id")
                .query(UUID.class).optional();
    }

    private static JdbcClient.StatementSpec insertion(JdbcClient client, String table, Map<String, Object> columns,
            String suffix) {
        JdbcClient.StatementSpec statement = client.sql("INSERT INTO aegis." + table + " ("
                + String.join(", ", columns.keySet()) + ") VALUES ("
                + columns.keySet().stream().map(column -> ":" + column).collect(Collectors.joining(", "))
                + ")" + suffix);
        for (Map.Entry<String, Object> column : columns.entrySet()) {
            statement = statement.param(column.getKey(), column.getValue());
        }
        return statement;
    }

    private void update(String table, UUID id, Map<String, Object> columns) {
        update(jdbc, table, id, columns);
    }

    private static void update(JdbcClient client, String table, UUID id, Map<String, Object> columns) {
        JdbcClient.StatementSpec statement = client.sql("UPDATE aegis." + table + " SET "
                + columns.keySet().stream().map(column -> column + " = :" + column).collect(Collectors.joining(", "))
                + " WHERE id = :id").param("id", id);
        for (Map.Entry<String, Object> column : columns.entrySet()) {
            statement = statement.param(column.getKey(), column.getValue());
        }
        assertEquals(1, statement.update());
    }

    private List<String> constraints(String table) {
        return jdbc.sql("""
                SELECT con.conname || ':' || con.contype::text FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'aegis' AND c.relname = :table ORDER BY con.conname COLLATE "C"
                """).param("table", table).query(String.class).list();
    }

    private List<String> foreignKeys(String... tables) {
        return jdbc.sql("""
                SELECT con.conname || ' ' || pg_get_constraintdef(con.oid) FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'aegis' AND con.contype = 'f' AND c.relname IN (:tables)
                ORDER BY con.conname COLLATE "C"
                """).param("tables", List.of(tables)).query(String.class).list();
    }

    private List<String> indexes(String table) {
        return jdbc.sql("""
                SELECT indexname FROM pg_indexes WHERE schemaname = 'aegis' AND tablename = :table
                ORDER BY indexname COLLATE "C"
                """).param("table", table).query(String.class).list();
    }

    private String indexDefinition(String index) {
        return jdbc.sql("SELECT indexdef FROM pg_indexes WHERE schemaname = 'aegis' AND indexname = :name")
                .param("name", index).query(String.class).single();
    }

    private List<String> privileges(String role, String table) {
        return jdbc.sql("""
                SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type)
                FROM information_schema.role_table_grants
                WHERE grantee = :role AND table_schema = 'aegis' AND table_name = :table
                GROUP BY table_name
                """).param("role", role).param("table", table).query(String.class).list();
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
