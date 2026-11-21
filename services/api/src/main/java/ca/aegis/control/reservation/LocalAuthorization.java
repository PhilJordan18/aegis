package ca.aegis.control.reservation;

import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
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
import ca.aegis.control.command.CommandOutbox;
import ca.aegis.control.command.UnlockCommand;
import ca.aegis.control.device.ConnectionStatus;
import ca.aegis.control.device.LockerAvailability;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.loan.LoanStatus;
import ca.aegis.control.reservation.PreparationRepository.Cell;
import ca.aegis.control.reservation.ReservationRepository.LockedUser;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;
import ca.aegis.control.shared.web.ApiError;

/**
 * The local authorization of a prepared checkout or return by the hub's QR (document 06, section 6.5; document 09, section 15.5;
 * #44). In the transaction of the idempotency key, which it joins, it consumes the challenge once, makes the operation
 * {@code AUTHORIZED} for 120 seconds and queues its single {@code UNLOCK_COMPARTMENT}; a return also moves its
 * loan from {@code ACTIVE} to {@code RETURN_PENDING} (#50).
 *
 * <p>A refusal that changes state is returned, not thrown, so that it commits with the idempotency key and a replay
 * neither counts it again nor runs it again: a counted wrong secret, the fifth that ends the attempt, a deadline found
 * passed and a hub found restarted. Every other refusal is thrown and changes nothing; a challenge that can no longer
 * succeed then ends at its deadline (at most 60 seconds), through {@link LocalChallengeExpiry}.
 */
@Service
class LocalAuthorization {

    /** Document 06, section 6.5: the physical window starts at the local authorization. */
    static final Duration PHYSICAL_WINDOW = Duration.ofSeconds(120);
    /** Document 06, section 6.5: the fifth wrong secret submitted by the initiator invalidates the challenge. */
    static final int MAX_FAILED_ATTEMPTS = 5;
    /** Base64url without padding of the 32 random bytes of document 10, section 27.1. */
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");

    /** The decision: the authorized operation, or a refusal that committed a change. */
    sealed interface Outcome {
    }

    record Authorized(LockerOperationView operation) implements Outcome {
    }

    record Refused(ApiError error) implements Outcome {
    }

    private record Operation(UUID id, UUID userId, String type, String status, UUID assetId, UUID reservationId,
            UUID loanId, UUID lockerId, UUID compartmentId) {

        boolean isReturn() {
            return LockerOperationType.RETURN.name().equals(type);
        }
    }

    private record Challenge(UUID id, String status, Instant expiresAt, Instant displayedAt, UUID targetSession,
            int failedAttempts, byte[] tokenHash) {
    }

    private final JdbcClient jdbc;
    private final ReservationRepository reservations;
    private final ReturnRepository loans;
    private final PreparationRepository preparation;
    private final ReservableAssets assets;
    private final CheckoutGuards guards;
    private final LockerAvailability availability;
    private final LocalChallengeRepository challenges;
    private final LocalChallengeExpiry endings;
    private final CommandOutbox commands;
    private final LockerOperationReads reads;
    private final AuditTrail audit;
    private final Clock clock;

    LocalAuthorization(JdbcClient jdbc, ReservationRepository reservations, ReturnRepository loans,
            PreparationRepository preparation,
            ReservableAssets assets, CheckoutGuards guards, LockerAvailability availability,
            LocalChallengeRepository challenges, LocalChallengeExpiry endings, CommandOutbox commands,
            LockerOperationReads reads, AuditTrail audit, Clock clock) {
        this.jdbc = jdbc;
        this.reservations = reservations;
        this.loans = loans;
        this.preparation = preparation;
        this.assets = assets;
        this.guards = guards;
        this.availability = availability;
        this.challenges = challenges;
        this.endings = endings;
        this.commands = commands;
        this.reads = reads;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Decodes the token of a well-formed request; {@code LOCAL_PROOF_MALFORMED} otherwise. The returned array is the
     * only copy of the secret: the caller clears it.
     */
    static byte[] decodeToken(String token) {
        if (token == null || !TOKEN.matcher(token).matches()) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        byte[] decoded = Base64.getUrlDecoder().decode(token);
        if (decoded.length != CheckoutPreparation.TOKEN_BYTES) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        return decoded;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    Outcome authorize(UUID actorId, UUID operationId, UUID challengeId, byte[] token) {
        LockedUser user = reservations.lockUser(actorId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.FORBIDDEN));
        // Another user's operation is not visible (document 09, section 26.2): its challenge is never touched.
        Operation found = find(operationId).filter(operation -> operation.userId().equals(user.id()))
                .orElseThrow(() -> new ReservationRefusedException(ApiError.OPERATION_NOT_FOUND));
        // Lock order of document 08, section 7.1: user, asset, reservation or loan, locker, compartment, operation,
        // challenge.
        LockedAsset asset = assets.lock(found.assetId()).orElseThrow();
        ReservationRow reservation = found.isReturn() ? null
                : reservations.lock(found.reservationId()).orElseThrow();
        ReturnRepository.LoanRow loan = found.isReturn() ? loans.lock(found.loanId()).orElseThrow() : null;
        preparation.lockLocker(found.lockerId());
        Optional<Cell> placed = preparation.lockPlacedCell(asset.id(), found.lockerId());
        Operation operation = lockOperation(operationId);
        Challenge challenge = lockChallenge(operationId)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.LOCAL_PROOF_CONTEXT_MISMATCH));
        // Read after every lock wait (document 06, section 6.5), at the millisecond precision of the hub contract.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);

        if (!challenge.id().equals(challengeId)) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_CONTEXT_MISMATCH);
        }
        if (!LocalChallengeStatus.PENDING.name().equals(challenge.status())) {
            throw new ReservationRefusedException(switch (LocalChallengeStatus.valueOf(challenge.status())) {
                case CONSUMED -> ApiError.LOCAL_PROOF_ALREADY_USED;
                case EXPIRED -> ApiError.LOCAL_PROOF_EXPIRED;
                default -> ApiError.LOCAL_PROOF_INVALIDATED;
            });
        }
        if (!LockerOperationStatus.AWAITING_LOCAL_PROOF.name().equals(operation.status())) {
            // A pending challenge outlives its attempt only through a defect; it never authorizes it.
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_INVALIDATED);
        }
        if (!now.isBefore(challenge.expiresAt())) {
            end(user, operation, challenge, LocalChallengeStatus.EXPIRED, LockerOperationStatus.EXPIRED,
                    LocalChallengeExpiry.LOCAL_PROOF_EXPIRED, now);
            return new Refused(ApiError.LOCAL_PROOF_EXPIRED);
        }
        if (challenge.displayedAt() == null) {
            // Transient: the display acknowledgement may still arrive; the client retries with a new key.
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_NOT_DISPLAYED);
        }
        UUID currentSession = preparation.activeDevice(operation.lockerId())
                .map(PreparationRepository.Device::deviceSessionId).orElse(null);
        if (!challenge.targetSession().equals(currentSession)) {
            end(user, operation, challenge, LocalChallengeStatus.INVALIDATED, LockerOperationStatus.FAILED,
                    LocalChallengeExpiry.HUB_RESTARTED, now);
            return new Refused(ApiError.LOCAL_PROOF_INVALIDATED);
        }
        if (availability.of(operation.lockerId(), now).status() != ConnectionStatus.ONLINE) {
            throw new ReservationRefusedException(ApiError.LOCKER_OFFLINE);
        }
        if (!MessageDigest.isEqual(challenge.tokenHash(), CheckoutPreparation.sha256(token))) {
            return wrongSecret(user, operation, challenge, now);
        }

        if (operation.isReturn()) {
            ReturnGuards.requireReturnable(loan.status());
        } else {
            requireCheckout(reservation, asset, now);
        }
        requireCommonGuards(asset, operation, placed, now);
        if (!operation.isReturn()) {
            requireCheckoutReadiness(user, asset, now);
        }

        consume(challenge.id(), now);
        authorize(operation.id(), now);
        if (operation.isReturn()) {
            loans.start(loan.id(), now);
        }
        UnlockCommand command = commands.enqueueUnlock(operation.id(), now);
        int purged = challenges.stopDisplay(challenge.id());

        Map<String, Object> details = new LinkedHashMap<>(LocalChallengeExpiry.source(operation.reservationId(),
                operation.loanId()));
        details.put("compartmentId", operation.compartmentId());
        details.put("expiresAt", now.plus(PHYSICAL_WINDOW));
        details.put("commandMessageId", command.messageId());
        audit.record(AuditEvent.transition(AuditEventType.OPERATION_AUTHORIZED, user.id(),
                AuditSubjectType.LOCKER_OPERATION, operation.id(), operation.id(),
                LockerOperationStatus.AWAITING_LOCAL_PROOF, LockerOperationStatus.AUTHORIZED, null, details, now));
        audit.record(AuditEvent.transition(AuditEventType.LOCAL_CHALLENGE_CONSUMED, user.id(),
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, challenge.id(), operation.id(), LocalChallengeStatus.PENDING,
                LocalChallengeStatus.CONSUMED, null, Map.of("displayInstructionsStopped", purged), now));
        if (operation.isReturn()) {
            // Document 05, section 4.3: the loan stays open, now waiting for the physical proof of its return.
            audit.record(AuditEvent.transition(AuditEventType.LOAN_RETURN_STARTED, user.id(), AuditSubjectType.LOAN,
                    loan.id(), operation.id(), LoanStatus.ACTIVE,
                    LoanStatus.RETURN_PENDING, null,
                    Map.of("assetId", asset.id(), "returnRequestedAt", now.toString()), now));
        }
        return new Authorized(reads.find(operation.id()).orElseThrow());
    }

    /**
     * Document 06, section 6.5: the attempt counts in a committed transaction; the fifth ends the challenge and the
     * operation. The audit never carries the submitted value.
     */
    private Outcome wrongSecret(LockedUser user, Operation operation, Challenge challenge, Instant now) {
        int attempts = challenge.failedAttempts() + 1;
        audit.record(new AuditEvent(AuditEventType.LOCAL_CHALLENGE_REJECTED, user.id(),
                AuditSubjectType.LOCAL_ACCESS_CHALLENGE, challenge.id(), operation.id(), null, null,
                AuditResult.REJECTED, ApiError.LOCAL_PROOF_INVALID.name(),
                Map.of("failedAttempts", attempts, "maxFailedAttempts", MAX_FAILED_ATTEMPTS), now));
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            end(user, operation, challenge, LocalChallengeStatus.INVALIDATED, LockerOperationStatus.FAILED,
                    LocalChallengeExpiry.LOCAL_PROOF_ATTEMPTS_EXHAUSTED, now);
        } else {
            int updated = jdbc.sql("""
                    UPDATE aegis.local_access_challenges SET failed_attempts = failed_attempts + 1
                    WHERE id = :id AND status = 'PENDING' AND failed_attempts = :seen
                    """).param("id", challenge.id()).param("seen", challenge.failedAttempts()).update();
            if (updated != 1) {
                throw new IllegalStateException("A locked local challenge changed state: " + challenge.id());
            }
        }
        return new Refused(ApiError.LOCAL_PROOF_INVALID);
    }

    /** Document 06, section 6.2: the reservation still ACTIVE and before its end, and no open loan of the asset. */
    private void requireCheckout(ReservationRow reservation, LockedAsset asset, Instant now) {
        if (reservation.status() != ReservationStatus.ACTIVE || !now.isBefore(reservation.reservedUntil())) {
            throw new ReservationRefusedException(ApiError.ACTIVE_RESERVATION_NOT_FOUND);
        }
        if (reservations.lockOpenLoanOfAsset(asset.id())) {
            throw new ReservationRefusedException(ApiError.ASSET_HAS_OPEN_LOAN);
        }
    }

    /**
     * Document 06, sections 6.1 and 6.5: schedule and every locker guard of the preparation, evaluated again at
     * {@code now}; the only open operation allowed on the locker is this one.
     */
    private void requireCommonGuards(LockedAsset asset, Operation operation, Optional<Cell> placed, Instant now) {
        guards.requireOpen(operation.lockerId(), now);
        // The asset must still be placed in the compartment the challenge was prepared for.
        if (!operation.lockerId().equals(asset.lockerId()) || placed.isEmpty()
                || !placed.get().id().equals(operation.compartmentId())) {
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
        CheckoutGuards.requireSafe(placed.get());
        if (preparation.activeRfidIdentifier(asset.id()).isEmpty()
                || preparation.hasUnresolvedAnomaly(asset.id(), operation.compartmentId())) {
            throw new ReservationRefusedException(ApiError.PHYSICAL_STATE_UNKNOWN);
        }
        if (hasOtherOpenOperation(operation.lockerId(), operation.id())) {
            throw new ReservationRefusedException(ApiError.LOCKER_OPERATION_IN_PROGRESS);
        }
    }

    /** Document 06, section 6.2: the holder's access level and the readiness, which a return never requires. */
    private void requireCheckoutReadiness(LockedUser user, LockedAsset asset, Instant now) {
        if (!user.maximumAccessLevel().permits(asset.requiredAccessLevel())) {
            throw new ReservationRefusedException(ApiError.ASSET_ACCESS_DENIED);
        }
        ReadinessAssessment readiness = assets.readinessForCheckout(asset.id(), user.id(), user.maximumAccessLevel(),
                now);
        if (readiness.result() != ReadinessResult.READY) {
            throw new ReservationRefusedException(ApiError.ASSET_NOT_READY,
                    readiness.reasons().stream().map(ReadinessReason::name).toList());
        }
    }

    private void end(LockedUser user, Operation operation, Challenge challenge, LocalChallengeStatus closed,
            LockerOperationStatus terminal, String reason, Instant now) {
        endings.end(challenge.id(), operation.id(),
                LocalChallengeExpiry.source(operation.reservationId(), operation.loanId()), operation.lockerId(),
                user.id(), closed, terminal, reason, now);
    }

    private Optional<Operation> find(UUID operationId) {
        return jdbc.sql(OPERATION + " WHERE id = :id").param("id", operationId).query(LocalAuthorization::operation)
                .optional();
    }

    private Operation lockOperation(UUID operationId) {
        return jdbc.sql(OPERATION + " WHERE id = :id FOR UPDATE").param("id", operationId)
                .query(LocalAuthorization::operation).single();
    }

    private static final String OPERATION = """
            SELECT id, user_id, type, status, asset_id, reservation_id, loan_id, locker_id, compartment_id
            FROM aegis.locker_operations""";

    private static Operation operation(java.sql.ResultSet row, int number) throws java.sql.SQLException {
        return new Operation(row.getObject("id", UUID.class), row.getObject("user_id", UUID.class),
                row.getString("type"), row.getString("status"), row.getObject("asset_id", UUID.class),
                row.getObject("reservation_id", UUID.class), row.getObject("loan_id", UUID.class),
                row.getObject("locker_id", UUID.class),
                row.getObject("compartment_id", UUID.class));
    }

    private Optional<Challenge> lockChallenge(UUID operationId) {
        return jdbc.sql("""
                SELECT id, status, expires_at, displayed_at, target_device_session_id, failed_attempts, token_hash
                FROM aegis.local_access_challenges WHERE operation_id = :id FOR UPDATE
                """).param("id", operationId)
                .query((row, number) -> new Challenge(row.getObject("id", UUID.class), row.getString("status"),
                        row.getObject("expires_at", OffsetDateTime.class).toInstant(),
                        Optional.ofNullable(row.getObject("displayed_at", OffsetDateTime.class))
                                .map(OffsetDateTime::toInstant).orElse(null),
                        row.getObject("target_device_session_id", UUID.class), row.getInt("failed_attempts"),
                        row.getBytes("token_hash")))
                .optional();
    }

    private boolean hasOtherOpenOperation(UUID lockerId, UUID operationId) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM aegis.locker_operations
                    WHERE locker_id = :locker AND id <> :id
                      AND status NOT IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')
                )
                """).param("locker", lockerId).param("id", operationId).query(Boolean.class).single();
    }

    private void consume(UUID challengeId, Instant now) {
        int updated = jdbc.sql("""
                UPDATE aegis.local_access_challenges SET status = 'CONSUMED', consumed_at = :now, closed_at = :now
                WHERE id = :id AND status = 'PENDING'
                """).param("now", now.atOffset(ZoneOffset.UTC)).param("id", challengeId).update();
        if (updated != 1) {
            throw new IllegalStateException("A locked local challenge changed state: " + challengeId);
        }
    }

    private void authorize(UUID operationId, Instant now) {
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        int updated = jdbc.sql("""
                UPDATE aegis.locker_operations
                SET status = 'AUTHORIZED', authorized_at = :now, local_proof_validated_at = :now, expires_at = :expires
                WHERE id = :id AND status = 'AWAITING_LOCAL_PROOF'
                """).param("now", at).param("expires", at.plus(PHYSICAL_WINDOW)).param("id", operationId).update();
        if (updated != 1) {
            throw new IllegalStateException("A locked operation changed state: " + operationId);
        }
    }

    /** Clears a decoded secret once the decision no longer needs it. */
    static void clear(byte[] token) {
        Arrays.fill(token, (byte) 0);
    }
}
