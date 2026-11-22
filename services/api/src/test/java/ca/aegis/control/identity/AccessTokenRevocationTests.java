package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * ADR-018 on real PostgreSQL: a password change refuses every token issued before it (A), and a Manager sign-out
 * refuses only the tokens of that browser session (B).
 */
class AccessTokenRevocationTests extends ApiIntegrationTest {

    private static final String REFRESH = "/api/v1/auth/session/refresh";
    private static final String REVOKE = "/api/v1/auth/session/revoke";
    private static final String COOKIE = "__Secure-aegis_session";

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PasswordChanges passwordChanges;

    @Autowired
    BrowserSessions browserSessions;

    @Autowired
    TransactionTemplate transactions;

    private record Browser(String cookie, String token) {
    }

    @Test
    void aPasswordChangeRefusesEveryEarlierTokenOnWebAndIos() throws Exception {
        TestAccount admin = accounts.admin();
        Browser browser = browserSignIn(admin);
        String restored = refreshedToken(browser.cookie());
        String ios = accessToken(admin);
        String newPassword = "rotated-" + UUID.randomUUID();

        assertTrue(passwordChanges.change(admin.id(), newPassword, null));

        for (String earlier : new String[] {browser.token(), restored, ios}) {
            me(earlier).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
        assertEquals(1, credentialVersion(admin.id()));
        String fresh = JsonPath.read(mvc.perform(login(admin.email(), newPassword)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), "$.accessToken");
        assertEquals(1L, claims(fresh).getLongClaim("cv"));
        me(fresh).andExpect(status().isOk());
    }

    @Test
    void reapplyingTheSamePasswordRefusesNothing() throws Exception {
        TestAccount admin = accounts.admin();
        Browser browser = browserSignIn(admin);
        String ios = accessToken(admin);

        assertFalse(passwordChanges.change(admin.id(), admin.password(), null));

        assertEquals(0, credentialVersion(admin.id()));
        me(browser.token()).andExpect(status().isOk());
        me(ios).andExpect(status().isOk());
    }

    @Test
    void aSignOutRefusesOnlyTheTokensOfThatBrowserSession() throws Exception {
        TestAccount admin = accounts.admin();
        Browser signedOut = browserSignIn(admin);
        String restored = refreshedToken(signedOut.cookie());
        Browser otherBrowser = browserSignIn(admin);
        String ios = accessToken(admin);

        mvc.perform(post(REVOKE).cookie(new Cookie(COOKIE, signedOut.cookie())).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isNoContent());

        me(signedOut.token()).andExpect(status().isUnauthorized());
        me(restored).andExpect(status().isUnauthorized());
        me(otherBrowser.token()).andExpect(status().isOk());
        me(refreshedToken(otherBrowser.cookie())).andExpect(status().isOk());
        me(ios).andExpect(status().isOk());
    }

    @Test
    void browserTokensNameTheirSessionAndDeviceTokensDoNot() throws Exception {
        TestAccount admin = accounts.admin();
        Browser browser = browserSignIn(admin);

        UUID sessionId = UUID.fromString(claims(browser.token()).getStringClaim("sid"));
        assertEquals(sessionId, UUID.fromString(claims(refreshedToken(browser.cookie())).getStringClaim("sid")));
        assertEquals(admin.id(), jdbc.sql("SELECT user_id FROM aegis.browser_sessions WHERE id = :id")
                .param("id", sessionId).query(UUID.class).single());
        assertNull(claims(accessToken(admin)).getClaim("sid"));
    }

    @Test
    void aSessionOfAnotherAccountOrPastItsEndAuthenticatesNothing() throws Exception {
        TestAccount admin = accounts.admin();
        TestAccount technician = accounts.technician();
        Browser browser = browserSignIn(admin);
        String sessionOfAdmin = claims(browser.token()).getStringClaim("sid");

        String borrowed = signed(new JWTClaimsSet.Builder()
                .issuer("aegis-control").audience("aegis-api").subject(technician.id().toString())
                .jwtID(UUID.randomUUID().toString()).issueTime(Date.from(clock.instant()))
                .expirationTime(Date.from(clock.instant().plus(AccessTokens.LIFETIME)))
                .claim("role", "TECHNICIAN").claim("maximumAccessLevel", "STANDARD").claim("cv", 0)
                .claim("sid", sessionOfAdmin).build());
        me(borrowed).andExpect(status().isUnauthorized());

        // A restored token never outlives its session, so a session that ended only shows through a shorter-lived copy.
        Browser ending = browserSignIn(admin);
        jdbc.sql("UPDATE aegis.browser_sessions SET expires_at = :end WHERE id = :id")
                .param("end", clock.instant().plus(Duration.ofMinutes(5)).atOffset(java.time.ZoneOffset.UTC))
                .param("id", UUID.fromString(claims(ending.token()).getStringClaim("sid"))).update();
        me(ending.token()).andExpect(status().isOk());
        clock.advance(Duration.ofMinutes(5));
        me(ending.token()).andExpect(status().isUnauthorized());
    }

    @Test
    void theDatabaseRefusesALoweredVersionAndANewHashUnderTheSameVersion() {
        TestAccount admin = accounts.admin();
        assertTrue(passwordChanges.change(admin.id(), "rotated-" + UUID.randomUUID(), null));

        assertThrows(DataAccessException.class, () -> jdbc.sql(
                "UPDATE aegis.users SET credential_version = 0 WHERE id = :id").param("id", admin.id()).update());
        assertThrows(DataAccessException.class, () -> jdbc.sql(
                "UPDATE aegis.users SET password_hash = 'another-hash' WHERE id = :id").param("id", admin.id()).update());
        assertThrows(DataAccessException.class, () -> jdbc.sql(
                "UPDATE aegis.users SET credential_version = -1 WHERE id = :id").param("id", admin.id()).update());
        assertEquals(1, credentialVersion(admin.id()));
    }

    /** Login / password change: the token carries the version read with the verified hash, then stale on commit. */
    @Test
    void aSignInRacingAPasswordChangeGetsATokenThatIsRefusedOnceTheChangeCommits() throws Exception {
        TestAccount admin = accounts.admin();
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> change = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(tx -> {
            passwordChanges.change(admin.id(), "rotated-" + UUID.randomUUID(), null);
            changed.countDown();
            await(release);
        }));
        assertTrue(changed.await(10, TimeUnit.SECONDS));

        // The old hash and version are still the committed ones: a device sign-in takes no lock and succeeds.
        String issuedDuringChange = accessToken(admin);
        assertEquals(0L, claims(issuedDuringChange).getLongClaim("cv"));
        me(issuedDuringChange).andExpect(status().isOk());
        release.countDown();
        change.get(10, TimeUnit.SECONDS);

        me(issuedDuringChange).andExpect(status().isUnauthorized());
    }

    /** Restore / password change, the restore first: its token carries the old version and is refused after. */
    @Test
    void aTokenRestoredJustBeforeAPasswordChangeIsRefusedOnceTheChangeCommits() throws Exception {
        TestAccount admin = accounts.admin();
        Browser browser = browserSignIn(admin);
        String restored = refreshedToken(browser.cookie());

        assertTrue(passwordChanges.change(admin.id(), "rotated-" + UUID.randomUUID(), null));

        me(restored).andExpect(status().isUnauthorized());
        refresh(browser.cookie()).andExpect(status().isUnauthorized());
    }

    /** Restore / sign-out: a restore waiting on the session row sees the revocation and issues nothing. */
    @Test
    void aRestoreRacingASignOutIssuesNoTokenAndEarlierOnesAreRefused() throws Exception {
        TestAccount admin = accounts.admin();
        Browser browser = browserSignIn(admin);
        String restoredBefore = refreshedToken(browser.cookie());
        CountDownLatch revoked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> signOut = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(tx -> {
            browserSessions.signOut(browser.cookie());
            revoked.countDown();
            await(release);
        }));
        assertTrue(revoked.await(10, TimeUnit.SECONDS));

        CompletableFuture<Integer> restore = CompletableFuture.supplyAsync(() -> {
            try {
                return refresh(browser.cookie()).andReturn().getResponse().getStatus();
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });
        awaitLockWaiter();
        // Until the revocation commits, the session is open and its tokens still authenticate: the accepted window.
        me(restoredBefore).andExpect(status().isOk());
        release.countDown();
        signOut.get(10, TimeUnit.SECONDS);

        assertEquals(401, restore.get(10, TimeUnit.SECONDS));
        me(restoredBefore).andExpect(status().isUnauthorized());
        me(browser.token()).andExpect(status().isUnauthorized());
    }

    private Browser browserSignIn(TestAccount account) throws Exception {
        MvcResult result = mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON)
                .header(ORIGIN, MANAGER_ORIGIN)
                .content(jsonMapper.writeValueAsString(
                        Map.of("email", account.email(), "password", account.password(), "browserSession", true))))
                .andExpect(status().isOk()).andReturn();
        Cookie cookie = result.getResponse().getCookie(COOKIE);
        assertNotNull(cookie);
        return new Browser(cookie.getValue(),
                JsonPath.read(result.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.accessToken"));
    }

    private String refreshedToken(String cookie) throws Exception {
        return JsonPath.read(refresh(cookie).andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8), "$.accessToken");
    }

    private ResultActions refresh(String cookie) throws Exception {
        return mvc.perform(post(REFRESH).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN));
    }

    private ResultActions me(String token) throws Exception {
        return mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)));
    }

    private int credentialVersion(UUID user) {
        return jdbc.sql("SELECT credential_version FROM aegis.users WHERE id = :id").param("id", user)
                .query(Integer.class).single();
    }

    private static JWTClaimsSet claims(String token) throws Exception {
        return SignedJWT.parse(token).getJWTClaimsSet();
    }

    private static String signed(JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(),
                claims);
        jwt.sign(new MACSigner(signingKey()));
        return jwt.serialize();
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
        throw new AssertionError("No request waited on the session lock");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("Not released");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }
}
