package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import ca.aegis.control.support.ApiIntegrationTest;

/** Document 08, section 11.4: the demonstration locker and its two cells, with the documented identifiers. */
class DemoLockerProvisioningTests extends ApiIntegrationTest {

    @DynamicPropertySource
    static void demoLocker(DynamicPropertyRegistry registry) {
        registry.add("aegis.lockers.demo-locker.enabled", () -> "true");
    }

    @Autowired
    DemoLockerProvisioner provisioner;

    @Autowired
    JdbcClient jdbc;

    @Test
    void theDemoLockerAndItsCellsAreCreatedAtStartup() {
        assertEquals(Map.of("code", "AEGIS-DEMO-01", "topology", "HUB_CELL", "status", "UNKNOWN"), jdbc.sql("""
                SELECT code, topology, status FROM aegis.lockers WHERE id = :id
                """).param("id", DemoLockerProvisioner.LOCKER_ID).query().singleRow());
        assertEquals(List.of(
                "1ae77ae3-8490-4f09-9412-a7816b77bff9 A1 1 1 true",
                "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10 A2 2 2 true"), cells());
    }

    @Test
    void provisioningAgainKeepsTheRowsAndAnAdministratorsChange() {
        jdbc.sql("UPDATE aegis.compartments SET enabled = false WHERE code = 'A2' AND locker_id = :locker")
                .param("locker", DemoLockerProvisioner.LOCKER_ID).update();
        try {
            provisioner.provision();

            assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.lockers WHERE lower(code) = 'aegis-demo-01'")
                    .query(Long.class).single());
            assertEquals(List.of(
                    "1ae77ae3-8490-4f09-9412-a7816b77bff9 A1 1 1 true",
                    "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10 A2 2 2 false"), cells());
        } finally {
            jdbc.sql("UPDATE aegis.compartments SET enabled = true WHERE code = 'A2' AND locker_id = :locker")
                    .param("locker", DemoLockerProvisioner.LOCKER_ID).update();
        }
    }

    @Test
    void anAssetCanBePlacedInTheDemoCellA1() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UUID model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Démo " + suffix).query(UUID.class).single();
        UUID asset = jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, calibration_required)
                VALUES (:model, :code, 'STANDARD', false) RETURNING id
                """).param("model", model).param("code", "DEMO-" + suffix).query(UUID.class).single();

        mvc.perform(put("/api/v1/admin/assets/" + asset + "/placement")
                .header(AUTHORIZATION, bearer(accessToken(accounts.admin())))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
                         "reason": "Affectation initiale pour la démonstration"}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lockerId").value(DemoLockerProvisioner.LOCKER_ID.toString()))
                .andExpect(jsonPath("$.lockerCode").value("AEGIS-DEMO-01"))
                .andExpect(jsonPath("$.compartmentCode").value("A1"));
    }

    private List<String> cells() {
        return jdbc.sql("""
                SELECT id || ' ' || code || ' ' || local_address || ' ' || hub_port || ' ' || enabled
                FROM aegis.compartments WHERE locker_id = :locker ORDER BY code
                """).param("locker", DemoLockerProvisioner.LOCKER_ID).query(String.class).list();
    }
}
