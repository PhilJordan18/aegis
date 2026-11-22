package ca.aegis.control.device;

import java.util.UUID;

/**
 * Published after the commit of an accepted {@code RFID_SCAN_COMPLETED} of a cell, with or without an operation, so
 * that a checkout anomaly waiting for its asset to be seen back in that cell is evaluated at once (document 06,
 * section 15.2). Carries no payload.
 */
public record PresenceScanStored(UUID compartmentId) {
}
