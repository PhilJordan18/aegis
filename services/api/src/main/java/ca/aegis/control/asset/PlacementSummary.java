package ca.aegis.control.asset;

import java.util.UUID;

/** Expected placement of an asset (document 09, section 8.2). */
public record PlacementSummary(UUID lockerId, String lockerCode, UUID compartmentId, String compartmentCode) {
}
