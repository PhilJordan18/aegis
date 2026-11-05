package ca.aegis.control.asset;

import java.util.UUID;

import ca.aegis.control.identity.AccessLevel;

/**
 * Technician asset representation (document 09, section 8.2), evaluated for the authenticated technician. It never
 * carries an identifier value, a raw RFID payload or anything about another holder.
 */
public record AssetView(
        UUID id,
        String assetCode,
        AssetModelSummary model,
        AccessLevel requiredAccessLevel,
        OperationalStatus operationalStatus,
        CalibrationView calibration,
        Availability availability,
        Presence presence,
        ReadinessAssessment readiness,
        PlacementSummary placement) {
}
