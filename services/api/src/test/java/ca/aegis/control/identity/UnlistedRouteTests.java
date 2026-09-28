package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Endpoints that exist but are missing from {@link ApiRoutes}, as a newly added controller would be before its
 * route is documented and listed: no caller reaches them, whatever the path family or the method.
 */
@Import(UnlistedRouteTests.UnlistedEndpoints.class)
class UnlistedRouteTests extends ApiIntegrationTest {

    private static final AtomicInteger invocations = new AtomicInteger();

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    @BeforeEach
    void noInvocationYet() {
        invocations.set(0);
    }

    @Test
    void newEndpointsAreRegisteredButNotListed() {
        Set<String> endpoints = new TreeSet<>();
        handlerMapping.getHandlerMethods().forEach((mapping, handler) -> {
            if (handler.getBeanType() == UnlistedEndpoints.class) {
                mapping.getMethodsCondition().getMethods().forEach(method -> mapping.getPatternValues()
                        .forEach(pattern -> endpoints.add(method + " " + pattern)));
            }
        });

        assertEquals(Set.of("DELETE " + ME, "GET /api/v1/admin/unlisted", "GET /api/v1/me/unlisted",
                "GET /api/v1/unlisted", "POST /api/v1/assets"), endpoints);
        for (String endpoint : endpoints) {
            String[] methodAndPath = endpoint.split(" ");
            MockHttpServletRequest request = new MockHttpServletRequest(methodAndPath[0], methodAndPath[1]);
            assertTrue(ApiRoutes.DOCUMENTED.stream().noneMatch(route -> route.matcher().matches(request)), endpoint);
        }
    }

    @Test
    void authenticatedCallersNeverReachThem() throws Exception {
        for (String token : List.of(accessToken(accounts.admin()), accessToken(accounts.technician()))) {
            for (MockHttpServletRequestBuilder request : requests()) {
                mvc.perform(request.header(AUTHORIZATION, bearer(token)))
                        .andExpect(status().isNotFound())
                        .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
            }
        }
        assertEquals(0, invocations.get());
    }

    @Test
    void anonymousCallersAreRejectedFirst() throws Exception {
        for (MockHttpServletRequestBuilder request : requests()) {
            mvc.perform(request)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
        assertEquals(0, invocations.get());
    }

    private static List<MockHttpServletRequestBuilder> requests() {
        return List.of(
                get("/api/v1/unlisted"),
                get("/api/v1/me/unlisted"),
                get("/api/v1/admin/unlisted"),
                MockMvcRequestBuilders.post("/api/v1/assets").contentType(MediaType.APPLICATION_JSON).content("{}"),
                MockMvcRequestBuilders.delete(ME));
    }

    @RestController
    static class UnlistedEndpoints {

        @GetMapping("/api/v1/unlisted")
        String unlisted() {
            return reached();
        }

        @GetMapping("/api/v1/me/unlisted")
        String underTheTechnicianPrefix() {
            return reached();
        }

        @GetMapping("/api/v1/admin/unlisted")
        String underTheAdministrationPrefix() {
            return reached();
        }

        @PostMapping("/api/v1/assets")
        String undocumentedMethodOnATechnicianRoute() {
            return reached();
        }

        @DeleteMapping(ME)
        String undocumentedMethodOnTheProfile() {
            return reached();
        }

        private static String reached() {
            invocations.incrementAndGet();
            return "reached";
        }
    }
}
