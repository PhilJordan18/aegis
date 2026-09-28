package ca.aegis.control.identity;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Creates the prepared demonstration accounts when explicitly enabled. Re-running is idempotent: a missing account
 * is created and a changed password is re-hashed, but the role, access level and status of an existing account are
 * never altered, so an administrator's decision to disable an account survives a restart.
 */
@Component
@ConditionalOnProperty(prefix = "aegis.identity.demo-accounts", name = "enabled", havingValue = "true")
class DemoAccountProvisioner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoAccountProvisioner.class);
    private static final int MINIMUM_PASSWORD_BYTES = 12;
    private static final int MAXIMUM_PASSWORD_BYTES = 72;
    private static final int MAXIMUM_DISPLAY_NAME_LENGTH = 120;

    private final DemoAccountProperties properties;
    private final AccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate transactions;

    DemoAccountProvisioner(DemoAccountProperties properties, AccountRepository accounts,
            PasswordEncoder passwordEncoder, TransactionTemplate transactions) {
        this.properties = properties;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.transactions = transactions;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        provision();
    }

    void provision() {
        List<DemoAccount> demoAccounts = List.of(
                validate(properties.admin(), Role.ADMIN, "AEGIS_DEMO_ADMIN"),
                validate(properties.technician(), Role.TECHNICIAN, "AEGIS_DEMO_TECHNICIAN"));
        transactions.executeWithoutResult(status -> demoAccounts.forEach(this::ensure));
    }

    static DemoAccount validate(DemoAccountProperties.DemoAccount configured, Role role, String variablePrefix) {
        if (configured == null) {
            throw new IllegalStateException(variablePrefix + " demo account settings are missing");
        }
        String email = EmailAddresses.normalize(configured.email());
        if (email == null || email.length() > EmailAddresses.MAX_LENGTH || email.indexOf('@') <= 0
                || email.indexOf('@') == email.length() - 1 || email.chars().anyMatch(Character::isWhitespace)) {
            throw new IllegalStateException(variablePrefix + "_EMAIL must be a valid email address");
        }
        String displayName = configured.displayName() == null ? "" : configured.displayName().strip();
        if (displayName.isEmpty() || displayName.length() > MAXIMUM_DISPLAY_NAME_LENGTH) {
            throw new IllegalStateException(variablePrefix + " display name must contain 1 to 120 characters");
        }
        String password = configured.password();
        int passwordBytes = password == null ? 0 : password.getBytes(StandardCharsets.UTF_8).length;
        if (passwordBytes < MINIMUM_PASSWORD_BYTES || passwordBytes > MAXIMUM_PASSWORD_BYTES) {
            throw new IllegalStateException(variablePrefix
                    + "_PASSWORD must contain 12 to 72 bytes when demo accounts are enabled");
        }
        AccessLevel level = configured.maximumAccessLevel() == null
                ? AccessLevel.STANDARD : configured.maximumAccessLevel();
        return new DemoAccount(email, displayName, password, role, level);
    }

    private void ensure(DemoAccount demo) {
        if (accounts.insertIfAbsent(demo.displayName(), demo.email(), passwordEncoder.encode(demo.password()),
                demo.role(), demo.maximumAccessLevel())) {
            log.info("Created demo account {} with role {} and access level {}", demo.email(), demo.role(),
                    demo.maximumAccessLevel());
            return;
        }
        Account existing = accounts.findByEmail(demo.email()).orElseThrow();
        if (!passwordEncoder.matches(demo.password(), existing.passwordHash())) {
            accounts.updatePasswordHash(existing.id(), passwordEncoder.encode(demo.password()));
            log.info("Updated the password of demo account {}", demo.email());
        }
        if (existing.role() != demo.role() || existing.maximumAccessLevel() != demo.maximumAccessLevel()
                || !existing.canAuthenticate()) {
            log.warn("Demo account {} is {} {} {}; its role, access level and status were left unchanged",
                    demo.email(), existing.status(), existing.role(), existing.maximumAccessLevel());
        }
    }

    record DemoAccount(String email, String displayName, String password, Role role,
            AccessLevel maximumAccessLevel) {

        @Override
        public String toString() {
            return "DemoAccount[email=%s, role=%s, maximumAccessLevel=%s, password=<redacted>]"
                    .formatted(email, role, maximumAccessLevel);
        }
    }
}
