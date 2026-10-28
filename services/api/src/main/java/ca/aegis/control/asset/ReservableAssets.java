package ca.aegis.control.asset;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.ReadinessEvaluator.AssetFacts;
import ca.aegis.control.asset.ReadinessEvaluator.User;
import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;

/**
 * The asset facts that the reservation feature needs, without exposing the catalog persistence. Every method joins the
 * caller's transaction: the asset row lock is held until that transaction ends (document 08, section 7.2).
 */
@Component
public class ReservableAssets {

    /**
     * An asset locked for a reservation decision.
     *
     * @param lockerId the locker of the current expected placement, or {@code null} when the asset has none
     */
    public record LockedAsset(UUID id, AccessLevel requiredAccessLevel, UUID lockerId) {
    }

    private final AssetRepository assets;
    private final AssetCustodyRepository custody;
    private final PhysicalPresence presence;

    ReservableAssets(AssetRepository assets, AssetCustodyRepository custody, PhysicalPresence presence) {
        this.assets = assets;
        this.custody = custody;
        this.presence = presence;
    }

    /**
     * Locks the asset row ({@code FOR UPDATE}), the second lock of document 08, section 7.1, after the user, then reads
     * the asset again. Under READ COMMITTED, a statement that waited for the lock re-checks the asset row but keeps the
     * placement it joined before waiting; a new statement sees the placement committed by the lock holder.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<LockedAsset> lock(UUID assetId) {
        return assets.lockForUpdate(assetId).flatMap(locked -> assets.find(assetId))
                .map(asset -> new LockedAsset(asset.id(), asset.requiredAccessLevel(),
                        asset.placement() == null ? null : asset.placement().lockerId()));
    }

    /**
     * Readiness recomputed for the creation of a reservation (document 06, sections 4.5 and 5.2), from stored facts
     * only: the asset, its custody and its physical presence at {@code now}.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public ReadinessAssessment readinessForNewReservation(UUID assetId, UUID userId, AccessLevel maximumAccessLevel,
            Instant now) {
        AssetRecord asset = assets.find(assetId).orElseThrow();
        AssetFacts facts = new AssetFacts(asset.id(), asset.operationalStatus(), asset.calibrationRequired(),
                asset.calibrationDueAt(), asset.requiredAccessLevel());
        // The caller has locked the user row and checked that it is an active technician.
        User user = new User(userId, AccountStatus.ACTIVE, Role.TECHNICIAN, maximumAccessLevel);
        return ReadinessEvaluator.evaluate(user, facts, custody.of(asset),
                presence.of(List.of(asset.id()), now).get(asset.id()), ReadinessContext.NEW_RESERVATION, now);
    }

    /** Summaries of the given assets, for reservation views; an unknown identifier is left out. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<UUID, AssetSummary> summaries(Collection<UUID> assetIds) {
        return assetIds.stream().distinct().map(assets::find).flatMap(Optional::stream).map(AssetSummary::of)
                .collect(Collectors.toMap(AssetSummary::id, Function.identity()));
    }
}
