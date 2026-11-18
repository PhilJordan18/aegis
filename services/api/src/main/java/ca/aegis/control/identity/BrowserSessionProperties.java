package ca.aegis.control.identity;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Browser session settings of ADR-016. {@code allowedOrigins} lists the exact Manager origins, such as
 * {@code https://manager.example}, allowed to start, refresh or revoke a browser session; empty, no browser session
 * can be started. The lifetime is absolute and capped at 12 hours, the limit the database also enforces.
 */
@ConfigurationProperties("aegis.security.browser-session")
public record BrowserSessionProperties(List<String> allowedOrigins, Duration lifetime) {

    static final Duration MAXIMUM_LIFETIME = Duration.ofHours(12);

    public BrowserSessionProperties {
        allowedOrigins = allowedOrigins == null ? List.of()
                : allowedOrigins.stream().map(String::strip).filter(origin -> !origin.isEmpty()).toList();
        for (String origin : allowedOrigins) {
            requireOrigin(origin);
        }
        if (lifetime == null) {
            lifetime = Duration.ofHours(8);
        }
        if (lifetime.isNegative() || lifetime.isZero() || lifetime.compareTo(MAXIMUM_LIFETIME) > 0) {
            throw new IllegalStateException("aegis.security.browser-session.lifetime must be positive and at most 12 hours");
        }
    }

    boolean allows(String origin) {
        return origin != null && Set.copyOf(allowedOrigins).contains(origin);
    }

    /** An origin is a scheme, a host and an optional port, exactly as a browser sends it: no path, no slash. */
    private static void requireOrigin(String origin) {
        URI uri;
        try {
            uri = URI.create(origin);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalStateException("Invalid browser session origin: " + origin);
        }
        boolean http = "https".equals(uri.getScheme()) || "http".equals(uri.getScheme());
        if (!http || uri.getHost() == null || uri.getRawPath() != null && !uri.getRawPath().isEmpty()
                || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawUserInfo() != null) {
            throw new IllegalStateException("Invalid browser session origin: " + origin);
        }
        if ("http".equals(uri.getScheme()) && !"localhost".equals(uri.getHost())) {
            throw new IllegalStateException("A browser session origin must use https, except on localhost: " + origin);
        }
    }
}
