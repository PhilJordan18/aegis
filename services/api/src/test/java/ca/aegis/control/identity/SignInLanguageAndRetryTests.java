package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.ACCEPT_LANGUAGE;
import static org.springframework.http.HttpHeaders.RETRY_AFTER;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.node.ObjectNode;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Document 09 §10.2: the requested language never changes a sign-in refusal (iOS sends {@code Accept-Language}
 * automatically), and {@code Retry-After} on {@code 429 RATE_LIMITED} is a whole number of seconds within the
 * one-minute window.
 */
class SignInLanguageAndRetryTests extends ApiIntegrationTest {

    private static final List<String> LANGUAGES = List.of("fr-CA", "en-CA", "es-MX");
    /** Per-request values; everything else in a refusal must be identical across languages. */
    private static final List<String> PER_REQUEST_FIELDS = List.of("traceId", "timestamp");
    private static final List<String> PER_REQUEST_HEADERS = List.of("X-Request-Id", "Date");

    @Test
    void invalidCredentialsDoNotDependOnTheRequestedLanguage() throws Exception {
        TestAccount technician = accounts.technician();
        assertSameRefusal(language -> login(technician.email(), "wrong-password-for-" + language), 401);
    }

    @Test
    void validationErrorsDoNotDependOnTheRequestedLanguage() throws Exception {
        TestAccount technician = accounts.technician();
        String tooLong = "p".repeat(73);
        assertSameRefusal(language -> login(technician.email(), tooLong), 400);
    }

    @Test
    void rateLimitingDoesNotDependOnTheRequestedLanguage() throws Exception {
        Map<String, String> retryAfter = new TreeMap<>();
        for (String language : LANGUAGES) {
            TestAccount technician = accounts.technician();
            clock.set(START);
            for (int attempt = 0; attempt < 5; attempt++) {
                mvc.perform(login(technician.email(), "wrong-" + attempt).header(ACCEPT_LANGUAGE, language));
                clock.advance(Duration.ofSeconds(1));
            }
            MockHttpServletResponse limited = mvc.perform(
                    login(technician.email(), technician.password()).header(ACCEPT_LANGUAGE, language))
                    .andReturn().getResponse();
            assertEquals(429, limited.getStatus(), language);
            assertEquals("RATE_LIMITED", jsonMapper.readTree(limited.getContentAsString()).get("code").asString(),
                    language);
            retryAfter.put(language, limited.getHeader(RETRY_AFTER));
        }
        assertEquals(1, retryAfter.values().stream().distinct().count(), retryAfter.toString());
    }

    @Test
    void retryAfterIsWholeSecondsWithinTheWindow() throws Exception {
        TestAccount technician = accounts.technician();
        for (int attempt = 0; attempt < 5; attempt++) {
            mvc.perform(login(technician.email(), "wrong-" + attempt));
            clock.advance(Duration.ofSeconds(1));
        }
        // The first refused attempt happened at START; the window closes 60 seconds later.
        Map<Duration, String> expected = Map.of(
                Duration.ofSeconds(5), "55",
                Duration.ofSeconds(30), "30",
                Duration.ofMillis(58_500), "2",
                Duration.ofSeconds(59), "1",
                Duration.ofMillis(59_999), "1");
        for (Map.Entry<Duration, String> point : new TreeMap<>(expected).entrySet()) {
            clock.set(START.plus(point.getKey()));
            String value = mvc.perform(login(technician.email(), technician.password()))
                    .andReturn().getResponse().getHeader(RETRY_AFTER);
            assertEquals(point.getValue(), value, "at +" + point.getKey());
            int seconds = Integer.parseInt(value);
            assertTrue(seconds >= 1 && seconds <= 60, value);
        }
    }

    private void assertSameRefusal(LanguageRequest request, int expectedStatus) throws Exception {
        Map<String, String> bodies = new TreeMap<>();
        Map<String, Map<String, Collection<String>>> headers = new TreeMap<>();
        for (String language : LANGUAGES) {
            MockHttpServletResponse response = mvc.perform(request.build(language).header(ACCEPT_LANGUAGE, language))
                    .andReturn().getResponse();
            assertEquals(expectedStatus, response.getStatus(), language);
            ObjectNode problem = (ObjectNode) jsonMapper.readTree(response.getContentAsString());
            PER_REQUEST_FIELDS.forEach(problem::remove);
            bodies.put(language, problem.toString());
            Map<String, Collection<String>> stable = new TreeMap<>();
            for (String name : response.getHeaderNames()) {
                if (PER_REQUEST_HEADERS.stream().noneMatch(name::equalsIgnoreCase)) {
                    stable.put(name, response.getHeaders(name));
                }
            }
            headers.put(language, stable);
        }
        assertEquals(1, bodies.values().stream().distinct().count(), bodies.toString());
        assertEquals(1, headers.values().stream().distinct().count(), headers.toString());
    }

    @FunctionalInterface
    private interface LanguageRequest {
        MockHttpServletRequestBuilder build(String language) throws Exception;
    }
}
