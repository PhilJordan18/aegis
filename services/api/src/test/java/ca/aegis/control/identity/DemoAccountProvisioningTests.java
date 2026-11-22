package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.support.ApiIntegrationTest;

/** Document 09, section 26.1.1: both prepared demonstration accounts can sign in. */
class DemoAccountProvisioningTests extends ApiIntegrationTest {

    private static final String SESSION_COOKIE = "__Secure-aegis_session";
    private static final String ADMIN_EMAIL = "admin-" + UUID.randomUUID() + "@aegis.demo";
    private static final String ADMIN_PASSWORD = "demo-" + UUID.randomUUID();
    private static final String TECHNICIAN_EMAIL = "technician-" + UUID.randomUUID() + "@aegis.demo";
    private static final String TECHNICIAN_PASSWORD = "demo-" + UUID.randomUUID();

    @DynamicPropertySource
    static void demoAccounts(DynamicPropertyRegistry registry) {
        registry.add("aegis.identity.demo-accounts.enabled", () -> "true");
        registry.add("aegis.identity.demo-accounts.admin.email", () -> ADMIN_EMAIL);
        registry.add("aegis.identity.demo-accounts.admin.password", () -> ADMIN_PASSWORD);
        registry.add("aegis.identity.demo-accounts.technician.email", () -> TECHNICIAN_EMAIL);
        registry.add("aegis.identity.demo-accounts.technician.password", () -> TECHNICIAN_PASSWORD);
    }

    @Autowired
    DemoAccountProvisioner provisioner;

    @Autowired
    AccountRepository accountRepository;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    TransactionTemplate transactions;

    @Autowired
    PasswordChanges passwordChanges;

    @Autowired
    JdbcClient jdbc;

    @Test
    void bothDemoAccountsAreCreatedAtStartupAndCanSignIn() throws Exception {
        Account admin = accountRepository.findByEmail(ADMIN_EMAIL).orElseThrow();
        assertEquals(Role.ADMIN, admin.role());
        assertEquals(AccessLevel.STANDARD, admin.maximumAccessLevel());
        assertEquals("Administrateur Démo", admin.displayName());
        assertThat(admin.passwordHash()).startsWith("{bcrypt}$2").doesNotContain(ADMIN_PASSWORD);
        Account technician = accountRepository.findByEmail(TECHNICIAN_EMAIL).orElseThrow();
        assertEquals(Role.TECHNICIAN, technician.role());
        assertEquals("Technicien Démo", technician.displayName());

        mvc.perform(login(ADMIN_EMAIL, ADMIN_PASSWORD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andExpect(jsonPath("$.user.displayName").value("Administrateur Démo"));
        mvc.perform(login(TECHNICIAN_EMAIL, TECHNICIAN_PASSWORD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("TECHNICIAN"));
    }

    @Test
    void provisioningAgainWithTheSameSettingsChangesNothing() {
        Account before = accountRepository.findByEmail(ADMIN_EMAIL).orElseThrow();

        provisioner.provision();

        Account after = accountRepository.findByEmail(ADMIN_EMAIL).orElseThrow();
        assertEquals(before.id(), after.id());
        assertEquals(before.passwordHash(), after.passwordHash());
    }

    @Test
    void changedPasswordIsRehashedWhileStatusRoleAndLevelAreKept() throws Exception {
        String adminEmail = "rotated-admin-" + UUID.randomUUID() + "@aegis.demo";
        String technicianEmail = "rotated-technician-" + UUID.randomUUID() + "@aegis.demo";
        provisioner(adminEmail, "first-admin-password", technicianEmail, "first-technician-password").provision();
        Account technician = accountRepository.findByEmail(technicianEmail).orElseThrow();
        accounts.disable(technician.id());
        accounts.changeAccessLevel(technician.id(), AccessLevel.RESTRICTED);

        provisioner(adminEmail, "second-admin-password", technicianEmail, "second-technician-password").provision();

        mvc.perform(login(adminEmail, "first-admin-password")).andExpect(status().isUnauthorized());
        mvc.perform(login(adminEmail, "second-admin-password")).andExpect(status().isOk());
        Account kept = accountRepository.findByEmail(technicianEmail).orElseThrow();
        assertEquals(technician.id(), kept.id());
        assertEquals(AccountStatus.DISABLED, kept.status());
        assertEquals(AccessLevel.RESTRICTED, kept.maximumAccessLevel());
        assertEquals(Role.TECHNICIAN, kept.role());
        assertEquals(true, passwordEncoder.matches("second-technician-password", kept.passwordHash()));
        mvc.perform(login(technicianEmail, "second-technician-password")).andExpect(status().isUnauthorized());
    }

    @Test
    void aRotatedPasswordRevokesBrowserSessionsButARestartWithTheSamePasswordDoesNot() throws Exception {
        String adminEmail = "session-admin-" + UUID.randomUUID() + "@aegis.demo";
        String technicianEmail = "session-technician-" + UUID.randomUUID() + "@aegis.demo";
        provisioner(adminEmail, "first-admin-password", technicianEmail, "first-technician-password").provision();
        String cookie = browserSession(adminEmail, "first-admin-password");

        provisioner(adminEmail, "first-admin-password", technicianEmail, "first-technician-password").provision();

        refresh(cookie).andExpect(status().isOk());
        UUID adminId = accountRepository.findByEmail(adminEmail).orElseThrow().id();
        assertEquals(0, passwordChangedEvents(adminId));

        provisioner(adminEmail, "second-admin-password", technicianEmail, "first-technician-password").provision();

        refresh(cookie).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_SESSION_INVALID"));
        assertEquals(1, passwordChangedEvents(adminId));
        UUID technicianId = accountRepository.findByEmail(technicianEmail).orElseThrow().id();
        assertEquals(0, passwordChangedEvents(technicianId));
    }

    private String browserSession(String email, String password) throws Exception {
        Cookie cookie = mvc.perform(post(LOGIN).contentType(MediaType.APPLICATION_JSON).header(ORIGIN, MANAGER_ORIGIN)
                .content(jsonMapper.writeValueAsString(
                        Map.of("email", email, "password", password, "browserSession", true))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie(SESSION_COOKIE);
        assertNotNull(cookie);
        return cookie.getValue();
    }

    private ResultActions refresh(String cookie) throws Exception {
        return mvc.perform(post("/api/v1/auth/session/refresh").cookie(new Cookie(SESSION_COOKIE, cookie))
                .header(ORIGIN, MANAGER_ORIGIN));
    }

    private long passwordChangedEvents(UUID account) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.audit_events
                WHERE event_type = 'PASSWORD_CHANGED' AND subject_type = 'USER' AND subject_id = :id
                """).param("id", account).query(Long.class).single();
    }

    private DemoAccountProvisioner provisioner(String adminEmail, String adminPassword, String technicianEmail,
            String technicianPassword) {
        DemoAccountProperties properties = new DemoAccountProperties(true,
                new DemoAccountProperties.DemoAccount(adminEmail, "Administrateur Rotation", adminPassword, null),
                new DemoAccountProperties.DemoAccount(technicianEmail, "Technicien Rotation", technicianPassword,
                        AccessLevel.STANDARD));
        return new DemoAccountProvisioner(properties, accountRepository, passwordEncoder, passwordChanges,
                transactions);
    }
}
