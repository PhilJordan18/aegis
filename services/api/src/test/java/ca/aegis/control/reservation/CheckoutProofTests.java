package ca.aegis.control.reservation;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.reservation.CheckoutProof.Fact;
import ca.aegis.control.reservation.CheckoutProof.Finding;
import ca.aegis.control.reservation.CheckoutProof.Kind;
import ca.aegis.control.reservation.CheckoutProof.Result;
import ca.aegis.control.reservation.CheckoutProof.Stage;
import ca.aegis.control.reservation.CheckoutProof.TagReading;
import ca.aegis.control.reservation.CheckoutProof.Verdict;

/** Document 06, section 10.3, and the #47 rules, on facts alone: order, boot, cell and reader. */
class CheckoutProofTests {

    static final UUID CELL = UUID.randomUUID();
    static final UUID OTHER_CELL = UUID.randomUUID();
    static final UUID SESSION = UUID.randomUUID();
    static final Instant T0 = Instant.parse("2026-09-28T13:00:00Z");

    final List<Fact> facts = new ArrayList<>();
    long sequence;

    @Test
    void theCompleteChainWithoutTheTagIsCoherentWhateverTheReceptionOrder() {
        ack();
        Fact opened = door(Kind.DOOR_OPENED);
        Fact closed = door(Kind.DOOR_CLOSED);
        Fact scan = scan("HEALTHY", TagReading.ABSENT, closed.occurredAt());
        List<Fact> shuffled = new ArrayList<>(List.of(scan, closed, facts.get(0), opened));
        Result result = CheckoutProof.evaluate(CELL, shuffled, false);
        assertEquals(Verdict.COHERENT, result.verdict());
        assertEquals(Stage.OBSERVED, result.stage());
        assertEquals(scan, result.scan().orElseThrow());
    }

    @Test
    void eachMissingLinkIsOnlyIncomplete() {
        assertResult(Verdict.INCOMPLETE, Finding.NOT_ACKNOWLEDGED, Stage.NONE);
        ack();
        assertResult(Verdict.INCOMPLETE, Finding.DOOR_NOT_OPENED, Stage.ACKNOWLEDGED);
        door(Kind.DOOR_OPENED);
        assertResult(Verdict.INCOMPLETE, Finding.DOOR_NOT_CLOSED, Stage.DOOR_OPENED);
        door(Kind.DOOR_CLOSED);
        assertResult(Verdict.INCOMPLETE, Finding.SCAN_MISSING, Stage.DOOR_OPENED);
    }

    @Test
    void rule1TheExpectedTagStillSeenIsIncomplete() {
        ack();
        door(Kind.DOOR_OPENED);
        Fact closed = door(Kind.DOOR_CLOSED);
        scan("HEALTHY", TagReading.SEEN, closed.occurredAt());
        assertResult(Verdict.INCOMPLETE, Finding.EXPECTED_ASSET_STILL_PRESENT, Stage.OBSERVED);
    }

    @Test
    void rule2AnUnhealthyReaderInAScanAfterTheClosingIsInconsistent() {
        ack();
        door(Kind.DOOR_OPENED);
        Fact closed = door(Kind.DOOR_CLOSED);
        scan("UNKNOWN", TagReading.NO_VERDICT, closed.occurredAt());
        assertResult(Verdict.INCONSISTENT, Finding.READER_NOT_HEALTHY, Stage.OBSERVED);
    }

    @Test
    void rule2DoesNotApplyBeforeTheInteractionNorToAScanTakenWhileTheDoorWasOpen() {
        ack();
        door(Kind.DOOR_OPENED);
        assertResult(Verdict.INCOMPLETE, Finding.DOOR_NOT_CLOSED, Stage.DOOR_OPENED);
        Fact early = scan("FAULTED", TagReading.NO_VERDICT, T0);
        Fact closed = door(Kind.DOOR_CLOSED);
        assertResult(Verdict.INCOMPLETE, Finding.SCAN_MISSING, Stage.DOOR_OPENED);
        scan("HEALTHY", TagReading.ABSENT, closed.occurredAt());
        assertResult(Verdict.COHERENT, Finding.NONE, Stage.OBSERVED);
        assertEquals(Kind.RFID_SCAN, early.kind());
    }

    @Test
    void aScanWhoseWindowStartsBeforeTheClosingOrThatADoorEventFollowsIsNotConclusive() {
        ack();
        door(Kind.DOOR_OPENED);
        Fact closed = door(Kind.DOOR_CLOSED);
        scan("HEALTHY", TagReading.ABSENT, closed.occurredAt().minusMillis(1));
        assertResult(Verdict.INCOMPLETE, Finding.SCAN_NOT_CONCLUSIVE, Stage.OBSERVED);

        facts.removeLast();
        scan("HEALTHY", TagReading.ABSENT, closed.occurredAt());
        door(Kind.DOOR_OPENED);
        assertResult(Verdict.INCOMPLETE, Finding.SCAN_NOT_CONCLUSIVE, Stage.OBSERVED);
        Fact again = door(Kind.DOOR_CLOSED);
        scan("HEALTHY", TagReading.ABSENT, again.occurredAt());
        assertResult(Verdict.COHERENT, Finding.NONE, Stage.OBSERVED);
    }

    @Test
    void theTagSeenInAnotherCellMakesTheLocationAmbiguous() {
        ack();
        door(Kind.DOOR_OPENED);
        Fact closed = door(Kind.DOOR_CLOSED);
        scan("HEALTHY", TagReading.ABSENT, closed.occurredAt());
        Result result = CheckoutProof.evaluate(CELL, facts, true);
        assertEquals(Verdict.INCONSISTENT, result.verdict());
        assertEquals(Finding.AMBIGUOUS_LOCATION, result.finding());
    }

    @Test
    void factsOfAnotherCellAnotherBootOrBeforeTheAcknowledgementAreIgnored() {
        Fact early = door(Kind.DOOR_OPENED);
        ack();
        facts.add(new Fact(UUID.randomUUID(), Kind.DOOR_OPENED, OTHER_CELL, SESSION, 1, ++sequence,
                T0.plusSeconds(sequence), T0.plusSeconds(sequence), null, null, TagReading.NO_VERDICT));
        facts.add(new Fact(UUID.randomUUID(), Kind.DOOR_OPENED, CELL, UUID.randomUUID(), 2, ++sequence,
                T0.plusSeconds(sequence), T0.plusSeconds(sequence), null, null, TagReading.NO_VERDICT));
        Result result = CheckoutProof.evaluate(CELL, facts, false);
        assertEquals(Finding.DOOR_NOT_OPENED, result.finding());
        assertEquals(1, early.sequence());
    }

    private void assertResult(Verdict verdict, Finding finding, Stage stage) {
        Result result = CheckoutProof.evaluate(CELL, facts, false);
        assertEquals(verdict, result.verdict());
        assertEquals(finding, result.finding());
        assertEquals(stage, result.stage());
    }

    private Fact ack() {
        return add(Kind.ACKNOWLEDGEMENT, null, null, TagReading.NO_VERDICT);
    }

    private Fact door(Kind kind) {
        return add(kind, null, null, TagReading.NO_VERDICT);
    }

    private Fact scan(String reader, TagReading tag, Instant windowStartedAt) {
        return add(Kind.RFID_SCAN, reader, windowStartedAt, tag);
    }

    private Fact add(Kind kind, String reader, Instant window, TagReading tag) {
        long next = ++sequence;
        Fact fact = new Fact(UUID.randomUUID(), kind, kind == Kind.ACKNOWLEDGEMENT ? null : CELL, SESSION, 1, next,
                T0.plusSeconds(next), T0.plusSeconds(next), reader, window, tag);
        facts.add(fact);
        return fact;
    }
}
