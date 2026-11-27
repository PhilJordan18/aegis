package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/** Runs with the most verbose framework logging a developer is likely to enable, then searches the output. */
@ExtendWith(OutputCaptureExtension.class)
class CredentialLoggingTests extends ApiIntegrationTest {

    private static final List<String> VERBOSE_LOGGERS =
            List.of("org.springframework.web", "org.springframework.security", "ca.aegis.control");

    @Autowired
    PasswordChanges passwordChanges;

    @Autowired
    BrowserSessions browserSessions;

    @Autowired
    JdbcClient jdbc;

    private final LoggingSystem loggingSystem = LoggingSystem.get(getClass().getClassLoader());

    @BeforeEach
    void verboseLogging() {
        VERBOSE_LOGGERS.forEach(logger -> loggingSystem.setLogLevel(logger, LogLevel.TRACE));
    }

    @AfterEach
    void defaultLogging() {
        VERBOSE_LOGGERS.forEach(logger -> loggingSystem.setLogLevel(logger, null));
    }

    @Test
    void passwordsAndTokensNeverReachTheLogs(CapturedOutput output) throws Exception {
        TestAccount technician = accounts.technician();
        String token = accessToken(technician);
        String wrongPassword = "wrong-" + technician.password();
        String tooLongPassword = "trop-long-" + "x".repeat(70);

        mvc.perform(login(technician.email(), wrongPassword)).andExpect(status().isUnauthorized());
        mvc.perform(login(technician.email(), tooLongPassword)).andExpect(status().isBadRequest());
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token))).andExpect(status().isOk());
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token + "x"))).andExpect(status().isUnauthorized());
        // ADR-016: neither the browser session cookie nor the token it restores may be logged.
        TestAccount admin = accounts.admin();
        MvcResult browser = mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON).header(ORIGIN, MANAGER_ORIGIN)
                        .content(jsonMapper.writeValueAsString(Map.of("email", admin.email(), "password",
                                admin.password(), "browserSession", true))))
                .andExpect(status().isOk()).andReturn();
        Cookie session = browser.getResponse().getCookie("__Secure-aegis_session");
        String restored = JsonPath.read(mvc.perform(post("/api/v1/auth/session/refresh").cookie(session)
                .header(ORIGIN, MANAGER_ORIGIN)).andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8), "$.accessToken");
        mvc.perform(post("/api/v1/auth/session/revoke").cookie(session).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/session/refresh").cookie(session).header(ORIGIN, MANAGER_ORIGIN))
                .andExpect(status().isUnauthorized());

        // ADR-017: a password change, its revocation and the purge log neither password nor hash.
        String oldHash = passwordHash(admin.id());
        String rotated = "rotated-" + admin.password();
        mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON).header(ORIGIN, MANAGER_ORIGIN)
                .content(jsonMapper.writeValueAsString(Map.of("email", admin.email(), "password",
                        admin.password(), "browserSession", true))))
                .andExpect(status().isOk());
        passwordChanges.change(admin.id(), rotated, null);
        String newHash = passwordHash(admin.id());
        new BrowserSessionPurgeJob(browserSessions, clock, 10).run();

        String logs = output.getAll();
        assertThat(logs).as("verbose logging was active").contains("LoginRequest[email=" + technician.email() + "]");
        assertThat(logs).doesNotContain(technician.password(), wrongPassword, tooLongPassword, token,
                token.substring(token.lastIndexOf('.') + 1), admin.password(), session.getValue(), restored,
                restored.substring(restored.lastIndexOf('.') + 1), rotated, oldHash, newHash);
    }

    @Test
    void selfServicePasswordBodiesAndRefusalsStayRedactedAtTrace(CapturedOutput output) throws Exception {
        var owner = accounts.technician();
        String token = accessToken(owner);
        String replacement = "new-" + UUID.randomUUID();
        String wrong = "wrong-" + UUID.randomUUID();
        String oversized = "é".repeat(37);
        String shortPassword = "12345678901";
        for (String value : List.of(oversized, shortPassword)) {
            mvc.perform(post("/api/v1/auth/password").header(AUTHORIZATION, bearer(token))
                            .contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(
                                    Map.of("currentPassword", owner.password(), "newPassword", value))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/v1/auth/password").header(AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(
                                Map.of("currentPassword", wrong, "newPassword", replacement))))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/auth/password").header(AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(
                                Map.of("currentPassword", owner.password(), "newPassword", replacement))))
                .andExpect(status().isNoContent());
        assertThat(output.getAll()).contains("ChangePasswordRequest[<redacted>]")
                .doesNotContain(owner.password(), replacement, wrong, oversized, shortPassword, token,
                        passwordHash(owner.id()));
    }

    private String passwordHash(UUID account) {
        return jdbc.sql("SELECT password_hash FROM aegis.users WHERE id = :id").param("id", account)
                .query(String.class).single();
    }
}
