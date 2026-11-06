package ca.aegis.control.reservation;

import static ca.aegis.control.reservation.ReservationApiTests.expectProblem;
import static ca.aegis.control.reservation.ReservationApiTests.key;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Document 09, sections 12.3 and 12.4: a placement change is refused while the asset is reserved, borrowed or in a
 * non-terminal locker operation, an identifier assignment while it is in such an operation and the revocation of
 * the identifier that operation expects, with the codes of the archival (section 12.2). A refusal changes no row and writes no audit event; terminal custody blocks nothing.
 */
class CatalogCustodyGuardApiTests extends ApiIntegrationTest {

    private static final String ASSETS = "/api/v1/admin/assets/";

    @Autowired
    JdbcClient jdbc;

    ReservationFixtures fixtures;
    String admin;
    UUID locker;
    UUID holder;

    @BeforeEach
    void prepare() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        admin = accessToken(accounts.admin());
        locker = fixtures.scheduledLocker(accounts.admin().id());
        holder = accounts.technician().id();
    }

    @Test
    void aPlacementChangeIsRefusedWhileTheAssetIsReservedBorrowedOrInOperation() throws Exception {
        UUID reserved = fixtures.asset(locker);
        fixtures.reservation(reserved, holder, "ACTIVE", START.minusSeconds(60), START.plusSeconds(3600));
        UUID borrowed = fixtures.asset(locker);
        fixtures.loan(borrowed, accounts.technician().id(), START.minusSeconds(3600));
        UUID inOperation = inOperation("REQUESTED");

        UUID free = freeCompartment();
        expectProblem(place(reserved, free), 409, "ASSET_ALREADY_RESERVED");
        expectProblem(place(borrowed, free), 409, "ASSET_HAS_OPEN_LOAN");
        expectProblem(place(inOperation, free), 409, "ASSET_OPERATION_IN_PROGRESS");

        for (UUID asset : new UUID[] {reserved, borrowed, inOperation}) {
            assertEquals(1L, fixtures.count("""
                    SELECT count(*) FROM aegis.asset_placements WHERE asset_id = :id AND removed_at IS NULL
                      AND compartment_id <> '%s'
                    """.formatted(free), asset));
            assertEquals(0L, fixtures.count("""
                    SELECT count(*) FROM aegis.audit_events WHERE event_type = 'ASSET_PLACEMENT_CHANGED'
                      AND subject_id = :id
                    """, asset));
        }
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.asset_placements WHERE compartment_id = :id
                """, free));

        // Placing an asset where it already is changes nothing, so the guard does not apply.
        place(reserved, currentCompartment(reserved)).andExpect(status().isOk());
    }

    @Test
    void anIdentifierChangeIsRefusedWhileTheAssetIsInOperation() throws Exception {
        UUID asset = inOperation("AWAITING_LOCAL_PROOF");
        UUID rfid = activeRfid(asset);
        String refusedKey = key();

        expectProblem(assign(asset, "NFC", "NFC-" + UUID.randomUUID(), refusedKey), 409,
                "ASSET_OPERATION_IN_PROGRESS");
        expectProblem(assign(asset, "RFID_UHF", "E2-" + UUID.randomUUID()), 409, "ASSET_OPERATION_IN_PROGRESS");
        // The operation expects this tag as its physical proof.
        expectProblem(revoke(asset, rfid), 409, "ASSET_OPERATION_IN_PROGRESS");

        assertEquals(1L, fixtures.count("SELECT count(*) FROM aegis.asset_identifiers WHERE asset_id = :id", asset));
        assertEquals(1L, fixtures.count("""
                SELECT count(*) FROM aegis.asset_identifiers WHERE id = :id AND active AND revoked_at IS NULL
                """, rfid));
        assertEquals(0L, fixtures.count("""
                SELECT count(*) FROM aegis.audit_events
                WHERE subject_id IN (SELECT id FROM aegis.asset_identifiers WHERE asset_id = :id)
                """, asset));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys WHERE idempotency_key = :key")
                .param("key", refusedKey).query(Long.class).single());
    }

    @Test
    void anotherIdentifierOfTheAssetStaysRevocableDuringAnOperation() throws Exception {
        UUID asset = inOperation("REQUESTED");
        UUID nfc = identifier(asset, true);

        revoke(asset, nfc).andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        expectProblem(revoke(asset, activeRfid(asset)), 409, "ASSET_OPERATION_IN_PROGRESS");
    }

    @Test
    void anAlreadyRevokedIdentifierStaysRevocableDuringAnOperation() throws Exception {
        UUID asset = inOperation("REQUESTED");
        UUID revoked = identifier(asset, false);

        revoke(asset, revoked).andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void terminalCustodyAndAReservationAloneLeaveIdentifiersAndPlacementChangeable() throws Exception {
        UUID ended = inOperation("FAILED");
        fixtures.reservation(ended, holder, "CANCELLED", START.minusSeconds(3600), START.minusSeconds(30));
        place(ended, freeCompartment()).andExpect(status().isOk());
        revoke(ended, activeRfid(ended)).andExpect(status().isOk());

        UUID reserved = fixtures.asset(locker);
        fixtures.reservation(reserved, holder, "ACTIVE", START.minusSeconds(60), START.plusSeconds(3600));
        assign(reserved, "NFC", "NFC-" + UUID.randomUUID()).andExpect(status().isCreated());
    }

    /** A placed asset with a checkout attempt in {@code status}, started from an earlier, expired reservation. */
    private UUID inOperation(String status) {
        UUID asset = fixtures.asset(locker);
        UUID expired = fixtures.reservation(asset, holder, "EXPIRED", START.minusSeconds(3600),
                START.minusSeconds(60));
        fixtures.checkout(asset, holder, expired, status, START.minusSeconds(120));
        return asset;
    }

    /** An NFC identifier of {@code asset}, active or already revoked, assigned before the test clock. */
    private UUID identifier(UUID asset, boolean active) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, active,
                                                     assigned_at, revoked_at)
                VALUES (:asset, 'NFC', :value, :active, :past, CASE WHEN :active THEN NULL ELSE :past END)
                RETURNING id
                """).param("asset", asset).param("value", "NFC-" + UUID.randomUUID()).param("active", active)
                .param("past", ReservationFixtures.utc(ReservationFixtures.PAST)).query(UUID.class).single();
    }

    private UUID freeCompartment() {
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                SELECT :locker, 'F' || (count(*) + 1), 100 + count(*), 100 + count(*)
                FROM aegis.compartments WHERE locker_id = :locker
                RETURNING id
                """).param("locker", locker).query(UUID.class).single();
    }

    private UUID currentCompartment(UUID asset) {
        return jdbc.sql("SELECT compartment_id FROM aegis.asset_placements WHERE asset_id = :id AND removed_at IS NULL")
                .param("id", asset).query(UUID.class).single();
    }

    private UUID activeRfid(UUID asset) {
        return jdbc.sql("""
                SELECT id FROM aegis.asset_identifiers WHERE asset_id = :id AND identifier_type = 'RFID_UHF' AND active
                """).param("id", asset).query(UUID.class).single();
    }

    private ResultActions place(UUID asset, UUID compartment) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("compartmentId", compartment.toString());
        body.put("reason", "Réaffectation");
        return mvc.perform(put(ASSETS + asset + "/placement").header(AUTHORIZATION, bearer(admin))
                .contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(body)));
    }

    private ResultActions assign(UUID asset, String type, String value) throws Exception {
        return assign(asset, type, value, key());
    }

    private ResultActions assign(UUID asset, String type, String value, String idempotencyKey) throws Exception {
        return mvc.perform(post(ASSETS + asset + "/identifiers").header(AUTHORIZATION, bearer(admin))
                .header("Idempotency-Key", idempotencyKey).contentType(MediaType.APPLICATION_JSON)
                .content(jsonMapper.writeValueAsString(Map.of("type", type, "value", value))));
    }

    private ResultActions revoke(UUID asset, UUID identifier) throws Exception {
        return mvc.perform(post(ASSETS + asset + "/identifiers/" + identifier + "/revoke")
                .header(AUTHORIZATION, bearer(admin)).header("Idempotency-Key", key()));
    }
}
