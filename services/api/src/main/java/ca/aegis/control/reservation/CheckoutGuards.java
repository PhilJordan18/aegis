package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.asset.ReadinessResult;
import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.DisplayEncryption;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.locker.LockerSchedules;
import ca.aegis.control.locker.OpenWindow;
import ca.aegis.control.locker.OperatingHours;
import ca.aegis.control.locker.OperatingHoursException;
import ca.aegis.control.reservation.PreparationRepository.Cell;
import ca.aegis.control.reservation.ReservationRepository.LockedUser;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;
import ca.aegis.control.shared.web.ApiError;

/**
 * The guards of a checkout shared by its preparation (document 06, section 6.4), its local authorization (section
 * 6.5) and the {@code CHECKOUT} value of {@code availableActions} (document 09, section 8.10).
 */
@Component
class CheckoutGuards {

    private final ReservationRepository reservations;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final LockerSchedules schedules;
    private final LockerAvailability availability;
    private final DisplayEncryption encryption;

    CheckoutGuards(ReservationRepository reservations, PreparationRepository preparation, ReservableAssets assets,
            LockerSchedules schedules, LockerAvailability availability, DisplayEncryption encryption) {
        this.reservations = reservations;
        this.preparation = preparation;
        this.assets = assets;
        this.schedules = schedules;
        this.availability = availability;
        this.encryption = encryption;
    }

    /**
     * Document 06, section 6.1: a connected cell with a healthy reader, a door known {@code CLOSED} and a lock known
     * {@code LOCKED}. A cell that cannot report is unavailable; an unknown door or lock is missing proof; a known
     * open door, unlocked lock or disabled compartment is unsafe.
     */
    static void requireSafe(Cell cell) {
        if (!cell.enabled()) {
            throw new ReservationRefusedException(ApiError.COMPARTMENT_STATE_UNSAFE);
        }
        if (!"CONNECTED".equals(cell.connectionStatus()) || !"HEALTHY".equals(cell.readerStatus())) {
            throw new ReservationRefusedException(ApiError.DEVICE_UNAVAILABLE);
        }
        if ("UNKNOWN".equals(cell.doorState()) || "UNKNOWN".equals(cell.lockState())) {
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
        if (!"CLOSED".equals(cell.doorState()) || !"LOCKED".equals(cell.lockState())) {
            throw new ReservationRefusedException(ApiError.COMPARTMENT_STATE_UNSAFE);
        }
    }

    /** The operating window open at {@code now}; {@code OUTSIDE_OPERATING_HOURS} otherwise. */
    OpenWindow requireOpen(UUID lockerId, Instant now) {
        try {
            return schedules.activeScheduleOf(lockerId)
                    .map(schedule -> OperatingHours.requireOpenOperatingWindow(schedule, now))
                    .orElseThrow(() -> new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS));
        } catch (OperatingHoursException outside) {
            throw new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
        }
    }

    /**
     * Document 09, section 8.10: whether a preparation of {@code row} by its holder would pass every guard at
     * {@code now}, read without locks. It is a display hint: the preparation evaluates the same guards again under
     * its locks. The rate limit of section 15.5 is deliberately not reflected.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    boolean checkoutAdmissible(ReservationRow row, Instant now) {
        if (!encryption.enabled() || row.status() != ReservationStatus.ACTIVE || !now.isBefore(row.reservedUntil())) {
            return false;
        }
        Optional<LockedUser> user = reservations.findUser(row.userId())
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN);
        AssetSummary asset = assets.summaries(List.of(row.assetId())).get(row.assetId());
        if (user.isEmpty() || asset == null || asset.placement() == null) {
            return false;
        }
        UUID lockerId = asset.placement().lockerId();
        Optional<Cell> cell = preparation.placedCell(asset.id(), lockerId);
        try {
            requireOpen(lockerId, now);
            requireSafe(cell.orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN)));
        } catch (ReservationRefusedException refused) {
            return false;
        }
        // Readiness in the holder's checkout context includes the access level and the asset's custody.
        return availability.of(lockerId, now).status() == ConnectionStatus.ONLINE
                && preparation.activeDevice(lockerId).map(PreparationRepository.Device::deviceSessionId).isPresent()
                && preparation.activeRfidIdentifier(asset.id()).isPresent()
                && !preparation.hasUnresolvedAnomaly(asset.id(), cell.get().id())
                && !preparation.hasOpenOperation(lockerId)
                && assets.readinessForCheckout(asset.id(), row.userId(), user.get().maximumAccessLevel(), now)
                        .result() == ReadinessResult.READY;
    }
}
