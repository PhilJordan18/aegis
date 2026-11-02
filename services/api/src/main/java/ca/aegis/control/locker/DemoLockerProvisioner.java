package ca.aegis.control.locker;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Creates the single demonstration locker of document 03, section 4.6, and its two cells when explicitly enabled
 * ({@code AEGIS_DEMO_LOCKER_ENABLED=true}). The identifiers are the ones documents 09 and 10 and the hub simulator
 * use, and the ports and addresses are those of document 12. Re-running is idempotent: a missing row is created and
 * an existing one is never altered, so an administrator's change survives a restart.
 */
@Component
@ConditionalOnProperty(prefix = "aegis.lockers.demo-locker", name = "enabled", havingValue = "true")
class DemoLockerProvisioner implements ApplicationRunner {

    static final UUID LOCKER_ID = UUID.fromString("d46a74ae-39dc-460b-8af0-38fc791b376a");
    static final String LOCKER_CODE = "AEGIS-DEMO-01";
    static final List<DemoCell> CELLS = List.of(
            new DemoCell(UUID.fromString("1ae77ae3-8490-4f09-9412-a7816b77bff9"), "A1", 1, 1),
            new DemoCell(UUID.fromString("5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10"), "A2", 2, 2));

    private static final Logger log = LoggerFactory.getLogger(DemoLockerProvisioner.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;

    DemoLockerProvisioner(JdbcClient jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        provision();
    }

    void provision() {
        transactions.executeWithoutResult(status -> {
            // ON CONFLICT names the key: a different locker already holding the demo code stops the startup.
            if (jdbc.sql("""
                    INSERT INTO aegis.lockers (id, code, name, topology)
                    VALUES (:id, :code, 'Casier de démonstration', 'HUB_CELL')
                    ON CONFLICT (id) DO NOTHING
                    """).param("id", LOCKER_ID).param("code", LOCKER_CODE).update() == 1) {
                log.info("Created demo locker {}", LOCKER_CODE);
            }
            CELLS.forEach(this::ensure);
        });
    }

    private void ensure(DemoCell cell) {
        if (jdbc.sql("""
                INSERT INTO aegis.compartments (id, locker_id, code, local_address, hub_port)
                VALUES (:id, :locker, :code, :address, :port)
                ON CONFLICT (id) DO NOTHING
                """).param("id", cell.id()).param("locker", LOCKER_ID).param("code", cell.code())
                .param("address", cell.localAddress()).param("port", cell.hubPort()).update() == 1) {
            log.info("Created demo compartment {} of locker {}", cell.code(), LOCKER_CODE);
        }
    }

    record DemoCell(UUID id, String code, int localAddress, int hubPort) {
    }
}
