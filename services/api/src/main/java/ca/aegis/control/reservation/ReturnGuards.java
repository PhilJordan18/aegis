package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.DisplayEncryption;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.loan.LoanStatus;
import ca.aegis.control.reservation.PreparationRepository.Cell;
import ca.aegis.control.shared.web.ApiError;

/**
 * The guards of a return shared by its preparation (document 06, section 6.4), its local authorization (section 6.5)
 * and the {@code RETURN} value of {@code availableActions} (document 09, section 8.10). Document 06, sections 6.1 and
 * 6.3: the common locker guards and an {@code ACTIVE} loan of the holder. Neither the readiness nor the access level
 * applies: a borrowed asset is returned whatever its readiness, and a holder whose level dropped can still return it.
 *
 * <p>A {@code RETURN_PENDING} loan admits a recovery once a return of it ended in {@code ANOMALY} and no anomaly
 * linked to its returns is still {@code OPEN} (document 06, section 13.4; decision of 21 November 2026, #67).
 */
@Component
public class ReturnGuards {

    private final ReservationRepository reservations;
    private final ReturnRepository loans;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final CheckoutGuards guards;
    private final LockerAvailability availability;
    private final DisplayEncryption encryption;

    ReturnGuards(ReservationRepository reservations, ReturnRepository loans, PreparationRepository preparation, ReservableAssets assets,
            CheckoutGuards guards, LockerAvailability availability, DisplayEncryption encryption) {
        this.reservations = reservations;
        this.loans = loans;
        this.preparation = preparation;
        this.assets = assets;
        this.guards = guards;
        this.availability = availability;
        this.encryption = encryption;
    }

    /**
     * Document 06, sections 6.3 and 13.4: an {@code ACTIVE} loan starts a return; a recoverable
     * {@code RETURN_PENDING} loan starts a recovery. Returns whether the attempt is a recovery.
     */
    boolean requireReturnable(UUID loanId, LoanStatus status) {
        if (status == LoanStatus.ACTIVE) {
            return false;
        }
        if (status == LoanStatus.RETURN_PENDING && loans.recoverable(loanId)) {
            return true;
        }
        throw new ReservationRefusedException(ApiError.LOAN_NOT_RETURNABLE);
    }

    /**
     * The guards that follow the locks of the cell: its state, the asset's active identifier and the absence of an
     * unresolved anomaly, except the acknowledged ones a recovery of {@code recoveredLoanId} resolves. The caller has
     * already checked the hub and the schedule.
     */
    void requireCell(UUID assetId, Cell cell, UUID recoveredLoanId) {
        CheckoutGuards.requireSafe(cell);
        if (preparation.activeRfidIdentifier(assetId).isEmpty() || unresolvedAnomaly(assetId, cell.id(),
                recoveredLoanId)) {
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
    }

    boolean unresolvedAnomaly(UUID assetId, UUID compartmentId, UUID recoveredLoanId) {
        return recoveredLoanId == null ? preparation.hasUnresolvedAnomaly(assetId, compartmentId)
                : preparation.hasUnresolvedAnomaly(assetId, compartmentId, recoveredLoanId);
    }

    /**
     * Document 09, section 8.10: whether the holder's preparation of a return would pass every guard at {@code now},
     * read without locks. It is a display hint: the preparation evaluates the same guards again under its locks. The
     * rate limit of section 15.5 is deliberately not reflected.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean returnAdmissible(UUID holderUserId, UUID assetId, UUID loanId, LoanStatus status, Instant now) {
        if (!encryption.enabled()) {
            return false;
        }
        boolean recovery;
        try {
            recovery = requireReturnable(loanId, status);
        } catch (ReservationRefusedException refused) {
            return false;
        }
        boolean holderActive = reservations.findUser(holderUserId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .isPresent();
        AssetSummary asset = assets.summaries(List.of(assetId)).get(assetId);
        if (!holderActive || asset == null || asset.placement() == null) {
            return false;
        }
        UUID lockerId = asset.placement().lockerId();
        try {
            guards.requireOpen(lockerId, now);
            requireCell(assetId, preparation.placedCell(assetId, lockerId)
                    .orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN)),
                    recovery ? loanId : null);
        } catch (ReservationRefusedException refused) {
            return false;
        }
        return availability.of(lockerId, now).status() == ConnectionStatus.ONLINE
                && preparation.activeDevice(lockerId).map(PreparationRepository.Device::deviceSessionId).isPresent()
                && !preparation.hasOpenOperation(lockerId);
    }
}
