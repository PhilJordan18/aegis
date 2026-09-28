package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.http.HttpHeaders.CACHE_CONTROL;
import static org.springframework.http.HttpHeaders.RETRY_AFTER;
import static org.springframework.http.HttpHeaders.WWW_AUTHENTICATE;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;

import tools.jackson.databind.node.ObjectNode;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

class AuthenticationApiTests extends ApiIntegrationTest {

    private static final Duration LIFETIME = Duration.ofMinutes(60);
    private static final String INVALID_TOKEN_CHALLENGE = "Bearer error=\"invalid_token\"";

    @Test
    void technicianSignsInAndReadsTheirProfile() throws Exception {
        TestAccount technician = accounts.technician();

        MvcResult signedIn = mvc.perform(login(technician.email(), technician.password()))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_JSON))
                .andExpect(header().string(CACHE_CONTROL, containsString("no-store")))
                .andExpect(jsonPath("$.*", hasSize(5)))
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(3600))
                .andExpect(jsonPath("$.expiresAt").value("2026-09-28T14:00:00Z"))
                .andExpect(jsonPath("$.user.*", hasSize(5)))
                .andExpect(jsonPath("$.user.id").value(technician.id().toString()))
                .andExpect(jsonPath("$.user.displayName").value(technician.displayName()))
                .andExpect(jsonPath("$.user.email").value(technician.email()))
                .andExpect(jsonPath("$.user.role").value("TECHNICIAN"))
                .andExpect(jsonPath("$.user.maximumAccessLevel").value("STANDARD"))
                .andReturn();
        String token = JsonPath.read(signedIn.getResponse().getContentAsString(StandardCharsets.UTF_8),
                "$.accessToken");

        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.*", hasSize(5)))
                .andExpect(jsonPath("$.id").value(technician.id().toString()))
                .andExpect(jsonPath("$.displayName").value(technician.displayName()))
                .andExpect(jsonPath("$.email").value(technician.email()))
                .andExpect(jsonPath("$.role").value("TECHNICIAN"))
                .andExpect(jsonPath("$.maximumAccessLevel").value("STANDARD"));
    }

    @Test
    void administratorSignsInWithTheirOwnRoleAndAccessLevel() throws Exception {
        TestAccount admin = accounts.create(Role.ADMIN, AccessLevel.RESTRICTED);

        mvc.perform(get(ME).header(AUTHORIZATION, bearer(accessToken(admin))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(admin.id().toString()))
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.maximumAccessLevel").value("RESTRICTED"));
    }

    @Test
    void accessTokenIsAnHs256JwtCarryingOnlyTheDocumentedClaims() throws Exception {
        TestAccount technician = accounts.technician();

        SignedJWT jwt = SignedJWT.parse(accessToken(technician));

        assertEquals(JWSAlgorithm.HS256, jwt.getHeader().getAlgorithm());
        assertEquals(JOSEObjectType.JWT, jwt.getHeader().getType());
        assertTrue(jwt.verify(new MACVerifier(signingKey())));
        JWTClaimsSet claims = jwt.getJWTClaimsSet();
        assertEquals(Set.of("iss", "aud", "sub", "jti", "iat", "exp", "role", "maximumAccessLevel"),
                claims.getClaims().keySet());
        assertEquals("aegis-control", claims.getIssuer());
        assertEquals(List.of("aegis-api"), claims.getAudience());
        assertEquals(technician.id().toString(), claims.getSubject());
        assertEquals(START, claims.getIssueTime().toInstant());
        assertEquals(START.plus(LIFETIME), claims.getExpirationTime().toInstant());
        assertEquals("TECHNICIAN", claims.getStringClaim("role"));
        assertEquals("STANDARD", claims.getStringClaim("maximumAccessLevel"));
        assertEquals(claims.getJWTID(), UUID.fromString(claims.getJWTID()).toString());
        assertNotEquals(claims.getJWTID(), SignedJWT.parse(accessToken(technician)).getJWTClaimsSet().getJWTID());
    }

    @Test
    void emailIsNormalizedBeforeTheAccountIsLookedUp() throws Exception {
        TestAccount technician = accounts.technician();

        mvc.perform(login("  " + technician.email().toUpperCase(Locale.ROOT) + " ", technician.password()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(technician.email()));
    }

    @Test
    void refusalIsIdenticalForWrongPasswordUnknownDisabledAndArchivedAccounts() throws Exception {
        TestAccount active = accounts.technician();
        TestAccount disabled = accounts.technician();
        accounts.disable(disabled.id());
        TestAccount archived = accounts.admin();
        accounts.archive(archived.id());

        List<MockHttpServletRequestBuilder> refusedAttempts = List.of(
                login(active.email(), "wrong-" + active.password()),
                login("nobody-" + UUID.randomUUID() + "@aegis.test", active.password()),
                login(disabled.email(), disabled.password()),
                login(archived.email(), archived.password()));

        Set<String> bodiesWithoutTraceId = new HashSet<>();
        for (MockHttpServletRequestBuilder attempt : refusedAttempts) {
            String body = mvc.perform(attempt)
                    .andExpect(status().isUnauthorized())
                    .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"))
                    .andExpect(jsonPath("$.status").value(401))
                    .andExpect(jsonPath("$.accessToken").doesNotExist())
                    .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
            ObjectNode problem = (ObjectNode) jsonMapper.readTree(body);
            problem.remove("traceId");
            bodiesWithoutTraceId.add(problem.toString());
        }
        assertEquals(1, bodiesWithoutTraceId.size(), () -> String.join("\n", bodiesWithoutTraceId));
    }

    @Test
    void invalidSignInBodiesAreRejectedWithoutEchoingThePassword() throws Exception {
        String tooLongPassword = "é".repeat(37);

        MvcResult tooLong = mvc.perform(login("technician@aegis.test", tooLongPassword))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations", hasSize(1)))
                .andExpect(jsonPath("$.violations[0].field").value("password"))
                .andExpect(jsonPath("$.violations[0].code").value("MAX_UTF8_BYTES"))
                .andReturn();
        assertThat(tooLong.getResponse().getContentAsString(StandardCharsets.UTF_8)).doesNotContain(tooLongPassword);

        // 72 bytes is the documented maximum: the attempt is checked, not rejected as malformed.
        mvc.perform(login("nobody-" + UUID.randomUUID() + "@aegis.test", "a".repeat(72)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"));

        mvc.perform(post(LOGIN).contentType(APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations", hasSize(2)))
                .andExpect(jsonPath("$.violations[0].field").value("email"))
                .andExpect(jsonPath("$.violations[0].code").value("NOT_BLANK"))
                .andExpect(jsonPath("$.violations[1].field").value("password"))
                .andExpect(jsonPath("$.violations[1].code").value("NOT_EMPTY"));

        mvc.perform(login("not-an-email", "some-password"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("email"))
                .andExpect(jsonPath("$.violations[0].code").value("EMAIL"));

        mvc.perform(login("a".repeat(310) + "@aegis.test", "some-password"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[*].code", hasItem("SIZE")));
    }

    @Test
    void unknownFieldsMalformedBodiesAndOtherMediaTypesAreRejected() throws Exception {
        mvc.perform(post(LOGIN).contentType(APPLICATION_JSON)
                        .content("{\"email\":\"technician@aegis.test\",\"password\":\"x\",\"rememberMe\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations[0].field").value("rememberMe"))
                .andExpect(jsonPath("$.violations[0].code").value("UNKNOWN_FIELD"));

        mvc.perform(post(LOGIN).contentType(APPLICATION_JSON).content("{\"email\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("body"))
                .andExpect(jsonPath("$.violations[0].code").value("MALFORMED_BODY"));

        mvc.perform(post(LOGIN).contentType(APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("MALFORMED_BODY"));

        mvc.perform(post(LOGIN).contentType(APPLICATION_JSON)
                        .content("{\"email\":[\"technician@aegis.test\"],\"password\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("email"))
                .andExpect(jsonPath("$.violations[0].code").value("INVALID_VALUE"));

        mvc.perform(post(LOGIN).contentType(MediaType.TEXT_PLAIN).content("technician@aegis.test"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(415))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void signInAttemptsAreLimitedPerClientAddressAndAccount() throws Exception {
        TestAccount technician = accounts.technician();
        for (int attempt = 0; attempt < 5; attempt++) {
            mvc.perform(login(technician.email(), "wrong-password-" + attempt))
                    .andExpect(status().isUnauthorized());
            clock.advance(Duration.ofSeconds(1));
        }

        mvc.perform(login(technician.email(), technician.password()))
                .andExpect(status().isTooManyRequests())
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(header().string(RETRY_AFTER, "55"));
        mvc.perform(login(technician.email().toUpperCase(Locale.ROOT), technician.password()))
                .andExpect(status().isTooManyRequests());

        mvc.perform(login(technician.email(), technician.password()).with(remoteAddress("192.0.2.10")))
                .andExpect(status().isOk());
        TestAccount otherAccount = accounts.technician();
        mvc.perform(login(otherAccount.email(), otherAccount.password()))
                .andExpect(status().isOk());

        // Refused attempts are not recorded, so one attempt is allowed as soon as the first leaves the window.
        clock.set(START.plusSeconds(60));
        mvc.perform(login(technician.email(), technician.password()))
                .andExpect(status().isOk());
        mvc.perform(login(technician.email(), technician.password()))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(RETRY_AFTER, "1"));
    }

    @Test
    void missingTokenReceivesTheContractProblem() throws Exception {
        mvc.perform(get(ME))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(WWW_AUTHENTICATE, "Bearer"))
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.*", hasSize(8)))
                .andExpect(jsonPath("$.type").value("https://aegis.local/problems/auth-token-invalid"))
                .andExpect(jsonPath("$.title").isNotEmpty())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"))
                .andExpect(jsonPath("$.detail").isNotEmpty())
                .andExpect(jsonPath("$.instance").value(ME))
                .andExpect(jsonPath("$.traceId").isNotEmpty())
                .andExpect(jsonPath("$.timestamp").value("2026-09-28T13:00:00Z"));

        mvc.perform(get(ME).header(AUTHORIZATION, "Basic dGVjaG5pY2lhbjpwYXNzd29yZA=="))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(WWW_AUTHENTICATE, "Bearer"))
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
    }

    @TestFactory
    Stream<DynamicTest> forgedOrMalformedTokensAreRejected() throws Exception {
        TestAccount technician = accounts.technician();
        UUID id = technician.id();
        byte[] key = signingKey();
        Instant now = clock.instant();

        // The unmodified crafted token is accepted, so each rejection below comes from its single defect.
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(signed(JWSAlgorithm.HS256, key, claims(id).build()))))
                .andExpect(status().isOk());

        Map<String, String> forged = new LinkedHashMap<>();
        forged.put("not a JWT", "not-a-jwt");
        forged.put("characters outside the bearer syntax", "abc$def");
        forged.put("tampered payload", tamperedPayload(signed(JWSAlgorithm.HS256, key, claims(id).build())));
        forged.put("signed with another key",
                signed(JWSAlgorithm.HS256, Base64.getDecoder().decode(randomBase64(48)), claims(id).build()));
        forged.put("unsigned", new PlainJWT(claims(id).build()).serialize());
        forged.put("HS384 with the right key", signed(JWSAlgorithm.HS384, key, claims(id).build()));
        forged.put("wrong issuer", signed(JWSAlgorithm.HS256, key, claims(id).issuer("another-issuer").build()));
        forged.put("wrong audience", signed(JWSAlgorithm.HS256, key, claims(id).audience("another-api").build()));
        forged.put("no audience", signed(JWSAlgorithm.HS256, key, claims(id).audience((List<String>) null).build()));
        forged.put("no token identifier", signed(JWSAlgorithm.HS256, key, claims(id).jwtID(null).build()));
        forged.put("subject is not an account identifier",
                signed(JWSAlgorithm.HS256, key, claims(id).subject("admin").build()));
        forged.put("unknown account", signed(JWSAlgorithm.HS256, key, claims(UUID.randomUUID()).build()));
        forged.put("unknown role", signed(JWSAlgorithm.HS256, key, claims(id).claim("role", "ROOT").build()));
        forged.put("no access level",
                signed(JWSAlgorithm.HS256, key, claims(id).claim("maximumAccessLevel", null).build()));
        forged.put("issued in the future", signed(JWSAlgorithm.HS256, key, claims(id)
                .issueTime(Date.from(now.plusSeconds(1)))
                .expirationTime(Date.from(now.plusSeconds(1).plus(LIFETIME).minusSeconds(1))).build()));
        forged.put("lifetime above 60 minutes", signed(JWSAlgorithm.HS256, key, claims(id)
                .expirationTime(Date.from(now.plus(LIFETIME).plusSeconds(1))).build()));
        forged.put("no expiry", signed(JWSAlgorithm.HS256, key, claims(id).expirationTime(null).build()));
        forged.put("no issue time", signed(JWSAlgorithm.HS256, key, claims(id).issueTime(null).build()));
        forged.put("expired and signed with another key", signed(JWSAlgorithm.HS256,
                Base64.getDecoder().decode(randomBase64(48)), expiredClaims(id).build()));
        forged.put("expired and for another audience",
                signed(JWSAlgorithm.HS256, key, expiredClaims(id).audience("another-api").build()));

        return forged.entrySet().stream().map(entry -> dynamicTest(entry.getKey(), () ->
                mvc.perform(get(ME).header(AUTHORIZATION, bearer(entry.getValue())))
                        .andExpect(status().isUnauthorized())
                        .andExpect(header().string(WWW_AUTHENTICATE, INVALID_TOKEN_CHALLENGE))
                        .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                        .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"))));
    }

    @Test
    void tokenExpiresSixtyMinutesAfterIssueWithoutClockSkew() throws Exception {
        String token = accessToken(accounts.technician());

        clock.set(START.plus(LIFETIME).minusSeconds(1));
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk());

        clock.set(START.plus(LIFETIME));
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(WWW_AUTHENTICATE, INVALID_TOKEN_CHALLENGE))
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_EXPIRED"))
                .andExpect(jsonPath("$.type").value("https://aegis.local/problems/auth-token-expired"));
    }

    @Test
    void authenticTokenWhoseOnlyDefectIsExpiryIsReportedAsExpired() throws Exception {
        TestAccount technician = accounts.technician();

        mvc.perform(get(ME).header(AUTHORIZATION,
                        bearer(signed(JWSAlgorithm.HS256, signingKey(), expiredClaims(technician.id()).build()))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_EXPIRED"));
    }

    @Test
    void disablingOrArchivingAnAccountStopsItsTokensImmediately() throws Exception {
        TestAccount disabled = accounts.technician();
        String disabledToken = accessToken(disabled);
        TestAccount archived = accounts.admin();
        String archivedToken = accessToken(archived);

        accounts.disable(disabled.id());
        accounts.archive(archived.id());

        for (String token : List.of(disabledToken, archivedToken)) {
            mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isUnauthorized())
                    .andExpect(header().string(WWW_AUTHENTICATE, INVALID_TOKEN_CHALLENGE))
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
    }

    @Test
    void publicEndpointsIgnoreAStaleToken() throws Exception {
        TestAccount technician = accounts.technician();
        String token = accessToken(technician);
        clock.set(START.plus(Duration.ofHours(2)));

        mvc.perform(get("/api/v1/system/health").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/system/health").header(AUTHORIZATION, bearer("not-a-jwt")))
                .andExpect(status().isOk());
        mvc.perform(login(technician.email(), technician.password()).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk());
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_EXPIRED"));
    }

    @Test
    void requestIdIsReusedWhenValidAndGeneratedOtherwise() throws Exception {
        String clientRequestId = "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30";
        mvc.perform(get(ME).header("X-Request-Id", clientRequestId))
                .andExpect(header().string("X-Request-Id", clientRequestId))
                .andExpect(jsonPath("$.traceId").value(clientRequestId));

        MvcResult replaced = mvc.perform(get(ME).header("X-Request-Id", "<script>alert(1)</script>")).andReturn();
        String generated = replaced.getResponse().getHeader("X-Request-Id");
        assertEquals(generated, UUID.fromString(generated).toString());
        assertEquals(generated, JsonPath.read(replaced.getResponse().getContentAsString(StandardCharsets.UTF_8),
                "$.traceId"));

        mvc.perform(get("/api/v1/system/health"))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void noUndocumentedPublicRouteIsExposed() throws Exception {
        for (String path : List.of("/api/v1/auth/login", "/error", "/api/v1/unknown", "/actuator/health",
                "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/v1")) {
            mvc.perform(get(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
    }

    /** The framework's RFC 9728 metadata is not part of document 09; no token is read on those paths. */
    @Test
    void protectedResourceMetadataIsNotPublished() throws Exception {
        String token = accessToken(accounts.technician());

        mvc.perform(get("/.well-known/oauth-protected-resource").header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(WWW_AUTHENTICATE, "Bearer"))
                .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
    }

    private JWTClaimsSet.Builder claims(UUID subject) {
        Instant now = clock.instant();
        return new JWTClaimsSet.Builder()
                .issuer("aegis-control")
                .audience("aegis-api")
                .subject(subject.toString())
                .jwtID(UUID.randomUUID().toString())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(LIFETIME)))
                .claim("role", "TECHNICIAN")
                .claim("maximumAccessLevel", "STANDARD");
    }

    private JWTClaimsSet.Builder expiredClaims(UUID subject) {
        Instant issuedAt = clock.instant().minus(Duration.ofHours(2));
        return claims(subject)
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(issuedAt.plus(LIFETIME)));
    }

    private static String signed(JWSAlgorithm algorithm, byte[] key, JWTClaimsSet claims) throws JOSEException {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(algorithm).type(JOSEObjectType.JWT).build(), claims);
        jwt.sign(new MACSigner(key));
        return jwt.serialize();
    }

    /** Re-encodes the payload with an administrator role while keeping the original signature. */
    private static String tamperedPayload(String token) throws Exception {
        String[] parts = token.split("\\.");
        JWTClaimsSet original = SignedJWT.parse(token).getJWTClaimsSet();
        JWTClaimsSet elevated = new JWTClaimsSet.Builder(original).claim("role", "ADMIN").build();
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(elevated.toString().getBytes(StandardCharsets.UTF_8));
        return parts[0] + "." + payload + "." + parts[2];
    }

    private static RequestPostProcessor remoteAddress(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }
}
