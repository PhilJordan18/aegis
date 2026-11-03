package ca.aegis.control.device;

import static ca.aegis.control.device.DevicePayloads.bytes;
import static ca.aegis.control.device.DevicePayloads.cell;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.device.DeviceMessageIngestion.Outcome;
import ca.aegis.control.device.DevicePayloads.Session;
import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;

/**
 * PHY-02 (#31) against PostgreSQL: RFID scans normalized at ingestion, and presence derived from them at read time
 * through the technician and administrator catalog views. Each test gets its own locker, cells, assets and hub
 * device, and calls the ingestion as the MQTT callback does; the broker path is covered by
 * {@link RfidPresenceBrokerTests}.
 */
class RfidPresenceTests extends ApiIntegrationTest {

    private static final AtomicLong BOOTS = new AtomicLong(5_000);

    @Autowired
    DeviceMessageIngestion ingestion;

    @Autowired
    JdbcClient jdbc;

    private ReservationFixtures fixtures;
    private UUID locker;
    private UUID assetA;
    private UUID assetB;
    private UUID cellA;
    private UUID cellB;
    private String tagA;
    private String tagB;
    private Session session;
    private String technician;

    @BeforeEach
    void lockerWithTwoPlacedAssetsAndAnOnlineHub() throws Exception {
        fixtures = new ReservationFixtures(jdbc);
        locker = fixtures.locker();
        assetA = fixtures.assetAt(locker, 1);
        assetB = fixtures.assetAt(locker, 2);
        cellA = compartmentOf(assetA);
        cellB = compartmentOf(assetB);
        tagA = tagOf(assetA);
        tagB = tagOf(assetB);
        jdbc.sql("""
                INSERT INTO aegis.locker_devices (locker_id, device_key, firmware_version, provisioned_at)
                VALUES (:locker, :key, 'test', :at)
                """).param("locker", locker).param("key", "presence-" + locker)
                .param("at", DeviceTestSupport.utc(START.minusSeconds(3600))).update();
        session = new Session(BOOTS.incrementAndGet(), locker);
        technician = accessToken(accounts.technician());
        heartbeat("HEALTHY", "HEALTHY");
        clock.advance(Duration.ofSeconds(5));
    }

    /** Other classes list the shared catalog: these assets must not stay present with proof after the test. */
    @AfterEach
    void endPlacements() {
        jdbc.sql("""
                UPDATE aegis.asset_placements SET removed_at = :now
                WHERE asset_id IN (:assets) AND removed_at IS NULL
                """).param("now", DeviceTestSupport.utc(clock.instant())).param("assets", List.of(assetA, assetB))
                .update();
    }

    @Test
    void aHealthyStableScanWithTheTagMakesAnEligibleAssetPresentAndReady() throws Exception {
        Map<String, Object> scan = ingest(scan(cellA, "HEALTHY", reads(tagA, 3, tagB, 1)));

        String view = technicianView(assetA);
        assertEquals("PRESENT", read(view, "$.presence"));
        assertEquals("READY", read(view, "$.readiness.result"));
        assertEquals(List.of(), read(view, "$.readiness.reasons"));
        String admin = adminView(assetA);
        assertEquals("PRESENT", read(admin, "$.presence"));
        assertEquals(List.of(), read(admin, "$.operationalDiagnostic.reasons"));

        Map<String, Object> row = message(scan);
        assertEquals("PROCESSED", row.get("processing_status"));
        assertEquals(List.of(
                        List.of("ASSET_IDENTIFIER_DETECTED", tagA, "{\"readCount\": 3, \"readerStatus\": \"HEALTHY\", "
                                + "\"identifierType\": \"RFID_UHF\"}"),
                        List.of("ASSET_IDENTIFIER_DETECTED", tagB, "{\"readCount\": 1, \"readerStatus\": \"HEALTHY\", "
                                + "\"identifierType\": \"RFID_UHF\"}"),
                        List.of("ASSET_PRESENT", tagA, "{\"assetId\": \"" + assetA + "\", \"readCount\": 3}")),
                observations(scan));
        assertEquals("UNKNOWN", read(technicianView(assetB), "$.presence"), "one or two reads prove nothing");
    }

    @Test
    void aPresentAssetWithAnExpiredCalibrationIsBlockedNotReady() throws Exception {
        jdbc.sql("""
                UPDATE aegis.assets SET calibration_required = true, calibration_due_at = :due WHERE id = :id
                """).param("due", DeviceTestSupport.utc(START.minus(Duration.ofDays(1)))).param("id", assetA)
                .update();
        ingest(scan(cellA, "HEALTHY", reads(tagA, 7)));

        String view = technicianView(assetA);
        assertEquals("PRESENT", read(view, "$.presence"));
        assertEquals("BLOCKED", read(view, "$.readiness.result"));
        assertEquals(List.of("CALIBRATION_EXPIRED"), read(view, "$.readiness.reasons"));
    }

    /** Document 03, section 4.16: ABSENT needs the whole window, a healthy reader and a complete door sequence. */
    @Test
    void aHealthyScanWithoutTheTagAfterAClosedDoorMakesTheAssetAbsentAndBlocked() throws Exception {
        Instant now = clock.instant();
        ingest(session.door("DOOR_OPENED", now.minusSeconds(4), cellA));
        ingest(session.door("DOOR_CLOSED", now.minusSeconds(3), cellA));
        Map<String, Object> scan = ingest(session.scan(now, cellA, "HEALTHY", now.minusSeconds(3), now,
                reads(tagB, 4)));

        String view = technicianView(assetA);
        assertEquals("ABSENT", read(view, "$.presence"));
        assertEquals("BLOCKED", read(view, "$.readiness.result"));
        assertEquals(List.of("NOT_PRESENT"), read(view, "$.readiness.reasons"));
        assertEquals(List.of("NOT_PRESENT"), read(adminView(assetA), "$.operationalDiagnostic.reasons"));
        assertEquals(List.of(List.of("ASSET_ABSENT", tagA, "{\"assetId\": \"" + assetA + "\"}"),
                List.of("ASSET_IDENTIFIER_DETECTED", tagB,
                        "{\"readCount\": 4, \"readerStatus\": \"HEALTHY\", \"identifierType\": \"RFID_UHF\"}")),
                observations(scan));
    }

    @Test
    void anAbsenceWithoutACompleteDoorSequenceOrOverLessThanThreeSecondsStaysUnknown() throws Exception {
        Instant now = clock.instant();
        Map<String, Object> noDoor = ingest(session.scan(now, cellA, "HEALTHY", now.minusSeconds(3), now, reads()));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals(List.of(List.of("ASSET_ABSENT", tagA, "{\"assetId\": \"" + assetA + "\"}")),
                observations(noDoor), "recorded for the scan, but not a proof of absence without the door");

        ingest(session.door("DOOR_OPENED", now.minusSeconds(3), cellB));
        ingest(session.door("DOOR_CLOSED", now.minusSeconds(3), cellB));
        Map<String, Object> shortWindow = ingest(session.scan(now, cellB, "HEALTHY",
                now.minusMillis(2_999), now, reads()));
        assertEquals("UNKNOWN", read(technicianView(assetB), "$.presence"));
        assertEquals(List.of(), observations(shortWindow));
    }

    @Test
    void aFaultedOrUnknownReaderConfirmsNeitherPresenceNorAbsence() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        Map<String, Object> faulted = ingest(scan(cellA, "FAULTED", reads()));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals("FAULTED", cellState(cellA).get("rfid_reader_status"));
        assertEquals(List.of(), observations(faulted));

        Map<String, Object> unknown = ingest(scan(cellB, "UNKNOWN", reads(tagB, 9)));
        assertEquals("UNKNOWN", read(technicianView(assetB), "$.presence"));
        assertEquals(List.of(List.of("ASSET_IDENTIFIER_DETECTED", tagB,
                "{\"readCount\": 9, \"readerStatus\": \"UNKNOWN\", \"identifierType\": \"RFID_UHF\"}")),
                observations(unknown), "the identifier is kept, without a verdict");
    }

    @Test
    void fewerThanThreeReadsAreNotPresent() throws Exception {
        Map<String, Object> scan = ingest(scan(cellA, "HEALTHY", reads(tagA, 2)));

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals(List.of(List.of("ASSET_IDENTIFIER_DETECTED", tagA,
                "{\"readCount\": 2, \"readerStatus\": \"HEALTHY\", \"identifierType\": \"RFID_UHF\"}")),
                observations(scan));
    }

    @Test
    void withoutAnyScanPresenceIsUnknownNeverAbsent() throws Exception {
        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
        assertEquals(List.of("UNKNOWN_PHYSICAL_STATE"), read(view, "$.readiness.reasons"));
        assertEquals("ONLINE", jdbc.sql("SELECT connection_status FROM aegis.locker_devices WHERE locker_id = :id")
                .param("id", locker).query(String.class).single());
    }

    @Test
    void aDuplicateScanStoresOneSetOfObservations() throws Exception {
        Map<String, Object> scan = scan(cellA, "HEALTHY", reads(tagA, 3));
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(events(), bytes(scan)));
        assertEquals(Outcome.DUPLICATE, ingestion.ingest(events(), bytes(scan)));

        assertEquals(2, observations(scan).size());
        assertEquals(1L, jdbc.sql("""
                SELECT count(*) FROM aegis.inbound_device_messages WHERE message_id = :id
                """).param("id", UUID.fromString((String) scan.get("messageId"))).query(Long.class).single());
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
    }

    /** The newest scan of a cell is the one with the highest sequence, whatever the delivery order. */
    @Test
    void anOlderScanDeliveredLateNeverReplacesANewerOne() throws Exception {
        Map<String, Object> older = scan(cellA, "HEALTHY", reads(tagA, 3));
        Map<String, Object> newer = scan(cellA, "FAULTED", reads());
        ingest(newer);
        ingest(older);
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals("FAULTED", cellState(cellA).get("rfid_reader_status"));

        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> olderFaulted = scan(cellB, "FAULTED", reads());
        Map<String, Object> newerPresent = scan(cellB, "HEALTHY", reads(tagB, 3));
        ingest(newerPresent);
        ingest(olderFaulted);
        assertEquals("PRESENT", read(technicianView(assetB), "$.presence"));
        assertEquals("HEALTHY", cellState(cellB).get("rfid_reader_status"));
    }

    @Test
    void aDoorEventAfterTheScanMakesPresenceUnknownUntilANewScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.door("DOOR_OPENED", clock.instant(), cellA));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.door("DOOR_CLOSED", clock.instant(), cellA));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "closing again proves nothing");

        clock.advance(Duration.ofSeconds(4));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
        assertEquals("UNKNOWN", read(technicianView(assetB), "$.presence"), "B was never scanned");
    }

    @Test
    void aRestartOrAReconnectionAfterTheScanRequiresANewScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(1));
        session.connectionId = UUID.randomUUID();
        ingest(session.availability(clock.instant(), "ONLINE", "CONNECTED"));
        heartbeat("HEALTHY", "HEALTHY");
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "reconnection");
        clock.advance(Duration.ofSeconds(5));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(1));
        session = new Session(BOOTS.incrementAndGet(), locker);
        ingest(session.restarted(clock.instant()));
        heartbeat("HEALTHY", "HEALTHY");
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "restart");
        clock.advance(Duration.ofSeconds(5));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
    }

    /**
     * Review HIGH 1 (a): door messages the backend rejects still show that the door may have moved, and so does a
     * later heartbeat reporting it open, even once a closed one follows.
     */
    @Test
    void rejectedDoorMessagesOrAnOpenDoorHeartbeatAfterTheScanMakePresenceUnknown() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> opened = session.door("DOOR_OPENED", clock.instant(), cellA);
        opened.put("operationId", UUID.randomUUID().toString());
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(opened)));
        assertEquals("OPERATION_NOT_FOUND", message(opened).get("processing_error"));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "rejected opening");
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", "HEALTHY", "OPEN", "UNLOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"))));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> closed = session.door("DOOR_CLOSED", clock.instant(), cellA);
        closed.put("operationId", UUID.randomUUID().toString());
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(closed)));
        heartbeat("HEALTHY", "HEALTHY");

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
        clock.advance(Duration.ofSeconds(5));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"), "a new scan after the movement");
    }

    /** Review HIGH 1 (b): without any door event, a heartbeat reporting the door open voids the earlier scan. */
    @Test
    void aHeartbeatReportingTheDoorOpenAfterTheScanMakesPresenceUnknownUntilANewScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        ingest(scan(cellB, "HEALTHY", reads(tagB, 3)));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", "HEALTHY", "OPEN", "UNLOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"))));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals("PRESENT", read(technicianView(assetB), "$.presence"), "B's door was reported closed");
        clock.advance(Duration.ofSeconds(4));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
    }

    /** Review HIGH 1: a newer scan the backend rejects leaves the cell's state unproven, not the older proof. */
    @Test
    void aRejectedNewerScanMakesPresenceUnknown() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Integer> many = new LinkedHashMap<>();
        many.put(tagA, 3);
        for (int i = 0; i < 32; i++) {
            many.put("E2-OTHER-" + i, 3);
        }
        Map<String, Object> tooMany = scan(cellA, "HEALTHY", many);
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(tooMany)));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "33 identifiers");

        clock.advance(Duration.ofSeconds(5));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> duplicated = scan(cellA, "HEALTHY", reads(tagA, 3));
        @SuppressWarnings("unchecked")
        List<Object> identifiers = (List<Object>) duplicated.get("observedIdentifiers");
        duplicated.put("observedIdentifiers", List.of(identifiers.get(0), identifiers.get(0)));
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(duplicated)));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "a duplicated identifier");
    }

    /** An older scan replayed after a door event never restores presence. */
    @Test
    void anOlderScanReplayedAfterADoorEventLeavesPresenceUnknown() throws Exception {
        Map<String, Object> older = scan(cellA, "HEALTHY", reads(tagA, 3));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.door("DOOR_OPENED", clock.instant(), cellA));
        ingest(older);

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
    }

    /** An older scan replayed after a heartbeat reported the door open never restores presence. */
    @Test
    void anOlderScanReplayedAfterAnOpenDoorHeartbeatLeavesPresenceUnknown() throws Exception {
        Map<String, Object> older = scan(cellA, "HEALTHY", reads(tagA, 3));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", "HEALTHY", "OPEN", "UNLOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"))));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");
        ingest(older);

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
    }

    /**
     * An older scan replayed after a rejected door event never restores presence: the rejected message is ordered by
     * the sequence its payload claims, not by when it arrived.
     */
    @Test
    void anOlderScanReplayedAfterARejectedDoorEventLeavesPresenceUnknown() throws Exception {
        Map<String, Object> older = scan(cellA, "HEALTHY", reads(tagA, 3));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> opened = session.door("DOOR_OPENED", clock.instant(), cellA);
        opened.put("operationId", UUID.randomUUID().toString());
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(opened)));
        ingest(older);

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
    }

    /** A scan the backend rejects is no evidence, even when it is the only scan of the cell. */
    @Test
    void aRejectedScanAloneLeavesPresenceUnknown() throws Exception {
        Map<String, Integer> many = new LinkedHashMap<>();
        many.put(tagA, 3);
        for (int i = 0; i < 32; i++) {
            many.put("E2-OTHER-" + i, 3);
        }
        Map<String, Object> tooMany = scan(cellA, "HEALTHY", many);
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(tooMany)));

        assertEquals(List.of(), observations(tooMany));
        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
    }

    /** Review 2, HIGH 1: while the cell's link to the hub is down its door is not observed, so the scan is void. */
    @Test
    void aCellThatLostItsHubLinkAfterTheScanNeedsANewScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        ingest(scan(cellB, "HEALTHY", reads(tagB, 3)));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "DISCONNECTED", "HEALTHY", "CLOSED", "LOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"))));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
        assertEquals("PRESENT", read(technicianView(assetB), "$.presence"), "B stayed connected and closed");
        clock.advance(Duration.ofSeconds(4));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"), "a new scan after the link is back");
    }

    /** Review 2, HIGH 1: a heartbeat that leaves the cell out says nothing of its door, so the scan is void. */
    @Test
    void aCellLeftOutOfAHeartbeatAfterTheScanNeedsANewScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        ingest(scan(cellB, "HEALTHY", reads(tagB, 3)));
        clock.advance(Duration.ofSeconds(1));
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"))));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
        assertEquals("PRESENT", read(technicianView(assetB), "$.presence"), "B was reported connected and closed");
    }

    /** Review 2, LOW 2: a rejected heartbeat may have reported the door open; its cells are unknown, so all count. */
    @Test
    void aRejectedHeartbeatAfterTheScanMakesPresenceUnknown() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> rejected = session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", "HEALTHY", "OPEN", "UNLOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED")));
        rejected.put("clockSynchronized", "yes");
        assertEquals(Outcome.REJECTED, ingestion.ingest("aegis/v1/lockers/" + locker + "/status", bytes(rejected)));
        assertEquals("REQUIRED_FIELD_MISSING", message(rejected).get("processing_error"));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
    }

    /** Review 2, LOW 3: a rejected message received after the scan voids it whatever sequence it claims. */
    @Test
    void aRejectedDoorEventClaimingAnOlderSequenceStillVoidsTheScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> opened = session.door("DOOR_OPENED", clock.instant(), cellA);
        opened.put("operationId", UUID.randomUUID().toString());
        opened.put("sequence", 0);
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(opened)));
        clock.advance(Duration.ofSeconds(1));
        heartbeat("HEALTHY", "HEALTHY");

        String view = technicianView(assetA);
        assertEquals("UNKNOWN", read(view, "$.presence"));
        assertEquals("UNKNOWN", read(view, "$.readiness.result"));
    }

    /** No validity period is defined: on an unbroken connection reporting the cell connected and closed it holds. */
    @Test
    void aScanStaysValidWhileTheConnectionReportsTheCellConnectedAndClosed() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        for (int i = 0; i < 5; i++) {
            clock.advance(Duration.ofSeconds(10));
            heartbeat("HEALTHY", "HEALTHY");
        }

        String view = technicianView(assetA);
        assertEquals("PRESENT", read(view, "$.presence"));
        assertEquals("READY", read(view, "$.readiness.result"));
    }

    /** Review LOW 3: a control character in an identifier is rejected and stored, never lost with its payload. */
    @Test
    void anIdentifierWithAControlCharacterIsStoredRejected() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        clock.advance(Duration.ofSeconds(1));
        Map<String, Object> nul = scan(cellA, "HEALTHY", reads("E2\u0000X", 3));

        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(nul)));
        Map<String, Object> row = message(nul);
        assertEquals("REJECTED", row.get("processing_status"));
        assertEquals("REQUIRED_FIELD_MISSING", row.get("processing_error"));
        assertEquals(List.of(), observations(nul));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
    }

    /** Review LOW 4: a late heartbeat that still becomes the reference does not undo a newer scan's reader status. */
    @Test
    void aLateReferenceHeartbeatKeepsTheReaderStatusOfANewerScan() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        Map<String, Object> late = session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED"),
                cell(cellB, 2, "CONNECTED", "HEALTHY", "CLOSED", "LOCKED")));
        Map<String, Object> faulted = scan(cellA, "FAULTED", reads());
        ingest(faulted);
        assertEquals("FAULTED", cellState(cellA).get("rfid_reader_status"));

        ingest(late);
        assertEquals(((Number) late.get("sequence")).longValue(), jdbc.sql("""
                SELECT heartbeat_sequence FROM aegis.locker_devices WHERE locker_id = :id
                """).param("id", locker).query(Long.class).single(), "the late heartbeat is the reference");
        assertEquals("FAULTED", cellState(cellA).get("rfid_reader_status"));
        assertEquals("HEALTHY", cellState(cellB).get("rfid_reader_status"));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
    }

    /** A scan proves only what was expected when it was made: a later binding of the tag needs a new scan. */
    @Test
    void aScanMadeBeforeTheTagWasBoundProvesNothingForTheNewBinding() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(1));
        jdbc.sql("""
                UPDATE aegis.asset_identifiers SET active = false, revoked_at = :now
                WHERE asset_id = :asset AND identifier_type = 'RFID_UHF' AND active
                """).param("now", DeviceTestSupport.utc(clock.instant())).param("asset", assetA).update();
        jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, assigned_at)
                VALUES (:asset, 'RFID_UHF', :value, :now)
                """).param("asset", assetA).param("value", tagA).param("now", DeviceTestSupport.utc(clock.instant()))
                .update();
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(5));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
    }

    @Test
    void anOfflineLockerOrADisconnectedCellMakesPresenceUnknown() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));

        clock.advance(Duration.ofSeconds(26));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "no heartbeat for over 30 seconds");
        heartbeat("HEALTHY", "HEALTHY");
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"), "the same connection resumed");

        ingest(session.availability(clock.instant(), "OFFLINE", "SHUTDOWN"));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"), "announced offline");
    }

    @Test
    void aDisconnectedCellOrAFaultedReaderInTheReferenceHeartbeatMakesPresenceUnknown() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        ingest(scan(cellB, "HEALTHY", reads(tagB, 3)));
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "DISCONNECTED", "HEALTHY", "CLOSED", "LOCKED"),
                cell(cellB, 2, "CONNECTED", "FAULTED", "CLOSED", "LOCKED"))));

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals("UNKNOWN", read(technicianView(assetB), "$.presence"));
    }

    /** Document 10, section 12.2: a tag that another cell still reports is ambiguous. */
    @Test
    void theSameTagInTwoCellsIsUnknownUntilTheOtherCellNoLongerSeesIt() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        ingest(scan(cellB, "HEALTHY", reads(tagA, 3, tagB, 3)));
        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals("PRESENT", read(technicianView(assetB), "$.presence"));

        ingest(scan(cellB, "HEALTHY", reads(tagB, 3)));
        assertEquals("PRESENT", read(technicianView(assetA), "$.presence"));
    }

    @Test
    void aScanThatArrivesMoreThanThirtySecondsLateIsKeptWithoutAVerdict() throws Exception {
        Map<String, Object> late = scan(cellA, "HEALTHY", reads(tagA, 3));
        clock.advance(Duration.ofSeconds(31));
        heartbeat("HEALTHY", "HEALTHY");
        ingest(late);

        assertEquals("UNKNOWN", read(technicianView(assetA), "$.presence"));
        assertEquals(1, observations(late).size(), "the detection only");
    }

    /** Document 03, invariant 21: presence observed during a loan neither closes it nor frees the asset. */
    @Test
    void aScanDuringAnActiveLoanLeavesTheLoanOpenAndTheAssetBorrowed() throws Exception {
        UUID loan = fixtures.loan(assetA, accounts.technician().id(), START.minusSeconds(600));
        Map<String, Object> before = jdbc.sql("SELECT * FROM aegis.loans WHERE id = :id").param("id", loan).query()
                .singleRow();

        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));

        String view = technicianView(assetA);
        assertEquals("PRESENT", read(view, "$.presence"));
        assertEquals("BORROWED", read(view, "$.availability"));
        assertEquals("BLOCKED", read(view, "$.readiness.result"));
        assertEquals(List.of("NOT_AVAILABLE"), read(view, "$.readiness.reasons"));
        assertEquals(before, jdbc.sql("SELECT * FROM aegis.loans WHERE id = :id").param("id", loan).query()
                .singleRow());
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.anomalies WHERE asset_id = :id").param("id", assetA)
                .query(Long.class).single(), "ANO-01 (#52) creates ASSET_PRESENT_WITH_ACTIVE_LOAN, not this lot");
    }

    @Test
    void observationsAreInsertedNeverRewritten() throws Exception {
        ingest(scan(cellA, "HEALTHY", reads(tagA, 3)));
        List<Map<String, Object>> first = lockerObservations();

        ingest(scan(cellA, "FAULTED", reads()));
        ingest(scan(cellA, "HEALTHY", reads(tagA, 4)));
        List<Map<String, Object>> after = lockerObservations();

        assertEquals(first, after.subList(0, first.size()));
        assertEquals(first.size() + 2, after.size());
    }

    @Test
    void aScanNamingACellOfAnotherLockerIsRejectedWithoutObservation() throws Exception {
        UUID foreign = compartmentOf(fixtures.assetAt(fixtures.locker(), 1));
        Map<String, Object> scan = scan(foreign, "HEALTHY", reads(tagA, 3));
        assertEquals(Outcome.REJECTED, ingestion.ingest(events(), bytes(scan)));

        Map<String, Object> row = message(scan);
        assertEquals("REJECTED", row.get("processing_status"));
        assertEquals("REQUIRED_FIELD_MISSING", row.get("processing_error"));
        assertEquals(List.of(), observations(scan));
    }

    private Map<String, Object> scan(UUID compartment, String reader, Map<String, Integer> reads) {
        Instant now = clock.instant();
        return session.scan(now, compartment, reader, now.minusSeconds(4), now.minusSeconds(1), reads);
    }

    private void heartbeat(String readerA, String readerB) {
        ingest(session.heartbeat(clock.instant(), List.of(
                cell(cellA, 1, "CONNECTED", readerA, "CLOSED", "LOCKED"),
                cell(cellB, 2, "CONNECTED", readerB, "CLOSED", "LOCKED"))));
    }

    private Map<String, Object> ingest(Map<String, Object> message) {
        String topic = "aegis/v1/lockers/" + locker + (message.get("type").equals("HEARTBEAT")
                || message.get("type").equals("DEVICE_AVAILABILITY") ? "/status" : "/events");
        assertEquals(Outcome.ACCEPTED, ingestion.ingest(topic, bytes(message)), message.get("type").toString());
        assertEquals(null, message(message).get("processing_error"), message.get("type").toString());
        return message;
    }

    private String events() {
        return "aegis/v1/lockers/" + locker + "/events";
    }

    private Map<String, Object> message(Map<String, Object> message) {
        return jdbc.sql("""
                SELECT id, processing_status, processing_error FROM aegis.inbound_device_messages
                WHERE message_id = :id
                """).param("id", UUID.fromString((String) message.get("messageId"))).query().singleRow();
    }

    /** Type, identifier and value of each observation of one message; rows of one message share their instant. */
    private List<List<Object>> observations(Map<String, Object> message) {
        return jdbc.sql("""
                SELECT o.type, o.identifier_value, o.value_json::text AS value
                FROM aegis.physical_observations o
                JOIN aegis.inbound_device_messages m ON m.id = o.inbound_message_id
                WHERE m.message_id = :id
                ORDER BY o.type, o.identifier_value
                """).param("id", UUID.fromString((String) message.get("messageId")))
                .query((row, n) -> List.<Object>of(row.getString("type"), row.getString("identifier_value"),
                        row.getString("value")))
                .list();
    }

    private List<Map<String, Object>> lockerObservations() {
        return jdbc.sql("SELECT * FROM aegis.physical_observations WHERE locker_id = :locker ORDER BY created_at, id")
                .param("locker", locker).query().listOfRows();
    }

    private Map<String, Object> cellState(UUID compartment) {
        return jdbc.sql("SELECT rfid_reader_status, door_state FROM aegis.compartments WHERE id = :id")
                .param("id", compartment).query().singleRow();
    }

    private UUID compartmentOf(UUID asset) {
        return jdbc.sql("SELECT compartment_id FROM aegis.asset_placements WHERE asset_id = :id AND removed_at IS NULL")
                .param("id", asset).query(UUID.class).single();
    }

    private String tagOf(UUID asset) {
        return jdbc.sql("""
                SELECT identifier_value FROM aegis.asset_identifiers
                WHERE asset_id = :id AND active AND identifier_type = 'RFID_UHF'
                """).param("id", asset).query(String.class).single();
    }

    private String technicianView(UUID asset) throws Exception {
        return mvc.perform(get("/api/v1/assets/" + asset).header(AUTHORIZATION, bearer(technician)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String adminView(UUID asset) throws Exception {
        return mvc.perform(get("/api/v1/admin/assets/" + asset)
                        .header(AUTHORIZATION, bearer(accessToken(accounts.admin()))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static <T> T read(String body, String path) {
        return JsonPath.read(body, path);
    }

    private static Map<String, Integer> reads(Object... valuesAndCounts) {
        Map<String, Integer> reads = new LinkedHashMap<>();
        for (int i = 0; i < valuesAndCounts.length; i += 2) {
            reads.put((String) valuesAndCounts[i], (Integer) valuesAndCounts[i + 1]);
        }
        return reads;
    }
}
