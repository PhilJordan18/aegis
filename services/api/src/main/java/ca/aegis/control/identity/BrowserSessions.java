package ca.aegis.control.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Revocable browser sessions of ADR-016. The cookie carries 256 random bits; the database keeps only their SHA-256
 * digest. A refresh re-reads the account and issues a new access token that never outlives the session's absolute
 * end; it neither rotates the cookie nor extends the session, so concurrent tabs cannot invalidate each other.
 */
@Service
class BrowserSessions {

    static final String COOKIE = "__Secure-aegis_session";
    static final String COOKIE_PATH = "/api/v1/auth/session";

    static final String SIGNED_OUT = "SIGNED_OUT";
    static final String ACCOUNT_CHANGED = "ACCOUNT_CHANGED";
    static final String PASSWORD_CHANGED = "PASSWORD_CHANGED";

    private static final int TOKEN_BYTES = 32;
    private static final Pattern TOKEN_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final JdbcClient jdbc;
    private final AccountRepository accounts;
    private final AccessTokens accessTokens;
    private final BrowserSessionProperties properties;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    BrowserSessions(JdbcClient jdbc, AccountRepository accounts, AccessTokens accessTokens,
            BrowserSessionProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.accessTokens = accessTokens;
        this.properties = properties;
        this.clock = clock;
    }

    /** A started session: the cookie value, never logged, and its absolute end. */
    record Started(String token, Instant expiresAt) {

        @Override
        public String toString() {
            return "Started[expiresAt=%s]".formatted(expiresAt);
        }
    }

    /**
     * Opens a session for an account whose password was just verified against {@code verifiedPasswordHash}. The row is
     * inserted only while the account still holds that hash and may sign in, under a share lock on the account row:
     * a concurrent password change (ADR-017) either waits for this insert and then revokes it, or has already
     * committed, and then nothing is inserted and the sign-in is refused.
     */
    Started start(CurrentAccount account, String verifiedPasswordHash) {
        byte[] secret = new byte[TOKEN_BYTES];
        random.nextBytes(secret);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = now.plus(properties.lifetime());
        int inserted = jdbc.sql("""
                INSERT INTO aegis.browser_sessions (user_id, token_hash, role, created_at, expires_at)
                SELECT u.id, :hash, u.role, :now, :expiresAt
                FROM aegis.users u
                WHERE u.id = :user AND u.password_hash = :verified AND u.role = :role
                    AND u.status = 'ACTIVE' AND u.archived_at IS NULL
                FOR SHARE
                """)
                .param("user", account.id())
                .param("verified", verifiedPasswordHash)
                .param("hash", digest(token))
                .param("role", account.role().name())
                .param("now", now.atOffset(ZoneOffset.UTC))
                .param("expiresAt", expiresAt.atOffset(ZoneOffset.UTC))
                .update();
        if (inserted != 1) {
            throw new InvalidCredentialsException();
        }
        return new Started(token, expiresAt);
    }

    /**
     * The new access token of a live session, or empty when the cookie is missing, malformed, unknown, revoked or
     * past its end, or when the account may no longer sign in or changed role; that last case revokes the session.
     */
    @Transactional
    Optional<LoginResponse> refresh(String token) {
        if (token == null || !TOKEN_SHAPE.matcher(token).matches()) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        Optional<Session> found = jdbc.sql("""
                SELECT id, user_id, role, expires_at FROM aegis.browser_sessions
                WHERE token_hash = :hash AND revoked_at IS NULL
                FOR UPDATE
                """)
                .param("hash", digest(token))
                .query((row, rowNumber) -> new Session(row.getObject("id", UUID.class),
                        row.getObject("user_id", UUID.class), Role.valueOf(row.getString("role")),
                        row.getObject("expires_at", java.time.OffsetDateTime.class).toInstant()))
                .optional();
        if (found.isEmpty() || !now.isBefore(found.get().expiresAt())) {
            return Optional.empty();
        }
        Session session = found.get();
        Optional<Account> account = accounts.findById(session.userId())
                .filter(existing -> existing.canAuthenticate() && existing.role() == session.role());
        if (account.isEmpty()) {
            revoke(session.id(), ACCOUNT_CHANGED, now);
            return Optional.empty();
        }
        // The token's own issue instant is truncated to the second; the session end bounds it.
        Instant notAfter = session.expiresAt().truncatedTo(ChronoUnit.SECONDS);
        if (!now.truncatedTo(ChronoUnit.SECONDS).isBefore(notAfter)) {
            return Optional.empty();
        }
        jdbc.sql("UPDATE aegis.browser_sessions SET last_refreshed_at = :now WHERE id = :id")
                .param("now", now.atOffset(ZoneOffset.UTC)).param("id", session.id()).update();
        CurrentAccount current = CurrentAccount.of(account.get());
        return Optional.of(LoginResponse.of(accessTokens.issue(current, notAfter), current));
    }

    /** Ends the session of this cookie, if any is still open. Unknown or malformed values are ignored. */
    void signOut(String token) {
        if (token == null || !TOKEN_SHAPE.matcher(token).matches()) {
            return;
        }
        jdbc.sql("""
                UPDATE aegis.browser_sessions SET revoked_at = :now, revocation_reason = :reason
                WHERE token_hash = :hash AND revoked_at IS NULL
                """)
                .param("now", clock.instant().atOffset(ZoneOffset.UTC))
                .param("reason", SIGNED_OUT)
                .param("hash", digest(token))
                .update();
    }

    /** Revokes every open session of the account; joins the caller's transaction. Returns how many were open. */
    int revokeAllOf(UUID userId, String reason, Instant now) {
        return jdbc.sql("""
                UPDATE aegis.browser_sessions SET revoked_at = :now, revocation_reason = :reason
                WHERE user_id = :user AND revoked_at IS NULL AND expires_at > :now
                """)
                .param("now", now.atOffset(ZoneOffset.UTC))
                .param("reason", reason)
                .param("user", userId)
                .update();
    }

    /**
     * Deletes up to {@code limit} sessions that ended, by revocation or expiry, before {@code cutoff}. A row is a
     * credential, not custody history (ADR-016); the durable trace of a password change is its audit event.
     */
    int purgeEndedBefore(Instant cutoff, int limit) {
        return jdbc.sql("""
                DELETE FROM aegis.browser_sessions WHERE id IN (
                    SELECT id FROM aegis.browser_sessions
                    WHERE coalesce(revoked_at, expires_at) < :cutoff
                    ORDER BY coalesce(revoked_at, expires_at)
                    LIMIT :limit)
                """)
                .param("cutoff", cutoff.atOffset(ZoneOffset.UTC))
                .param("limit", limit)
                .update();
    }

    static ResponseCookie cookie(Started started, Clock clock) {
        return base(started.token())
                .maxAge(Duration.between(clock.instant(), started.expiresAt()).toSeconds())
                .build();
    }

    static ResponseCookie cleared() {
        return base("").maxAge(0).build();
    }

    private static ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(COOKIE, value).path(COOKIE_PATH).httpOnly(true).secure(true).sameSite("Strict");
    }

    private void revoke(UUID id, String reason, Instant now) {
        jdbc.sql("""
                UPDATE aegis.browser_sessions SET revoked_at = :now, revocation_reason = :reason
                WHERE id = :id AND revoked_at IS NULL
                """)
                .param("now", now.atOffset(ZoneOffset.UTC)).param("reason", reason).param("id", id).update();
    }

    private static byte[] digest(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException missing) {
            throw new IllegalStateException("SHA-256 is required", missing);
        }
    }

    private record Session(UUID id, UUID userId, Role role, Instant expiresAt) {
    }
}
