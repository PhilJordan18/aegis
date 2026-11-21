package ca.aegis.control.display;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * The associated data that binds an encrypted display payload to its {@code hub_display_outbox} row (decision of 11
 * November 2026, #43): the row id, the locker, the operation and the display revision, after a version label. Every
 * field is fixed-format (lowercase UUIDs, a decimal revision) and separated by a newline, so two distinct rows can
 * never produce the same bytes.
 */
public final class DisplayAad {

    static final String VERSION = "aegis-display-aad/v1";

    private DisplayAad() {
    }

    public static byte[] of(UUID outboxId, UUID lockerId, UUID operationId, long displayRevision) {
        if (displayRevision <= 0) {
            throw new IllegalArgumentException("A display revision is positive");
        }
        return (VERSION + "\n" + outboxId + "\n" + lockerId + "\n" + operationId + "\n" + displayRevision)
                .getBytes(StandardCharsets.US_ASCII);
    }
}
