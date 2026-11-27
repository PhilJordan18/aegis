package ca.aegis.control.identity;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class AccountRepository {

    private static final String SELECT_ACCOUNT = """
            SELECT id, display_name, email, password_hash, role, maximum_access_level, status, archived_at,
                credential_version
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

    Optional<Account> lockById(UUID id) {
        return jdbc.sql(SELECT_ACCOUNT + "WHERE id = :id FOR UPDATE").param("id", id)
                .query(AccountRepository::map).optional();
    }

    Optional<Account> findById(UUID id) {
        return jdbc.sql(SELECT_ACCOUNT + "WHERE id = :id")
                .param("id", id)
                .query(AccountRepository::map)
                .optional();
    }

    /**
     * The account a token names, read with its browser session in the same round trip (ADR-018). {@code sessionOpen}
     * is true only when {@code sessionId} names a session of this very account that is neither revoked nor past its
     * end at {@code now}; it is false when {@code sessionId} is null.
     */
    Optional<TokenOwner> findTokenOwner(UUID id, UUID sessionId, Instant now) {
        return jdbc.sql("""
                SELECT u.id, u.display_name, u.email, u.password_hash, u.role, u.maximum_access_level, u.status,
                    u.archived_at, u.credential_version, s.id IS NOT NULL AS session_open
                FROM aegis.users u
                LEFT JOIN aegis.browser_sessions s
                    ON s.id = :session AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > :now
                WHERE u.id = :id
                """)
                .param("id", id)
                .param("session", sessionId)
                .param("now", now.atOffset(ZoneOffset.UTC))
                .query((row, rowNumber) -> new TokenOwner(map(row, rowNumber), row.getBoolean("session_open")))
                .optional();
    }

    record TokenOwner(Account account, boolean sessionOpen) {
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
                archivedAt == null ? null : archivedAt.toInstant(),
                row.getInt("credential_version"));
    }
}
