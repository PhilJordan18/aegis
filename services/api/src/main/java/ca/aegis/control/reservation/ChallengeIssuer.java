package ca.aegis.control.reservation;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.display.HubDisplayOutbox;
import ca.aegis.control.display.HubDisplayOutbox.Target;
import ca.aegis.control.reservation.PreparationRepository.Cell;
import ca.aegis.control.reservation.PreparationRepository.Device;
import ca.aegis.control.shared.web.ApiError;

/**
 * The part of a preparation shared by the checkout and the return (document 06, section 6.4): the hub guard, the rate
 * limit of document 09, section 15.5, and the challenge bound to the hub's current boot with its encrypted
 * {@code DISPLAY_ACCESS_CHALLENGE}. Every method joins the preparation's transaction, under its locks.
 */
@Component
class ChallengeIssuer {

    /** Document 06, section 6.4: the challenge never lives longer than 60 seconds. */
    static final Duration CHALLENGE_WINDOW = Duration.ofSeconds(60);
    private static final String ONE_OPEN_PER_LOCKER = "ux_locker_operations_one_open_per_locker";

    private final PreparationRepository preparation;
    private final LockerAvailability availability;
    private final HubDisplayOutbox display;
    private final AuditTrail audit;
    private final int maxPreparations;
    private final Duration preparationWindow;
    private final SecureRandom random = new SecureRandom();

    ChallengeIssuer(PreparationRepository preparation, LockerAvailability availability, HubDisplayOutbox display,
            AuditTrail audit, @Value("${aegis.display.preparation.max-per-window:6}") int maxPreparations,
            @Value("${aegis.display.preparation.window:PT10M}") Duration preparationWindow) {
        if (maxPreparations < 1 || preparationWindow.isNegative() || preparationWindow.isZero()) {
            throw new IllegalStateException("aegis.display.preparation needs a positive limit and window");
        }
        this.preparation = preparation;
        this.availability = availability;
        this.display = display;
        this.audit = audit;
        this.maxPreparations = maxPreparations;
        this.preparationWindow = preparationWindow;
    }

    /** Document 06, section 6.1: a hub {@code ONLINE} now, whose current boot the challenge can target. */
    Device requireOnline(UUID lockerId, Instant now) {
        if (availability.of(lockerId, now).status() != ConnectionStatus.ONLINE) {
            throw new ReservationRefusedException(ApiError.LOCKER_OFFLINE);
        }
        return preparation.activeDevice(lockerId).filter(device -> device.deviceSessionId() != null)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.LOCKER_OFFLINE));
    }

    /**
     * Document 09, section 15.5: at most the configured number of new preparations per user–locker pair in the
     * sliding window, whatever their type; the client may retry once the oldest counted one leaves it.
     */
    void requireRateAllowed(UUID userId, UUID lockerId, Instant now) {
        Instant windowStart = now.minus(preparationWindow);
        if (preparation.preparationsSince(userId, lockerId, windowStart) >= maxPreparations) {
            Instant retryAt = preparation.oldestPreparationSince(userId, lockerId, windowStart)
                    .plus(preparationWindow);
            long seconds = (Duration.between(now, retryAt).toMillis() + 999) / 1000;
            throw new LocalProofRateLimitedException(seconds);
        }
    }

    /** The challenge deadline: 60 seconds at most, and never past any of {@code limits}. */
    static Instant challengeExpiry(Instant now, Instant... limits) {
        Instant expiresAt = now.plus(CHALLENGE_WINDOW);
        for (Instant limit : limits) {
            if (limit.isBefore(expiresAt)) {
                expiresAt = limit;
            }
        }
        expiresAt = expiresAt.truncatedTo(ChronoUnit.MILLIS);
        if (!expiresAt.isAfter(now)) {
            throw new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
        }
        return expiresAt;
    }

    /**
     * Creates the challenge of an operation just inserted {@code AWAITING_LOCAL_PROOF} and its encrypted display
     * instruction; stores the SHA-256 of the token only and clears the token before returning.
     */
    UUID issue(UUID actorId, UUID operationId, LockerOperationType type, Cell cell, Device device, Instant now,
            Instant expiresAt) {
        byte[] token = new byte[CheckoutPreparation.TOKEN_BYTES];
        random.nextBytes(token);
        UUID challengeId;
        UUID displayMessageId;
        try {
            challengeId = preparation.insertChallenge(operationId, cell.lockerId(), device,
                    CheckoutPreparation.sha256(token), now, expiresAt);
            displayMessageId = display.enqueueChallenge(new Target(cell.lockerId(), device.id(),
                    device.deviceSessionId()), operationId, cell.id(), cell.code(), challengeId, type.name(), token,
                    now, expiresAt);
        } finally {
            Arrays.fill(token, (byte) 0);
        }
        audit.record(new AuditEvent(AuditEventType.LOCAL_CHALLENGE_CREATED, actorId,
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, challengeId, operationId, null, null,
                ca.aegis.control.audit.AuditResult.ACCEPTED, null, Map.of("expiresAt", expiresAt,
                        "targetDeviceSessionId", device.deviceSessionId(), "displayMessageId", displayMessageId),
                now));
        return challengeId;
    }

    /** The per-locker index stays the final guard against a concurrent operation (document 08, section 5.1). */
    static RuntimeException translate(DataIntegrityViolationException violation) {
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
