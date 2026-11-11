package ca.aegis.control.reservation;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Document 06, section 10.3, for a {@code CHECKOUT}: what the stored facts of one operation prove, read from scratch at
 * each evaluation so that network order never matters (document 10, section 17.3). Pure: no lock, clock or database.
 *
 * <p>The proof chain lives in one device session: the hub's accepted acknowledgement, then an opening of the target
 * cell, then its closing, then a later RFID scan of that cell whose window starts after the closing and that no door
 * event of the cell follows. Two rules approved by Philippe on 11 November 2026 (#47) apply once that chain exists:
 * an expected tag the healthy scan still sees keeps the proof {@link Verdict#INCOMPLETE} (the deadline then turns it
 * into an anomaly), and a {@code FAULTED} or {@code UNKNOWN} reader in a scan of the cell after that closing, which no
 * door event follows, makes it {@link Verdict#INCONSISTENT} at once. Only a scan of the chain speaks for the reader: the
 * cell's projection, which a scan taken while the door was open may have set, never does. Before the chain exists, or
 * when a fact is merely missing, the proof is only incomplete.
 */
final class CheckoutProof {

    enum Verdict {
        /** Ack, opening, closing and a stable healthy scan without the expected tag: the checkout is proven. */
        COHERENT,
        /** Not proven yet; the deadline decides whether waiting ends as EXPIRED or ANOMALY. */
        INCOMPLETE,
        /** Proven contradictory after a complete interaction: ANOMALY now. */
        INCONSISTENT
    }

    /** Why the proof is not coherent; stored in the anomaly details, never in a public field. */
    enum Finding {
        NONE,
        NOT_ACKNOWLEDGED,
        DOOR_NOT_OPENED,
        DOOR_NOT_CLOSED,
        SCAN_MISSING,
        SCAN_NOT_CONCLUSIVE,
        EXPECTED_ASSET_STILL_PRESENT,
        READER_NOT_HEALTHY,
        AMBIGUOUS_LOCATION
    }

    /** How far the chain went, which is the furthest operation status the facts justify. */
    enum Stage {
        NONE,
        ACKNOWLEDGED,
        DOOR_OPENED,
        OBSERVED
    }

    enum Kind {
        ACKNOWLEDGEMENT,
        DOOR_OPENED,
        DOOR_CLOSED,
        RFID_SCAN
    }

    /** What the backend normalized from one scan for the expected tag (document 10, section 12.2). */
    enum TagReading {
        ABSENT,
        SEEN,
        NO_VERDICT
    }

    /**
     * One accepted message of the operation. {@code compartmentId} is null for an acknowledgement; {@code reader},
     * {@code windowStartedAt} and {@code tag} are set for a scan only.
     */
    record Fact(UUID messageId, Kind kind, UUID compartmentId, UUID session, long bootCount, long sequence,
            Instant occurredAt, Instant receivedAt, String reader, Instant windowStartedAt, TagReading tag) {

        boolean sameBoot(Fact other) {
            return session.equals(other.session) && bootCount == other.bootCount;
        }
    }

    /**
     * @param opened the opening that started the interaction, when one exists
     * @param closed its closing, when one exists
     * @param scan the scan evaluated, when one exists
     */
    record Result(Verdict verdict, Finding finding, Stage stage, Optional<Fact> acknowledgement,
            Optional<Fact> opened, Optional<Fact> closed, Optional<Fact> scan) {
    }

    private CheckoutProof() {
    }

    /**
     * @param compartmentId the operation's target cell
     * @param facts every accepted acknowledgement, door event and scan stored for the operation
     * @param tagElsewhere whether a scan of another cell detected the expected tag since the authorization, which
     *     leaves its location ambiguous (document 06, section 10.1, condition 6)
     */
    static Result evaluate(UUID compartmentId, List<Fact> facts, boolean tagElsewhere) {
        Optional<Fact> ack = facts.stream().filter(fact -> fact.kind() == Kind.ACKNOWLEDGEMENT)
                .min(Comparator.comparing(Fact::receivedAt));
        if (ack.isEmpty()) {
            return new Result(Verdict.INCOMPLETE, Finding.NOT_ACKNOWLEDGED, Stage.NONE, ack, Optional.empty(),
                    Optional.empty(), Optional.empty());
        }
        List<Fact> chain = facts.stream()
                .filter(fact -> fact.kind() != Kind.ACKNOWLEDGEMENT && fact.sameBoot(ack.get())
                        && compartmentId.equals(fact.compartmentId()) && fact.sequence() > ack.get().sequence())
                .sorted(Comparator.comparingLong(Fact::sequence))
                .toList();
        Optional<Fact> opened = chain.stream().filter(fact -> fact.kind() == Kind.DOOR_OPENED).findFirst();
        if (opened.isEmpty()) {
            return new Result(Verdict.INCOMPLETE, Finding.DOOR_NOT_OPENED, Stage.ACKNOWLEDGED, ack, opened,
                    Optional.empty(), Optional.empty());
        }
        Optional<Fact> closed = chain.stream()
                .filter(fact -> fact.kind() == Kind.DOOR_CLOSED && fact.sequence() > opened.get().sequence())
                .findFirst();
        if (closed.isEmpty()) {
            return new Result(Verdict.INCOMPLETE, Finding.DOOR_NOT_CLOSED, Stage.DOOR_OPENED, ack, opened, closed,
                    Optional.empty());
        }
        Optional<Fact> scan = chain.stream()
                .filter(fact -> fact.kind() == Kind.RFID_SCAN && fact.sequence() > closed.get().sequence())
                .max(Comparator.comparingLong(Fact::sequence));
        if (scan.isEmpty()) {
            return new Result(Verdict.INCOMPLETE, Finding.SCAN_MISSING, Stage.DOOR_OPENED, ack, opened, closed, scan);
        }
        Fact read = scan.get();
        // The scan speaks for the cell only if the last door event before it is a closing that precedes its window,
        // and no door event follows it: otherwise the door may have moved since, and only a later scan can tell.
        Optional<Fact> lastDoor = chain.stream()
                .filter(fact -> fact.kind() != Kind.RFID_SCAN && fact.sequence() < read.sequence())
                .max(Comparator.comparingLong(Fact::sequence));
        boolean doorAfter = chain.stream()
                .anyMatch(fact -> fact.kind() != Kind.RFID_SCAN && fact.sequence() > read.sequence());
        if (!doorAfter && !"HEALTHY".equals(read.reader())) {
            return new Result(Verdict.INCONSISTENT, Finding.READER_NOT_HEALTHY, Stage.OBSERVED, ack, opened, closed,
                    scan);
        }
        boolean settled = lastDoor.filter(door -> door.kind() == Kind.DOOR_CLOSED).isPresent()
                && read.windowStartedAt() != null && !read.windowStartedAt().isBefore(lastDoor.get().occurredAt())
                && !doorAfter;
        if (!settled) {
            return new Result(Verdict.INCOMPLETE, Finding.SCAN_NOT_CONCLUSIVE, Stage.OBSERVED, ack, opened, closed,
                    scan);
        }
        if (tagElsewhere) {
            return new Result(Verdict.INCONSISTENT, Finding.AMBIGUOUS_LOCATION, Stage.OBSERVED, ack, opened, closed,
                    scan);
        }
        return switch (read.tag()) {
            case ABSENT -> new Result(Verdict.COHERENT, Finding.NONE, Stage.OBSERVED, ack, opened, closed, scan);
            case SEEN -> new Result(Verdict.INCOMPLETE, Finding.EXPECTED_ASSET_STILL_PRESENT, Stage.OBSERVED, ack,
                    opened, closed, scan);
            case NO_VERDICT -> new Result(Verdict.INCOMPLETE, Finding.SCAN_NOT_CONCLUSIVE, Stage.OBSERVED, ack,
                    opened, closed, scan);
        };
    }
}
