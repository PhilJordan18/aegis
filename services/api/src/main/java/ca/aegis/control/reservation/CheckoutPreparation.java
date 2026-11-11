package ca.aegis.control.reservation;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.beans.factory.annotation.Value;
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
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.DisplayEncryption;
import ca.aegis.control.display.HubDisplayOutbox;
import ca.aegis.control.display.HubDisplayOutbox.Target;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.locker.LockerSchedules;
import ca.aegis.control.locker.OpenWindow;
import ca.aegis.control.locker.OperatingHours;
import ca.aegis.control.locker.OperatingHoursException;
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

    /** Document 06, section 6.4: the challenge never lives longer than 60 seconds. */
    static final Duration CHALLENGE_WINDOW = Duration.ofSeconds(60);
    static final int TOKEN_BYTES = 32;
    private static final String ONE_OPEN_PER_LOCKER = "ux_locker_operations_one_open_per_locker";

    private final ReservationRepository reservations;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final LockerSchedules schedules;
    private final LockerAvailability availability;
    private final DisplayEncryption encryption;
    private final HubDisplayOutbox display;
    private final LockerOperationReads reads;
    private final AuditTrail audit;
    private final Clock clock;
    private final int maxPreparations;
    private final Duration preparationWindow;
    private final SecureRandom random = new SecureRandom();

    CheckoutPreparation(ReservationRepository reservations, PreparationRepository preparation,
            ReservableAssets assets, LockerSchedules schedules, LockerAvailability availability,
            DisplayEncryption encryption, HubDisplayOutbox display, LockerOperationReads reads, AuditTrail audit,
            Clock clock, @Value("${aegis.display.preparation.max-per-window:6}") int maxPreparations,
            @Value("${aegis.display.preparation.window:PT10M}") Duration preparationWindow) {
        if (maxPreparations < 1 || preparationWindow.isNegative() || preparationWindow.isZero()) {
            throw new IllegalStateException("aegis.display.preparation needs a positive limit and window");
        }
        this.reservations = reservations;
        this.preparation = preparation;
        this.assets = assets;
        this.schedules = schedules;
        this.availability = availability;
        this.encryption = encryption;
        this.display = display;
        this.reads = reads;
        this.audit = audit;
        this.clock = clock;
        this.maxPreparations = maxPreparations;
        this.preparationWindow = preparationWindow;
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
        OpenWindow window = openWindow(lockerId, now);

        preparation.lockLocker(lockerId);
        Cell cell = preparation.lockPlacedCell(asset.id(), lockerId)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN));
        Device device = requireOnline(lockerId, now);
        requireSafe(cell);
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
        Instant windowStart = now.minus(preparationWindow);
        if (preparation.preparationsSince(user.id(), lockerId, windowStart) >= maxPreparations) {
            // Document 09, section 15.5: the client may retry once the oldest counted preparation leaves the window.
            Instant retryAt = preparation.oldestPreparationSince(user.id(), lockerId, windowStart)
                    .plus(preparationWindow);
            long seconds = (Duration.between(now, retryAt).toMillis() + 999) / 1000;
            throw new LocalProofRateLimitedException(seconds);
        }

        Instant expiresAt = earliest(now.plus(CHALLENGE_WINDOW), window.closesAt(), reservation.reservedUntil())
                .truncatedTo(ChronoUnit.MILLIS);
        if (!expiresAt.isAfter(now)) {
            throw new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
        }

        UUID operationId;
        try {
            operationId = preparation.insertCheckout(user.id(), asset.id(), cell, reservationId, identifierId, now);
        } catch (DataIntegrityViolationException violation) {
            throw translate(violation);
        }
        byte[] token = new byte[TOKEN_BYTES];
        random.nextBytes(token);
        UUID challengeId;
        UUID displayMessageId;
        try {
            challengeId = preparation.insertChallenge(operationId, lockerId, device, sha256(token), now, expiresAt);
            displayMessageId = display.enqueueChallenge(new Target(lockerId, device.id(), device.deviceSessionId()),
                    operationId, cell.id(), cell.code(), challengeId, LockerOperationType.CHECKOUT.name(), token, now,
                    expiresAt);
        } finally {
            Arrays.fill(token, (byte) 0);
        }

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("reservationId", reservationId);
        details.put("assetId", asset.id());
        details.put("lockerId", lockerId);
        details.put("compartmentId", cell.id());
        details.put("status", LockerOperationStatus.AWAITING_LOCAL_PROOF.name());
        audit.record(new AuditEvent(AuditEventType.OPERATION_REQUESTED, user.id(),
                AuditSubjectType.LOCKER_OPERATION, operationId, AuditResult.ACCEPTED, details, now));
        audit.record(new AuditEvent(AuditEventType.LOCAL_CHALLENGE_CREATED, user.id(),
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, challengeId, operationId, null, null, AuditResult.ACCEPTED,
                null, Map.of("expiresAt", expiresAt, "targetDeviceSessionId", device.deviceSessionId(),
                        "displayMessageId", displayMessageId), now));
        return reads.find(operationId).orElseThrow();
    }

    private OpenWindow openWindow(UUID lockerId, Instant now) {
        try {
            return schedules.activeScheduleOf(lockerId)
                    .map(schedule -> OperatingHours.requireOpenOperatingWindow(schedule, now))
                    .orElseThrow(() -> new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS));
        } catch (OperatingHoursException outside) {
            throw new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
        }
    }

    /** Document 06, section 6.1: a hub {@code ONLINE} now, whose current boot the challenge can target. */
    private Device requireOnline(UUID lockerId, Instant now) {
        if (availability.of(lockerId, now).status() != ConnectionStatus.ONLINE) {
            throw new ReservationRefusedException(ApiError.LOCKER_OFFLINE);
        }
        return preparation.activeDevice(lockerId).filter(device -> device.deviceSessionId() != null)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.LOCKER_OFFLINE));
    }

    /**
     * Document 06, section 6.1: a connected cell with a healthy reader, a door known {@code CLOSED} and a lock known
     * {@code LOCKED}. A cell that cannot report is unavailable; an unknown door or lock is missing proof; a known
     * open door, unlocked lock or disabled compartment is unsafe.
     */
    private static void requireSafe(Cell cell) {
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

    private static Instant earliest(Instant first, Instant... others) {
        Instant earliest = first;
        for (Instant other : others) {
            if (other.isBefore(earliest)) {
                earliest = other;
            }
        }
        return earliest;
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

    /** The per-locker index stays the final guard against a concurrent operation (document 08, section 5.1). */
    private static RuntimeException translate(DataIntegrityViolationException violation) {
        for (Throwable cause = violation; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres) {
                ServerErrorMessage message = postgres.getServerErrorMessage();
                return message != null && ONE_OPEN_PER_LOCKER.equals(message.getConstraint())
                        ? new ReservationRefusedException(ApiError.LOCKER_OPERATION_IN_PROGRESS) : violation;
            }
        }
        return violation;
    }
}
