package ca.aegis.control.asset;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * Current physical presence of assets, established only from valid physical proof (document 06, section 4.2). This
 * is the seam that PHY-02 replaces with an evaluation of the stored observations.
 */
interface PhysicalPresence {

    /** Presence of each asset at {@code now}; an asset without valid proof is {@link Presence#UNKNOWN}. */
    Map<UUID, Presence> of(Collection<UUID> assetIds, Instant now);
}
