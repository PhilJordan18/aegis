package ca.aegis.control.reservation;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Catalog, locker, schedule and custody rows inserted directly: lockers and loans have no creation route in P0, and
 * the reservation tests must not depend on the catalog routes they do not exercise.
 */
public final class ReservationFixtures {

    /** Every day open from 08:00 to 17:00 in Toronto: 12:00Z to 21:00Z on 28 September 2026 (EDT). */
    static final String OPENS_AT = "08:00";
    static final String CLOSES_AT = "17:00";
    /** Before every test clock, so that a revocation or a placement end at the test instant stays chronological. */
    static final Instant PAST = Instant.parse("2026-01-01T00:00:00Z");

    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcClient jdbc;
    private final String suffix = UUID.randomUUID().toString().substring(0, 8);
    private int sequence;

    public ReservationFixtures(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    UUID model() {
        return jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle réservation " + suffix + "-" + next()).query(UUID.class).single();
    }

    public UUID locker() {
        return jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier réservation', 'HUB_CELL')
                RETURNING id
                """).param("code", "R-" + suffix + "-" + next()).query(UUID.class).single();
    }

    /** A locker with every day open from {@link #OPENS_AT} to {@link #CLOSES_AT} in America/Toronto. */
    public UUID scheduledLocker(UUID creator) {
        UUID locker = locker();
        schedule(locker, creator, true);
        return locker;
    }

    public void schedule(UUID locker, UUID creator, boolean open) {
        UUID schedule = jdbc.sql("""
                INSERT INTO aegis.operating_schedules (locker_id, time_zone, created_by_user_id)
                VALUES (:locker, 'America/Toronto', :creator)
                RETURNING id
                """).param("locker", locker).param("creator", creator).query(UUID.class).single();
        for (int day = 1; day <= 7; day++) {
            jdbc.sql("""
                    INSERT INTO aegis.operating_windows (operating_schedule_id, day_of_week, enabled, opens_at, closes_at)
                    VALUES (:schedule, :day, :enabled, CAST(:opensAt AS time), CAST(:closesAt AS time))
                    """)
                    .param("schedule", schedule)
                    .param("day", day)
                    .param("enabled", open)
                    .param("opensAt", open ? OPENS_AT : null)
                    .param("closesAt", open ? CLOSES_AT : null)
                    .update();
        }
    }

    /** A serviceable asset without calibration, placed in a new compartment of {@code locker} when it is not null. */
    UUID asset(UUID locker) {
        return asset(locker, "STANDARD", "SERVICEABLE", false, null);
    }

    UUID asset(UUID locker, String requiredAccessLevel, String operationalStatus, boolean calibrationRequired,
            Instant calibrationDueAt) {
        int n = next();
        UUID asset = jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, operational_status,
                                          calibration_required, calibration_due_at)
                VALUES (:model, :code, :level, :status, :required, :due)
                RETURNING id
                """)
                .param("model", model())
                .param("code", "RES-" + suffix + "-" + n)
                .param("level", requiredAccessLevel)
                .param("status", operationalStatus)
                .param("required", calibrationRequired)
                .param("due", utc(calibrationDueAt))
                .query(UUID.class)
                .single();
        if (locker != null) {
            place(asset, locker, "C" + n, n);
        }
        jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:asset, 'RFID_UHF', :value, :past)
                """).param("asset", asset).param("value", "E2-" + suffix + "-" + n).param("past", utc(PAST)).update();
        return asset;
    }

    /** A serviceable asset placed in a new compartment of {@code locker} at {@code address}, also its hub port. */
    public UUID assetAt(UUID locker, int address) {
        UUID asset = asset(null);
        place(asset, locker, "T" + suffix + "-" + address, address);
        return asset;
    }

    private void place(UUID asset, UUID locker, String code, int address) {
        UUID compartment = jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                VALUES (:locker, :code, :port, :port)
                RETURNING id
                """).param("locker", locker).param("code", code).param("port", address).query(UUID.class).single();
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                VALUES (:asset, :compartment, 'Test', :past)
                """).param("asset", asset).param("compartment", compartment).param("past", utc(PAST)).update();
    }

    public UUID reservation(UUID asset, UUID user, String status, Instant from, Instant until) {
        String terminal = switch (status) {
            case "ACTIVE" -> "";
            case "FULFILLED" -> ", fulfilled_at";
            case "CANCELLED" -> ", cancelled_at";
            case "EXPIRED" -> ", expired_at";
            default -> throw new IllegalArgumentException(status);
        };
        return jdbc.sql("INSERT INTO aegis.reservations (asset_id, user_id, status, reserved_from, reserved_until, "
                + "created_at" + terminal + ") VALUES (:asset, :user, :status, :from, :until, :from"
                + (terminal.isEmpty() ? "" : ", :until") + ") RETURNING id")
                .param("asset", asset)
                .param("user", user)
                .param("status", status)
                .param("from", utc(from))
                .param("until", utc(until))
                .query(UUID.class)
                .single();
    }

    /** An open loan of {@code holder}, born from a confirmed checkout of a fulfilled reservation. */
    public UUID loan(UUID asset, UUID holder, Instant at) {
        UUID reservation = reservation(asset, holder, "FULFILLED", at, at.plusSeconds(3600));
        UUID checkout = checkout(asset, holder, reservation, "CONFIRMED", at);
        return jdbc.sql("""
                INSERT INTO aegis.loans (asset_id, holder_user_id, checkout_operation_id, status, checked_out_at,
                                         due_at)
                VALUES (:asset, :holder, :checkout, 'ACTIVE', :at, :due)
                RETURNING id
                """)
                .param("asset", asset).param("holder", holder).param("checkout", checkout)
                .param("at", utc(at.plusSeconds(60))).param("due", utc(at.plusSeconds(3600)))
                .query(UUID.class).single();
    }

    /** A checkout attempt: {@code CONFIRMED} with every milestone, or {@code REQUESTED}, still non-terminal. */
    UUID checkout(UUID asset, UUID user, UUID reservation, String status, Instant at) {
        return attempt(asset, user, reservation, status, status.equals("CONFIRMED"), at);
    }

    /**
     * A checkout attempt in {@code status}, created at {@code at}. An {@code authorized} attempt was authorized ten
     * seconds later and carries the milestones its status requires; {@code REQUESTED} and
     * {@code AWAITING_LOCAL_PROOF} never are; an authorized {@code ANOMALY} attempt had its command sent. A terminal
     * attempt ended a minute after creation.
     */
    public UUID attempt(UUID asset, UUID user, UUID reservation, String status, boolean authorized, Instant at) {
        boolean confirmed = status.equals("CONFIRMED");
        boolean terminal = List.of("CONFIRMED", "FAILED", "EXPIRED", "ANOMALY").contains(status);
        boolean sent = authorized && (confirmed || List.of("COMMAND_SENT", "ANOMALY").contains(status));
        Instant authorizedAt = authorized ? at.plusSeconds(10) : null;
        Instant sentAt = sent ? at.plusSeconds(11) : null;
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, reservation_id,
                     expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
                     command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at,
                     terminal_at, failure_reason)
                SELECT 'CHECKOUT', :status, :user, :asset, c.locker_id, c.id, :reservation, i.id,
                       :created, :authorized, :authorized, :expires, :sent, :opened, :opened, :observed, :confirmed,
                       :terminal, :reason
                FROM aegis.asset_placements p
                JOIN aegis.compartments c ON c.id = p.compartment_id
                JOIN aegis.asset_identifiers i ON i.asset_id = p.asset_id AND i.active
                WHERE p.asset_id = :asset AND p.removed_at IS NULL
                RETURNING id
                """)
                .param("status", status)
                .param("user", user)
                .param("asset", asset)
                .param("reservation", reservation)
                .param("created", utc(at))
                .param("authorized", utc(authorizedAt))
                .param("expires", authorized ? utc(authorizedAt.plusSeconds(120)) : null)
                .param("sent", utc(sentAt))
                .param("opened", sent ? utc(sentAt) : null)
                .param("observed", confirmed ? utc(sentAt) : null)
                .param("confirmed", confirmed ? utc(at.plusSeconds(60)) : null)
                .param("terminal", terminal ? utc(at.plusSeconds(60)) : null)
                .param("reason", terminal && !confirmed ? "TEST_" + status : null)
                .query(UUID.class)
                .single();
    }

    /**
     * The {@code PENDING} local challenge of {@code attempt}, created at {@code at} for the hub of the attempt's
     * locker, with the 60-second window of ADR-009. A {@code displayed} challenge was shown five seconds later.
     */
    UUID challenge(UUID attempt, Instant at, boolean displayed) {
        UUID locker = jdbc.sql("SELECT locker_id FROM aegis.locker_operations WHERE id = :id").param("id", attempt)
                .query(UUID.class).single();
        UUID device = hub(locker);
        UUID session = jdbc.sql("SELECT device_session_id FROM aegis.locker_devices WHERE id = :id")
                .param("id", device).query(UUID.class).single();
        byte[] hash = new byte[32];
        RANDOM.nextBytes(hash);
        return jdbc.sql("""
                INSERT INTO aegis.local_access_challenges (operation_id, locker_id, locker_device_id,
                                                           target_device_session_id, token_hash, created_at,
                                                           expires_at, displayed_at)
                VALUES (:operation, :locker, :device, :session, :hash, :created, :expires, :displayed)
                RETURNING id
                """)
                .param("operation", attempt).param("locker", locker).param("device", device)
                .param("session", session).param("hash", hash).param("created", utc(at))
                .param("expires", utc(at.plusSeconds(60)))
                .param("displayed", displayed ? utc(at.plusSeconds(5)) : null)
                .query(UUID.class).single();
    }

    /**
     * The encrypted display instruction of {@code challenge} in {@code status}: {@code CLAIMED} holds a lease, and
     * {@code ACKNOWLEDGED} was published and acknowledged. The payload is random bytes standing for the envelope.
     */
    UUID display(UUID challenge, String status, Instant at) {
        byte[] payload = new byte[64];
        RANDOM.nextBytes(payload);
        boolean published = status.equals("ACKNOWLEDGED") || status.equals("DISPATCHED");
        return jdbc.sql("""
                INSERT INTO aegis.hub_display_outbox (message_id, operation_id, locker_id, locker_device_id,
                    target_device_session_id, challenge_id, message_type, display_revision, topic, schema_version,
                    encrypted_payload, encryption_key_id, issued_at, expires_at, status, claim_until, published_at,
                    acknowledged_at)
                SELECT :message, c.operation_id, c.locker_id, c.locker_device_id, c.target_device_session_id, c.id,
                       'DISPLAY_ACCESS_CHALLENGE', :revision, 'aegis/v1/lockers/' || c.locker_id || '/display', '2.0',
                       :payload, 'display-key-test', c.created_at, c.expires_at, :status, :claim, :published,
                       :acknowledged
                FROM aegis.local_access_challenges c
                WHERE c.id = :challenge
                RETURNING id
                """)
                .param("message", UUID.randomUUID()).param("revision", (long) next()).param("payload", payload)
                .param("status", status)
                .param("claim", status.equals("CLAIMED") ? utc(at.plusSeconds(30)) : null)
                .param("published", published ? utc(at.plusSeconds(1)) : null)
                .param("acknowledged", status.equals("ACKNOWLEDGED") ? utc(at.plusSeconds(2)) : null)
                .param("challenge", challenge)
                .query(UUID.class).single();
    }

    /**
     * An anomaly of {@code attempt}, detected at {@code at}: {@code OPEN}, or {@code RESOLVED} a minute later by an
     * identifier detection that a new RFID scan of the attempt's locker recorded.
     */
    public UUID anomaly(UUID attempt, String status, Instant at) {
        UUID evidence = null;
        if (status.equals("RESOLVED")) {
            UUID device = hub(jdbc.sql("SELECT locker_id FROM aegis.locker_operations WHERE id = :id")
                    .param("id", attempt).query(UUID.class).single());
            UUID scan = jdbc.sql("""
                    INSERT INTO aegis.inbound_device_messages (locker_device_id, message_id, topic, message_type,
                        operation_id, schema_version, device_session_id, boot_count, sequence, occurred_at,
                        raw_payload, processing_status)
                    VALUES (:device, :message, 'aegis/v1/lockers/test/events', 'RFID_SCAN_COMPLETED', :id, '2.0',
                            :session, 1, 1, :at, :raw, 'PROCESSED')
                    RETURNING id
                    """).param("device", device).param("message", UUID.randomUUID()).param("id", attempt)
                    .param("session", UUID.randomUUID()).param("at", utc(at.plusSeconds(60)))
                    .param("raw", new byte[] {1}).query(UUID.class).single();
            evidence = jdbc.sql("""
                    INSERT INTO aegis.physical_observations (inbound_message_id, locker_id, compartment_id,
                                                             operation_id, type, observed_at, identifier_value)
                    SELECT :scan, o.locker_id, o.compartment_id, o.id, 'ASSET_IDENTIFIER_DETECTED', :at,
                           i.identifier_value
                    FROM aegis.locker_operations o
                    JOIN aegis.asset_identifiers i ON i.id = o.expected_asset_identifier_id
                    WHERE o.id = :id
                    RETURNING id
                    """).param("scan", scan).param("at", utc(at.plusSeconds(60))).param("id", attempt)
                    .query(UUID.class).single();
        }
        boolean resolved = evidence != null;
        return jdbc.sql("""
                INSERT INTO aegis.anomalies (type, severity, status, locker_operation_id, asset_id, compartment_id,
                                             detected_at, resolved_at, resolution_evidence_observation_id,
                                             resolution_note)
                SELECT 'EXPECTED_ASSET_NOT_OBSERVED', 'HIGH', :status, o.id, o.asset_id, o.compartment_id, :at,
                       :resolvedAt, :evidence, :note
                FROM aegis.locker_operations o
                WHERE o.id = :id
                RETURNING id
                """)
                .param("status", status).param("id", attempt).param("at", utc(at))
                .param("resolvedAt", resolved ? utc(at.plusSeconds(60)) : null)
                .param("evidence", evidence)
                .param("note", resolved ? "Actif détecté dans sa cellule" : null)
                .query(UUID.class).single();
    }

    /** The active hub of {@code locker}, provisioned with a session on first use. */
    UUID hub(UUID locker) {
        return jdbc.sql("SELECT id FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NULL")
                .param("locker", locker).query(UUID.class).optional()
                .orElseGet(() -> jdbc.sql("""
                        INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, device_session_id,
                                                          boot_count)
                        VALUES (:locker, :key, '0.1.0-test', :session, 1)
                        RETURNING id
                        """).param("locker", locker).param("key", "hub-" + suffix + "-" + next())
                        .param("session", UUID.randomUUID()).query(UUID.class).single());
    }

    public String operationStatus(UUID operation) {
        return jdbc.sql("SELECT status FROM aegis.locker_operations WHERE id = :id").param("id", operation)
                .query(String.class).single();
    }

    public String reservationStatus(UUID reservation) {
        return jdbc.sql("SELECT status FROM aegis.reservations WHERE id = :id").param("id", reservation)
                .query(String.class).single();
    }

    long count(String sql, UUID id) {
        return jdbc.sql(sql).param("id", id).query(Long.class).single();
    }

    private int next() {
        return ++sequence;
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
