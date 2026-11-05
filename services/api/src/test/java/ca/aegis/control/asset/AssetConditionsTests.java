package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.identity.AccessLevel;

class AssetConditionsTests {

    private static final Instant NOW = Instant.parse("2026-09-28T13:00:00Z");

    @Test
    void requiredCalibrationExpiresAtItsDueInstant() {
        assertEquals(CalibrationStatus.NOT_REQUIRED, AssetConditions.calibration(false, null, NOW));
        assertEquals(CalibrationStatus.VALID, AssetConditions.calibration(true, NOW.plusSeconds(1), NOW));
        assertEquals(CalibrationStatus.EXPIRED, AssetConditions.calibration(true, NOW, NOW));
        assertEquals(CalibrationStatus.EXPIRED, AssetConditions.calibration(true, NOW.minusSeconds(1), NOW));
        assertEquals(CalibrationStatus.UNKNOWN, AssetConditions.calibration(true, null, NOW));
    }

    @Test
    void serviceableAssetWithoutObservationIsOnlyOfUnknownPhysicalState() {
        AssetConditions conditions = conditions(asset(OperationalStatus.SERVICEABLE, NOW.plusSeconds(60), null));

        assertEquals(Availability.AVAILABLE, conditions.availability());
        assertEquals(Presence.UNKNOWN, conditions.presence());
        assertEquals(List.of(ReadinessReason.UNKNOWN_PHYSICAL_STATE), conditions.diagnosticReasons());
    }

    @Test
    void reasonsAccumulateInDocumentedOrderAndNeverDenyAccess() {
        AssetConditions conditions = conditions(
                asset(OperationalStatus.DAMAGED, NOW.minus(Duration.ofDays(1)), NOW.minusSeconds(10)));

        assertEquals(Availability.UNAVAILABLE, conditions.availability());
        assertEquals(List.of(ReadinessReason.NOT_AVAILABLE, ReadinessReason.DAMAGED,
                ReadinessReason.CALIBRATION_EXPIRED, ReadinessReason.UNKNOWN_PHYSICAL_STATE),
                conditions.diagnosticReasons());
        assertFalse(conditions.diagnosticReasons().contains(ReadinessReason.ACCESS_DENIED));

        AssetConditions maintenance = new AssetConditions(OperationalStatus.MAINTENANCE, CalibrationStatus.VALID,
                Availability.AVAILABLE, Presence.ABSENT);
        assertEquals(List.of(ReadinessReason.NOT_PRESENT, ReadinessReason.MAINTENANCE),
                maintenance.diagnosticReasons());

        AssetConditions clear = new AssetConditions(OperationalStatus.SERVICEABLE, CalibrationStatus.NOT_REQUIRED,
                Availability.AVAILABLE, Presence.PRESENT);
        assertEquals(List.of(), clear.diagnosticReasons());
    }

    private static AssetConditions conditions(AssetRecord asset) {
        return AssetConditions.of(asset, Custody.archivalOnly(asset.archived()), Presence.UNKNOWN, NOW);
    }

    private static AssetRecord asset(OperationalStatus status, Instant calibrationDueAt, Instant archivedAt) {
        return new AssetRecord(UUID.randomUUID(), new AssetModelSummary(UUID.randomUUID(), "Model", null, null),
                "A1", null, AccessLevel.RESTRICTED, status, calibrationDueAt != null, calibrationDueAt, archivedAt,
                null);
    }
}
