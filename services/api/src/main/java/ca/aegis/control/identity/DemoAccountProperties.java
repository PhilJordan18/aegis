package ca.aegis.control.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The two prepared demonstration accounts of scope section 10.1. Passwords come only from environment variables
 * ({@code AEGIS_DEMO_ADMIN_PASSWORD}, {@code AEGIS_DEMO_TECHNICIAN_PASSWORD}); nothing is provisioned unless
 * {@code AEGIS_DEMO_ACCOUNTS_ENABLED=true}.
 */
@ConfigurationProperties("aegis.identity.demo-accounts")
public record DemoAccountProperties(boolean enabled, DemoAccount admin, DemoAccount technician) {

    public record DemoAccount(String email, String displayName, String password, AccessLevel maximumAccessLevel) {

        @Override
        public String toString() {
            return "DemoAccount[email=%s, displayName=%s, maximumAccessLevel=%s, password=<redacted>]"
                    .formatted(email, displayName, maximumAccessLevel);
        }
    }
}
