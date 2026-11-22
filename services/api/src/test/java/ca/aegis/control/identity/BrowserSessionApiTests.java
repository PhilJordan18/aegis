package ca.aegis.control.identity;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.http.HttpHeaders.SET_COOKIE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/** ADR-016: the revocable browser session that lets a reloaded Manager page recover its access token (#178). */
class BrowserSessionApiTests extends ApiIntegrationTest {

    private static final String REFRESH = "/api/v1/auth/session/refresh";
    private static final String REVOKE = "/api/v1/auth/session/revoke";
    private static final String ADMIN_ROUTE = "/api/v1/admin/assets";
    private static final String COOKIE = "__Secure-aegis_session";

    @Autowired
    JdbcClient jdbc;

    TestAccount admin;

    @BeforeEach
    void admin() {
        admin = accounts.admin();
    }

    @Test
    void browserSignInSetsAHardenedSessionCookieAndStoresOnlyItsDigest() throws Exception {
        MvcResult result = mvc.perform(browserLogin(admin.email(), admin.password()).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.expiresIn").value(3600))
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andReturn();

        String header = result.getResponse().getHeader(SET_COOKIE);
        assertNotNull(header);
        assertTrue(header.startsWith(COOKIE + "="), header);
        for (String attribute : new String[] {"Path=/api/v1/auth/session", "Max-Age=28800", "HttpOnly", "Secure",
                "SameSite=Strict"}) {
            assertTrue(header.contains(attribute), header);
        }
        assertFalse(header.contains("Domain="), header);
        String token = cookieValue(result);
        assertEquals(43, token.length());

        Map<String, Object> row = jdbc.sql("SELECT * FROM aegis.browser_sessions WHERE user_id = :id")
                .param("id", admin.id()).query().singleRow();
        assertEquals(32, ((byte[]) row.get("token_hash")).length);
        assertFalse(row.values().stream().anyMatch(value -> token.equals(String.valueOf(value))));
        assertEquals("ADMIN", row.get("role"));
        assertNull(row.get("revoked_at"));
    }

    @Test
    void signInWithoutBrowserSessionIsUnchangedAndSetsNoCookie() throws Exception {
        mvc.perform(login(admin.email(), admin.password()).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(SET_COOKIE));
        assertEquals(0L, sessions(admin.id()));
    }

    @Test
    void aBrowserSessionIsRefusedFromAnyOtherOriginBeforeTheCredentialsAreChecked() throws Exception {
        for (String origin : new String[] {null, "https://evil.example", MANAGER_ORIGIN + "/", "null"}) {
            MockHttpServletRequestBuilder request = browserLogin(admin.email(), "wrong password");
            if (origin != null) {
                request.header(ORIGIN, origin);
            }
            mvc.perform(request)
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"))
                    .andExpect(header().doesNotExist(SET_COOKIE));
        }
        assertEquals(0L, sessions(admin.id()));
    }

    @Test
    void aReloadedPageRecoversAWorkingAdministratorTokenFromItsCookie() throws Exception {
        String cookie = browserSession(admin);
        clock.advance(Duration.ofMinutes(75));

        String body = refresh(cookie)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(SET_COOKIE))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(3600))
                .andExpect(jsonPath("$.expiresAt").value("2026-09-28T15:15:00Z"))
                .andExpect(jsonPath("$.user.id").value(admin.id().toString()))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String token = JsonPath.read(body, "$.accessToken");

        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token))).andExpect(status().isOk());
        mvc.perform(get(ADMIN_ROUTE).header(AUTHORIZATION, bearer(token))).andExpect(status().isOk());
        // Two tabs reloading together both recover: the cookie is not rotated.
        refresh(cookie).andExpect(status().isOk());
        refresh(cookie).andExpect(status().isOk());
    }

    @Test
    void theRecoveredTokenNeverOutlivesTheSessionAndTheSessionNeverExtends() throws Exception {
        String cookie = browserSession(admin);

        clock.advance(Duration.ofHours(7).plusMinutes(30));
        refresh(cookie).andExpect(status().isOk())
                .andExpect(jsonPath("$.expiresIn").value(1800))
                .andExpect(jsonPath("$.expiresAt").value("2026-09-28T21:00:00Z"));

        clock.advance(Duration.ofMinutes(30));
        refresh(cookie).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"))
                .andExpect(header().string(SET_COOKIE, containsString("Max-Age=0")));
    }

    @Test
    void anUnusableCookieAsksForANewSignInAndClearsTheCookie() throws Exception {
        for (String value : new String[] {null, "", "not-a-token", "A".repeat(43)}) {
            MockHttpServletRequestBuilder request = post(REFRESH).header(ORIGIN, MANAGER_ORIGIN);
            if (value != null) {
                request.cookie(new Cookie(COOKIE, value));
            }
            mvc.perform(request)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"))
                    .andExpect(header().string(SET_COOKIE, containsString("Max-Age=0")));
        }
    }

    @Test
    void aValidCookieIsRefusedFromAnotherOrigin() throws Exception {
        String cookie = browserSession(admin);

        mvc.perform(post(REFRESH).cookie(new Cookie(COOKIE, cookie)))
                .andExpect(status().isForbidden());
        mvc.perform(post(REFRESH).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, "https://evil.example"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.accessToken").doesNotExist());
        mvc.perform(post(REVOKE).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, "https://evil.example"))
                .andExpect(status().isForbidden());
        refresh(cookie).andExpect(status().isOk());
    }

    @Test
    void anExplicitSignOutRevokesTheSessionOnTheServer() throws Exception {
        String cookie = browserSession(admin);

        mvc.perform(post(REVOKE).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isNoContent())
                .andExpect(header().string(SET_COOKIE, containsString(COOKIE + "=;")))
                .andExpect(header().string(SET_COOKIE, containsString("Max-Age=0")));

        refresh(cookie).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"));
        assertEquals("SIGNED_OUT", jdbc.sql("SELECT revocation_reason FROM aegis.browser_sessions WHERE user_id = :id")
                .param("id", admin.id()).query(String.class).single());
        // Idempotent, with or without a cookie.
        mvc.perform(post(REVOKE).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isNoContent());
        mvc.perform(post(REVOKE).header(ORIGIN, MANAGER_ORIGIN)).andExpect(status().isNoContent());
    }

    @Test
    void signingOutOneSessionLeavesAnotherOpen() throws Exception {
        String first = browserSession(admin);
        String second = browserSession(admin);

        mvc.perform(post(REVOKE).cookie(new Cookie(COOKIE, first)).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isNoContent());

        refresh(first).andExpect(status().isUnauthorized());
        refresh(second).andExpect(status().isOk());
    }

    @Test
    void aDisabledAccountOrAChangedRoleEndsTheSession() throws Exception {
        String disabled = browserSession(admin);
        accounts.disable(admin.id());
        refresh(disabled).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"));
        assertEquals("ACCOUNT_CHANGED", jdbc.sql("""
                SELECT revocation_reason FROM aegis.browser_sessions WHERE user_id = :id
                """).param("id", admin.id()).query(String.class).single());

        TestAccount demoted = accounts.create(Role.ADMIN, AccessLevel.STANDARD);
        String cookie = browserSession(demoted);
        accounts.changeRole(demoted.id(), Role.TECHNICIAN);
        refresh(cookie).andExpect(status().isUnauthorized());
        // The revocation is final: restoring the role does not reopen the session.
        accounts.changeRole(demoted.id(), Role.ADMIN);
        refresh(cookie).andExpect(status().isUnauthorized());
    }

    @Test
    void aTechnicianSessionStillCannotReachAdministration() throws Exception {
        TestAccount technician = accounts.technician();
        String cookie = browserSession(technician);

        String body = refresh(cookie).andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("TECHNICIAN"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        mvc.perform(get(ADMIN_ROUTE).header(AUTHORIZATION, bearer(JsonPath.read(body, "$.accessToken"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void theCookieIsNotABearerCredential() throws Exception {
        String cookie = browserSession(admin);

        mvc.perform(get(ADMIN_ROUTE).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(cookie))).andExpect(status().isUnauthorized());
    }

    @Test
    void anUnknownLoginFieldIsStillRejected() throws Exception {
        mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON).header(ORIGIN, MANAGER_ORIGIN)
                .content("{\"email\":\"" + admin.email() + "\",\"password\":\"" + admin.password()
                        + "\",\"rememberMe\":true}"))
                .andExpect(status().isBadRequest());
    }

    private String browserSession(TestAccount account) throws Exception {
        return cookieValue(mvc.perform(browserLogin(account.email(), account.password())
                .header(ORIGIN, MANAGER_ORIGIN)).andExpect(status().isOk()).andReturn());
    }

    private MockHttpServletRequestBuilder browserLogin(String email, String password) {
        return post(LOGIN).contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(
                Map.of("email", email, "password", password, "browserSession", true)));
    }

    private ResultActions refresh(String cookie) throws Exception {
        return mvc.perform(post(REFRESH).cookie(new Cookie(COOKIE, cookie)).header(ORIGIN, MANAGER_ORIGIN));
    }

    private static String cookieValue(MvcResult result) {
        Cookie cookie = result.getResponse().getCookie(COOKIE);
        assertNotNull(cookie);
        return cookie.getValue();
    }

    private long sessions(UUID user) {
        return jdbc.sql("SELECT count(*) FROM aegis.browser_sessions WHERE user_id = :id").param("id", user)
                .query(Long.class).single();
    }
}
