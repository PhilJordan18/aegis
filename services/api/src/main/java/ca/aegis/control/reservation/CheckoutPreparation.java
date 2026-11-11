package ca.aegis.control.reservation;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.ReadinessAssessment;
import ca.aegis.control.asset.ReadinessReason;
import ca.aegis.control.asset.ReadinessResult;
import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.asset.ReservableAssets.LockedAsset;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.display.DisplayEncryption;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.locker.OpenWindow;
import ca.aegis.control.reservation.PreparationRepository.Cell;
import ca.aegis.control.reservation.PreparationRepository.Device;
import ca.aegis.control.reservation.ReservationRepository.LockedUser;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Preparation of a checkout without any opening (document 06, section 6.4; document 09, section 15.1; #43, #46). In
 * the transaction of the idempotency key, which it joins, it creates the operation {@code AWAITING_LOCAL_PROOF}, its
 * challenge bound to the hub's current boot, and the encrypted {@code DISPLAY_ACCESS_CHALLENGE}. It never inserts
 * into {@code command_outbox}: only the local authorization of document 06, section 6.5 may.
 */
@Service
class CheckoutPreparation {

    static final int TOKEN_BYTES = 32;

    private final ReservationRepository reservations;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final CheckoutGuards guards;
    private final ChallengeIssuer issuer;
    private final DisplayEncryption encryption;
    private final LockerOperationReads reads;
    private final AuditTrail audit;
    private final Clock clock;

    CheckoutPreparation(ReservationRepository reservations, PreparationRepository preparation,
            ReservableAssets assets, CheckoutGuards guards, ChallengeIssuer issuer, DisplayEncryption encryption,
            LockerOperationReads reads, AuditTrail audit, Clock clock) {
        this.reservations = reservations;
        this.preparation = preparation;
        this.assets = assets;
        this.guards = guards;
        this.issuer = issuer;
        this.encryption = encryption;
        this.reads = reads;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    LockerOperationView prepare(UUID actorId, UUID reservationId) {
        if (!encryption.enabled()) {
            // Without the hub challenge flow no opening can ever be authorized: the locker cannot serve it.
            throw new ReservationRefusedException(ApiError.LOCKER_OFFLINE);
        }
        LockedUser user = reservations.lockUser(actorId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.FORBIDDEN));
        // Another technician's reservation is not visible, so it is not found (document 09, section 26.2).
        UUID assetId = reservations.find(reservationId).filter(row -> row.userId().equals(user.id()))
                .map(ReservationRow::assetId).orElseThrow(ResourceNotFoundException::new);
        LockedAsset asset = assets.lock(assetId).orElseThrow();
        ReservationRow reservation = reservations.lock(reservationId).orElseThrow();
        // Read after every lock wait (document 06, section 6.5), at the millisecond precision of the hub contract.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);

        if (reservation.status() != ReservationStatus.ACTIVE || !now.isBefore(reservation.reservedUntil())) {
            throw new ReservationRefusedException(ApiError.ACTIVE_RESERVATION_NOT_FOUND);
        }
        if (reservations.lockOpenLoanOfAsset(asset.id())) {
            throw new ReservationRefusedException(ApiError.ASSET_HAS_OPEN_LOAN);
        }
        if (asset.lockerId() == null) {
            throw notReady(List.of(ReadinessReason.UNKNOWN_PHYSICAL_STATE));
        }
        UUID lockerId = asset.lockerId();
        OpenWindow window = guards.requireOpen(lockerId, now);

        preparation.lockLocker(lockerId);
        Cell cell = preparation.lockPlacedCell(asset.id(), lockerId)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN));
        Device device = issuer.requireOnline(lockerId, now);
        CheckoutGuards.requireSafe(cell);
        UUID identifierId = preparation.activeRfidIdentifier(asset.id())
                .orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN));
        if (preparation.hasUnresolvedAnomaly(asset.id(), cell.id())) {
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
        if (preparation.hasOpenOperation(lockerId)) {
            throw new ReservationRefusedException(ApiError.LOCKER_OPERATION_IN_PROGRESS);
        }
        if (!user.maximumAccessLevel().permits(asset.requiredAccessLevel())) {
            throw new ReservationRefusedException(ApiError.ASSET_ACCESS_DENIED);
        }
        ReadinessAssessment readiness = assets.readinessForCheckout(asset.id(), user.id(), user.maximumAccessLevel(),
                now);
        if (readiness.result() != ReadinessResult.READY) {
            throw notReady(readiness.reasons());
        }
        issuer.requireRateAllowed(user.id(), lockerId, now);
        Instant expiresAt = ChallengeIssuer.challengeExpiry(now, window.closesAt(), reservation.reservedUntil());

        UUID operationId;
        try {
            operationId = preparation.insertCheckout(user.id(), asset.id(), cell, reservationId, identifierId, now);
        } catch (DataIntegrityViolationException violation) {
            throw ChallengeIssuer.translate(violation);
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("reservationId", reservationId);
        details.put("assetId", asset.id());
        details.put("lockerId", lockerId);
        details.put("compartmentId", cell.id());
        details.put("status", LockerOperationStatus.AWAITING_LOCAL_PROOF.name());
        audit.record(new AuditEvent(AuditEventType.OPERATION_REQUESTED, user.id(),
                AuditSubjectType.LOCKER_OPERATION, operationId, AuditResult.ACCEPTED, details, now));
        issuer.issue(user.id(), operationId, LockerOperationType.CHECKOUT, cell, device, now, expiresAt);
        return reads.find(operationId).orElseThrow();
    }

    static byte[] sha256(byte[] token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token);
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 unavailable", unavailable);
        }
    }

    private static ReservationRefusedException notReady(List<ReadinessReason> reasons) {
        return new ReservationRefusedException(ApiError.ASSET_NOT_READY,
                reasons.stream().map(ReadinessReason::name).toList());
    }
}
