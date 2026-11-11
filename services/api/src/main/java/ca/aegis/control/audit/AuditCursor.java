package ca.aegis.control.audit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/**
 * The opaque cursor of document 09, sections 19.1 and 22.2, under rule D10 approved on 11 November
 * 2026 (#67): base64url of the last item's {@code occurredAt} in microseconds, its id, and a hash of the filters it
 * was issued for. A cursor replayed with other filters would skip or repeat rows silently, so it is refused instead.
 * The cursor carries no secret and grants nothing: the route stays ADMIN only and the filters are re-applied.
 */
record AuditCursor(Instant occurredAt, UUID id, String filterHash) {

    private static final String VERSION = "v1";

    String encode() {
        long micros = Math.addExact(Math.multiplyExact(occurredAt.getEpochSecond(), 1_000_000L),
                occurredAt.getNano() / 1_000);
        String raw = VERSION + "." + micros + "." + id + "." + filterHash;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.US_ASCII));
    }

    /** The position of {@code raw}, which must have been issued for {@code expectedFilterHash}. */
    static AuditCursor decode(String raw, String expectedFilterHash) {
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(raw.strip()), StandardCharsets.US_ASCII)
                    .split("\\.", -1);
            if (parts.length == 4 && VERSION.equals(parts[0]) && parts[2].length() == 36
                    && expectedFilterHash.equals(parts[3])) {
                long micros = Long.parseLong(parts[1]);
                Instant at = Instant.ofEpochSecond(Math.floorDiv(micros, 1_000_000L),
                        Math.floorMod(micros, 1_000_000L) * 1_000L);
                return new AuditCursor(at, UUID.fromString(parts[2]), parts[3]);
            }
        } catch (IllegalArgumentException | ArithmeticException | java.time.DateTimeException malformed) {
            // Refused below; NumberFormatException is an IllegalArgumentException.
        }
        throw new InvalidCursorException();
    }

    /** A short, stable hash of the canonical filter values; {@code null} and absent are the same filter. */
    static String hash(Object... filters) {
        StringBuilder canonical = new StringBuilder();
        for (Object filter : filters) {
            canonical.append(filter == null ? "" : filter.toString()).append('\u001f');
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (NoSuchAlgorithmException missing) {
            throw new IllegalStateException("SHA-256 is required by every Java platform", missing);
        }
    }

    static final class InvalidCursorException extends ApiException {

        InvalidCursorException() {
            super(ApiError.INVALID_CURSOR);
        }
    }
}
