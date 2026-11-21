package ca.aegis.control.reservation;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.AssetSummary;
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
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;
import ca.aegis.control.identity.UserSummaries;
import ca.aegis.control.identity.UserSummary;
import ca.aegis.control.locker.LockerSchedules;
import ca.aegis.control.locker.OpenWindow;
import ca.aegis.control.locker.OperatingHours;
import ca.aegis.control.locker.OperatingHoursException;
import ca.aegis.control.reservation.ReservationRepository.AdminFilter;
import ca.aegis.control.reservation.ReservationRepository.LockedUser;
import ca.aegis.control.reservation.ReservationRepository.ReservationRow;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Reservation use cases (document 06, section 5; document 09, section 14). A reservation is a custody fact only: it
 * never opens a compartment, creates no locker operation and publishes nothing over MQTT.
 */
@Service
class ReservationService {

    /** The final guards of document 08, section 5.1, named as PostgreSQL reports them. */
    private static final Map<String, ApiError> ACTIVE_INDEXES = Map.of(
            "ux_reservations_one_active_per_asset", ApiError.ASSET_ALREADY_RESERVED,
            "ux_reservations_one_active_per_user", ApiError.USER_ALREADY_HAS_ACTIVE_RESERVATION);

    private final ReservationRepository reservations;
    private final CheckoutAttemptRepository attempts;
    private final PendingCheckouts pendingCheckouts;
    private final ReservableAssets assets;
    private final LockerSchedules schedules;
    private final AuditTrail audit;
    private final UserSummaries users;
    private final CheckoutGuards guards;
    private final Clock clock;

    ReservationService(ReservationRepository reservations, CheckoutAttemptRepository attempts,
            PendingCheckouts pendingCheckouts, ReservableAssets assets, LockerSchedules schedules, AuditTrail audit,
            UserSummaries users, CheckoutGuards guards, Clock clock) {
        this.reservations = reservations;
        this.attempts = attempts;
        this.pendingCheckouts = pendingCheckouts;
        this.assets = assets;
        this.schedules = schedules;
        this.audit = audit;
        this.users = users;
        this.guards = guards;
        this.clock = clock;
    }

    /**
     * Document 06, section 5.2, inside the transaction of the idempotency key, which this method joins. Refusals are
     * reported in the order of document 09, section 14.1: conflicts, open loan, operating hours, then access level
     * and readiness. The pre-checks give the precise code; the partial unique indexes stay the final guard.
     */
    @Transactional
    ReservationView create(UUID actorId, CreateReservationRequest request) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant requestedUntil = request.reservedUntil();
        // PostgreSQL keeps microseconds: the stored end is never later than the requested one, and still after now.
        Instant until = requestedUntil.truncatedTo(ChronoUnit.MICROS);
        if (!until.isAfter(now)) {
            throw untilNotAfterNow();
        }

        LockedUser user = reservations.lockUser(actorId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.FORBIDDEN));
        LockedAsset asset = assets.lock(request.assetId())
                .orElseThrow(() -> new ReservationRefusedException(ApiError.ASSET_NOT_FOUND));

        if (reservations.lockActiveOfUser(user.id())) {
            throw new ReservationRefusedException(ApiError.USER_ALREADY_HAS_ACTIVE_RESERVATION);
        }
        if (reservations.lockActiveOfAsset(asset.id())) {
            throw new ReservationRefusedException(ApiError.ASSET_ALREADY_RESERVED);
        }
        if (reservations.lockOpenLoanOfAsset(asset.id())) {
            throw new ReservationRefusedException(ApiError.ASSET_HAS_OPEN_LOAN);
        }

        Optional<OpenWindow> window = Optional.ofNullable(asset.lockerId()).map(locker -> openWindow(locker, now));
        window.ifPresent(open -> requireUntilWithin(open, now, requestedUntil));

        if (!user.maximumAccessLevel().permits(asset.requiredAccessLevel())) {
            throw new ReservationRefusedException(ApiError.ASSET_ACCESS_DENIED);
        }
        ReadinessAssessment readiness = assets.readinessForNewReservation(asset.id(), user.id(),
                user.maximumAccessLevel(), now);
        if (readiness.result() != ReadinessResult.READY) {
            throw notReady(readiness.reasons());
        }
        if (window.isEmpty()) {
            // Without an expected placement there is no locker, no schedule and no compartment to prove presence in.
            throw notReady(List.of(ReadinessReason.UNKNOWN_PHYSICAL_STATE));
        }

        UUID id;
        try {
            id = reservations.insert(asset.id(), user.id(), now, until, now);
        } catch (DataIntegrityViolationException violation) {
            throw translate(violation);
        }
        ReservationRow created = reservations.find(id).orElseThrow();
        // ck_audit_events_state_pair admits no to_state without a from_state: a creation records its state in details.
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("assetId", created.assetId());
        details.put("status", created.status());
        details.put("reservedFrom", created.reservedFrom());
        details.put("reservedUntil", created.reservedUntil());
        audit.record(new AuditEvent(AuditEventType.RESERVATION_CREATED, user.id(), AuditSubjectType.RESERVATION, id,
                AuditResult.ACCEPTED, details, now));
        return view(created, now);
    }

    /**
     * Document 06, section 5.5 and document 09, section 14.4, inside the transaction of the idempotency key. Locks
     * follow document 06, section 3.3: the holder, the asset, the reservation, then the lockers and attempts that the
     * cancellation ends. A refusal writes nothing.
     * <p>
     * The instant of the decision is read once the holder, asset and reservation are locked: a transaction that held
     * them may have committed an attempt or a challenge later than the moment this request arrived, and every date
     * this cancellation writes must not precede them.
     */
    @Transactional
    ReservationView cancel(UUID actorId, UUID reservationId) {
        LockedUser holder = reservations.lockUser(actorId)
                .filter(found -> found.status() == AccountStatus.ACTIVE && found.role() == Role.TECHNICIAN)
                .orElseThrow(() -> new ReservationRefusedException(ApiError.FORBIDDEN));
        // Another technician's reservation is not visible, so it is not found (document 09, sections 14.3 and 26.2).
        UUID assetId = reservations.find(reservationId).filter(row -> row.userId().equals(holder.id()))
                .map(ReservationRow::assetId).orElseThrow(ResourceNotFoundException::new);
        assets.lockForCustody(assetId);
        ReservationRow reservation = reservations.lock(reservationId).orElseThrow();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        switch (reservation.status()) {
            case CANCELLED -> {
                audit.record(new AuditEvent(AuditEventType.RESERVATION_CANCELLED, holder.id(),
                        AuditSubjectType.RESERVATION, reservationId, AuditResult.ALREADY_APPLIED,
                        Map.of("assetId", assetId, "cancelledAt", reservation.cancelledAt()), now));
                return view(reservation, now);
            }
            case FULFILLED, EXPIRED -> throw new ReservationRefusedException(ApiError.RESERVATION_NOT_CANCELLABLE);
            case ACTIVE -> {
                if (!cancellable(reservation, now)) {
                    throw new ReservationRefusedException(ApiError.RESERVATION_NOT_CANCELLABLE);
                }
            }
        }

        List<UUID> endedAttempts = pendingCheckouts.endForCancellation(reservationId, holder.id(), now);
        reservations.cancel(reservationId, now);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("assetId", assetId);
        details.put("reservedUntil", reservation.reservedUntil());
        details.put("endedOperationIds", endedAttempts);
        audit.record(AuditEvent.transition(AuditEventType.RESERVATION_CANCELLED, holder.id(),
                AuditSubjectType.RESERVATION, reservationId, null, ReservationStatus.ACTIVE,
                ReservationStatus.CANCELLED, null, details, now));
        return view(reservations.find(reservationId).orElseThrow(), now);
    }

    /** Document 09, section 14.2. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    ReservationView activeOf(UUID technicianId) {
        Instant now = clock.instant();
        return reservations.activeOfUser(technicianId).map(row -> view(row, now))
                .orElseThrow(() -> new ReservationRefusedException(ApiError.ACTIVE_RESERVATION_NOT_FOUND));
    }

    /** Document 09, sections 14.3 and 26.2: another technician's reservation is not visible, so it is not found. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    ReservationView ownedBy(UUID technicianId, UUID reservationId) {
        Instant now = clock.instant();
        return reservations.find(reservationId).filter(row -> row.userId().equals(technicianId))
                .map(row -> view(row, now))
                .orElseThrow(ResourceNotFoundException::new);
    }

    /** Document 09, section 17: every reservation, read only; the count and the page see one snapshot. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PageResponse<AdminReservationView> adminList(AdminFilter filter, PageQuery page) {
        long total = reservations.count(filter);
        List<ReservationRow> rows = total == 0 ? List.of() : reservations.page(filter, page);
        Map<UUID, AssetSummary> summaries = assets.summaries(rows.stream().map(ReservationRow::assetId).toList());
        Map<UUID, UserSummary> holders = users.of(rows.stream().map(ReservationRow::userId).toList());
        return PageResponse.of(rows.stream()
                .map(row -> adminView(row, summaries.get(row.assetId()), holders.get(row.userId()))).toList(),
                page, total);
    }

    /** Document 09, section 17: any reservation, whoever holds it. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    AdminReservationView adminGet(UUID reservationId) {
        return reservations.find(reservationId)
                .map(row -> adminView(row, assets.summaries(List.of(row.assetId())).get(row.assetId()),
                        users.of(List.of(row.userId())).get(row.userId())))
                .orElseThrow(ResourceNotFoundException::new);
    }

    /**
     * Rule D4 approved on 11 November 2026 (#67): section 8.10 lists the mutations of the requester, and
     * an administrator performs none of them, so {@code availableActions} is always empty here.
     */
    private AdminReservationView adminView(ReservationRow row, AssetSummary asset, UserSummary user) {
        UUID currentOperation = row.status() == ReservationStatus.ACTIVE
                ? reservations.currentOperationOf(row.id()).orElse(null) : null;
        return new AdminReservationView(row.id(), asset, row.userId(), user, row.status(), row.reservedFrom(),
                row.reservedUntil(), row.createdAt(), row.cancelledAt(), row.fulfilledAt(), row.expiredAt(),
                currentOperation, List.of());
    }

    private OpenWindow openWindow(UUID lockerId, Instant now) {
        try {
            return schedules.activeScheduleOf(lockerId)
                    .map(schedule -> OperatingHours.requireOpenOperatingWindow(schedule, now))
                    // No active schedule means no open window (document 06, section 5.1).
                    .orElseThrow(() -> new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS));
        } catch (OperatingHoursException outside) {
            throw new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
        }
    }

    private static void requireUntilWithin(OpenWindow window, Instant now, Instant until) {
        try {
            OperatingHours.requireUntilWithinWindow(window, now, until);
        } catch (OperatingHoursException refused) {
            throw switch (refused.reason()) {
                case UNTIL_AFTER_CLOSING -> new ReservationRefusedException(ApiError.RESERVATION_END_AFTER_CLOSING);
                case OUTSIDE_OPERATING_HOURS -> new ReservationRefusedException(ApiError.OUTSIDE_OPERATING_HOURS);
                // Checked before any lock; kept for completeness of the mapping.
                case UNTIL_NOT_AFTER_NOW -> untilNotAfterNow();
            };
        }
    }

    /** Document 09, section 14.1 names no code for an end that is not after now: a field validation error is used. */
    private static InvalidRequestException untilNotAfterNow() {
        return InvalidRequestException.of("reservedUntil", "INVALID_VALUE",
                "La fin de la réservation doit être postérieure à l'instant courant.");
    }

    private static ReservationRefusedException notReady(List<ReadinessReason> reasons) {
        return new ReservationRefusedException(ApiError.ASSET_NOT_READY,
                reasons.stream().map(ReadinessReason::name).toList());
    }

    /** A known active-uniqueness index becomes its conflict; any other integrity failure stays an internal error. */
    private static RuntimeException translate(DataIntegrityViolationException violation) {
        for (Throwable cause = violation; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres) {
                ServerErrorMessage message = postgres.getServerErrorMessage();
                ApiError error = message == null ? null : ACTIVE_INDEXES.get(message.getConstraint());
                return error == null ? violation : new ReservationRefusedException(error);
            }
        }
        return violation;
    }

    private ReservationView view(ReservationRow row, Instant now) {
        AssetSummary asset = assets.summaries(List.of(row.assetId())).get(row.assetId());
        boolean active = row.status() == ReservationStatus.ACTIVE;
        UUID currentOperation = active ? reservations.currentOperationOf(row.id()).orElse(null) : null;
        return new ReservationView(row.id(), asset, row.userId(), row.status(), row.reservedFrom(),
                row.reservedUntil(), row.createdAt(), row.cancelledAt(), row.fulfilledAt(), row.expiredAt(),
                currentOperation, availableActions(row, now));
    }

    /**
     * Document 09, section 8.10, for the holder, who is the only reader of these views. {@code CANCEL} is emitted
     * exactly when {@link #cancel} would accept it at {@code now}; {@code CHECKOUT} when the preparation of section
     * 15.1 would pass its guards at {@code now}, read without locks (#44).
     */
    private List<String> availableActions(ReservationRow row, Instant now) {
        List<String> actions = new ArrayList<>(2);
        if (guards.checkoutAdmissible(row, now)) {
            actions.add(ReservationAction.CHECKOUT.name());
        }
        if (cancellable(row, now)) {
            actions.add(ReservationAction.CANCEL.name());
        }
        return List.copyOf(actions);
    }

    /**
     * The single rule of document 06, section 5.5 and document 09, section 8.10 that both {@link #cancel} and
     * {@code availableActions} apply: an {@code ACTIVE} reservation before its {@code reservedUntil} (from then on it
     * is due, and only its expiry may end it, document 06, section 14) with no attempt that blocks the cancellation.
     */
    private boolean cancellable(ReservationRow row, Instant now) {
        return row.status() == ReservationStatus.ACTIVE && now.isBefore(row.reservedUntil())
                && !attempts.blocksCancellation(row.id());
    }
}
