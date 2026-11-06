package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.CELL_A1;
import static ca.aegis.control.device.DevicePayloads.CELL_A2;
import static ca.aegis.control.device.DevicePayloads.EVENTS;
import static ca.aegis.control.device.DevicePayloads.LOCKER;
import static ca.aegis.control.device.DevicePayloads.STATUS;
import static ca.aegis.control.device.DevicePayloads.bytes;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.device.DeviceMessageIngestion.Outcome;
import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * {@code deviceErrors} of {@code LockerStatusView} (document 09, section 8.6, approved on 6 November 2026, #29): the
 * reported errors of the current device session, grouped, ordered and bounded, without raw content and without any
 * effect on the derived states. Messages go through the real ingestion, as the MQTT callback calls it.
 */
class LockerDeviceErrorsApiTests extends ApiIntegrationTest {

    private static final String PATH = "/api/v1/lockers/" + LOCKER + "/status";
    private static final List<String> CODES = List.of("CELL_COMMUNICATION_LOST", "RFID_READER_FAULT",
            "DOOR_SENSOR_FAULT", "LOCK_ACTUATOR_FAULT", "POWER_FAULT", "CLOCK_SYNC_LOST", "STORAGE_FAULT",
            "INBOUND_MESSAGE_INVALID");

    @Autowired
    DeviceMessageIngestion ingestion;

    @Autowired
    JdbcClient jdbc;

    private DeviceTestSupport db;
    private Session session;
    private String technician;

    @BeforeEach
    void freshlyProvisionedDevice() throws Exception {
        db = new DeviceTestSupport(jdbc);
        db.provisionTestHub(clock.instant());
        session = new Session(4_000_000_000L + System.nanoTime() % 1_000_000);
        technician = accessToken(accounts.technician());
    }

    @Test
    void reportsAreGroupedByCodeAndCellWithTheMostSevereReportAndOrderedCriticalThenLatest() throws Exception {
        Instant t0 = clock.instant();
        report("RFID_READER_FAULT", "WARNING", CELL_A1);
        tick();
        report("RFID_READER_FAULT", "CRITICAL", CELL_A1);
        Instant t2 = tick();
        report("RFID_READER_FAULT", "WARNING", CELL_A1);
        Instant t3 = tick();
        report("POWER_FAULT", "WARNING", null);
        // A cell of another locker reads as null and joins the locker-level group of its code.
        report("POWER_FAULT", "WARNING", cellOfAnotherLocker());
        Instant t4 = tick();
        report("DOOR_SENSOR_FAULT", "WARNING", CELL_A2);
        report("CLOCK_SYNC_LOST", "WARNING", null);
        Instant t5 = tick();
        report("RFID_READER_FAULT", "WARNING", CELL_A2);

        read().andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceErrors[*].errorCode").value(contains("RFID_READER_FAULT",
                        "RFID_READER_FAULT", "CLOCK_SYNC_LOST", "DOOR_SENSOR_FAULT", "POWER_FAULT")))
                .andExpect(jsonPath("$.deviceErrors[0].severity").value("CRITICAL"))
                .andExpect(jsonPath("$.deviceErrors[0].compartmentId").value(CELL_A1.toString()))
                .andExpect(jsonPath("$.deviceErrors[0].firstReceivedAt").value(t0.toString()))
                .andExpect(jsonPath("$.deviceErrors[0].lastReceivedAt").value(t2.toString()))
                .andExpect(jsonPath("$.deviceErrors[0].occurrences").value(3))
                .andExpect(jsonPath("$.deviceErrors[1].severity").value("WARNING"))
                .andExpect(jsonPath("$.deviceErrors[1].compartmentId").value(CELL_A2.toString()))
                .andExpect(jsonPath("$.deviceErrors[1].lastReceivedAt").value(t5.toString()))
                // Same lastReceivedAt: the error code decides, then the cell.
                .andExpect(jsonPath("$.deviceErrors[2].compartmentId").value(nullValue()))
                .andExpect(jsonPath("$.deviceErrors[2].lastReceivedAt").value(t4.toString()))
                .andExpect(jsonPath("$.deviceErrors[3].compartmentId").value(CELL_A2.toString()))
                .andExpect(jsonPath("$.deviceErrors[4].compartmentId").value(nullValue()))
                .andExpect(jsonPath("$.deviceErrors[4].occurrences").value(2))
                .andExpect(jsonPath("$.deviceErrors[4].firstReceivedAt").value(t3.toString()))
                .andExpect(jsonPath("$.deviceErrors[4].lastReceivedAt").value(t3.toString()));
    }

    /** Review: the latest reception orders, not the first; on a tie the locker-level group precedes its cells. */
    @Test
    void theLatestReceptionOrdersGroupsAndALockerLevelGroupPrecedesItsCellsOnATie() throws Exception {
        report("STORAGE_FAULT", "WARNING", null);
        tick();
        report("CLOCK_SYNC_LOST", "WARNING", null);
        tick();
        report("STORAGE_FAULT", "WARNING", null);
        report("POWER_FAULT", "WARNING", CELL_A1);
        report("POWER_FAULT", "WARNING", null);

        String body = body();
        assertEquals(List.of("POWER_FAULT", "POWER_FAULT", "STORAGE_FAULT", "CLOCK_SYNC_LOST"),
                JsonPath.read(body, "$.deviceErrors[*].errorCode"));
        assertEquals(java.util.Arrays.asList(null, CELL_A1.toString(), null, null),
                JsonPath.read(body, "$.deviceErrors[*].compartmentId"));
    }

    /** R2: a second session sharing the bootCount, or a report of an older boot, is not the current session. */
    @Test
    void reportsOutsideTheProjectionSessionAreLeftOut() throws Exception {
        report("POWER_FAULT", "WARNING", null);
        Session conflicting = new Session(session.bootCount);
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS,
                bytes(conflicting.deviceError(clock.instant(), "STORAGE_FAULT", "CRITICAL"))));
        Map<String, Object> olderBoot = session.deviceError(clock.instant(), "LOCK_ACTUATOR_FAULT", "CRITICAL");
        olderBoot.put("bootCount", session.bootCount - 1);
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(olderBoot)));

        read().andExpect(jsonPath("$.deviceErrors[*].errorCode").value(contains("POWER_FAULT")));
    }

    /** A replaced hub starts from no session: the errors of the disabled device are not the new one's. */
    @Test
    void aReplacedDeviceDoesNotInheritTheErrorsOfTheDisabledOne() throws Exception {
        report("POWER_FAULT", "CRITICAL", null);
        UUID original = jdbc.sql(
                "SELECT id FROM aegis.locker_devices WHERE locker_id = :locker AND disabled_at IS NULL")
                .param("locker", LOCKER).query(UUID.class).single();
        UUID replacement = null;
        try {
            jdbc.sql("UPDATE aegis.locker_devices SET disabled_at = now() WHERE id = :id").param("id", original)
                    .update();
            replacement = jdbc.sql("""
                    INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, device_session_id,
                                                      boot_count)
                    VALUES (:locker, :key, 'test', :session, :boot)
                    RETURNING id
                    """).param("locker", LOCKER).param("key", "replacement-" + UUID.randomUUID())
                    .param("session", session.deviceSessionId).param("boot", session.bootCount)
                    .query(UUID.class).single();
            read().andExpect(jsonPath("$.deviceErrors.length()").value(0));
        } finally {
            if (replacement != null) {
                jdbc.sql("UPDATE aegis.locker_devices SET disabled_at = now() WHERE id = :id")
                        .param("id", replacement).update();
            }
            jdbc.sql("UPDATE aegis.locker_devices SET disabled_at = NULL WHERE id = :id").param("id", original)
                    .update();
        }
    }

    @Test
    void atMostTwentyGroupsAreListedAndTheOldestWarningsAreLeftOut() throws Exception {
        List<String> expected = new ArrayList<>();
        UUID[] cells = {null, CELL_A1, CELL_A2};
        for (UUID cell : cells) {
            for (String code : CODES) {
                tick();
                report(code, "WARNING", cell);
                expected.addFirst(code + "/" + cell);
            }
        }
        tick();
        report("POWER_FAULT", "CRITICAL", null);
        expected.remove("POWER_FAULT/null");
        expected.addFirst("POWER_FAULT/null");

        String body = body();
        List<String> codes = JsonPath.read(body, "$.deviceErrors[*].errorCode");
        List<String> compartments = JsonPath.read(body, "$.deviceErrors[*].compartmentId");
        List<String> listed = new ArrayList<>();
        for (int i = 0; i < codes.size(); i++) {
            listed.add(codes.get(i) + "/" + compartments.get(i));
        }
        assertEquals(24, expected.size());
        assertEquals(expected.subList(0, 20), listed);
    }

    @Test
    void aNewSessionStartsAnEmptyListWithoutErasingTheStoredReports() throws Exception {
        report("LOCK_ACTUATOR_FAULT", "CRITICAL", CELL_A1);
        read().andExpect(jsonPath("$.deviceErrors.length()").value(1));

        Session next = new Session(session.bootCount + 1);
        tick();
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(next.restarted(clock.instant()))));
        read().andExpect(jsonPath("$.deviceErrors").isArray())
                .andExpect(jsonPath("$.deviceErrors.length()").value(0));
        assertEquals(1L, jdbc.sql("""
                SELECT count(*) FROM aegis.inbound_device_messages
                WHERE message_type = 'DEVICE_ERROR' AND device_session_id = :session
                """).param("session", session.deviceSessionId).query(Long.class).single());

        // A late report of the previous session stays out of the new session's list.
        tick();
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS,
                bytes(session.deviceError(clock.instant(), "POWER_FAULT", "CRITICAL"))));
        session = next;
        report("STORAGE_FAULT", "WARNING", null);
        read().andExpect(jsonPath("$.deviceErrors[*].errorCode").value(contains("STORAGE_FAULT")));
    }

    @Test
    void withoutASessionTheListIsPresentAndEmpty() throws Exception {
        read().andExpect(jsonPath("$.connectionStatus").value("UNKNOWN"))
                .andExpect(jsonPath("$.deviceErrors").isArray())
                .andExpect(jsonPath("$.deviceErrors.length()").value(0));
    }

    @Test
    void duplicateDeliveriesAndRejectedReportsAreNotCounted() throws Exception {
        Map<String, Object> once = session.deviceError(clock.instant(), "STORAGE_FAULT", "WARNING");
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(once)));
        assertEquals(Outcome.DUPLICATE, ingestion.ingest(EVENTS, bytes(once)));
        Map<String, Object> rejected = session.deviceError(clock.instant(), "STORAGE_FAULT", "CRITICAL");
        rejected.put("operationId", UUID.randomUUID().toString());
        assertEquals(Outcome.REJECTED, ingestion.ingest(EVENTS, bytes(rejected)));

        read().andExpect(jsonPath("$.deviceErrors.length()").value(1))
                .andExpect(jsonPath("$.deviceErrors[0].severity").value("WARNING"))
                .andExpect(jsonPath("$.deviceErrors[0].occurrences").value(1));
    }

    @Test
    void theViewCarriesNoDetailPayloadOrMessageIdentifier() throws Exception {
        Map<String, Object> error = session.deviceError(clock.instant(), "INBOUND_MESSAGE_INVALID", "WARNING");
        error.put("detail", "detail-marker-" + UUID.randomUUID());
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(error)));

        String body = body();
        Map<String, Object> group = JsonPath.read(body, "$.deviceErrors[0]");
        assertEquals(List.of("errorCode", "severity", "compartmentId", "firstReceivedAt", "lastReceivedAt",
                "occurrences"), List.copyOf(group.keySet()));
        for (Object forbidden : new Object[] {error.get("detail"), error.get("messageId"),
                session.deviceSessionId, "detail", "payload"}) {
            assertFalse(body.contains(forbidden.toString()), forbidden + " leaked");
        }
    }

    /** Errors inform; they never move a derived state, and a stale hub stays explicitly OFFLINE beside them. */
    @Test
    void errorsChangeNoStateAndAStaleHubStaysOfflineBesideThem() throws Exception {
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(STATUS, bytes(session.heartbeat(clock.instant(), "CLOSED"))));
        String before = body();
        Map<String, Object> device = db.device();

        for (String code : CODES) {
            report(code, "INBOUND_MESSAGE_INVALID".equals(code) ? "WARNING" : "CRITICAL", CELL_A1);
        }
        String after = body();
        assertEquals("ONLINE", JsonPath.read(after, "$.connectionStatus"));
        for (String path : new String[] {"$.connectionStatus", "$.lastSeenAt", "$.compartments"}) {
            assertEquals((Object) JsonPath.read(before, path), JsonPath.read(after, path), path);
        }
        assertEquals(device, db.device());
        assertEquals(CODES.size(), ((List<?>) JsonPath.read(after, "$.deviceErrors")).size());

        clock.set(clock.instant().plus(Duration.ofSeconds(31)));
        technician = accessToken(accounts.technician());
        Map<String, Object> stale = db.device();
        read().andExpect(jsonPath("$.connectionStatus").value("OFFLINE"))
                .andExpect(jsonPath("$.deviceErrors.length()").value(CODES.size()));
        assertEquals(stale, db.device(), "a read writes nothing");
    }

    @Test
    void anAdministratorReadsTheSameErrors() throws Exception {
        report("CELL_COMMUNICATION_LOST", "CRITICAL", CELL_A2);
        mvc.perform(get(PATH).header(AUTHORIZATION, bearer(accessToken(accounts.admin()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceErrors[0].errorCode").value("CELL_COMMUNICATION_LOST"));
        mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
    }

    private void report(String code, String severity, UUID compartmentId) {
        Map<String, Object> error = session.deviceError(clock.instant(), code, severity);
        if (compartmentId != null) {
            error.put("compartmentId", compartmentId.toString());
        }
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(EVENTS, bytes(error)));
    }

    private UUID cellOfAnotherLocker() {
        UUID locker = jdbc.sql("""
                INSERT INTO aegis.lockers (code, name, topology) VALUES (:code, 'Autre casier', 'HUB_CELL')
                RETURNING id
                """).param("code", "ERR-" + UUID.randomUUID()).query(UUID.class).single();
        return jdbc.sql("""
                INSERT INTO aegis.compartments (locker_id, code, local_address, hub_port) VALUES (:locker, 'A1', 1, 1)
                RETURNING id
                """).param("locker", locker).query(UUID.class).single();
    }

    private Instant tick() {
        clock.set(clock.instant().plusSeconds(1));
        return clock.instant();
    }

    private ResultActions read() throws Exception {
        return mvc.perform(get(PATH).header(AUTHORIZATION, bearer(technician)));
    }

    private String body() throws Exception {
        return read().andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
    }
}
