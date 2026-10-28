package ca.aegis.control.asset;

import static ca.aegis.control.asset.ReadinessReason.ACCESS_DENIED;
import static ca.aegis.control.asset.ReadinessReason.CALIBRATION_EXPIRED;
import static ca.aegis.control.asset.ReadinessReason.DAMAGED;
import static ca.aegis.control.asset.ReadinessReason.MAINTENANCE;
import static ca.aegis.control.asset.ReadinessReason.NOT_AVAILABLE;
import static ca.aegis.control.asset.ReadinessReason.NOT_PRESENT;
import static ca.aegis.control.asset.ReadinessReason.UNKNOWN_PHYSICAL_STATE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import ca.aegis.control.asset.ReadinessEvaluator.AssetFacts;
import ca.aegis.control.asset.ReadinessEvaluator.User;
import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.AccountStatus;
import ca.aegis.control.identity.Role;

/** Decision matrix of document 06, section 4.4, and result priority of section 4.3. */
class ReadinessEvaluatorTests {

    private static final Instant NOW = Instant.parse("2026-09-28T13:00:00.123456Z");
    private static final UUID ASSET = UUID.randomUUID();
    private static final User TECHNICIAN =
            new User(UUID.randomUUID(), AccountStatus.ACTIVE, Role.TECHNICIAN, AccessLevel.STANDARD);
    private static final User OTHER =
            new User(UUID.randomUUID(), AccountStatus.ACTIVE, Role.TECHNICIAN, AccessLevel.RESTRICTED);
    private static final AssetFacts COMPLIANT = new AssetFacts(ASSET, OperationalStatus.SERVICEABLE, true,
            NOW.plus(Duration.ofDays(30)), AccessLevel.STANDARD);
    private static final Custody FREE = Custody.archivalOnly(false);

    @Test
    void readyOnlyWhenEveryConditionHoldsAndPresenceIsProven() {
        ReadinessAssessment ready = evaluate(TECHNICIAN, COMPLIANT, FREE, Presence.PRESENT);

        assertEquals(ReadinessResult.READY, ready.result());
        assertEquals(List.of(), ready.reasons());
        assertEquals(ASSET, ready.assetId());
        assertEquals(TECHNICIAN.id(), ready.evaluatedForUserId());
        assertEquals(NOW, ready.evaluatedAt());

        AssetFacts withoutCalibration = new AssetFacts(ASSET, OperationalStatus.SERVICEABLE, false, null,
                AccessLevel.STANDARD);
        assertEquals(ReadinessResult.READY,
                evaluate(TECHNICIAN, withoutCalibration, FREE, Presence.PRESENT).result());
    }

    @Test
    void unknownPresenceNeverGivesReady() {
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, FREE, Presence.UNKNOWN),
                ReadinessResult.UNKNOWN, UNKNOWN_PHYSICAL_STATE);
    }

    @Test
    void eachBlockingConditionAloneGivesItsReason() {
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, FREE, Presence.ABSENT), ReadinessResult.BLOCKED, NOT_PRESENT);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, Custody.archivalOnly(true), Presence.PRESENT),
                ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, new Custody(false, null, true), Presence.PRESENT),
                ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, new Custody(false, OTHER.id(), false), Presence.PRESENT),
                ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(TECHNICIAN, with(OperationalStatus.MAINTENANCE), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, MAINTENANCE);
        assertOutcome(evaluate(TECHNICIAN, with(OperationalStatus.DAMAGED), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, DAMAGED);
        assertOutcome(evaluate(TECHNICIAN, dueAt(NOW.minusSeconds(1)), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, CALIBRATION_EXPIRED);
        assertOutcome(evaluate(TECHNICIAN, restricted(COMPLIANT), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, ACCESS_DENIED);
    }

    @Test
    void calibrationExpiresExactlyAtItsDueInstant() {
        assertOutcome(evaluate(TECHNICIAN, dueAt(NOW), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, CALIBRATION_EXPIRED);
        assertOutcome(evaluate(TECHNICIAN, dueAt(NOW.plusNanos(1_000)), FREE, Presence.PRESENT),
                ReadinessResult.READY);
    }

    @Test
    void requiredCalibrationWithoutDueDateIsNeverReady() {
        AssetFacts incomplete = new AssetFacts(ASSET, OperationalStatus.SERVICEABLE, true, null,
                AccessLevel.STANDARD);

        assertOutcome(evaluate(TECHNICIAN, incomplete, FREE, Presence.PRESENT),
                ReadinessResult.UNKNOWN, UNKNOWN_PHYSICAL_STATE);
        assertOutcome(evaluate(TECHNICIAN, restricted(incomplete), FREE, Presence.PRESENT),
                ReadinessResult.BLOCKED, ACCESS_DENIED);
    }

    @Test
    void severalReasonsAreDistinctAndInTheirDocumentedOrder() {
        AssetFacts everything = new AssetFacts(ASSET, OperationalStatus.DAMAGED, true, NOW, AccessLevel.RESTRICTED);
        Custody reservedAndBorrowed = new Custody(true, OTHER.id(), true);

        assertOutcome(evaluate(TECHNICIAN, everything, reservedAndBorrowed, Presence.ABSENT),
                ReadinessResult.BLOCKED, NOT_PRESENT, NOT_AVAILABLE, DAMAGED, CALIBRATION_EXPIRED, ACCESS_DENIED);
        assertOutcome(evaluate(TECHNICIAN, restricted(with(OperationalStatus.MAINTENANCE)), Custody.archivalOnly(true),
                Presence.PRESENT), ReadinessResult.BLOCKED, NOT_AVAILABLE, MAINTENANCE, ACCESS_DENIED);
    }

    @Test
    void aCertainBlockPrevailsOverMissingPhysicalProof() {
        ReadinessAssessment blocked = evaluate(TECHNICIAN, with(OperationalStatus.DAMAGED), FREE, Presence.UNKNOWN);

        assertOutcome(blocked, ReadinessResult.BLOCKED, DAMAGED);
        assertOutcome(evaluate(TECHNICIAN, restricted(COMPLIANT), FREE, Presence.UNKNOWN),
                ReadinessResult.BLOCKED, ACCESS_DENIED);
        assertOutcome(evaluate(TECHNICIAN, dueAt(NOW), Custody.archivalOnly(true), Presence.UNKNOWN),
                ReadinessResult.BLOCKED, NOT_AVAILABLE, CALIBRATION_EXPIRED);
    }

    @Test
    void aReservationIsCompatibleOnlyWithTheCheckoutOfItsHolder() {
        Custody heldByTechnician = new Custody(false, TECHNICIAN.id(), false);

        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, heldByTechnician, Presence.PRESENT, ReadinessContext.CHECKOUT),
                ReadinessResult.READY);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, heldByTechnician, Presence.PRESENT, ReadinessContext.GENERAL),
                ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, heldByTechnician, Presence.PRESENT,
                ReadinessContext.NEW_RESERVATION), ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(OTHER, COMPLIANT, heldByTechnician, Presence.PRESENT, ReadinessContext.CHECKOUT),
                ReadinessResult.BLOCKED, NOT_AVAILABLE);
    }

    @Test
    void theHoldersCheckoutStaysBlockedByALoanOrArchival() {
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, new Custody(false, TECHNICIAN.id(), true), Presence.PRESENT,
                ReadinessContext.CHECKOUT), ReadinessResult.BLOCKED, NOT_AVAILABLE);
        assertOutcome(evaluate(TECHNICIAN, COMPLIANT, new Custody(true, TECHNICIAN.id(), false), Presence.PRESENT,
                ReadinessContext.CHECKOUT), ReadinessResult.BLOCKED, NOT_AVAILABLE);
    }

    @Test
    void availabilityFollowsItsDocumentedPriority() {
        assertEquals(Availability.AVAILABLE, FREE.availability());
        assertEquals(Availability.UNAVAILABLE, Custody.archivalOnly(true).availability());
        assertEquals(Availability.RESERVED, new Custody(true, OTHER.id(), false).availability());
        assertEquals(Availability.BORROWED, new Custody(true, OTHER.id(), true).availability());
    }

    @ParameterizedTest
    @EnumSource(ReadinessContext.class)
    void disabledUsersAndAdministratorsAreRejectedBeforeEvaluation(ReadinessContext context) {
        User disabled = new User(UUID.randomUUID(), AccountStatus.DISABLED, Role.TECHNICIAN, AccessLevel.RESTRICTED);
        User admin = new User(UUID.randomUUID(), AccountStatus.ACTIVE, Role.ADMIN, AccessLevel.RESTRICTED);

        assertThrows(IllegalArgumentException.class,
                () -> evaluate(disabled, COMPLIANT, FREE, Presence.PRESENT, context));
        assertThrows(IllegalArgumentException.class,
                () -> evaluate(admin, COMPLIANT, FREE, Presence.PRESENT, context));
    }

    @Test
    void theSameFactsAlwaysGiveTheSameAssessment() {
        AssetFacts damaged = restricted(with(OperationalStatus.DAMAGED));

        assertEquals(evaluate(TECHNICIAN, damaged, FREE, Presence.ABSENT),
                evaluate(TECHNICIAN, damaged, FREE, Presence.ABSENT));
        assertNotEquals(evaluate(TECHNICIAN, damaged, FREE, Presence.ABSENT).evaluatedForUserId(),
                evaluate(OTHER, damaged, FREE, Presence.ABSENT).evaluatedForUserId());
    }

    @Test
    void anAssessmentRejectsReasonsThatContradictItsResult() {
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.READY, List.of(UNKNOWN_PHYSICAL_STATE), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.BLOCKED, List.of(), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.BLOCKED, List.of(MAINTENANCE, UNKNOWN_PHYSICAL_STATE), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.UNKNOWN, List.of(), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.UNKNOWN, List.of(ACCESS_DENIED), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.BLOCKED, List.of(MAINTENANCE, MAINTENANCE), NOW));
        assertThrows(IllegalArgumentException.class, () -> new ReadinessAssessment(ASSET, TECHNICIAN.id(),
                ReadinessResult.BLOCKED, List.of(ACCESS_DENIED, MAINTENANCE), NOW));
    }

    private static ReadinessAssessment evaluate(User user, AssetFacts asset, Custody custody, Presence presence) {
        return evaluate(user, asset, custody, presence, ReadinessContext.GENERAL);
    }

    private static ReadinessAssessment evaluate(User user, AssetFacts asset, Custody custody, Presence presence,
            ReadinessContext context) {
        return ReadinessEvaluator.evaluate(user, asset, custody, presence, context, NOW);
    }

    private static void assertOutcome(ReadinessAssessment assessment, ReadinessResult result,
            ReadinessReason... reasons) {
        assertEquals(result, assessment.result());
        assertEquals(List.of(reasons), assessment.reasons());
    }

    private static AssetFacts with(OperationalStatus status) {
        return new AssetFacts(ASSET, status, COMPLIANT.calibrationRequired(), COMPLIANT.calibrationDueAt(),
                COMPLIANT.requiredAccessLevel());
    }

    private static AssetFacts dueAt(Instant dueAt) {
        return new AssetFacts(ASSET, OperationalStatus.SERVICEABLE, true, dueAt, AccessLevel.STANDARD);
    }

    private static AssetFacts restricted(AssetFacts asset) {
        return new AssetFacts(asset.id(), asset.operationalStatus(), asset.calibrationRequired(),
                asset.calibrationDueAt(), AccessLevel.RESTRICTED);
    }
}
