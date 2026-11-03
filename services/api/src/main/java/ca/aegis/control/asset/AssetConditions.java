package ca.aegis.control.asset;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * Non-personal conditions of an asset derived from stored facts at one instant (document 03, sections 5.2 to 5.4;
 * document 06, section 4). Nothing here is persisted or accepted from a client.
 */
record AssetConditions(
        OperationalStatus operationalStatus,
        CalibrationStatus calibration,
        Availability availability,
        Presence presence) {

    /** Custody and presence come from the same sources as the technician catalog, so both views agree. */
    static AssetConditions of(AssetRecord asset, Custody custody, Presence presence, Instant now) {
        return new AssetConditions(asset.operationalStatus(),
                calibration(asset.calibrationRequired(), asset.calibrationDueAt(), now),
                custody.availability(),
                presence);
    }

    /** A required calibration is expired from its due instant onwards (document 06: {@code now >= dueAt}). */
    static CalibrationStatus calibration(boolean required, Instant dueAt, Instant now) {
        if (!required) {
            return CalibrationStatus.NOT_REQUIRED;
        }
        if (dueAt == null) {
            return CalibrationStatus.UNKNOWN;
        }
        return now.isBefore(dueAt) ? CalibrationStatus.VALID : CalibrationStatus.EXPIRED;
    }

    /** Reasons of document 09, section 8.9, in their documented order; never {@code ACCESS_DENIED}. */
    List<ReadinessReason> diagnosticReasons() {
        Set<ReadinessReason> reasons = EnumSet.noneOf(ReadinessReason.class);
        if (presence == Presence.ABSENT) {
            reasons.add(ReadinessReason.NOT_PRESENT);
        }
        if (availability != Availability.AVAILABLE) {
            reasons.add(ReadinessReason.NOT_AVAILABLE);
        }
        if (operationalStatus == OperationalStatus.MAINTENANCE) {
            reasons.add(ReadinessReason.MAINTENANCE);
        }
        if (operationalStatus == OperationalStatus.DAMAGED) {
            reasons.add(ReadinessReason.DAMAGED);
        }
        if (calibration == CalibrationStatus.EXPIRED) {
            reasons.add(ReadinessReason.CALIBRATION_EXPIRED);
        }
        if (presence == Presence.UNKNOWN || calibration == CalibrationStatus.UNKNOWN) {
            reasons.add(ReadinessReason.UNKNOWN_PHYSICAL_STATE);
        }
        return List.copyOf(reasons);
    }
}
