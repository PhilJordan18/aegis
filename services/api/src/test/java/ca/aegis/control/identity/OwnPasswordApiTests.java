package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.support.ApiIntegrationTest;

class OwnPasswordApiTests extends ApiIntegrationTest {
    private static final String PASSWORD = "/api/v1/auth/password";
    @Autowired JdbcClient jdbc;
    @Autowired AccountRepository repository;
    @Autowired PasswordChanges passwordChanges;
    @Autowired OwnPasswordChange ownPasswords;
    @Autowired TransactionTemplate transactions;

    @Test
    void changeRevokesCallerOtherJwtAndEveryCookieAuditsActorAndRequiresFreshLogin() throws Exception {
        var owner = accounts.technician();
        var other = accounts.technician();
        String token = accessToken(owner);
        String otherToken = accessToken(other);
        var browser = mvc.perform(post(LOGIN).header(ORIGIN, MANAGER_ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonMapper.writeValueAsString(Map.of("email", owner.email(), "password", owner.password(),
                                "browserSession", true))))
                .andExpect(status().isOk()).andReturn().getResponse();
        Cookie cookie = browser.getCookie(BrowserSessions.COOKIE);
        String browserToken = com.jayway.jsonpath.JsonPath.read(browser.getContentAsString(), "$.accessToken");
        String replacement = "new-" + UUID.randomUUID();
        change(token, owner.password(), replacement).andExpect(status().isNoContent());
        for (String stale : List.of(token, browserToken)) {
            mvc.perform(get(ME).header(AUTHORIZATION, bearer(stale))).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/v1/auth/session/refresh").header(ORIGIN, MANAGER_ORIGIN).cookie(cookie))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(otherToken))).andExpect(status().isOk());
        mvc.perform(login(owner.email(), owner.password())).andExpect(status().isUnauthorized());
        mvc.perform(login(owner.email(), replacement)).andExpect(status().isOk());
        assertEquals(1, repository.findById(owner.id()).orElseThrow().credentialVersion());
        var events = jdbc.sql("SELECT actor_user_id, details::text FROM aegis.audit_events "
                + "WHERE subject_id=:id AND event_type='PASSWORD_CHANGED'").param("id", owner.id()).query().listOfRows();
        assertEquals(1, events.size());
        assertEquals(owner.id(), events.getFirst().get("actor_user_id"));
        assertFalse(events.toString().contains(replacement));
        assertFalse(events.toString().contains(owner.password()));
        assertEquals(0, repository.findById(other.id()).orElseThrow().credentialVersion());
    }

    @Test
    void incorrectReusedAndMalformedPasswordsDoNotChangeAccountOrExposeSecrets() throws Exception {
        var owner = accounts.technician();
        String token = accessToken(owner);
        String hash = repository.findById(owner.id()).orElseThrow().passwordHash();
        change(token, "wrong-secret", "new-" + UUID.randomUUID()).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_CURRENT_INVALID"));
        change(token, owner.password(), owner.password()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PASSWORD_REUSED"));
        for (String newPassword : List.of("short", "é".repeat(37), "")) {
            String response = change(token, owner.password(), newPassword).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(response.contains(owner.password()));
            if (!newPassword.isEmpty()) assertFalse(response.contains(newPassword));
        }
        for (String payload : List.of("{}", "null", "{\"currentPassword\":123,\"newPassword\":true}",
                "{\"currentPassword\":\"secret\",\"newPassword\":\"some-long-password\",\"userId\":\"other\"}")) {
            mvc.perform(post(PASSWORD).header(AUTHORIZATION, bearer(token)).contentType(MediaType.APPLICATION_JSON)
                            .content(payload)).andExpect(status().isBadRequest());
        }
        assertEquals(hash, repository.findById(owner.id()).orElseThrow().passwordHash());
        assertEquals(0, auditCount(owner.id()));
        assertEquals("ChangePasswordRequest[<redacted>]", new ChangePasswordRequest(owner.password(), "secret").toString());
    }

    @Test
    void fiveAttemptsAcrossSourceAddressesThenRetryAfterAndNewWindow() throws Exception {
        var owner = accounts.technician();
        String token = accessToken(owner);
        for (int n = 0; n < 5; n++) {
            mvc.perform(post(PASSWORD).header(AUTHORIZATION, bearer(token)).contentType(MediaType.APPLICATION_JSON)
                            .content(jsonMapper.writeValueAsString(Map.of("currentPassword", "wrong",
                                    "newPassword", "replacement-password")))
                            .with(request -> { request.setRemoteAddr(UUID.randomUUID().toString()); return request; }))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("PASSWORD_CURRENT_INVALID"));
        }
        var refused = change(token, owner.password(), "replacement-password").andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("RATE_LIMITED")).andReturn().getResponse();
        assertEquals("60", refused.getHeader("Retry-After"));
        clock.advance(Duration.ofSeconds(60));
        change(token, owner.password(), "replacement-password").andExpect(status().isNoContent());
    }

    @Test
    void authenticationIsRequiredAndNeitherDisabledNorArchivedAccountsCanChange() throws Exception {
        mvc.perform(post(PASSWORD).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"secret\",\"newPassword\":\"long-new-password\"}"))
                .andExpect(status().isUnauthorized());
        var disabled = accounts.technician();
        String token = accessToken(disabled);
        accounts.disable(disabled.id());
        change(token, disabled.password(), "replacement-password").andExpect(status().isUnauthorized());
        var archived = accounts.technician();
        token = accessToken(archived);
        accounts.archive(archived.id());
        change(token, archived.password(), "replacement-password").andExpect(status().isUnauthorized());
        var admin = accounts.admin();
        change(accessToken(admin), admin.password(), "replacement-password").andExpect(status().isNoContent());
    }

    @Test
    void concurrentRequestRechecksVersionAfterWaitingForTheAccountLock() throws Exception {
        var owner = accounts.technician();
        String token = accessToken(owner);
        CompletableFuture<Integer> waiting = transactions.execute(tx -> {
            repository.lockById(owner.id()).orElseThrow();
            CompletableFuture<Integer> future = CompletableFuture.supplyAsync(() -> {
                try {
                    return change(token, owner.password(), "loser-replacement-password")
                            .andReturn().getResponse().getStatus();
                } catch (Exception failure) { throw new IllegalStateException(failure); }
            });
            awaitLockWaiter();
            ownPasswords.change(CurrentAccount.of(repository.findById(owner.id()).orElseThrow()),
                    new ChangePasswordRequest(owner.password(), "winner-replacement-password"));
            return future;
        });
        assertEquals(401, waiting.get(10, TimeUnit.SECONDS));
        assertEquals(1, auditCount(owner.id()));
        assertEquals(1, repository.findById(owner.id()).orElseThrow().credentialVersion());
        mvc.perform(login(owner.email(), "winner-replacement-password")).andExpect(status().isOk());
        mvc.perform(login(owner.email(), "loser-replacement-password")).andExpect(status().isUnauthorized());
    }

    @Test
    void outerRollbackKeepsHashVersionSessionAndAuditTogether() throws Exception {
        var owner = accounts.technician();
        String token = accessToken(owner);
        Cookie cookie = mvc.perform(post(LOGIN).header(ORIGIN, MANAGER_ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonMapper.writeValueAsString(Map.of("email", owner.email(), "password", owner.password(),
                                "browserSession", true))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie(BrowserSessions.COOKIE);
        Account before = repository.findById(owner.id()).orElseThrow();
        transactions.executeWithoutResult(tx -> {
            ownPasswords.change(CurrentAccount.of(before), new ChangePasswordRequest(owner.password(), "replacement-password"));
            tx.setRollbackOnly();
        });
        assertEquals(before, repository.findById(owner.id()).orElseThrow());
        mvc.perform(post("/api/v1/auth/session/refresh").header(ORIGIN, MANAGER_ORIGIN).cookie(cookie))
                .andExpect(status().isOk());
        assertEquals(0, auditCount(owner.id()));
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token))).andExpect(status().isOk());
    }

    @Test
    void staleAuthenticatedVersionCannotChangeEvenWhenPasswordWasRotatedBackToTheSameValue() {
        var owner = accounts.technician();
        CurrentAccount stale = CurrentAccount.of(repository.findById(owner.id()).orElseThrow());
        passwordChanges.change(owner.id(), "intermediate-password", null);
        passwordChanges.change(owner.id(), owner.password(), null);
        var refused = assertThrows(OwnPasswordChange.Refused.class,
                () -> ownPasswords.change(stale, new ChangePasswordRequest(owner.password(), "replacement-password")));
        assertEquals(ca.aegis.control.shared.web.ApiError.AUTH_TOKEN_INVALID, refused.error());
        assertEquals(2, repository.findById(owner.id()).orElseThrow().credentialVersion());
        assertEquals(2, auditCount(owner.id()));
    }

    @Test
    void newPasswordLimitsCountUtf8BytesAndPreserveWhitespace() throws Exception {
        for (String replacement : List.of("é".repeat(6), "é".repeat(36), "  kept-spaces  ")) {
            var owner = accounts.technician();
            change(accessToken(owner), owner.password(), replacement).andExpect(status().isNoContent());
            mvc.perform(login(owner.email(), replacement)).andExpect(status().isOk());
        }
    }

    private void awaitLockWaiter() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (jdbc.sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                    + "AND wait_event_type='Lock'").query(Long.class).single() > 0) return;
            try { Thread.sleep(20); } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted);
            }
        }
        throw new AssertionError("Concurrent request never waited on account lock");
    }

    private long auditCount(UUID account) {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED' AND subject_id=:id")
                .param("id", account).query(Long.class).single();
    }

    private ResultActions change(String token, String current, String replacement) throws Exception {
        return mvc.perform(post(PASSWORD).header(AUTHORIZATION, bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content(jsonMapper.writeValueAsString(Map.of("currentPassword", current, "newPassword", replacement))));
    }
}
