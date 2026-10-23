package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.JsonNode;

/**
 * Document 09, section 12.4: the expected placement of an asset, its history and its audit. Each test creates its
 * own locker, because the database is shared by the whole run.
 */
class AssetPlacementApiTests extends CatalogApiTest {

    String lockerCode;
    UUID locker;
    UUID first;
    UUID second;

    @BeforeEach
    void createLocker() {
        lockerCode = "T-" + suffix;
        locker = PlacementFixtures.locker(jdbc, lockerCode);
        first = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        second = PlacementFixtures.compartment(jdbc, locker, "A2", 2);
    }

    @Test
    void aFirstPlacementIsReturnedShownOnTheAssetAndAuditedOnce() throws Exception {
        String asset = createAsset(createModel("Placement " + suffix), "PL-" + suffix);

        String id = id(place(asset, body(first, "  Affectation initiale ")).andExpect(status().isOk())
                .andExpect(jsonPath("$.assetId").value(asset))
                .andExpect(jsonPath("$.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.lockerCode").value(lockerCode))
                .andExpect(jsonPath("$.compartmentId").value(first.toString()))
                .andExpect(jsonPath("$.compartmentCode").value("A1"))
                .andExpect(jsonPath("$.assignedAt").value(START.toString()))
                .andExpect(jsonPath("$.reason").value("Affectation initiale")));
        mvc.perform(asAdmin(get(ASSETS + "/" + asset)))
                .andExpect(jsonPath("$.placement.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.placement.lockerCode").value(lockerCode))
                .andExpect(jsonPath("$.placement.compartmentId").value(first.toString()))
                .andExpect(jsonPath("$.placement.compartmentCode").value("A1"));
        clock.advance(Duration.ofMinutes(1));
        place(asset, body(first, "Autre motif")).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.reason").value("Affectation initiale"));

        List<JsonNode> events = events(asset);
        assertEquals(1, events.size());
        assertEquals(true, events.getFirst().get("from").isNull());
        assertEquals(snapshot(id, first, "A1", START.toString(), "Affectation initiale"),
                events.getFirst().get("to"));
        assertEquals(List.of("ASSET_PLACEMENT_CHANGED ACCEPTED " + admin.id() + " " + START), eventHeads(asset));
    }

    @Test
    void aMoveEndsThePreviousPlacementKeepsItAndFreesTheCompartment() throws Exception {
        String model = createModel("Déplacement " + suffix);
        String asset = createAsset(model, "MV-" + suffix);
        String other = createAsset(model, "MV-OTHER-" + suffix);
        String initial = id(place(asset, body(first, "Initial")));
        clock.advance(Duration.ofMinutes(3));
        String movedAt = START.plus(Duration.ofMinutes(3)).toString();

        String moved = id(place(asset, body(second, "Cellule réparée")).andExpect(status().isOk())
                .andExpect(jsonPath("$.compartmentId").value(second.toString()))
                .andExpect(jsonPath("$.assignedAt").value(movedAt)));
        place(other, body(first, "Cellule libérée")).andExpect(status().isOk());

        assertEquals(List.of(initial + " " + first + " " + movedAt, moved + " " + second + " null"),
                history(asset));
        List<JsonNode> events = events(asset);
        assertEquals(2, events.size());
        assertEquals(snapshot(initial, first, "A1", START.toString(), "Initial"), events.get(1).get("from"));
        assertEquals(snapshot(moved, second, "A2", movedAt, "Cellule réparée"), events.get(1).get("to"));
    }

    @Test
    void refusedPlacementsChangeNothingAndWriteNoEvent() throws Exception {
        String model = createModel("Refus placement " + suffix);
        String asset = createAsset(model, "RPL-" + suffix);
        String holder = createAsset(model, "RPL-HOLD-" + suffix);
        String archived = createAsset(model, "RPL-ARCH-" + suffix);
        archiveAsset(archived).andExpect(status().isOk());
        place(holder, body(first, "Occupant")).andExpect(status().isOk());
        UUID disabled = PlacementFixtures.compartment(jdbc, locker, "A3", 3);
        jdbc.sql("UPDATE aegis.compartments SET enabled = false WHERE id = :id").param("id", disabled).update();
        long events = totalEvents();
        long placements = totalPlacements();

        place(asset, body(first, "Doublon")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMPARTMENT_ALREADY_OCCUPIED"));
        place(asset, body(disabled, "Désactivé")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMPARTMENT_DISABLED"));
        place(asset, body(UUID.randomUUID(), "Inconnu")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations[0].field").value("compartmentId"))
                .andExpect(jsonPath("$.violations[0].code").value("COMPARTMENT_NOT_FOUND"));
        place(archived, body(second, "Archivé")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_ARCHIVED"));
        place(UUID.randomUUID().toString(), body(second, "Inconnu")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        place(asset, body(second, " ")).andExpect(status().isBadRequest());
        place(asset, body(second, "x".repeat(501))).andExpect(status().isBadRequest());
        place(asset, body(null, "Sans compartiment")).andExpect(status().isBadRequest());
        Map<String, Object> extra = body(second, "Champ inconnu");
        extra.put("lockerId", locker.toString());
        place(asset, extra).andExpect(status().isBadRequest());

        assertEquals(events, totalEvents());
        assertEquals(placements, totalPlacements());
    }

    @Test
    void techniciansCannotPlaceAnAsset() throws Exception {
        String asset = createAsset(createModel("Rôle placement " + suffix), "RPT-" + suffix);

        mvc.perform(json(put(placement(asset)), body(first, "Technicien"))
                .header(AUTHORIZATION, bearer(accessToken(accounts.technician()))))
                .andExpect(status().isForbidden());
        assertEquals(List.of(), history(asset));
    }

    static Map<String, Object> body(UUID compartment, String reason) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("compartmentId", compartment == null ? null : compartment.toString());
        body.put("reason", reason);
        return body;
    }

    static String placement(String asset) {
        return ASSETS + "/" + asset + "/placement";
    }

    ResultActions place(String asset, Object body) throws Exception {
        return mvc.perform(asAdmin(json(put(placement(asset)), body)));
    }

    private JsonNode snapshot(String id, UUID compartment, String compartmentCode, String assignedAt, String reason) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("placementId", id);
        fields.put("lockerId", locker.toString());
        fields.put("lockerCode", lockerCode);
        fields.put("compartmentId", compartment.toString());
        fields.put("compartmentCode", compartmentCode);
        fields.put("assignedAt", assignedAt);
        fields.put("reason", reason);
        return jsonMapper.valueToTree(fields);
    }

    private List<String> history(String asset) {
        return jdbc.sql("""
                SELECT id || ' ' || compartment_id || ' '
                       || coalesce(to_char(removed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'null')
                FROM aegis.asset_placements WHERE asset_id = :id ORDER BY assigned_at
                """).param("id", UUID.fromString(asset)).query(String.class).list();
    }

    private List<JsonNode> events(String asset) {
        return jdbc.sql("""
                SELECT details::text FROM aegis.audit_events
                WHERE event_type = 'ASSET_PLACEMENT_CHANGED' AND subject_type = 'ASSET' AND subject_id = :id
                ORDER BY occurred_at
                """).param("id", UUID.fromString(asset)).query(String.class).list().stream()
                .map(jsonMapper::readTree).toList();
    }

    private List<String> eventHeads(String asset) {
        return jdbc.sql("""
                SELECT event_type || ' ' || result || ' ' || actor_user_id || ' '
                       || to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                FROM aegis.audit_events
                WHERE event_type = 'ASSET_PLACEMENT_CHANGED' AND subject_id = :id ORDER BY occurred_at
                """).param("id", UUID.fromString(asset)).query(String.class).list();
    }

    private long totalEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    private long totalPlacements() {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_placements").query(Long.class).single();
    }
}
