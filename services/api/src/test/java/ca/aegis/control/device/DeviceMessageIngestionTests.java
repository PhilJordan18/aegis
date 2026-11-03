package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.device.DeviceMessageIngestion.Outcome;
import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * The ingestion pipeline against PostgreSQL, called as the MQTT callback calls it: concurrent deliveries and the
 * cases a broker cannot produce for the test hub account (another locker's topic).
 */
class DeviceMessageIngestionTests extends ApiIntegrationTest {

    @Autowired
    DeviceMessageIngestion ingestion;

    @Autowired
    JdbcClient jdbc;

    private DeviceTestSupport db;
    private final Session session = new Session(3_000_000_000L + System.nanoTime() % 1_000_000);

    @BeforeEach
    void freshlyProvisionedDevice() {
        db = new DeviceTestSupport(jdbc);
        db.provisionTestHub(clock.instant());
    }

    @Test
    void twoConcurrentDeliveriesOfOneMessageStoreOneRowAndOneDuplicate() throws Exception {
        for (int round = 0; round < 10; round++) {
            Map<String, Object> heartbeat = session.heartbeat(clock.instant(), "CLOSED");
            byte[] payload = bytes(heartbeat);
            CountDownLatch start = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                List<Future<Outcome>> outcomes = new ArrayList<>();
                for (int i = 0; i < 2; i++) {
                    outcomes.add(pool.submit(() -> {
                        start.await();
                        return ingestion.ingest(STATUS, payload);
                    }));
                }
                start.countDown();
                List<Outcome> results = new ArrayList<>();
                for (Future<Outcome> outcome : outcomes) {
                    results.add(outcome.get());
                }
                results.sort(null);
                assertEquals(List.of(Outcome.ACCEPTED, Outcome.DUPLICATE), results);
                assertEquals(1, db.messageCount(heartbeat.get("messageId")));
                UUID stored = (UUID) db.message(heartbeat.get("messageId")).orElseThrow().get("id");
                assertEquals(1, db.duplicateAudits(stored));
            } finally {
                pool.shutdownNow();
            }
        }
        assertEquals(10L, db.device().get("heartbeat_sequence"));
    }

    /** Kept as a log, not as a REJECTED row, pending the decision on documents 08 and 10 (section 19.2). */
    @Test
    void aMessageForALockerWithoutAnActiveDeviceIsOnlyLogged() {
        UUID unknownLocker = UUID.randomUUID();
        Map<String, Object> heartbeat = session.heartbeat(clock.instant(), "CLOSED");
        heartbeat.put("lockerId", unknownLocker.toString());

        assertEquals(Outcome.LOGGED,
                ingestion.ingest("aegis/v1/lockers/" + unknownLocker + "/status", bytes(heartbeat)));
        assertEquals(0, db.messageCount(heartbeat.get("messageId")));
        assertEquals(Outcome.LOGGED, ingestion.ingest("aegis/v1/lockers/not-a-uuid/status", bytes(heartbeat)));
    }

    @Test
    void anInboundMessageInvalidReportIsAcceptedAsATechnicalFactOnly() {
        Map<String, Object> report = session.deviceError(clock.instant(), "INBOUND_MESSAGE_INVALID", "WARNING");
        report.put("compartmentId", DevicePayloads.CELL_A1.toString());
        Map<String, Object> device = db.device();
        // Other test classes leave anomalies in the shared database: only this ingestion's delta counts.
        long anomaliesBefore = jdbc.sql("SELECT count(*) FROM aegis.anomalies").query(Long.class).single();

        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(report)));

        Map<String, Object> row = db.message(report.get("messageId")).orElseThrow();
        assertEquals("PROCESSED", row.get("processing_status"));
        assertEquals(Map.of("operation", 0L, "observations", 0L, "anomalies", 0L), jdbc.sql("""
                SELECT (SELECT count(*) FROM aegis.inbound_device_messages
                        WHERE id = :id AND operation_id IS NOT NULL) AS operation,
                       (SELECT count(*) FROM aegis.physical_observations WHERE inbound_message_id = :id)
                           AS observations,
                       (SELECT count(*) FROM aegis.anomalies) - :anomaliesBefore AS anomalies
                """).param("id", row.get("id")).param("anomaliesBefore", anomaliesBefore).query().singleRow());
        assertEquals(device.get("heartbeat_sequence"), db.device().get("heartbeat_sequence"));
        assertEquals("UNKNOWN", db.device().get("connection_status"));
    }

    /** Review L2: the closing is read from the stored OFFLINE, as no reference heartbeat exists yet. */
    @Test
    void aFirstValidHeartbeatOfAConnectionAlreadyClosedLeavesTheLockerOffline() {
        assertEquals(Outcome.ACCEPTED,
                ingestion.ingest(STATUS, bytes(session.availability(clock.instant(), "OFFLINE", "CONNECTION_LOST"))));
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(STATUS, bytes(session.heartbeat(clock.instant(), "OPEN"))));

        Map<String, Object> device = db.device();
        assertEquals("OFFLINE", device.get("connection_status"));
        assertEquals(null, device.get("heartbeat_connection_id"));
        assertEquals("UNKNOWN", db.cell(DevicePayloads.CELL_A1).get("door_state"), "not a reference heartbeat");
    }

    @Test
    void aMessageNamingAnUnknownOperationIsRejectedWithThatCode() {
        Map<String, Object> error = session.deviceError(clock.instant(), "LOCK_ACTUATOR_FAULT", "CRITICAL");
        error.put("operationId", UUID.randomUUID().toString());

        assertEquals(Outcome.REJECTED, ingestion.ingest(EVENTS, bytes(error)));
        Map<String, Object> row = db.message(error.get("messageId")).orElseThrow();
        assertEquals("OPERATION_NOT_FOUND", row.get("processing_error"));
        assertEquals(Outcome.DUPLICATE, ingestion.ingest(EVENTS, bytes(error)), "a replayed rejection");
    }
}
