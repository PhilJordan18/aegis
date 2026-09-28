package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/** Runs with the most verbose framework logging a developer is likely to enable, then searches the output. */
@ExtendWith(OutputCaptureExtension.class)
class CredentialLoggingTests extends ApiIntegrationTest {

    private static final List<String> VERBOSE_LOGGERS =
            List.of("org.springframework.web", "org.springframework.security", "ca.aegis.control");

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

        String logs = output.getAll();
        assertThat(logs).as("verbose logging was active").contains("LoginRequest[email=" + technician.email() + "]");
        assertThat(logs).doesNotContain(technician.password(), wrongPassword, tooLongPassword, token,
                token.substring(token.lastIndexOf('.') + 1));
    }
}
