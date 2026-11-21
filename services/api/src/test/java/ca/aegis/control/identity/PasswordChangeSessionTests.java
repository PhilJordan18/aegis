package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/** ADR-017: an effective password change revokes the account's browser sessions, atomically and without races. */
class PasswordChangeSessionTests extends ApiIntegrationTest {

    private static final String REFRESH = "/api/v1/auth/session/refresh";
    private static final String COOKIE = "__Secure-aegis_session";
    private static final String NEW_PASSWORD = "rotated-" + UUID.randomUUID();

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PasswordChanges passwordChanges;

    @Autowired
    BrowserSessions browserSessions;

    @Autowired
    TransactionTemplate transactions;

    TestAccount admin;

    @BeforeEach
    void admin() {
        admin = accounts.admin();
    }

    @Test
    void anEffectiveChangeRevokesEveryOpenSessionOfTheAccountAndIsAudited() throws Exception {
        String first = browserSession(admin);
        String second = browserSession(admin);
        TestAccount other = accounts.admin();
        String unrelated = browserSession(other);
        String iosToken = accessToken(admin);

        assertTrue(passwordChanges.change(admin.id(), NEW_PASSWORD, null));

        refresh(first).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"));
        refresh(second).andExpect(status().isUnauthorized());
        refresh(unrelated).andExpect(status().isOk());
        assertEquals(2, jdbc.sql("""
                SELECT count(*) FROM aegis.browser_sessions
                WHERE user_id = :id AND revocation_reason = 'PASSWORD_CHANGED'
                """).param("id", admin.id()).query(Long.class).single());
        assertEquals(Map.of("revokedBrowserSessions", 2), passwordChangedEvents(admin.id()).getFirst());
        assertEquals(1, passwordChangedEvents(admin.id()).size());
        // Not an access-token revocation (ADR-018 is only proposed): an already issued token still works.
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(iosToken))).andExpect(status().isOk());
        mvc.perform(login(admin.email(), admin.password())).andExpect(status().isUnauthorized());
        mvc.perform(login(admin.email(), NEW_PASSWORD)).andExpect(status().isOk());
    }

    @Test
    void theSamePasswordChangesNothingAndRevokesNothing() throws Exception {
        String cookie = browserSession(admin);
        String hashBefore = passwordHash(admin.id());

        assertFalse(passwordChanges.change(admin.id(), admin.password(), null));

        assertEquals(hashBefore, passwordHash(admin.id()));
        refresh(cookie).andExpect(status().isOk());
        assertTrue(passwordChangedEvents(admin.id()).isEmpty());
    }

    @Test
    void aRevokedSessionCanNeverBeReopenedOrAltered() throws Exception {
        browserSession(admin);
        passwordChanges.change(admin.id(), NEW_PASSWORD, null);

        assertThrows(DataAccessException.class, () -> jdbc.sql("""
                UPDATE aegis.browser_sessions SET revoked_at = NULL, revocation_reason = NULL WHERE user_id = :id
                """).param("id", admin.id()).update());
        assertThrows(DataAccessException.class, () -> jdbc.sql("""
                UPDATE aegis.browser_sessions SET last_refreshed_at = now() WHERE user_id = :id
                """).param("id", admin.id()).update());
    }

    @Test
    void aBrowserSignInRacingAPasswordChangeNeverLeavesAnOpenSession() throws Exception {
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> change = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(tx -> {
            passwordChanges.change(admin.id(), NEW_PASSWORD, null);
            changed.countDown();
            await(release);
        }));
        assertTrue(changed.await(10, TimeUnit.SECONDS));

        // The old hash is still the committed one, so the password check passes; the guarded insert must wait.
        CompletableFuture<MvcResult> signIn = CompletableFuture.supplyAsync(() -> perform(admin.password()));
        awaitLockWaiter();
        release.countDown();
        change.get(10, TimeUnit.SECONDS);

        assertEquals(401, signIn.get(10, TimeUnit.SECONDS).getResponse().getStatus());
        assertEquals(0, openSessions(admin.id()));
    }

    @Test
    void aRefreshRacingAPasswordChangeSeesTheRevocation() throws Exception {
        String cookie = browserSession(admin);
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> change = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(tx -> {
            passwordChanges.change(admin.id(), NEW_PASSWORD, null);
            changed.countDown();
            await(release);
        }));
        assertTrue(changed.await(10, TimeUnit.SECONDS));

        CompletableFuture<Integer> refresh = CompletableFuture.supplyAsync(() -> {
            try {
                return refresh(cookie).andReturn().getResponse().getStatus();
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });
        awaitLockWaiter();
        release.countDown();
        change.get(10, TimeUnit.SECONDS);

        assertEquals(401, refresh.get(10, TimeUnit.SECONDS));
        assertEquals(0, openSessions(admin.id()));
    }

    @Test
    void retentionCountsThirtyDaysFromTheEarlierOfRevocationAndEndAndKeepsTheAudit() throws Exception {
        String open = browserSession(admin);
        TestAccount rotated = accounts.admin();
        browserSession(rotated);
        passwordChanges.change(rotated.id(), NEW_PASSWORD, null);
        Instant now = clock.instant();
        Duration thirtyDays = Duration.ofDays(30);
        // Ended by revocation 30 days and 1 second ago: deleted. Exactly 30 days ago: kept.
        UUID revokedJustOver = insertSession(admin.id(), now.minus(thirtyDays).minusSeconds(3601),
                now.minus(thirtyDays).minusSeconds(1));
        UUID revokedExactly = insertSession(admin.id(), now.minus(thirtyDays).minusSeconds(3600),
                now.minus(thirtyDays));
        // Never revoked, absolute end 30 days and 1 second ago: deleted.
        UUID expiredJustOver = insertSession(admin.id(), now.minus(thirtyDays).minus(Duration.ofHours(8))
                .minusSeconds(1), null);
        // Signed out long after its end: the end, not the late revocation, starts the 30 days.
        UUID lateSignOut = insertSession(admin.id(), now.minus(Duration.ofDays(40)), now.minus(Duration.ofDays(5)));
        long auditBefore = jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();

        new BrowserSessionPurgeJob(browserSessions, clock, 1).run();

        assertFalse(exists(revokedJustOver));
        assertTrue(exists(revokedExactly));
        assertFalse(exists(expiredJustOver));
        assertFalse(exists(lateSignOut));
        refresh(open).andExpect(status().isOk());
        assertEquals(auditBefore, jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single());

        // The rotated account's revoked sessions are purged later; its PASSWORD_CHANGED event stays.
        clock.advance(thirtyDays.plusDays(1));
        new BrowserSessionPurgeJob(browserSessions, clock, 10).run();
        assertEquals(0, jdbc.sql("SELECT count(*) FROM aegis.browser_sessions WHERE user_id = :id")
                .param("id", rotated.id()).query(Long.class).single());
        assertEquals(List.of(Map.of("revokedBrowserSessions", 1)), passwordChangedEvents(rotated.id()));
    }

    @Test
    void anOpenSessionIsNeverDeleted() throws Exception {
        String open = browserSession(admin);

        assertEquals(0, browserSessions.purgeEnded(clock.instant(), Duration.ZERO, 100));
        refresh(open).andExpect(status().isOk());

        // The database refuses it too, whatever the caller: here a row open by the database's own clock.
        UUID live = insertSession(admin.id(), Instant.now(), null);
        assertThrows(DataAccessException.class, () -> jdbc.sql("DELETE FROM aegis.browser_sessions WHERE id = :id")
                .param("id", live).update());
        assertTrue(exists(live));

        // An application clock ahead of the database skips that row instead of failing the whole batch.
        Instant aheadOfDatabase = Instant.now().plus(Duration.ofHours(9));
        assertDoesNotThrow(() -> browserSessions.purgeEnded(aheadOfDatabase, Duration.ZERO, Integer.MAX_VALUE));
        assertTrue(exists(live));
    }

    private MvcResult perform(String password) {
        try {
            return mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON).header(ORIGIN, MANAGER_ORIGIN)
                    .content(jsonMapper.writeValueAsString(
                            Map.of("email", admin.email(), "password", password, "browserSession", true))))
                    .andReturn();
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private String browserSession(TestAccount account) throws Exception {
        MvcResult result = mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON)
                .header(ORIGIN, MANAGER_ORIGIN)
                .content(jsonMapper.writeValueAsString(
                        Map.of("email", account.email(), "password", account.password(), "browserSession", true))))
                .andExpect(status().isOk()).andReturn();
        Cookie cookie = result.getResponse().getCookie(COOKIE);
        assertNotNull(cookie);
        return cookie.getValue();
    }

    private org.springframework.test.web.servlet.ResultActions refresh(String cookie) throws Exception {
        return mvc.perform(post(REFRESH).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN));
    }

    /** Waits until another backend of this database is blocked on a row lock. */
    private void awaitLockWaiter() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            long waiting = jdbc.sql("""
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                    """).query(Long.class).single();
            if (waiting > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("No request waited on the account or session lock");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("Not released");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    private long openSessions(UUID user) {
        return jdbc.sql("SELECT count(*) FROM aegis.browser_sessions WHERE user_id = :id AND revoked_at IS NULL")
                .param("id", user).query(Long.class).single();
    }

    private String passwordHash(UUID user) {
        return jdbc.sql("SELECT password_hash FROM aegis.users WHERE id = :id").param("id", user)
                .query(String.class).single();
    }

    private List<Map<String, Object>> passwordChangedEvents(UUID user) {
        return jdbc.sql("""
                SELECT details::text FROM aegis.audit_events
                WHERE event_type = 'PASSWORD_CHANGED' AND subject_type = 'USER' AND subject_id = :id
                """).param("id", user).query(String.class).list().stream()
                .map(json -> JsonPath.<Map<String, Object>>read(json, "$")).toList();
    }

    private UUID insertSession(UUID user, Instant createdAt, Instant revokedAt) {
        byte[] hash = new byte[32];
        new java.security.SecureRandom().nextBytes(hash);
        return jdbc.sql("""
                INSERT INTO aegis.browser_sessions
                    (user_id, token_hash, role, created_at, expires_at, revoked_at, revocation_reason)
                VALUES (:user, :hash, 'ADMIN', :createdAt, :expiresAt, :revokedAt, :reason)
                RETURNING id
                """)
                .param("user", user)
                .param("hash", hash)
                .param("createdAt", createdAt.atOffset(ZoneOffset.UTC))
                .param("expiresAt", createdAt.plus(Duration.ofHours(8)).atOffset(ZoneOffset.UTC))
                .param("revokedAt", revokedAt == null ? null : revokedAt.atOffset(ZoneOffset.UTC))
                .param("reason", revokedAt == null ? null : "SIGNED_OUT")
                .query(UUID.class).single();
    }

    private boolean exists(UUID session) {
        return jdbc.sql("SELECT count(*) FROM aegis.browser_sessions WHERE id = :id").param("id", session)
                .query(Long.class).single() == 1;
    }
}
