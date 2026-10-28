package ca.aegis.control.asset;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

/**
 * Presence before PHY-02 (decision of 28 October 2026): no observation is stored yet, so no asset has valid physical
 * proof and every presence is {@code UNKNOWN}. Readiness therefore can never be {@code READY} until PHY-02 replaces
 * this component.
 */
@Component
class NoPhysicalProofPresence implements PhysicalPresence {

    @Override
    public Map<UUID, Presence> of(Collection<UUID> assetIds, Instant now) {
        return assetIds.stream().distinct().collect(Collectors.toMap(Function.identity(), id -> Presence.UNKNOWN));
    }
}
