package ca.aegis.control.identity;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;

/**
 * The only writer of {@code users.password_hash} after an account exists (ADR-017). An effective change revokes every
 * open browser session of the account and records {@code PASSWORD_CHANGED} in the same transaction; a password equal
 * to the current one changes nothing, so re-applying a configuration on restart signs no one out.
 *
 * <p>The account row is locked first. A browser sign-in inserts its session only while that row still holds the hash
 * it verified, under a share lock (see {@link BrowserSessions#start}), so a sign-in that raced a change either commits
 * before the revocation, which then sees it, or inserts nothing.
 */
@Service
class PasswordChanges {

    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final BrowserSessions browserSessions;
    private final AuditTrail audit;
    private final Clock clock;

    PasswordChanges(JdbcClient jdbc, PasswordEncoder passwordEncoder, BrowserSessions browserSessions,
            AuditTrail audit, Clock clock) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.browserSessions = browserSessions;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Sets the password of an existing account.
     *
     * @param actorUserId the human who asked, or {@code null} for the backend itself, such as the demo provisioner
     * @return whether the password actually changed
     */
    @Transactional
    boolean change(UUID accountId, String newPassword, UUID actorUserId) {
        String currentHash = jdbc.sql("SELECT password_hash FROM aegis.users WHERE id = :id FOR UPDATE")
                .param("id", accountId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("Unknown account " + accountId));
        if (passwordEncoder.matches(newPassword, currentHash)) {
            return false;
        }
        jdbc.sql("UPDATE aegis.users SET password_hash = :hash WHERE id = :id")
                .param("hash", passwordEncoder.encode(newPassword))
                .param("id", accountId)
                .update();
        Instant now = clock.instant();
        int revoked = browserSessions.revokeAllOf(accountId, BrowserSessions.PASSWORD_CHANGED, now);
        audit.record(new AuditEvent(AuditEventType.PASSWORD_CHANGED, actorUserId, AuditSubjectType.USER, accountId,
                AuditResult.ACCEPTED, Map.of("revokedBrowserSessions", revoked), now));
        return true;
    }
}
