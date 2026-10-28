package ca.aegis.control.asset;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;

/**
 * Readiness algorithm of document 06, sections 4.3 to 4.5: pure and deterministic, it reads no clock, no database and
 * no client claim. A certain block gives {@code BLOCKED} with every distinct reason; insufficient proof gives
 * {@code UNKNOWN} only when nothing blocks; {@code READY} needs every condition, presence {@code PRESENT} included.
 */
final class ReadinessEvaluator {

    /** The evaluated user, as stored, never as claimed by a token. */
    record User(UUID id, AccountStatus status, Role role, AccessLevel maximumAccessLevel) {
    }

    /** Stored facts of the asset that do not depend on custody. */
    record AssetFacts(UUID id, OperationalStatus operationalStatus, boolean calibrationRequired,
            Instant calibrationDueAt, AccessLevel requiredAccessLevel) {
    }

    private ReadinessEvaluator() {
    }

    /**
     * @throws IllegalArgumentException for a disabled user or a non-technician: document 06, section 4.4 rejects the
     *         request before any evaluation, so no assessment is produced for them
     */
    static ReadinessAssessment evaluate(User user, AssetFacts asset, Custody custody, Presence presence,
            ReadinessContext context, Instant now) {
        Objects.requireNonNull(presence, "presence");
        Objects.requireNonNull(context, "context");
        Objects.requireNonNull(now, "now");
        if (user.status() != AccountStatus.ACTIVE || user.role() != Role.TECHNICIAN) {
            throw new IllegalArgumentException("Readiness is evaluated for an active technician only");
        }
        Set<ReadinessReason> blocks = EnumSet.noneOf(ReadinessReason.class);
        if (presence == Presence.ABSENT) {
            blocks.add(ReadinessReason.NOT_PRESENT);
        }
        if (!custody.compatibleWith(user.id(), context)) {
            blocks.add(ReadinessReason.NOT_AVAILABLE);
        }
        if (asset.operationalStatus() == OperationalStatus.MAINTENANCE) {
            blocks.add(ReadinessReason.MAINTENANCE);
        }
        if (asset.operationalStatus() == OperationalStatus.DAMAGED) {
            blocks.add(ReadinessReason.DAMAGED);
        }
        CalibrationStatus calibration = AssetConditions.calibration(asset.calibrationRequired(),
                asset.calibrationDueAt(), now);
        if (calibration == CalibrationStatus.EXPIRED) {
            blocks.add(ReadinessReason.CALIBRATION_EXPIRED);
        }
        if (!user.maximumAccessLevel().permits(asset.requiredAccessLevel())) {
            blocks.add(ReadinessReason.ACCESS_DENIED);
        }
        if (!blocks.isEmpty()) {
            return new ReadinessAssessment(asset.id(), user.id(), ReadinessResult.BLOCKED, blocks.stream().toList(),
                    now);
        }
        // A required calibration without a due date proves nothing (document 03, section 5.4; document 06, 4.4
        // note): like missing physical proof, it can never become READY.
        if (presence == Presence.UNKNOWN || calibration == CalibrationStatus.UNKNOWN) {
            return new ReadinessAssessment(asset.id(), user.id(), ReadinessResult.UNKNOWN,
                    List.of(ReadinessReason.UNKNOWN_PHYSICAL_STATE), now);
        }
        return new ReadinessAssessment(asset.id(), user.id(), ReadinessResult.READY, List.of(), now);
    }
}
