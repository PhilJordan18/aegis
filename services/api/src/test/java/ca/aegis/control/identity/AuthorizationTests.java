package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.identity.ApiRoutes.Access;
import ca.aegis.control.identity.ApiRoutes.Route;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * HTTP route authorization of document 09, sections 5 and 9, as enforced by the security filter. Most documented
 * routes belong to later slices and answer 404 or 405 once the filter lets a request through, so these tests prove
 * the filter only. Ownership of reservations, loans and operations (document 09, section 26.2) still has to be
 * tested against the real endpoints when their slices add them.
 */
class AuthorizationTests extends ApiIntegrationTest {

    @Autowired
    JwtDecoder jwtDecoder;

    @Autowired
    CurrentAccountAuthenticationConverter currentAccounts;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    @Test
    void technicianIsForbiddenOnEveryDocumentedAdministrationRoute() throws Exception {
        String token = accessToken(accounts.technician());

        for (Route route : routes(Access.ADMIN)) {
            assertRefused(perform(route, token), 403, ApiError.FORBIDDEN, route);
        }
    }

    @Test
    void administratorIsForbiddenOnEveryTechnicianRoute() throws Exception {
        String token = accessToken(accounts.admin());

        for (Route route : routes(Access.TECHNICIAN)) {
            assertRefused(perform(route, token), 403, ApiError.FORBIDDEN, route);
        }
    }

    @Test
    void eachRolePassesTheFilterOnlyOnItsDocumentedRoutes() throws Exception {
        String adminToken = accessToken(accounts.admin());
        String technicianToken = accessToken(accounts.technician());

        for (Route route : routes(Access.ADMIN)) {
            assertPassesFilter(perform(route, adminToken), route);
        }
        for (Route route : routes(Access.TECHNICIAN)) {
            assertPassesFilter(perform(route, technicianToken), route);
        }
        for (Route route : routes(Access.ADMIN_OR_TECHNICIAN)) {
            assertPassesFilter(perform(route, adminToken), route);
            assertPassesFilter(perform(route, technicianToken), route);
        }
    }

    @Test
    void everyImplementedEndpointIsListed() {
        List<String> checked = new ArrayList<>();
        List<String> unlisted = new ArrayList<>();
        handlerMapping.getHandlerMethods().forEach((mapping, handler) -> {
            if (!handler.getBeanType().getPackageName().startsWith("ca.aegis.control")) {
                return;
            }
            Set<RequestMethod> methods = mapping.getMethodsCondition().getMethods();
            for (String pattern : mapping.getPatternValues()) {
                if (methods.isEmpty()) {
                    unlisted.add("every method of " + pattern);
                }
                for (RequestMethod method : methods) {
                    MockHttpServletRequest request = new MockHttpServletRequest(method.name(), samplePath(pattern));
                    checked.add(method + " " + pattern);
                    if (ApiRoutes.DOCUMENTED.stream().noneMatch(route -> route.matcher().matches(request))) {
                        unlisted.add(method + " " + pattern);
                    }
                }
            }
        });

        assertTrue(checked.containsAll(
                List.of("GET /api/v1/system/health", "POST /api/v1/auth/login", "GET /api/v1/auth/me")), checked::toString);
        assertEquals(List.of(), unlisted);
    }

    @Test
    void unlistedRoutesAndMethodsAreNotFoundEvenForAuthenticatedCallers() throws Exception {
        for (String token : List.of(accessToken(accounts.admin()), accessToken(accounts.technician()))) {
            for (MockHttpServletRequestBuilder request : unlistedRequests()) {
                mvc.perform(request.header(AUTHORIZATION, bearer(token)))
                        .andExpect(status().isNotFound())
                        .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
            }
        }
    }

    @Test
    void anonymousCallersAreRejectedBeforeAnyRouteIsRevealed() throws Exception {
        for (Route route : ApiRoutes.DOCUMENTED) {
            if (route.access() != Access.PUBLIC) {
                assertRefused(perform(route, null), 401, ApiError.AUTH_TOKEN_INVALID, route);
            }
        }
        for (MockHttpServletRequestBuilder request : unlistedRequests()) {
            mvc.perform(request)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
    }

    @Test
    void roleChangesApplyToTokensAlreadyIssued() throws Exception {
        TestAccount account = accounts.technician();
        String token = accessToken(account);
        Route technicianRoute = route(HttpMethod.GET, "/api/v1/me/reservation");
        Route adminRoute = route(HttpMethod.GET, "/api/v1/admin/assets");

        accounts.changeRole(account.id(), Role.ADMIN);
        assertRefused(perform(technicianRoute, token), 403, ApiError.FORBIDDEN, technicianRoute);
        assertPassesFilter(perform(adminRoute, token), adminRoute);
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(token))).andExpect(jsonPath("$.role").value("ADMIN"));

        accounts.changeRole(account.id(), Role.TECHNICIAN);
        assertRefused(perform(adminRoute, token), 403, ApiError.FORBIDDEN, adminRoute);
        assertPassesFilter(perform(technicianRoute, token), technicianRoute);
    }

    @Test
    void accessLevelChangesApplyToTokensAlreadyIssued() throws Exception {
        TestAccount promoted = accounts.create(Role.TECHNICIAN, AccessLevel.STANDARD);
        String promotedToken = accessToken(promoted);
        TestAccount demoted = accounts.create(Role.TECHNICIAN, AccessLevel.RESTRICTED);
        String demotedToken = accessToken(demoted);

        accounts.changeAccessLevel(promoted.id(), AccessLevel.RESTRICTED);
        accounts.changeAccessLevel(demoted.id(), AccessLevel.STANDARD);

        mvc.perform(get(ME).header(AUTHORIZATION, bearer(promotedToken)))
                .andExpect(jsonPath("$.maximumAccessLevel").value("RESTRICTED"));
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(demotedToken)))
                .andExpect(jsonPath("$.maximumAccessLevel").value("STANDARD"));

        assertEquals("STANDARD", jwtDecoder.decode(promotedToken).getClaimAsString("maximumAccessLevel"));
        assertTrue(currentAccount(promotedToken).mayUse(AccessLevel.RESTRICTED));

        assertEquals("RESTRICTED", jwtDecoder.decode(demotedToken).getClaimAsString("maximumAccessLevel"));
        CurrentAccount current = currentAccount(demotedToken);
        assertFalse(current.mayUse(AccessLevel.RESTRICTED));
        ApiException denied = assertThrows(ApiException.class,
                () -> current.requireAccessLevel(AccessLevel.RESTRICTED));
        assertEquals(ApiError.ASSET_ACCESS_DENIED, denied.error());
    }

    @Test
    void profileIsAlwaysTheCallersOwn() throws Exception {
        TestAccount first = accounts.technician();
        TestAccount second = accounts.technician();

        mvc.perform(get(ME).param("id", second.id().toString()).param("email", second.email())
                        .header(AUTHORIZATION, bearer(accessToken(first))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(first.id().toString()))
                .andExpect(jsonPath("$.email").value(first.email()));
        mvc.perform(get(ME).header(AUTHORIZATION, bearer(accessToken(second))))
                .andExpect(jsonPath("$.id").value(second.id().toString()));
    }

    static List<MockHttpServletRequestBuilder> unlistedRequests() {
        return List.of(
                get("/api/v1/does-not-exist"),
                get("/api/v1/admin/undocumented"),
                get("/api/v1/me/undocumented"),
                get("/api/v1/auth/login"),
                MockMvcRequestBuilders.delete(ME),
                MockMvcRequestBuilders.put("/api/v1/system/health"),
                MockMvcRequestBuilders.post("/api/v1/assets").contentType(MediaType.APPLICATION_JSON).content("{}"));
    }

    private MvcResult perform(Route route, String token) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(route.method(), samplePath(route.path()));
        if (route.method() != HttpMethod.GET) {
            request.contentType(MediaType.APPLICATION_JSON).content("{}");
        }
        if (token != null) {
            request.header(AUTHORIZATION, bearer(token));
        }
        return mvc.perform(request).andReturn();
    }

    private static void assertRefused(MvcResult result, int status, ApiError error, Route route) throws Exception {
        String description = route.method() + " " + route.path();
        assertEquals(status, result.getResponse().getStatus(), description);
        assertEquals(error.name(), JsonPath.read(
                result.getResponse().getContentAsString(StandardCharsets.UTF_8), "$.code"), description);
    }

    private static void assertPassesFilter(MvcResult result, Route route) {
        int status = result.getResponse().getStatus();
        assertTrue(status != 401 && status != 403, route.method() + " " + route.path() + " answered " + status);
    }

    private static List<Route> routes(Access access) {
        return ApiRoutes.DOCUMENTED.stream().filter(route -> route.access() == access).toList();
    }

    private static Route route(HttpMethod method, String path) {
        return ApiRoutes.DOCUMENTED.stream()
                .filter(route -> route.method() == method && route.path().equals(path))
                .findFirst().orElseThrow();
    }

    private static String samplePath(String pattern) {
        return pattern.replaceAll("\\{[^/]+}", UUID.randomUUID().toString());
    }

    private CurrentAccount currentAccount(String token) {
        return (CurrentAccount) currentAccounts.convert(jwtDecoder.decode(token)).getPrincipal();
    }
}
