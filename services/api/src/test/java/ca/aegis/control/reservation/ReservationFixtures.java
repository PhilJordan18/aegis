package ca.aegis.control.reservation;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Catalog, locker, schedule and custody rows inserted directly: lockers and loans have no creation route in P0, and
 * the reservation tests must not depend on the catalog routes they do not exercise.
 */
final class ReservationFixtures {

    /** Every day open from 08:00 to 17:00 in Toronto: 12:00Z to 21:00Z on 28 September 2026 (EDT). */
    static final String OPENS_AT = "08:00";
    static final String CLOSES_AT = "17:00";
    /** Before every test clock, so that a revocation or a placement end at the test instant stays chronological. */
    static final Instant PAST = Instant.parse("2026-01-01T00:00:00Z");

    private final JdbcClient jdbc;
    private final String suffix = UUID.randomUUID().toString().substring(0, 8);
    private int sequence;

    ReservationFixtures(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    UUID model() {
        return jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle réservation " + suffix + "-" + next()).query(UUID.class).single();
    }

    UUID locker() {
        return jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier réservation', 'HUB_CELL')
                RETURNING id
                """).param("code", "R-" + suffix + "-" + next()).query(UUID.class).single();
    }

    /** A locker with every day open from {@link #OPENS_AT} to {@link #CLOSES_AT} in America/Toronto. */
    UUID scheduledLocker(UUID creator) {
        UUID locker = locker();
        schedule(locker, creator, true);
        return locker;
    }

    void schedule(UUID locker, UUID creator, boolean open) {
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
            UUID compartment = jdbc.sql("""
                    INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                    VALUES (:locker, :code, :port, :port)
                    RETURNING id
                    """).param("locker", locker).param("code", "C" + n).param("port", n).query(UUID.class).single();
            jdbc.sql("""
                    INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at)
                    VALUES (:asset, :compartment, 'Test', :past)
                    """).param("asset", asset).param("compartment", compartment).param("past", utc(PAST)).update();
        }
        jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:asset, 'RFID_UHF', :value, :past)
                """).param("asset", asset).param("value", "E2-" + suffix + "-" + n).param("past", utc(PAST)).update();
        return asset;
    }

    UUID reservation(UUID asset, UUID user, String status, Instant from, Instant until) {
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
    UUID loan(UUID asset, UUID holder, Instant at) {
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
        boolean confirmed = status.equals("CONFIRMED");
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, reservation_id,
                     expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
                     command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at,
                     terminal_at)
                SELECT 'CHECKOUT', :status, :user, :asset, c.locker_id, c.id, :reservation, i.id,
                       :created, :authorized, :authorized, :expires, :authorized, :authorized, :authorized,
                       :authorized, :confirmed, :confirmed
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
                .param("authorized", confirmed ? utc(at.plusSeconds(10)) : null)
                .param("expires", confirmed ? utc(at.plusSeconds(130)) : null)
                .param("confirmed", confirmed ? utc(at.plusSeconds(60)) : null)
                .query(UUID.class)
                .single();
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
