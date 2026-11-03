package ca.aegis.control.asset;

import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

/** Lockers and compartments inserted directly: no route creates them in P0 (document 09 has none). */
final class PlacementFixtures {

    private PlacementFixtures() {
    }

    static UUID locker(JdbcClient jdbc, String code) {
        return jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Casier de test', 'HUB_CELL')
                RETURNING id
                """).param("code", code).query(UUID.class).single();
    }

    static UUID compartment(JdbcClient jdbc, UUID locker, String code, int port) {
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port)
                VALUES (:locker, :code, :port, :port)
                RETURNING id
                """).param("locker", locker).param("code", code).param("port", port).query(UUID.class).single();
    }
}
