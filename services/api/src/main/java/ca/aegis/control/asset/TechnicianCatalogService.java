package ca.aegis.control.asset;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.ReadinessEvaluator.AssetFacts;
import ca.aegis.control.asset.ReadinessEvaluator.User;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;

/**
 * Technician catalog with personal readiness (document 09, section 11). Assets and custody are read in one
 * repeatable-read snapshot, and every item of a response is evaluated at the same instant (section 24).
 */
@Service
class TechnicianCatalogService {

    private final AssetRepository assets;
    private final AssetCustodyRepository custody;
    private final PhysicalPresence presence;
    private final Clock clock;

    TechnicianCatalogService(AssetRepository assets, AssetCustodyRepository custody, PhysicalPresence presence,
            Clock clock) {
        this.assets = assets;
        this.custody = custody;
        this.presence = presence;
        this.clock = clock;
    }

    /**
     * The readiness and availability filters apply to evaluated items, so the whole matching catalog is evaluated
     * before the page is cut: totals stay exact. This is sized for the P0 catalog of a single institution; a larger
     * catalog needs these filters pushed into SQL first.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PageResponse<AssetView> list(CurrentAccount account, PageQuery page, Optional<String> pattern, AssetSort sort,
            Optional<ReadinessResult> readiness, Optional<Availability> availability) {
        List<AssetView> matching = evaluate(account, assets.listActive(pattern, sort)).stream()
                .filter(view -> readiness.map(result -> view.readiness().result() == result).orElse(true))
                .filter(view -> availability.map(value -> view.availability() == value).orElse(true))
                .toList();
        long from = Math.min(page.offset(), matching.size());
        long to = Math.min(from + page.size(), matching.size());
        return PageResponse.of(matching.subList((int) from, (int) to), page, matching.size());
    }

    /** An archived asset is still evaluated here: document 06, section 4.4 makes it {@code BLOCKED/NOT_AVAILABLE}. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    AssetView get(CurrentAccount account, UUID assetId) {
        AssetRecord asset = assets.find(assetId).orElseThrow(AssetNotFoundException::new);
        return evaluate(account, List.of(asset)).getFirst();
    }

    private List<AssetView> evaluate(CurrentAccount account, List<AssetRecord> records) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        List<UUID> ids = records.stream().map(AssetRecord::id).toList();
        Map<UUID, Custody> custodies = custody.of(records);
        Map<UUID, Presence> presences = presence.of(ids, now);
        // Authentication only admits an active account (CurrentAccountAuthenticationConverter).
        User user = new User(account.id(), AccountStatus.ACTIVE, account.role(), account.maximumAccessLevel());
        return records.stream()
                .map(asset -> view(asset, user, custodies.get(asset.id()), presences.get(asset.id()), now))
                .toList();
    }

    private static AssetView view(AssetRecord asset, User user, Custody custody, Presence presence, Instant now) {
        AssetFacts facts = new AssetFacts(asset.id(), asset.operationalStatus(), asset.calibrationRequired(),
                asset.calibrationDueAt(), asset.requiredAccessLevel());
        ReadinessAssessment readiness = ReadinessEvaluator.evaluate(user, facts, custody, presence,
                ReadinessContext.GENERAL, now);
        CalibrationView calibration = new CalibrationView(asset.calibrationRequired(), asset.calibrationDueAt(),
                AssetConditions.calibration(asset.calibrationRequired(), asset.calibrationDueAt(), now));
        return new AssetView(asset.id(), asset.assetCode(), asset.model(), asset.requiredAccessLevel(),
                asset.operationalStatus(), calibration, custody.availability(), presence, readiness,
                asset.placement());
    }
}
