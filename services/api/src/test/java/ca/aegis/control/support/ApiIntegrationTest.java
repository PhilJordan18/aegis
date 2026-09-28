package ca.aegis.control.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Full application on a database created for this test run (see {@link TestDatabases}), with a controllable clock
 * and a signing key generated for this run only.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestClockConfiguration.class)
public abstract class ApiIntegrationTest {

    public static final Instant START = Instant.parse("2026-09-28T13:00:00Z");
    public static final String JWT_SECRET = randomBase64(48);
    public static final String LOGIN = "/api/v1/auth/login";
    public static final String ME = "/api/v1/auth/me";

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected MutableClock clock;

    @Autowired
    protected JsonMapper jsonMapper;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    protected TestAccounts accounts;

    @DynamicPropertySource
    static void applicationDatabaseAndSigningKey(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> TestDatabases.shared().applicationDatabaseUrl());
        registry.add("spring.datasource.username", () -> TestDatabases.shared().server().user());
        registry.add("spring.datasource.password", () -> TestDatabases.shared().server().password());
        registry.add("aegis.security.jwt.secret", () -> JWT_SECRET);
    }

    @BeforeEach
    void resetClockAndAccounts() {
        clock.set(START);
        accounts = new TestAccounts(jdbc, passwordEncoder);
    }

    protected MockHttpServletRequestBuilder login(String email, String password) {
        return post(LOGIN).contentType(MediaType.APPLICATION_JSON)
                .content(jsonMapper.writeValueAsString(Map.of("email", email, "password", password)));
    }

    protected String accessToken(TestAccount account) throws Exception {
        String body = mvc.perform(login(account.email(), account.password()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.accessToken");
    }

    protected static String bearer(String token) {
        return "Bearer " + token;
    }

    public static byte[] signingKey() {
        return Base64.getDecoder().decode(JWT_SECRET);
    }

    public static String randomBase64(int bytes) {
        byte[] random = new byte[bytes];
        new SecureRandom().nextBytes(random);
        return Base64.getEncoder().encodeToString(random);
    }
}
