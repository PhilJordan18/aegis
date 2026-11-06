package ca.aegis.control.locker;

import java.util.List;
import java.util.UUID;

/**
 * A locker and its compartments for the administration (document 09, section 16.2, approved on 6 November 2026).
 * It carries no device health: that stays in {@link LockerStatusView}.
 */
public record AdminLockerView(UUID id, String code, String name, String topology,
        List<AdminCompartmentView> compartments) {

    /**
     * {@code currentAsset} is the asset of the active placement, or null. It shows the occupancy at read time; it
     * does not promise that a later placement will be accepted.
     */
    public record AdminCompartmentView(UUID id, String code, boolean enabled, CurrentAsset currentAsset) {
    }

    public record CurrentAsset(UUID id, String assetCode) {
    }
}
