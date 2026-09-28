package ca.aegis.control.identity;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class AccountRepository {

    private static final String SELECT_ACCOUNT = """
            SELECT id, display_name, email, password_hash, role, maximum_access_level, status, archived_at
            FROM aegis.users
            """;

    private final JdbcClient jdbc;

    AccountRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<Account> findByEmail(String normalizedEmail) {
        return jdbc.sql(SELECT_ACCOUNT + "WHERE lower(email) = lower(:email)")
                .param("email", normalizedEmail)
                .query(AccountRepository::map)
                .optional();
    }

    Optional<Account> findById(UUID id) {
        return jdbc.sql(SELECT_ACCOUNT + "WHERE id = :id")
                .param("id", id)
                .query(AccountRepository::map)
                .optional();
    }

    /** Returns false when an account already uses this address, whatever its case. */
    boolean insertIfAbsent(String displayName, String normalizedEmail, String passwordHash, Role role,
            AccessLevel maximumAccessLevel) {
        int inserted = jdbc.sql("""
                INSERT INTO aegis.users (display_name, email, password_hash, role, maximum_access_level)
                VALUES (:displayName, :email, :passwordHash, :role, :maximumAccessLevel)
                ON CONFLICT ((lower(email))) DO NOTHING
                """)
                .param("displayName", displayName)
                .param("email", normalizedEmail)
                .param("passwordHash", passwordHash)
                .param("role", role.name())
                .param("maximumAccessLevel", maximumAccessLevel.name())
                .update();
        return inserted == 1;
    }

    void updatePasswordHash(UUID id, String passwordHash) {
        jdbc.sql("UPDATE aegis.users SET password_hash = :passwordHash WHERE id = :id")
                .param("passwordHash", passwordHash)
                .param("id", id)
                .update();
    }

    private static Account map(ResultSet row, int rowNumber) throws SQLException {
        OffsetDateTime archivedAt = row.getObject("archived_at", OffsetDateTime.class);
        return new Account(
                row.getObject("id", UUID.class),
                row.getString("display_name"),
                row.getString("email"),
                row.getString("password_hash"),
                Role.valueOf(row.getString("role")),
                AccessLevel.valueOf(row.getString("maximum_access_level")),
                AccountStatus.valueOf(row.getString("status")),
                archivedAt == null ? null : archivedAt.toInstant());
    }
}
