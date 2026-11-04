package ca.aegis.control.command;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.reservation.ReservationFixtures;

/**
 * Checkout operations at the edge of their authorization, inserted directly: the QR validation that authorizes an
 * operation (LOC-02) is not part of IOT-01, so a test plays the business decision itself and the outbox is called
 * inside that decision's transaction, as the authorizing service will call it.
 */
final class CommandFixtures {

    /**
     * The fictitious locker of the backend broker tests (#115): the test hub account may read its {@code commands}
     * topic and nothing else, so no command of these tests ever reaches the demo hub.
     */
    static final UUID BROKER_TEST_LOCKER = UUID.fromString("f08e3bc1-a0c6-4870-a6f6-55d9e9ddd502");

    private static final SecureRandom RANDOM = new SecureRandom();
    /** Addresses 1 and 2 of the broker test locker belong to the ingestion tests. */
    private static final AtomicInteger BROKER_LOCKER_ADDRESS = new AtomicInteger(100);
    private static final java.util.concurrent.atomic.AtomicLong REPORT_SEQUENCE = new java.util.concurrent.atomic.AtomicLong();

    private final JdbcClient jdbc;
    private final ReservationFixtures reservations;

    CommandFixtures(JdbcClient jdbc) {
        this.jdbc = jdbc;
        this.reservations = new ReservationFixtures(jdbc);
    }

    /** A checkout waiting for its local proof, in a compartment of a new locker, with a displayed challenge. */
    Operation awaitingLocalProof(UUID user, Instant at) {
        return awaitingLocalProof(user, reservations.locker(), 1, at);
    }

    /** The same, in a new compartment of the broker test locker. */
    Operation awaitingLocalProofOnBrokerTestLocker(UUID user, Instant at) {
        jdbc.sql("""
                INSERT INTO aegis.lockers (id, code, name, topology)
                VALUES (:locker, 'AEGIS-TEST-HUB', 'Casier de test MQTT', 'HUB_CELL')
                ON CONFLICT (id) DO NOTHING
                """).param("locker", BROKER_TEST_LOCKER).update();
        return awaitingLocalProof(user, BROKER_TEST_LOCKER, BROKER_LOCKER_ADDRESS.getAndIncrement(), at);
    }

    /** The same, in a new compartment at {@code address} of an existing {@code locker}. */
    Operation awaitingLocalProof(UUID user, UUID locker, int address, Instant at) {
        UUID asset = reservations.assetAt(locker, address);
        UUID reservation = reservations.reservation(asset, user, "ACTIVE", at.minusSeconds(60), at.plusSeconds(3600));
        return awaitingLocalProof(user, asset, locker, "CHECKOUT", reservation, null, at);
    }

    /** A return of an active loan waiting for its local proof, in a compartment of a new locker. */
    Operation returnAwaitingLocalProof(UUID user, Instant at) {
        UUID locker = reservations.locker();
        UUID asset = reservations.assetAt(locker, 1);
        UUID loan = reservations.loan(asset, user, at.minusSeconds(7200));
        return awaitingLocalProof(user, asset, locker, "RETURN", null, loan, at);
    }

    private Operation awaitingLocalProof(UUID user, UUID asset, UUID locker, String type, UUID reservation, UUID loan,
            Instant at) {
        Map<String, Object> placement = jdbc.sql("""
                SELECT c.id AS compartment, i.id AS identifier
                FROM aegis.asset_placements p
                JOIN aegis.compartments c ON c.id = p.compartment_id
                JOIN aegis.asset_identifiers i ON i.asset_id = p.asset_id AND i.active
                WHERE p.asset_id = :asset AND p.removed_at IS NULL
                """).param("asset", asset).query().singleRow();
        UUID compartment = (UUID) placement.get("compartment");
        UUID operation = jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, reservation_id, loan_id,
                     expected_asset_identifier_id, created_at)
                VALUES (:type, 'AWAITING_LOCAL_PROOF', :user, :asset, :locker, :compartment, :reservation, :loan,
                        :identifier, :at)
                RETURNING id
                """)
                .param("user", user).param("asset", asset).param("locker", locker).param("compartment", compartment)
                .param("type", type).param("reservation", reservation).param("loan", loan)
                .param("identifier", placement.get("identifier"))
                .param("at", utc(at)).query(UUID.class).single();
        UUID device = hub(locker);
        // The ingestion tests reprovision the broker test hub without a session; the target session is then arbitrary.
        UUID session = jdbc.sql("""
                SELECT COALESCE(device_session_id, public.gen_random_uuid()) FROM aegis.locker_devices WHERE id = :id
                """)
                .param("id", device).query(UUID.class).single();
        byte[] hash = new byte[32];
        RANDOM.nextBytes(hash);
        UUID challenge = jdbc.sql("""
                INSERT INTO aegis.local_access_challenges (operation_id, locker_id, locker_device_id,
                                                           target_device_session_id, token_hash, created_at,
                                                           expires_at, displayed_at)
                VALUES (:operation, :locker, :device, :session, :hash, :at, :expires, :at)
                RETURNING id
                """)
                .param("operation", operation).param("locker", locker).param("device", device)
                .param("session", session).param("hash", hash).param("at", utc(at))
                .param("expires", utc(at.plusSeconds(60))).query(UUID.class).single();
        return new Operation(operation, locker, compartment, challenge);
    }

    /** Another compartment of {@code locker}; a locker has at most one open operation at a time. */
    UUID compartment(UUID locker, int address) {
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                VALUES (:locker, :code, :address, :address)
                RETURNING id
                """).param("locker", locker).param("code", "X-" + UUID.randomUUID()).param("address", address)
                .query(UUID.class).single();
    }

    /**
     * The business decision of document 06, section 7 as LOC-02 will take it: the challenge is consumed and the
     * operation authorized at {@code at}, for the 120 seconds of {@code ck_locker_operations_expiration}.
     */
    void authorize(Operation operation, Instant at) {
        jdbc.sql("""
                UPDATE aegis.local_access_challenges
                SET status = 'CONSUMED', consumed_at = :at, closed_at = :at
                WHERE id = :id
                """).param("id", operation.challenge()).param("at", utc(at)).update();
        authorizeWithoutConsumingChallenge(operation, at);
    }

    void authorizeWithoutConsumingChallenge(Operation operation, Instant at) {
        jdbc.sql("""
                UPDATE aegis.locker_operations
                SET status = 'AUTHORIZED', authorized_at = :at, local_proof_validated_at = :at, expires_at = :expires
                WHERE id = :id
                """).param("id", operation.id()).param("at", utc(at)).param("expires", utc(at.plusSeconds(120)))
                .update();
    }

    /** Ends an authorized operation the way a concurrent failure would, before its command is published. */
    void fail(UUID operation, Instant at) {
        jdbc.sql("""
                UPDATE aegis.locker_operations SET status = 'FAILED', terminal_at = :at, failure_reason = 'TEST_FAILED'
                WHERE id = :id
                """).param("id", operation).param("at", utc(at)).update();
    }

    /**
     * Takes every still sendable command of earlier tests out of the dispatcher's reach: the claim reads the whole
     * table, and the shared test database keeps the rows of other test methods.
     */
    void retireEarlierCommands() {
        jdbc.sql("""
                UPDATE aegis.command_outbox SET status = 'CANCELLED', claim_until = NULL, last_error = 'TEST_RETIRED'
                WHERE status IN ('PENDING', 'CLAIMED')
                """).update();
    }

    /** Ends the operations earlier tests left open on the broker test locker, which has room for only one. */
    void retireOpenOperationsOnBrokerTestLocker() {
        jdbc.sql("""
                UPDATE aegis.locker_operations
                SET status = 'FAILED', terminal_at = created_at + interval '10 minutes', failure_reason = 'TEST_RETIRED'
                WHERE locker_id = :locker AND terminal_at IS NULL
                """).param("locker", BROKER_TEST_LOCKER).update();
    }

    /**
     * A command report as the ingestion stores it before applying it: a new event {@code messageId} from the hub of
     * the operation's locker, received at {@code at}. Returns the stored row's id.
     */
    UUID storeReport(Operation operation, UUID commandMessageId, String type, Instant at) {
        UUID device = hub(operation.locker());
        return jdbc.sql("""
                INSERT INTO aegis.inbound_device_messages
                    (locker_device_id, message_id, topic, message_type, operation_id, command_message_id,
                     schema_version, device_session_id, boot_count, sequence, occurred_at, received_at, raw_payload)
                VALUES (:device, :messageId, :topic, :type, :operation, :command, '3.0', :session, 1,
                        :sequence, :at, :at, :raw)
                RETURNING id
                """).param("device", device).param("messageId", UUID.randomUUID())
                .param("topic", "aegis/v1/lockers/" + operation.locker() + "/events").param("type", type)
                .param("operation", operation.id()).param("command", commandMessageId)
                .param("session", UUID.randomUUID()).param("sequence", REPORT_SEQUENCE.incrementAndGet())
                .param("at", utc(at)).param("raw", new byte[] {'{', '}'})
                .query(UUID.class).single();
    }

    Map<String, Object> command(UUID operation) {
        return jdbc.sql("""
                SELECT id, message_id, locker_id, compartment_id, command_type, topic, schema_version, issued_at,
                       expires_at, payload::text AS payload, status, attempt_count, next_attempt_at, claimed_at,
                       claim_until, published_at, acknowledged_at, last_error
                FROM aegis.command_outbox WHERE operation_id = :operation
                """).param("operation", operation).query().singleRow();
    }

    long commandCount(UUID operation) {
        return jdbc.sql("SELECT count(*) FROM aegis.command_outbox WHERE operation_id = :operation")
                .param("operation", operation).query(Long.class).single();
    }

    Map<String, Object> operation(UUID operation) {
        return jdbc.sql("""
                SELECT status, authorized_at, expires_at, command_sent_at, terminal_at, failure_reason
                FROM aegis.locker_operations WHERE id = :id
                """).param("id", operation).query().singleRow();
    }

    List<Map<String, Object>> audits(UUID operation) {
        return jdbc.sql("""
                SELECT event_type, subject_type, subject_id, from_state, to_state, result, reason,
                       details::text AS details, occurred_at
                FROM aegis.audit_events WHERE operation_id = :operation ORDER BY occurred_at, id
                """).param("operation", operation).query().listOfRows();
    }

    private UUID hub(UUID locker) {
        return jdbc.sql("SELECT id FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NULL")
                .param("locker", locker).query(UUID.class).optional()
                .orElseGet(() -> jdbc.sql("""
                        INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, device_session_id,
                                                          boot_count)
                        VALUES (:locker, :key, '0.1.0-test', :session, 1)
                        RETURNING id
                        """).param("locker", locker).param("key", "hub-" + UUID.randomUUID())
                        .param("session", UUID.randomUUID()).query(UUID.class).single());
    }

    static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    static Instant instant(Object timestamp) {
        return timestamp instanceof OffsetDateTime offset ? offset.toInstant()
                : ((java.sql.Timestamp) timestamp).toInstant();
    }

    record Operation(UUID id, UUID locker, UUID compartment, UUID challenge) {
    }
}
