package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
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
 * V007, document 08, sections 4.6, 4.7, 5.1 and 9: local access challenges, the display outbox and the command
 * outbox. Every refusal below comes from PostgreSQL itself; each invalid row breaks exactly one constraint so that the
 * name is certain.
 */
class IotEvidenceSchemaTests {

    private static final int MIGRATIONS = 9;
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
                "ck_display_challenge:c", "ck_display_claim:c", "ck_display_dates:c", "ck_display_sendable_payload:c",
                "ck_display_status:c", "ck_display_type:c", "fk_display_challenge:f", "fk_display_device:f",
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

        // Invariant, expiry and claim indexes only; the read indexes of section 5.2 are left to V011.
        assertEquals(List.of("ix_local_challenges_pending_expiry", "local_access_challenges_operation_id_key",
                "local_access_challenges_pkey", "local_access_challenges_token_hash_key",
                "uq_local_challenge_id_operation"), indexes("local_access_challenges"));
        assertEquals(List.of("hub_display_outbox_message_id_key", "hub_display_outbox_pkey", "ix_display_claimable",
                "uq_display_revision", "ux_display_one_challenge_per_operation"), indexes("hub_display_outbox"));
        assertEquals(List.of("command_outbox_pkey", "ix_command_outbox_claimable", "uq_command_outbox_message",
                "uq_command_outbox_operation"), indexes("command_outbox"));
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
        assertEquals(List.of("command_outbox", "hub_display_outbox"), jdbc.sql("""
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
        columns.put("schema_version", "2.0");
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
        columns.put("schema_version", "2.0");
        columns.put("issued_at", AUTHORIZED);
        columns.put("expires_at", AUTHORIZED.plusSeconds(120));
        columns.put("payload", json("""
                {"messageId": "%s", "operationId": "%s", "lockerId": "%s", "compartmentId": "%s",
                 "type": "UNLOCK_COMPARTMENT", "issuedAt": "%s", "expiresAt": "%s", "schemaVersion": "2.0"}
                """.formatted(message, operation, site.locker(), site.compartment(), AUTHORIZED,
                AUTHORIZED.plusSeconds(120))));
        return columns;
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
        JdbcClient.StatementSpec statement = client.sql("INSERT INTO aegis." + table + " ("
                + String.join(", ", columns.keySet()) + ") VALUES ("
                + columns.keySet().stream().map(column -> ":" + column).collect(Collectors.joining(", "))
                + ") RETURNING id");
        for (Map.Entry<String, Object> column : columns.entrySet()) {
            statement = statement.param(column.getKey(), column.getValue());
        }
        return statement.query(UUID.class).single();
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
