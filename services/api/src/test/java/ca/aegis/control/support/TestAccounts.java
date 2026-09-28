package ca.aegis.control.support;

import java.util.Locale;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.Role;

/**
 * Prepared accounts written directly to {@code aegis.users}. Each call uses a new address and password, so tests
 * never share an account or a login-attempt window.
 */
public final class TestAccounts {

    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;

    public TestAccounts(JdbcClient jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    public TestAccount technician() {
        return create(Role.TECHNICIAN, AccessLevel.STANDARD);
    }

    public TestAccount admin() {
        return create(Role.ADMIN, AccessLevel.STANDARD);
    }

    public TestAccount create(Role role, AccessLevel maximumAccessLevel) {
        String email = role.name().toLowerCase(Locale.ROOT) + "-" + UUID.randomUUID() + "@aegis.test";
        String password = "test-" + UUID.randomUUID();
        String displayName = role == Role.ADMIN ? "Administratrice Test" : "Technicien Test";
        UUID id = jdbc.sql("""
                INSERT INTO aegis.users (display_name, email, password_hash, role, maximum_access_level)
                VALUES (:displayName, :email, :passwordHash, :role, :maximumAccessLevel)
                RETURNING id
                """)
                .param("displayName", displayName)
                .param("email", email)
                .param("passwordHash", passwordEncoder.encode(password))
                .param("role", role.name())
                .param("maximumAccessLevel", maximumAccessLevel.name())
                .query((row, number) -> row.getObject("id", UUID.class))
                .single();
        return new TestAccount(id, email, password, displayName, role, maximumAccessLevel);
    }

    public void disable(UUID id) {
        update("UPDATE aegis.users SET status = 'DISABLED' WHERE id = :id", id);
    }

    public void archive(UUID id) {
        update("UPDATE aegis.users SET status = 'DISABLED', archived_at = now() WHERE id = :id", id);
    }

    public void changeRole(UUID id, Role role) {
        jdbc.sql("UPDATE aegis.users SET role = :role WHERE id = :id")
                .param("role", role.name())
                .param("id", id)
                .update();
    }

    public void changeAccessLevel(UUID id, AccessLevel maximumAccessLevel) {
        jdbc.sql("UPDATE aegis.users SET maximum_access_level = :level WHERE id = :id")
                .param("level", maximumAccessLevel.name())
                .param("id", id)
                .update();
    }

    public String status(UUID id) {
        return jdbc.sql("SELECT status FROM aegis.users WHERE id = :id").param("id", id).query(String.class).single();
    }

    private void update(String sql, UUID id) {
        if (jdbc.sql(sql).param("id", id).update() != 1) {
            throw new IllegalStateException("No account " + id);
        }
    }

    public record TestAccount(UUID id, String email, String password, String displayName, Role role,
            AccessLevel maximumAccessLevel) {

        @Override
        public String toString() {
            return "TestAccount[id=%s, email=%s, role=%s]".formatted(id, email, role);
        }
    }
}
