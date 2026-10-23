package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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

    private List<String> cells() {
        return jdbc.sql("""
                SELECT id || ' ' || code || ' ' || local_address || ' ' || hub_port || ' ' || enabled
                FROM aegis.compartments WHERE locker_id = :locker ORDER BY code
                """).param("locker", DemoLockerProvisioner.LOCKER_ID).query(String.class).list();
    }
}
