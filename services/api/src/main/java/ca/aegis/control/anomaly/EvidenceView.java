package ca.aegis.control.anomaly;

import java.time.Instant;
import java.util.UUID;

/**
 * A normalized physical observation of an anomaly's evidence (document 09, section 18.1; provisional shape D7 of the
 * 11 November 2026 matrix, #67). The raw identifier value, the measured value, the inbound message and its payload
 * are excluded.
 *
 * @param type the observation type of {@code ck_physical_observations_type}
 * @param receivedAt when the backend stored the observation; {@code observedAt} is the device's instant
 */
record EvidenceView(UUID observationId, String type, UUID compartmentId, UUID operationId, Instant observedAt,
        Instant receivedAt) {
}
