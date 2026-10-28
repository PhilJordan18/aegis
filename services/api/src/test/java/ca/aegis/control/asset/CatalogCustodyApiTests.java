package ca.aegis.control.asset;

import static org.hamcrest.Matchers.contains;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Availability and readiness derived from stored reservations and loans (document 03, section 5.2; document 06,
 * section 4.4). No route creates them yet, so their rows are inserted directly, with valid foreign keys.
 */
class CatalogCustodyApiTests extends CatalogApiTest {

    static final String CATALOG = "/api/v1/assets";
    static final Instant CREATED = START.minus(Duration.ofDays(1));
    static final Instant AUTHORIZED = CREATED.plusSeconds(60);
    static final Instant CONFIRMED = AUTHORIZED.plusSeconds(30);

    TestAccount technician;
    String technicianToken;
    String asset;
    UUID identifier;
    UUID locker;
    UUID compartment;

    @BeforeEach
    void createPlacedAsset() throws Exception {
        technician = accounts.technician();
        technicianToken = accessToken(technician);
        asset = createAsset(createModel("Garde " + suffix), "G1-" + suffix);
        identifier = UUID.fromString(id(mvc.perform(asAdmin(withKey(json(post(ASSETS + "/" + asset + "/identifiers"),
                Map.of("type", "RFID_UHF", "value", "E200-" + suffix))))).andExpect(status().isCreated())));
        locker = PlacementFixtures.locker(jdbc, "G-" + suffix);
        compartment = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        mvc.perform(asAdmin(json(put(ASSETS + "/" + asset + "/placement"),
                Map.of("compartmentId", compartment, "reason", "Affectation")))).andExpect(status().isOk());
    }

    @Test
    void aReservationOfAnotherTechnicianMakesTheAssetReservedAndBlocked() throws Exception {
        reserve(accounts.technician().id(), "ACTIVE");

        expectBlockedAs(Availability.RESERVED, technicianToken);
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", "RESERVED")))
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[*].id").value(contains(asset)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", "AVAILABLE")))
                .andExpect(jsonPath("$.totalItems").value(0));
    }

    @Test
    void theHoldersOwnReservationIsBlockedOutsideItsCheckout() throws Exception {
        reserve(technician.id(), "ACTIVE");

        expectBlockedAs(Availability.RESERVED, technicianToken);
    }

    @Test
    void endedReservationsLeaveTheAssetAvailable() throws Exception {
        reserve(accounts.technician().id(), "CANCELLED");
        reserve(accounts.technician().id(), "EXPIRED");

        mvc.perform(asTechnician(get(CATALOG + "/" + asset)))
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.readiness.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")));
    }

    @Test
    void anActiveLoanMakesTheAssetBorrowed() throws Exception {
        lend(technician.id(), "ACTIVE", START.plus(Duration.ofHours(4)));

        expectBlockedAs(Availability.BORROWED, technicianToken);
        expectBlockedAs(Availability.BORROWED, accessToken(accounts.technician()));
    }

    @Test
    void aReturnPendingLoanKeepsTheAssetBorrowed() throws Exception {
        lend(accounts.technician().id(), "RETURN_PENDING", START.plus(Duration.ofHours(4)));

        expectBlockedAs(Availability.BORROWED, technicianToken);
    }

    @Test
    void aLateLoanNeverMakesTheAssetAvailable() throws Exception {
        lend(accounts.technician().id(), "ACTIVE", START.minus(Duration.ofHours(2)));

        expectBlockedAs(Availability.BORROWED, technicianToken);
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", "BORROWED")))
                .andExpect(jsonPath("$.totalItems").value(1));
    }

    @Test
    void aCompletedLoanFreesTheAsset() throws Exception {
        UUID holder = accounts.technician().id();
        UUID loan = lend(holder, "ACTIVE", START.plus(Duration.ofHours(4)));
        UUID returning = operation("RETURN", holder, null, loan);
        jdbc.sql("""
                UPDATE aegis.loans SET status = 'COMPLETED', return_requested_at = :at, returned_at = :at,
                       return_operation_id = :operation
                WHERE id = :id
                """).param("at", utc(CONFIRMED.plusSeconds(60))).param("operation", returning).param("id", loan)
                .update();

        mvc.perform(asTechnician(get(CATALOG + "/" + asset)))
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.readiness.result").value("UNKNOWN"));
    }

    private void expectBlockedAs(Availability availability, String token) throws Exception {
        mvc.perform(get(CATALOG + "/" + asset).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value(availability.name()))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("NOT_AVAILABLE")));
        mvc.perform(get(CATALOG).param("q", suffix).header(AUTHORIZATION, bearer(token)))
                .andExpect(jsonPath("$.items[0].availability").value(availability.name()))
                .andExpect(jsonPath("$.items[0].readiness.reasons").value(contains("NOT_AVAILABLE")));
    }

    UUID reserve(UUID user, String status) {
        String terminal = switch (status) {
            case "ACTIVE" -> null;
            case "FULFILLED" -> "fulfilled_at";
            case "CANCELLED" -> "cancelled_at";
            case "EXPIRED" -> "expired_at";
            default -> throw new IllegalArgumentException(status);
        };
        return jdbc.sql("""
                INSERT INTO aegis.reservations (asset_id, user_id, status, reserved_from, reserved_until, created_at
                """ + (terminal == null ? "" : ", " + terminal) + """
                ) VALUES (:asset, :user, :status, :from, :until, :created""" + (terminal == null ? "" : ", :created")
                + ") RETURNING id")
                .param("asset", UUID.fromString(asset))
                .param("user", user)
                .param("status", status)
                .param("from", utc(CREATED))
                .param("until", utc(CREATED.plus(Duration.ofHours(1))))
                .param("created", utc(CREATED))
                .query(UUID.class)
                .single();
    }

    /** A loan created by a confirmed checkout of a fulfilled reservation of {@code holder}. */
    UUID lend(UUID holder, String status, Instant dueAt) {
        UUID reservation = reserve(holder, "FULFILLED");
        UUID checkout = operation("CHECKOUT", holder, reservation, null);
        return jdbc.sql("""
                INSERT INTO aegis.loans (asset_id, holder_user_id, checkout_operation_id, status, checked_out_at,
                                         due_at, return_requested_at)
                VALUES (:asset, :holder, :checkout, :status, :checkedOut, :due, :returnRequested)
                RETURNING id
                """)
                .param("asset", UUID.fromString(asset))
                .param("holder", holder)
                .param("checkout", checkout)
                .param("status", status)
                .param("checkedOut", utc(CONFIRMED))
                .param("due", utc(dueAt))
                .param("returnRequested", status.equals("RETURN_PENDING") ? utc(CONFIRMED.plusSeconds(60)) : null)
                .query(UUID.class)
                .single();
    }

    /** A {@code CONFIRMED} operation with every milestone of the nominal path. */
    UUID operation(String type, UUID user, UUID reservation, UUID loan) {
        return jdbc.sql("""
                INSERT INTO aegis.locker_operations
                    (type, status, user_id, asset_id, locker_id, compartment_id, reservation_id, loan_id,
                     expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
                     command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at,
                     terminal_at)
                VALUES (:type, 'CONFIRMED', :user, :asset, :locker, :compartment, :reservation, :loan, :identifier,
                        :created, :authorized, :authorized, :expires, :authorized, :authorized, :authorized,
                        :authorized, :confirmed, :confirmed)
                RETURNING id
                """)
                .param("type", type)
                .param("user", user)
                .param("asset", UUID.fromString(asset))
                .param("locker", locker)
                .param("compartment", compartment)
                .param("reservation", reservation)
                .param("loan", loan)
                .param("identifier", identifier)
                .param("created", utc(CREATED))
                .param("authorized", utc(AUTHORIZED))
                .param("expires", utc(AUTHORIZED.plusSeconds(120)))
                .param("confirmed", utc(CONFIRMED))
                .query(UUID.class)
                .single();
    }

    MockHttpServletRequestBuilder asTechnician(MockHttpServletRequestBuilder request) {
        return request.header(AUTHORIZATION, bearer(technicianToken));
    }

    static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
