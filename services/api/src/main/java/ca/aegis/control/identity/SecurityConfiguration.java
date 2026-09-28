package ca.aegis.control.identity;

import java.time.Clock;
import java.util.Map;

import jakarta.servlet.DispatcherType;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.RequestMatcher;

import ca.aegis.control.shared.web.Problems;

@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
@EnableConfigurationProperties({JwtProperties.class, DemoAccountProperties.class})
class SecurityConfiguration {

    private static final RequestMatcher PUBLIC_ROUTES = ApiRoutes.publicRoutes();

    /**
     * The resource-server DSL always publishes RFC 9728 metadata under {@code /.well-known}. Document 09 lists no
     * such route, so this chain, checked first, refuses those paths like any unlisted route; no bearer token is
     * read there, so every caller receives 401.
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    SecurityFilterChain undocumentedDiscovery(HttpSecurity http, Problems problems) throws Exception {
        SecurityProblemHandlers handlers = new SecurityProblemHandlers(problems);
        statelessApi(http, handlers)
                .securityMatcher("/.well-known/**")
                .authorizeHttpRequests(requests -> requests.anyRequest().denyAll());
        return http.build();
    }

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http, JwtDecoder jwtDecoder,
            CurrentAccountAuthenticationConverter currentAccounts, Problems problems) throws Exception {
        SecurityProblemHandlers handlers = new SecurityProblemHandlers(problems);
        statelessApi(http, handlers)
                .authorizeHttpRequests(requests -> {
                    requests.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
                    for (ApiRoutes.Route route : ApiRoutes.DOCUMENTED) {
                        var rule = requests.requestMatchers(route.matcher());
                        switch (route.access()) {
                            case PUBLIC -> rule.permitAll();
                            case ADMIN_OR_TECHNICIAN -> rule.hasAnyRole(Role.ADMIN.name(), Role.TECHNICIAN.name());
                            case TECHNICIAN -> rule.hasRole(Role.TECHNICIAN.name());
                            case ADMIN -> rule.hasRole(Role.ADMIN.name());
                        }
                    }
                    requests.anyRequest().access(ApiRoutes.UNLISTED);
                })
                .oauth2ResourceServer(resourceServer -> resourceServer
                        .bearerTokenResolver(bearerTokenResolver())
                        .jwt(jwt -> jwt.decoder(jwtDecoder).jwtAuthenticationConverter(currentAccounts))
                        .authenticationEntryPoint(handlers)
                        .accessDeniedHandler(handlers));
        return http.build();
    }

    /** Clients send bearer tokens explicitly; no cookie, session or browser flow can carry an identity. */
    private static HttpSecurity statelessApi(HttpSecurity http, SecurityProblemHandlers handlers) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(handlers)
                        .accessDeniedHandler(handlers));
    }

    /**
     * Public routes ignore any {@code Authorization} header, so that a client still holding an expired token can
     * sign in again and read the health status instead of receiving 401.
     */
    private static BearerTokenResolver bearerTokenResolver() {
        DefaultBearerTokenResolver headerOnly = new DefaultBearerTokenResolver();
        return request -> PUBLIC_ROUTES.matches(request) ? null : headerOnly.resolve(request);
    }

    @Bean
    JwtDecoder jwtDecoder(JwtProperties properties, Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(properties.signingKey())
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new AccessTokens.Validator(clock, properties.issuer(), properties.audience()));
        return decoder;
    }

    @Bean
    JwtEncoder jwtEncoder(JwtProperties properties) {
        return NimbusJwtEncoder.withSecretKey(properties.signingKey()).algorithm(MacAlgorithm.HS256).build();
    }

    /** BCrypt only: a stored value with another or no encoding prefix never matches. */
    @Bean
    PasswordEncoder passwordEncoder() {
        DelegatingPasswordEncoder encoder = new DelegatingPasswordEncoder("bcrypt",
                Map.of("bcrypt", new BCryptPasswordEncoder()));
        encoder.setDefaultPasswordEncoderForMatches(new NeverMatchingPasswordEncoder());
        return encoder;
    }

    private static final class NeverMatchingPasswordEncoder implements PasswordEncoder {

        @Override
        public String encode(CharSequence rawPassword) {
            throw new UnsupportedOperationException("Passwords are always encoded with BCrypt");
        }

        @Override
        public boolean matches(CharSequence rawPassword, String encodedPassword) {
            return false;
        }
    }
}
