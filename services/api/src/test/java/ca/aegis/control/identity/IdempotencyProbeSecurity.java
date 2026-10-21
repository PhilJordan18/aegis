package ca.aegis.control.identity;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import ca.aegis.control.shared.web.Problems;

/**
 * Test-only access rule for the idempotency probe paths, which {@link ApiRoutes} does not list and therefore
 * answers 404 to every authenticated caller. It applies the rule of an {@code ADMIN} route with the application's
 * own JWT decoder, account converter and problem handlers: an anonymous caller or a disabled account receives 401,
 * a technician 403, before any handler runs.
 */
@TestConfiguration(proxyBeanMethods = false)
public class IdempotencyProbeSecurity {

    public static final String PROBE_PATHS = "/api/v1/admin/idempotency-probe/**";

    /** True when production security would let some caller reach this request, which the probe must never be. */
    public static boolean documented(String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        return ApiRoutes.DOCUMENTED.stream().anyMatch(route -> route.matcher().matches(request));
    }

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    SecurityFilterChain idempotencyProbeSecurity(HttpSecurity http, JwtDecoder jwtDecoder,
            CurrentAccountAuthenticationConverter currentAccounts, Problems problems) throws Exception {
        SecurityProblemHandlers handlers = new SecurityProblemHandlers(problems);
        http.securityMatcher(PROBE_PATHS)
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(handlers)
                        .accessDeniedHandler(handlers))
                .authorizeHttpRequests(requests -> requests.anyRequest().hasRole(Role.ADMIN.name()))
                .oauth2ResourceServer(resourceServer -> resourceServer
                        .jwt(jwt -> jwt.decoder(jwtDecoder).jwtAuthenticationConverter(currentAccounts))
                        .authenticationEntryPoint(handlers)
                        .accessDeniedHandler(handlers));
        return http.build();
    }
}
