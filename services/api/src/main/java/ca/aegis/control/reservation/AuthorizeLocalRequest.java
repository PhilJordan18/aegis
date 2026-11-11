package ca.aegis.control.reservation;

import java.util.UUID;

/**
 * The body of document 09, section 15.5, as hashed by the idempotency key. Its {@code toString} never shows the
 * token, which must not reach a log, an audit or an error response (section 15.5 and section 21).
 */
record AuthorizeLocalRequest(UUID challengeId, String token) {

    @Override
    public String toString() {
        return "AuthorizeLocalRequest[challengeId=" + challengeId + ", token=<redacted>]";
    }
}
