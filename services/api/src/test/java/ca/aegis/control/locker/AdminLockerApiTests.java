package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * {@code GET /admin/lockers} (document 09, section 16.2, approved on 6 November 2026): administrators only, the page
 * envelope of section 11.1, lockers and compartments by code without case then id, and the occupancy of the active
 * placement only. Other test classes share the database, so assertions look at this class's own lockers.
 */
class AdminLockerApiTests extends ApiIntegrationTest {

    private static final String LOCKERS = "/api/v1/admin/lockers";
    private static final OffsetDateTime PAST = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @Autowired
    JdbcClient jdbc;

    String admin;
    String prefix;

    @BeforeEach
    void prepare() throws Exception {
        admin = accessToken(accounts.admin());
        prefix = "ADM-" + UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    void lockersAndCompartmentsAreOrderedByCodeWithoutCaseThenIdWithTheirCurrentAsset() throws Exception {
        UUID second = locker(prefix + "-b", "MONOLITHIC");
        UUID first = locker(prefix.toLowerCase() + "-A", "HUB_CELL");
        UUID a2 = compartment(first, "a2", 2, true);
        UUID a1 = compartment(first, "A1", 1, false);
        UUID b10 = compartment(first, "B10", 3, true);
        UUID occupant = asset(prefix + "-OCC");
        UUID former = asset(prefix + "-OLD");
        placement(occupant, a2, null);
        placement(former, a1, Instant.parse("2026-02-01T00:00:00Z"));

        List<Map<String, Object>> mine = allPagesOf(prefix);
        assertEquals(List.of(first.toString(), second.toString()), mine.stream().map(l -> l.get("id")).toList());

        Map<String, Object> view = mine.getFirst();
        assertEquals("HUB_CELL", view.get("topology"));
        assertEquals("Casier " + prefix.toLowerCase() + "-A", view.get("name"));
        List<Map<String, Object>> cells = compartments(view);
        assertEquals(List.of(a1.toString(), a2.toString(), b10.toString()), cells.stream().map(c -> c.get("id")).toList());
        assertEquals(false, cells.get(0).get("enabled"));
        // A removed placement leaves the compartment free; only the active one is the occupancy.
        assertNull(cells.get(0).get("currentAsset"));
        assertEquals(Map.of("id", occupant.toString(), "assetCode", prefix + "-OCC"), cells.get(1).get("currentAsset"));
        assertNull(cells.get(2).get("currentAsset"));
        assertTrue(compartments(mine.get(1)).isEmpty());
    }

    @Test
    void anArchivedOccupantStaysVisibleOnlyWhileItsPlacementIsActive() throws Exception {
        UUID locker = locker(prefix, "HUB_CELL");
        UUID cell = compartment(locker, "C1", 1, true);
        UUID asset = asset(prefix + "-ARCH");
        placement(asset, cell, null);
        jdbc.sql("UPDATE aegis.assets SET archived_at = :at WHERE id = :id").param("at", PAST).param("id", asset)
                .update();

        assertEquals(asset.toString(), currentAssetId(allPagesOf(prefix).getFirst()));
    }

    @Test
    void thePageEnvelopeAndItsParametersFollowSection11() throws Exception {
        locker(prefix + "-1", "HUB_CELL");
        locker(prefix + "-2", "HUB_CELL");
        long total = jdbc.sql("SELECT count(*) FROM aegis.lockers").query(Long.class).single();

        mvc.perform(get(LOCKERS).header(AUTHORIZATION, bearer(admin)).param("size", "1").param("page", "0")
                        .param("unknown", "ignored"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(1))
                .andExpect(jsonPath("$.totalItems").value(total))
                .andExpect(jsonPath("$.totalPages").value(total))
                .andExpect(jsonPath("$.items.length()").value(1));
        mvc.perform(get(LOCKERS).header(AUTHORIZATION, bearer(admin)).param("page", String.valueOf(total)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        for (String[] invalid : new String[][] {{"size", "0"}, {"size", "101"}, {"page", "-1"}, {"page", "x"}}) {
            mvc.perform(get(LOCKERS).header(AUTHORIZATION, bearer(admin)).param(invalid[0], invalid[1]))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.violations[0].field").value(invalid[0]))
                    .andExpect(jsonPath("$.violations[0].code").value("INVALID_VALUE"));
        }
    }

    @Test
    void onlyAnAdministratorReadsTheLockers() throws Exception {
        mvc.perform(get(LOCKERS)).andExpect(status().isUnauthorized());
        mvc.perform(get(LOCKERS).header(AUTHORIZATION, bearer(accessToken(accounts.technician()))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    private List<Map<String, Object>> allPagesOf(String codePrefix) throws Exception {
        List<Map<String, Object>> mine = new ArrayList<>();
        for (int page = 0; ; page++) {
            String body = mvc.perform(get(LOCKERS).header(AUTHORIZATION, bearer(admin))
                            .param("size", "100").param("page", String.valueOf(page)))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
            List<Map<String, Object>> items = JsonPath.read(body, "$.items");
            for (Map<String, Object> item : items) {
                if (((String) item.get("code")).toLowerCase().startsWith(codePrefix.toLowerCase())) {
                    mine.add(item);
                }
            }
            if (page + 1 >= ((Number) JsonPath.read(body, "$.totalPages")).intValue()) {
                return mine;
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> compartments(Map<String, Object> locker) {
        return (List<Map<String, Object>>) locker.get("compartments");
    }

    @SuppressWarnings("unchecked")
    private static String currentAssetId(Map<String, Object> locker) {
        return (String) ((Map<String, Object>) compartments(locker).getFirst().get("currentAsset")).get("id");
    }

    private UUID locker(String code, String topology) {
        return jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier ' || :code, :topology)
                RETURNING id
                """).param("code", code).param("topology", topology).query(UUID.class).single();
    }

    private UUID compartment(UUID locker, String code, int address, boolean enabled) {
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port, enabled)
                VALUES (:locker, :code, :address, :address, :enabled)
                RETURNING id
                """).param("locker", locker).param("code", code).param("address", address)
                .param("enabled", enabled).query(UUID.class).single();
    }

    private UUID asset(String code) {
        UUID model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle " + code).query(UUID.class).single();
        return jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, operational_status,
                                          calibration_required)
                VALUES (:model, :code, 'STANDARD', 'SERVICEABLE', false)
                RETURNING id
                """).param("model", model).param("code", code).query(UUID.class).single();
    }

    private void placement(UUID asset, UUID compartment, Instant removedAt) {
        jdbc.sql("""
                INSERT INTO aegis.asset_placements (asset_id, compartment_id, reason, assigned_at, removed_at)
                VALUES (:asset, :compartment, 'Test', :past, :removed)
                """).param("asset", asset).param("compartment", compartment).param("past", PAST)
                .param("removed", removedAt == null ? null : OffsetDateTime.ofInstant(removedAt, ZoneOffset.UTC))
                .update();
    }
}
