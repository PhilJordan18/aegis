package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import ca.aegis.control.support.TestDatabaseServer;
import ca.aegis.control.support.TestDatabases;

/**
 * V005 and V006, document 08, sections 4.6, 4.9 and 5.1: reservations, locker operations and loans. Every refusal
 * below comes from PostgreSQL itself; each invalid row breaks exactly one constraint so that the name is certain.
 */
class CustodySchemaTests {

    private static final OffsetDateTime CREATED = OffsetDateTime.of(2026, 10, 28, 13, 0, 0, 0, ZoneOffset.UTC);
    private static final OffsetDateTime AUTHORIZED = CREATED.plusMinutes(1);
    private static final OffsetDateTime CONFIRMED = AUTHORIZED.plusSeconds(30);
    private static final List<String> NOMINAL_PATH = List.of("REQUESTED", "AWAITING_LOCAL_PROOF", "AUTHORIZED",
            "COMMAND_SENT", "COMMAND_ACKNOWLEDGED", "DOOR_OPENED", "OBSERVATION_RECEIVED", "CONFIRMED");
    private static final List<String> OPEN_STATUSES = NOMINAL_PATH.subList(0, 7);
    private static final List<String> FAILURE_STATUSES = List.of("FAILED", "EXPIRED", "ANOMALY");

    private final TestDatabases databases = TestDatabases.shared();
    private final TestDatabaseServer server = databases.server();
    private final String absentRole = "aegis_test_absent_" + UUID.randomUUID().toString().substring(0, 8);

    private String database;
    private JdbcClient jdbc;
    private UUID model;

    /** A technician, an asset with its RFID tag, and the compartment of a locker where the asset is expected. */
    private record Site(UUID user, UUID asset, UUID identifier, UUID locker, UUID compartment) {
    }

    @BeforeEach
    void migratedDatabase() {
        database = databases.create("custody");
        jdbc = JdbcClient.create(new DriverManagerDataSource(server.url(database), server.user(), server.password()));
        assertEquals(8, flyway(absentRole).migrate().migrationsExecuted);
        model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES ('Multimeter') RETURNING id")
                .query(UUID.class).single();
    }

    @AfterEach
    void dropDatabase() {
        databases.drop(database);
    }

    @Test
    void theCustodyTablesDeclareTheConstraintsAndInvariantIndexesOfDocument08() {
        assertEquals(List.of(
                "ck_reservations_dates_after_creation:c", "ck_reservations_interval:c", "ck_reservations_status:c",
                "ck_reservations_terminal_date:c", "fk_reservations_asset:f", "fk_reservations_user:f",
                "reservations_pkey:p", "uq_reservations_id_asset_user:u"), constraints("reservations"));
        assertEquals(List.of(
                "ck_locker_operations_authorization_pair:c", "ck_locker_operations_chronology:c",
                "ck_locker_operations_confirmation:c", "ck_locker_operations_expiration:c",
                "ck_locker_operations_failure_reason:c", "ck_locker_operations_local_proof:c",
                "ck_locker_operations_source:c", "ck_locker_operations_status:c",
                "ck_locker_operations_status_jalons:c", "ck_locker_operations_terminal:c",
                "ck_locker_operations_terminal_date:c", "ck_locker_operations_type:c",
                "fk_locker_operations_asset:f", "fk_locker_operations_checkout_reservation:f",
                "fk_locker_operations_compartment_locker:f", "fk_locker_operations_expected_identifier:f",
                "fk_locker_operations_return_loan:f", "fk_locker_operations_user:f", "locker_operations_pkey:p",
                "uq_locker_operations_id_asset_user:u", "uq_locker_operations_id_locker:u"),
                constraints("locker_operations"));
        assertEquals(List.of(
                "ck_loans_dates:c", "ck_loans_return_operation_distinct:c", "ck_loans_status:c",
                "ck_loans_status_effects:c", "fk_loans_asset:f", "fk_loans_checkout_operation:f",
                "fk_loans_holder:f", "fk_loans_return_operation:f", "loans_pkey:p",
                "uq_loans_checkout_operation:u", "uq_loans_id_asset_holder:u"), constraints("loans"));

        // No cascade anywhere: the history of a custody chain is never deleted through a parent row.
        assertEquals(List.of(
                "fk_audit_events_operation FOREIGN KEY (operation_id) REFERENCES locker_operations(id)",
                "fk_loans_asset FOREIGN KEY (asset_id) REFERENCES assets(id)",
                "fk_loans_checkout_operation FOREIGN KEY (checkout_operation_id, asset_id, holder_user_id) "
                        + "REFERENCES locker_operations(id, asset_id, user_id)",
                "fk_loans_holder FOREIGN KEY (holder_user_id) REFERENCES users(id)",
                "fk_loans_return_operation FOREIGN KEY (return_operation_id) REFERENCES locker_operations(id)",
                "fk_locker_operations_asset FOREIGN KEY (asset_id) REFERENCES assets(id)",
                "fk_locker_operations_checkout_reservation FOREIGN KEY (reservation_id, asset_id, user_id) "
                        + "REFERENCES reservations(id, asset_id, user_id)",
                "fk_locker_operations_compartment_locker FOREIGN KEY (compartment_id, locker_id) "
                        + "REFERENCES compartments(id, locker_id)",
                "fk_locker_operations_expected_identifier FOREIGN KEY (expected_asset_identifier_id, asset_id) "
                        + "REFERENCES asset_identifiers(id, asset_id)",
                "fk_locker_operations_return_loan FOREIGN KEY (loan_id, asset_id, user_id) "
                        + "REFERENCES loans(id, asset_id, holder_user_id)",
                "fk_locker_operations_user FOREIGN KEY (user_id) REFERENCES users(id)",
                "fk_reservations_asset FOREIGN KEY (asset_id) REFERENCES assets(id)",
                "fk_reservations_user FOREIGN KEY (user_id) REFERENCES users(id)"), jdbc.sql("""
                SELECT conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
                WHERE contype = 'f' AND (conrelid IN ('aegis.reservations'::regclass, 'aegis.locker_operations'::regclass,
                        'aegis.loans'::regclass) OR conname = 'fk_audit_events_operation')
                ORDER BY conname COLLATE "C"
                """).query(String.class).list());

        // Read indexes of section 5.2 are left to V011; only the invariant and support indexes exist here.
        assertEquals(List.of("reservations_pkey", "uq_reservations_id_asset_user",
                "ux_reservations_one_active_per_asset", "ux_reservations_one_active_per_user"), indexes("reservations"));
        assertEquals(List.of("locker_operations_pkey", "uq_locker_operations_id_asset_user",
                "uq_locker_operations_id_locker", "ux_locker_operations_one_open_per_locker"),
                indexes("locker_operations"));
        assertEquals(List.of("loans_pkey", "uq_loans_checkout_operation", "uq_loans_id_asset_holder",
                "ux_loans_one_open_per_asset"), indexes("loans"));
        assertEquals(List.of("audit_events_pkey", "ix_audit_events_operation_time", "ix_audit_events_subject_time",
                "ix_audit_events_time"), indexes("audit_events"));
    }

    @Test
    void reservationsKeepOneActiveRowPerAssetAndPerUserAndACoherentConclusion() {
        Site first = site("A");
        Site second = site("B");
        UUID reservation = reserve(first);
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.reservations WHERE id = :id")
                .param("id", reservation).query(String.class).single());

        assertViolation("23505", "ux_reservations_one_active_per_asset",
                () -> insert("reservations", reservation(first.asset(), second.user())));
        assertViolation("23505", "ux_reservations_one_active_per_user",
                () -> insert("reservations", reservation(second.asset(), first.user())));
        assertViolation("23503", "fk_reservations_asset",
                () -> insert("reservations", reservation(UUID.randomUUID(), second.user())));
        assertViolation("23503", "fk_reservations_user",
                () -> insert("reservations", reservation(second.asset(), UUID.randomUUID())));
        assertViolation("23514", "ck_reservations_interval", () -> insert("reservations",
                with(reservation(second.asset(), second.user()), "reserved_until", CREATED)));
        assertViolation("23514", "ck_reservations_status", () -> update("reservations", reservation,
                Map.of("status", "PENDING")));
        assertViolation("23514", "ck_reservations_terminal_date", () -> update("reservations", reservation,
                Map.of("status", "FULFILLED")));
        assertViolation("23514", "ck_reservations_terminal_date", () -> update("reservations", reservation,
                Map.of("expired_at", CONFIRMED)));
        assertViolation("23514", "ck_reservations_terminal_date", () -> update("reservations", reservation,
                Map.of("status", "CANCELLED", "cancelled_at", CONFIRMED, "expired_at", CONFIRMED)));
        assertViolation("23514", "ck_reservations_terminal_date", () -> update("reservations", reservation,
                Map.of("status", "EXPIRED", "fulfilled_at", CONFIRMED)));
        assertViolation("23514", "ck_reservations_dates_after_creation", () -> update("reservations", reservation,
                Map.of("status", "CANCELLED", "cancelled_at", CREATED.minusSeconds(1))));

        // A concluded reservation frees the asset and the technician; its row stays as history.
        update("reservations", reservation, Map.of("status", "CANCELLED", "cancelled_at", CONFIRMED));
        UUID expired = insert("reservations", reservation(first.asset(), first.user()));
        update("reservations", expired, Map.of("status", "EXPIRED", "expired_at", CREATED.plusHours(1)));
        UUID fulfilled = insert("reservations", reservation(first.asset(), second.user()));
        update("reservations", fulfilled, Map.of("status", "FULFILLED", "fulfilled_at", CONFIRMED));
        insert("reservations", reservation(first.asset(), first.user()));
        assertEquals(List.of("ACTIVE", "CANCELLED", "EXPIRED", "FULFILLED"), jdbc.sql("""
                SELECT status FROM aegis.reservations WHERE asset_id = :asset ORDER BY status
                """).param("asset", first.asset()).query(String.class).list());
    }

    @Test
    void lockerOperationsRequireTheirSourceAndCoherentMilestones() {
        Site site = site("A");
        Site elsewhere = site("B");
        UUID reservation = reserve(site);
        UUID otherReservation = reserve(elsewhere);
        Map<String, Object> requested = checkout(site, reservation, "REQUESTED");
        Map<String, Object> authorized = checkout(site, reservation, "AUTHORIZED");

        assertViolation("23514", "ck_locker_operations_status", () -> insertOperation(with(requested,
                "status", "OPENED")));
        // An unknown type also fails ck_locker_operations_source, which PostgreSQL may report first.
        assertRefused("23514", () -> insertOperation(with(requested, "type", "MOVE")));
        assertViolation("23514", "ck_locker_operations_source", () -> insertOperation(with(requested,
                "reservation_id", null)));
        assertViolation("23514", "ck_locker_operations_source", () -> insertOperation(with(requested,
                "type", "RETURN")));

        assertViolation("23514", "ck_locker_operations_local_proof", () -> insertOperation(with(requested,
                "authorized_at", AUTHORIZED, "local_proof_validated_at", AUTHORIZED,
                "expires_at", AUTHORIZED.plusSeconds(120))));
        assertViolation("23514", "ck_locker_operations_local_proof", () -> insertOperation(with(authorized,
                "local_proof_validated_at", AUTHORIZED.plusSeconds(1))));
        assertViolation("23514", "ck_locker_operations_local_proof", () -> insertOperation(with(authorized,
                "local_proof_validated_at", null)));
        assertViolation("23514", "ck_locker_operations_authorization_pair", () -> insertOperation(with(authorized,
                "expires_at", null)));
        assertViolation("23514", "ck_locker_operations_expiration", () -> insertOperation(with(authorized,
                "expires_at", AUTHORIZED.plusSeconds(60))));
        assertViolation("23514", "ck_locker_operations_expiration", () -> insertOperation(with(authorized,
                "expires_at", AUTHORIZED.plusSeconds(121))));
        assertViolation("23514", "ck_locker_operations_chronology", () -> insertOperation(with(authorized,
                "created_at", AUTHORIZED.plusSeconds(1))));
        assertViolation("23514", "ck_locker_operations_chronology", () -> insertOperation(with(requested,
                "command_sent_at", AUTHORIZED)));
        assertViolation("23514", "ck_locker_operations_chronology", () -> insertOperation(with(
                checkout(site, reservation, "COMMAND_SENT"), "door_opened_at", AUTHORIZED.plusSeconds(10))));
        assertViolation("23514", "ck_locker_operations_status_jalons", () -> insertOperation(with(authorized,
                "status", "COMMAND_SENT")));
        assertViolation("23514", "ck_locker_operations_status_jalons", () -> insertOperation(with(
                checkout(site, reservation, "COMMAND_ACKNOWLEDGED"), "status", "OBSERVATION_RECEIVED")));
        assertViolation("23514", "ck_locker_operations_terminal", () -> insertOperation(with(
                checkout(site, reservation, "FAILED"), "terminal_at", null)));
        assertViolation("23514", "ck_locker_operations_terminal", () -> insertOperation(with(requested,
                "terminal_at", AUTHORIZED)));
        assertViolation("23514", "ck_locker_operations_confirmation", () -> insertOperation(with(
                checkout(site, reservation, "CONFIRMED"), "confirmed_at", null)));
        assertViolation("23514", "ck_locker_operations_confirmation", () -> insertOperation(with(
                checkout(site, reservation, "FAILED"), "confirmed_at", AUTHORIZED)));
        assertViolation("23514", "ck_locker_operations_failure_reason", () -> insertOperation(with(
                checkout(site, reservation, "ANOMALY"), "failure_reason", null)));
        assertViolation("23514", "ck_locker_operations_failure_reason", () -> insertOperation(with(
                checkout(site, reservation, "CONFIRMED"), "failure_reason", "UNEXPECTED")));
        assertViolation("23514", "ck_locker_operations_terminal_date", () -> insertOperation(with(
                checkout(site, reservation, "EXPIRED"), "terminal_at", CREATED.minusSeconds(1))));

        // Terminal rows, so that the open-operation index cannot fire before the foreign key.
        Map<String, Object> failed = checkout(site, reservation, "FAILED");
        assertViolation("23503", "fk_locker_operations_compartment_locker", () -> insertOperation(with(failed,
                "compartment_id", elsewhere.compartment())));
        assertViolation("23503", "fk_locker_operations_checkout_reservation", () -> insertOperation(with(failed,
                "reservation_id", otherReservation)));
        assertViolation("23503", "fk_locker_operations_expected_identifier", () -> insertOperation(with(failed,
                "expected_asset_identifier_id", elsewhere.identifier())));

        // The nominal path of document 05, section 5.1, one milestone per transition, then a failure exit.
        UUID operation = insertOperation(with(requested, "status", null));
        assertEquals("REQUESTED", jdbc.sql("SELECT status FROM aegis.locker_operations WHERE id = :id")
                .param("id", operation).query(String.class).single());
        for (String status : NOMINAL_PATH.subList(1, NOMINAL_PATH.size())) {
            update("locker_operations", operation, milestones(status));
        }
        UUID abandoned = insertOperation(checkout(site, reservation, "AWAITING_LOCAL_PROOF"));
        update("locker_operations", abandoned, milestones("FAILED"));
        UUID uncertain = insertOperation(checkout(site, reservation, "DOOR_OPENED"));
        update("locker_operations", uncertain, with(milestones("DOOR_OPENED"), "status", "ANOMALY",
                "terminal_at", AUTHORIZED.plusSeconds(120), "failure_reason", "DOOR_NOT_CLOSED_BEFORE_EXPIRY"));
        assertEquals(List.of("ANOMALY", "CONFIRMED", "FAILED"), jdbc.sql("""
                SELECT status FROM aegis.locker_operations WHERE locker_id = :locker ORDER BY status
                """).param("locker", site.locker()).query(String.class).list());
    }

    /** Document 08, section 5.1: every non-terminal status holds the locker, AWAITING_LOCAL_PROOF included. */
    @Test
    void aLockerHoldsOneOpenOperationWhateverItsNonTerminalStatus() {
        Site holder = site("A");
        Site neighbour = site("B", holder.locker(), 2);
        Site elsewhere = site("C");
        UUID holderReservation = reserve(holder);
        UUID neighbourReservation = reserve(neighbour);
        UUID open = insertOperation(checkout(holder, holderReservation, "AWAITING_LOCAL_PROOF"));
        insertOperation(checkout(elsewhere, reserve(elsewhere), "COMMAND_SENT"));

        for (String status : OPEN_STATUSES) {
            assertViolation("23505", "ux_locker_operations_one_open_per_locker",
                    () -> insertOperation(checkout(neighbour, neighbourReservation, status)));
        }
        for (String status : List.of("CONFIRMED", "FAILED", "EXPIRED", "ANOMALY")) {
            insertOperation(checkout(neighbour, neighbourReservation, status));
        }

        update("locker_operations", open, milestones("EXPIRED"));
        insertOperation(checkout(neighbour, neighbourReservation, "REQUESTED"));
        assertEquals(1, jdbc.sql("""
                SELECT count(*) FROM aegis.locker_operations
                WHERE locker_id = :locker AND status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')
                """).param("locker", holder.locker()).query(Long.class).single());
    }

    @Test
    void loansKeepOneLoanPerCheckoutOneOpenLoanPerAssetAndACoherentReturn() {
        Site site = site("A");
        Site other = site("B");
        UUID firstReservation = reserve(site);
        UUID firstCheckout = insertOperation(checkout(site, firstReservation, "CONFIRMED"));
        update("reservations", firstReservation, Map.of("status", "FULFILLED", "fulfilled_at", CONFIRMED));
        UUID loan = insert("loans", with(loan(site, firstCheckout), "status", null));
        assertEquals("ACTIVE", jdbc.sql("SELECT status FROM aegis.loans WHERE id = :id").param("id", loan)
                .query(String.class).single());

        UUID secondReservation = reserve(site);
        UUID secondCheckout = insertOperation(checkout(site, secondReservation, "CONFIRMED"));
        assertViolation("23505", "ux_loans_one_open_per_asset", () -> insert("loans", loan(site, secondCheckout)));
        // A missing asset or holder also breaks fk_loans_checkout_operation; PostgreSQL fires foreign key triggers in
        // creation order and reports the simple key declared first.
        assertViolation("23503", "fk_loans_asset", () -> insert("loans", with(loan(site, secondCheckout),
                "asset_id", UUID.randomUUID())));
        assertViolation("23503", "fk_loans_holder", () -> insert("loans", with(loan(other, secondCheckout),
                "holder_user_id", UUID.randomUUID())));
        assertViolation("23503", "fk_loans_checkout_operation", () -> insert("loans", loan(other,
                UUID.randomUUID())));

        assertViolation("23514", "ck_loans_status", () -> update("loans", loan, Map.of("status", "LOST")));
        assertViolation("23514", "ck_loans_dates", () -> update("loans", loan, Map.of("return_requested_at",
                CONFIRMED.minusSeconds(1))));
        assertViolation("23514", "ck_loans_status_effects", () -> update("loans", loan, Map.of("status",
                "RETURN_PENDING")));
        assertViolation("23514", "ck_loans_status_effects", () -> update("loans", loan, Map.of("returned_at",
                CONFIRMED.plusHours(1))));
        assertViolation("23514", "ck_loans_status_effects", () -> update("loans", loan, Map.of("status",
                "COMPLETED", "return_requested_at", CONFIRMED.plusHours(1), "returned_at",
                CONFIRMED.plusHours(1))));
        assertViolation("23514", "ck_loans_return_operation_distinct", () -> update("loans", loan, Map.of(
                "status", "COMPLETED", "return_requested_at", CONFIRMED.plusHours(1), "returned_at",
                CONFIRMED.plusHours(1), "return_operation_id", firstCheckout)));
        assertViolation("23503", "fk_loans_return_operation", () -> update("loans", loan, Map.of(
                "status", "COMPLETED", "return_requested_at", CONFIRMED.plusHours(1), "returned_at",
                CONFIRMED.plusHours(1), "return_operation_id", UUID.randomUUID())));

        // A return belongs to the loan's holder and asset (circular foreign key added after both tables).
        Map<String, Object> failedReturn = returning(site, loan, "FAILED");
        assertViolation("23503", "fk_locker_operations_return_loan", () -> insertOperation(with(failedReturn,
                "user_id", other.user())));
        assertViolation("23503", "fk_locker_operations_return_loan", () -> insertOperation(with(failedReturn,
                "asset_id", other.asset(), "expected_asset_identifier_id", other.identifier())));

        // A safe failure brings the loan back to ACTIVE and keeps return_requested_at (section 4.6).
        UUID safeFailure = insertOperation(returning(site, loan, "AUTHORIZED"));
        update("loans", loan, Map.of("status", "RETURN_PENDING", "return_requested_at", CONFIRMED.plusHours(1)));
        update("locker_operations", safeFailure, with(milestones("AUTHORIZED"), "status", "FAILED",
                "terminal_at", AUTHORIZED.plusSeconds(5), "failure_reason", "PUBLICATION_FAILED"));
        update("loans", loan, Map.of("status", "ACTIVE"));

        UUID returned = insertOperation(returning(site, loan, "CONFIRMED"));
        update("loans", loan, Map.of("status", "COMPLETED", "return_requested_at", CONFIRMED.plusHours(2),
                "returned_at", CONFIRMED.plusHours(2), "return_operation_id", returned));

        // A replayed confirmation finds the completed loan of its checkout and cannot open a second one.
        assertViolation("23505", "uq_loans_checkout_operation", () -> insert("loans", loan(site, firstCheckout)));
        // The checkout operation belongs to the loan's asset and holder (composite foreign key, 28 October 2026).
        // The asset has no open loan any more, so only that key can refuse these rows.
        assertViolation("23503", "fk_loans_checkout_operation", () -> insert("loans", with(loan(site,
                secondCheckout), "asset_id", other.asset())));
        assertViolation("23503", "fk_loans_checkout_operation", () -> insert("loans", with(loan(site,
                secondCheckout), "holder_user_id", other.user())));
        insert("loans", loan(site, secondCheckout));
        assertEquals(List.of("ACTIVE", "COMPLETED"), jdbc.sql(
                "SELECT status FROM aegis.loans WHERE asset_id = :asset ORDER BY status")
                .param("asset", site.asset()).query(String.class).list());
    }

    /** A confirmation after the reservation's end starts a loan that is already overdue (section 4.6). */
    @Test
    void aLoanMayStartAfterItsDueDate() {
        Site site = site("A");
        UUID reservation = reserve(site);
        UUID checkout = insertOperation(checkout(site, reservation, "CONFIRMED"));

        UUID loan = insert("loans", with(loan(site, checkout), "due_at", CONFIRMED.minusSeconds(1)));
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.loans WHERE id = :id AND due_at < checked_out_at")
                .param("id", loan).query(Long.class).single());
    }

    @Test
    void auditEventsMayReferenceAnExistingOperationOnly() {
        Site site = site("A");
        UUID operation = insertOperation(checkout(site, reserve(site), "REQUESTED"));

        UUID event = jdbc.sql("""
                INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, operation_id,
                                                from_state, to_state, result)
                VALUES ('OPERATION_REQUESTED', :actor, 'LOCKER_OPERATION', :operation, :operation,
                        'NONE', 'REQUESTED', 'ACCEPTED')
                RETURNING id
                """).param("actor", site.user()).param("operation", operation).query(UUID.class).single();
        assertEquals(operation, jdbc.sql("SELECT operation_id FROM aegis.audit_events WHERE id = :id")
                .param("id", event).query(UUID.class).single());
        assertViolation("23503", "fk_audit_events_operation", () -> jdbc.sql("""
                INSERT INTO aegis.audit_events (event_type, subject_type, subject_id, operation_id)
                VALUES ('OPERATION_REQUESTED', 'LOCKER_OPERATION', gen_random_uuid(), gen_random_uuid())
                """).update());
        assertEquals("CREATE INDEX ix_audit_events_operation_time ON aegis.audit_events USING btree "
                + "(operation_id, occurred_at) WHERE (operation_id IS NOT NULL)", jdbc.sql(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'aegis' AND indexname = :name")
                .param("name", "ix_audit_events_operation_time").query(String.class).single());
    }

    /**
     * Custody history is never destructively erased (AGENTS.md, document 08, section 12.1): the application role
     * records custody, takes the row locks of section 7.1 and moves states forward, but cannot delete or truncate.
     */
    @Test
    void theApplicationRoleRecordsAndUpdatesCustodyButNeverDeletesIt() {
        String role = "aegis_test_app_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.sql("CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
                .update();
        try {
            // The callback runs after every migrate, even when no migration is pending.
            assertEquals(0, flyway(role).migrate().migrationsExecuted);
            for (String table : List.of("reservations", "locker_operations", "loans")) {
                assertEquals(List.of(table + ":INSERT,SELECT,UPDATE"), privileges(role, table));
            }
            assertEquals(List.of("audit_events:INSERT,SELECT"), privileges(role, "audit_events"));
            assertEquals(List.of("assets:DELETE,INSERT,SELECT,UPDATE"), privileges(role, "assets"));
            Site site = site("A");
            Map<String, UUID> rows = new LinkedHashMap<>();

            try (SingleConnectionDataSource session = new SingleConnectionDataSource(server.url(database),
                    server.user(), server.password(), true)) {
                JdbcClient application = JdbcClient.create(session);
                application.sql("SET ROLE " + role).update();

                application.sql("SELECT id FROM aegis.users WHERE id = :id FOR NO KEY UPDATE")
                        .param("id", site.user()).query(UUID.class).single();
                UUID reservation = insert(application, "reservations", reservation(site.asset(), site.user()));
                application.sql("SELECT id FROM aegis.reservations WHERE id = :id FOR UPDATE")
                        .param("id", reservation).query(UUID.class).single();
                UUID checkout = insert(application, "locker_operations",
                        checkout(site, reservation, "AWAITING_LOCAL_PROOF"));
                application.sql("SELECT id FROM aegis.locker_operations WHERE id = :id FOR UPDATE")
                        .param("id", checkout).query(UUID.class).single();
                update(application, "locker_operations", checkout, milestones("CONFIRMED"));
                update(application, "reservations", reservation, Map.of("status", "FULFILLED",
                        "fulfilled_at", CONFIRMED));
                UUID loan = insert(application, "loans", loan(site, checkout));
                update(application, "loans", loan, Map.of("status", "RETURN_PENDING", "return_requested_at",
                        CONFIRMED.plusHours(1)));
                application.sql("""
                        INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id,
                                                        operation_id, result)
                        VALUES ('CHECKOUT_CONFIRMED', :actor, 'LOAN', :loan, :operation, 'ACCEPTED')
                        """).param("actor", site.user()).param("loan", loan).param("operation", checkout).update();
                rows.put("reservations", reservation);
                rows.put("locker_operations", checkout);
                rows.put("loans", loan);

                for (Map.Entry<String, UUID> row : rows.entrySet()) {
                    assertEquals(1, application.sql("SELECT count(*) FROM aegis." + row.getKey() + " WHERE id = :id")
                            .param("id", row.getValue()).query(Long.class).single());
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
            assertEquals("RETURN_PENDING", jdbc.sql("SELECT status FROM aegis.loans WHERE id = :id")
                    .param("id", rows.get("loans")).query(String.class).single());
        } finally {
            jdbc.sql("DROP OWNED BY " + role).update();
            jdbc.sql("DROP ROLE " + role).update();
        }
    }

    @Test
    void twoTechniciansReservingOneAssetAtOnceLeaveOneActiveReservation() throws Exception {
        Site first = site("A");
        Site second = site("B");

        assertSecondWriterRefused("ux_reservations_one_active_per_asset",
                "SELECT count(*) FROM aegis.reservations WHERE asset_id = :asset AND status = 'ACTIVE'",
                Map.of("asset", first.asset()), "reservations",
                reservation(first.asset(), first.user()), reservation(first.asset(), second.user()));
    }

    @Test
    void oneTechnicianReservingTwoAssetsAtOnceKeepsOneActiveReservation() throws Exception {
        Site first = site("A");
        Site second = site("B");

        assertSecondWriterRefused("ux_reservations_one_active_per_user",
                "SELECT count(*) FROM aegis.reservations WHERE user_id = :user AND status = 'ACTIVE'",
                Map.of("user", first.user()), "reservations",
                reservation(first.asset(), first.user()), reservation(second.asset(), first.user()));
    }

    /** Two ingestions confirm the same checkout: the second loan is refused even for the same asset and holder. */
    @Test
    void twoConfirmationsOfOneCheckoutCreateOneLoan() throws Exception {
        Site site = site("A");
        UUID reservation = reserve(site);
        UUID checkout = insertOperation(checkout(site, reservation, "CONFIRMED"));

        assertSecondWriterRefused("uq_loans_checkout_operation",
                "SELECT count(*) FROM aegis.loans WHERE checkout_operation_id = :operation",
                Map.of("operation", checkout), "loans", loan(site, checkout), loan(site, checkout));
    }

    /** Two confirmed checkouts of one asset, each from its own reservation, race to open a loan. */
    @Test
    void twoCheckoutsOfOneAssetConfirmedAtOnceOpenOneLoan() throws Exception {
        Site site = site("A");
        UUID firstReservation = reserve(site);
        UUID firstCheckout = insertOperation(checkout(site, firstReservation, "CONFIRMED"));
        update("reservations", firstReservation, Map.of("status", "FULFILLED", "fulfilled_at", CONFIRMED));
        UUID secondCheckout = insertOperation(checkout(site, reserve(site), "CONFIRMED"));

        assertSecondWriterRefused("ux_loans_one_open_per_asset",
                "SELECT count(*) FROM aegis.loans WHERE asset_id = :asset AND status IN ('ACTIVE', 'RETURN_PENDING')",
                Map.of("asset", site.asset()), "loans", loan(site, firstCheckout), loan(site, secondCheckout));
    }

    /** Two technicians start a physical operation on two cells of one locker at the same time. */
    @Test
    void twoOperationsStartedAtOnceOnOneLockerLeaveOneOpen() throws Exception {
        Site first = site("A");
        Site second = site("B", first.locker(), 2);
        Map<String, Object> firstOperation = checkout(first, reserve(first), "AWAITING_LOCAL_PROOF");
        Map<String, Object> secondOperation = checkout(second, reserve(second), "AWAITING_LOCAL_PROOF");

        assertSecondWriterRefused("ux_locker_operations_one_open_per_locker", """
                SELECT count(*) FROM aegis.locker_operations
                WHERE locker_id = :locker AND status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')
                """, Map.of("locker", first.locker()), "locker_operations", firstOperation, secondOperation);
    }

    /**
     * Two READ COMMITTED transactions both pass the application pre-check, since neither sees the other's
     * uncommitted row, then both insert. The second insert waits on the first transaction's index entry; once the
     * first commits, PostgreSQL itself refuses the second with 23505 on the invariant index, and one row remains.
     */
    private void assertSecondWriterRefused(String index, String precheck, Map<String, ?> keys, String table,
            Map<String, Object> first, Map<String, Object> second) throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try (SingleConnectionDataSource firstSession = transaction();
                SingleConnectionDataSource secondSession = transaction()) {
            JdbcClient firstWriter = JdbcClient.create(firstSession);
            JdbcClient secondWriter = JdbcClient.create(secondSession);
            assertEquals(0, firstWriter.sql(precheck).params(keys).query(Long.class).single());
            assertEquals(0, secondWriter.sql(precheck).params(keys).query(Long.class).single());
            int firstPid = firstWriter.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            int secondPid = secondWriter.sql("SELECT pg_backend_pid()").query(Integer.class).single();
            insert(firstWriter, table, first);

            CountDownLatch secondStarted = new CountDownLatch(1);
            Future<UUID> secondInsert = executor.submit(() -> {
                secondStarted.countDown();
                return insert(secondWriter, table, second);
            });
            assertTrue(secondStarted.await(10, TimeUnit.SECONDS));
            awaitBlocked(secondPid, firstPid);
            firstSession.getConnection().commit();

            ExecutionException failure = assertThrows(ExecutionException.class,
                    () -> secondInsert.get(10, TimeUnit.SECONDS));
            DataAccessException refusal = assertInstanceOf(DataAccessException.class, failure.getCause());
            PSQLException cause = assertInstanceOf(PSQLException.class, refusal.getMostSpecificCause());
            assertEquals("23505", cause.getSQLState(), cause::getMessage);
            assertEquals(index, cause.getServerErrorMessage().getConstraint(), cause::getMessage);
            secondSession.getConnection().rollback();
        } finally {
            executor.shutdownNow();
        }
        assertEquals(1, jdbc.sql(precheck).params(keys).query(Long.class).single());
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

    private Site site(String code) {
        UUID locker = jdbc.sql("INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier', 'HUB_CELL') "
                + "RETURNING id").param("code", "L-" + code).query(UUID.class).single();
        return site(code, locker, 1);
    }

    /** A new technician and asset, expected in a new compartment of the given locker. */
    private Site site(String code, UUID locker, int slot) {
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
                VALUES (:locker, :code, :slot, :slot)
                RETURNING id
                """).param("locker", locker).param("code", "A" + slot).param("slot", slot).query(UUID.class).single();
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason)
                VALUES (:asset, :compartment, 'Affectation initiale')
                """).param("asset", asset).param("compartment", compartment).update();
        return new Site(user, asset, identifier, locker, compartment);
    }

    private UUID reserve(Site site) {
        return insert("reservations", reservation(site.asset(), site.user()));
    }

    private static Map<String, Object> reservation(UUID asset, UUID user) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("asset_id", asset);
        columns.put("user_id", user);
        columns.put("reserved_from", CREATED);
        columns.put("reserved_until", CREATED.plusHours(1));
        columns.put("created_at", CREATED);
        return columns;
    }

    private static Map<String, Object> checkout(Site site, UUID reservation, String status) {
        Map<String, Object> columns = operation("CHECKOUT", site, status);
        columns.put("reservation_id", reservation);
        return columns;
    }

    private static Map<String, Object> returning(Site site, UUID loan, String status) {
        Map<String, Object> columns = operation("RETURN", site, status);
        columns.put("loan_id", loan);
        return columns;
    }

    private static Map<String, Object> operation(String type, Site site, String status) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("type", type);
        columns.put("user_id", site.user());
        columns.put("asset_id", site.asset());
        columns.put("locker_id", site.locker());
        columns.put("compartment_id", site.compartment());
        columns.put("expected_asset_identifier_id", site.identifier());
        columns.putAll(milestones(status));
        return columns;
    }

    /** The columns of a valid operation in this status, as the nominal path or a failure before authorization. */
    private static Map<String, Object> milestones(String status) {
        int reached = NOMINAL_PATH.indexOf(status);
        if (reached < 0 && !FAILURE_STATUSES.contains(status)) {
            throw new IllegalArgumentException(status);
        }
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("status", status);
        columns.put("created_at", CREATED);
        if (reached >= 2) {
            columns.put("authorized_at", AUTHORIZED);
            columns.put("local_proof_validated_at", AUTHORIZED);
            columns.put("expires_at", AUTHORIZED.plusSeconds(120));
        }
        if (reached >= 3) {
            columns.put("command_sent_at", AUTHORIZED.plusSeconds(1));
        }
        if (reached >= 4) {
            columns.put("acknowledged_at", AUTHORIZED.plusSeconds(2));
        }
        if (reached >= 5) {
            columns.put("door_opened_at", AUTHORIZED.plusSeconds(10));
        }
        if (reached >= 6) {
            columns.put("observation_received_at", AUTHORIZED.plusSeconds(20));
        }
        if (reached == 7) {
            columns.put("confirmed_at", CONFIRMED);
            columns.put("terminal_at", CONFIRMED);
        }
        if (reached < 0) {
            columns.put("terminal_at", AUTHORIZED);
            columns.put("failure_reason", "LOCAL_CHALLENGE_EXPIRED");
        }
        return columns;
    }

    private static Map<String, Object> loan(Site site, UUID checkoutOperation) {
        Map<String, Object> columns = new LinkedHashMap<>();
        columns.put("asset_id", site.asset());
        columns.put("holder_user_id", site.user());
        columns.put("checkout_operation_id", checkoutOperation);
        columns.put("status", "ACTIVE");
        columns.put("checked_out_at", CONFIRMED);
        columns.put("due_at", CREATED.plusHours(1));
        return columns;
    }

    /** A copy with the given column values; a null value removes the column, so its default applies. */
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

    private UUID insertOperation(Map<String, Object> columns) {
        return insert("locker_operations", columns);
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

    private List<String> privileges(String role, String table) {
        return jdbc.sql("""
                SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type)
                FROM information_schema.role_table_grants
                WHERE grantee = :role AND table_schema = 'aegis' AND table_name = :table
                GROUP BY table_name
                """).param("role", role).param("table", table).query(String.class).list();
    }

    private List<String> indexes(String table) {
        return jdbc.sql("""
                SELECT indexname FROM pg_indexes WHERE schemaname = 'aegis' AND tablename = :table
                ORDER BY indexname COLLATE "C"
                """).param("table", table).query(String.class).list();
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
