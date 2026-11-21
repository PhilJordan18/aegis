package ca.aegis.control.device;

import java.util.UUID;

/**
 * Published after the commit of an accepted acknowledgement, door event or RFID scan that references an operation, so
 * that the operation's owner evaluates it in a transaction of its own (#47). Carries no payload.
 */
public record PhysicalEvidenceStored(UUID operationId) {
}
