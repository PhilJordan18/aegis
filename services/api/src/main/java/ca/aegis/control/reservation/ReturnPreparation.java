package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
import ca.aegis.control.reservation.ReturnRepository.LoanRow;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Preparation of a return without any opening (document 06, section 6.4; document 09, section 15.2; #50). Like the
 * checkout's, it creates the operation {@code AWAITING_LOCAL_PROOF}, its challenge and the encrypted display
 * instruction, and never a lock command. The loan keeps its state: it becomes {@code RETURN_PENDING} only at the local
 * authorization.
 */
@Service
class ReturnPreparation {

    private final ReservationRepository reservations;
    private final ReturnRepository loans;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final CheckoutGuards guards;
    private final ReturnGuards returnGuards;
    private final ChallengeIssuer issuer;
    private final DisplayEncryption encryption;
    private final LockerOperationReads reads;
    private final AuditTrail audit;
    private final Clock clock;

    ReturnPreparation(ReservationRepository reservations, ReturnRepository loans, PreparationRepository preparation,
            ReservableAssets assets, CheckoutGuards guards, ReturnGuards returnGuards, ChallengeIssuer issuer,
            DisplayEncryption encryption, LockerOperationReads reads, AuditTrail audit, Clock clock) {
        this.reservations = reservations;
        this.loans = loans;
        this.preparation = preparation;
        this.assets = assets;
        this.guards = guards;
        this.returnGuards = returnGuards;
        this.issuer = issuer;
        this.encryption = encryption;
        this.reads = reads;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    LockerOperationView prepare(UUID actorId, UUID loanId) {
        if (!encryption.enabled()) {
            throw new ReservationRefusedException(ApiError.LOCKER_OFFLINE);
        }
        LockedUser user = reservations.lockUser(actorId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.FORBIDDEN));
        // Another holder's loan is not visible, so it is not found (document 09, sections 15.3 and 26.2).
        UUID assetId = loans.find(loanId).filter(row -> row.holderUserId().equals(user.id()))
                .map(LoanRow::assetId).orElseThrow(ResourceNotFoundException::new);
        // Lock order of document 08, section 7.1: user, asset, loan, locker, compartment.
        LockedAsset asset = assets.lock(assetId).orElseThrow();
        LoanRow loan = loans.lock(loanId).orElseThrow();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);

        ReturnGuards.requireReturnable(loan.status());
        if (asset.lockerId() == null) {
            // The asset lost its placement: the cell that must receive it is unknown.
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
        UUID lockerId = asset.lockerId();
        OpenWindow window = guards.requireOpen(lockerId, now);

        preparation.lockLocker(lockerId);
        Cell cell = preparation.lockPlacedCell(asset.id(), lockerId)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN));
        Device device = issuer.requireOnline(lockerId, now);
        returnGuards.requireCell(asset.id(), cell);
        UUID identifierId = preparation.activeRfidIdentifier(asset.id()).orElseThrow();
        if (preparation.hasOpenOperation(lockerId)) {
            throw new ReservationRefusedException(ApiError.LOCKER_OPERATION_IN_PROGRESS);
        }
        issuer.requireRateAllowed(user.id(), lockerId, now);
        Instant expiresAt = ChallengeIssuer.challengeExpiry(now, window.closesAt());

        UUID operationId;
        try {
            operationId = loans.insertReturn(user.id(), asset.id(), cell, loanId, identifierId, now);
        } catch (DataIntegrityViolationException violation) {
            throw ChallengeIssuer.translate(violation);
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("loanId", loanId);
        details.put("assetId", asset.id());
        details.put("lockerId", lockerId);
        details.put("compartmentId", cell.id());
        details.put("status", LockerOperationStatus.AWAITING_LOCAL_PROOF.name());
        audit.record(new AuditEvent(AuditEventType.OPERATION_REQUESTED, user.id(),
                AuditSubjectType.LOCKER_OPERATION, operationId, AuditResult.ACCEPTED, details, now));
        issuer.issue(user.id(), operationId, LockerOperationType.RETURN, cell, device, now, expiresAt);
        return reads.find(operationId).orElseThrow();
    }
}
