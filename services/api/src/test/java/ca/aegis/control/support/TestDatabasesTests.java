package ca.aegis.control.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Proves the safety rules of {@link TestDatabases} with instances isolated from the shared test run. */
class TestDatabasesTests {

    private final TestDatabaseServer server = TestDatabases.shared().server();
    private final TestDatabases databases = new TestDatabases(server);

    @AfterEach
    void dropWhatThisTestCreated() {
        databases.dropCreated();
    }

    @Test
    void createdDatabasesAreUniqueToTheRunAndMarked() throws SQLException {
        String first = databases.create("probe");
        String second = databases.create("probe");
        String otherRun = new TestDatabases(server).nextName("probe");

        assertNotEquals(first, second);
        assertThat(first).matches("aegis_test_[0-9a-f]{12}_probe[0-9]+");
        assertNotEquals(first.substring(0, 23), otherRun.substring(0, 23));
        assertThat(comment(first)).startsWith("Aegis API test run " + first.substring(11, 23) + " started ");
    }

    @Test
    void onlyDatabasesCreatedByThisRunAreDropped() throws SQLException {
        String own = databases.create("probe");
        TestDatabases otherRun = new TestDatabases(server);

        assertThrows(IllegalStateException.class, () -> otherRun.drop(own));
        otherRun.dropCreated();
        assertTrue(exists(own));
        assertThrows(IllegalStateException.class, () -> databases.drop("aegis"));
        assertThrows(IllegalArgumentException.class, () -> databases.createExactly("aegis"));

        databases.drop(own);
        assertFalse(exists(own));
        assertFalse(databases.createdByThisRun(own));
    }

    @Test
    void existingDatabaseIsNeverAdoptedNorDropped() throws SQLException {
        String name = databases.nextName("probe");
        execute("CREATE DATABASE " + name);
        try {
            assertThrows(IllegalStateException.class, () -> databases.createExactly(name));
            assertFalse(databases.createdByThisRun(name));
            assertThrows(IllegalStateException.class, () -> databases.drop(name));
            databases.dropCreated();
            assertTrue(exists(name));
        } finally {
            // Created by this test as a stand-in for a database the harness must not touch.
            execute("DROP DATABASE IF EXISTS " + name);
        }
    }

    @Test
    void databaseWhoseMarkerChangedIsLeftInPlace() throws SQLException {
        String name = databases.create("probe");
        execute("COMMENT ON DATABASE " + name + " IS 'replaced by someone else'");
        try {
            assertThrows(IllegalStateException.class, () -> databases.drop(name));
            assertTrue(exists(name));
            assertTrue(databases.createdByThisRun(name));
        } finally {
            execute("DROP DATABASE IF EXISTS " + name);
        }
        databases.dropCreated();
        assertFalse(databases.createdByThisRun(name));
    }

    private boolean exists(String name) throws SQLException {
        try (Connection connection = server.connect("postgres");
                PreparedStatement query = connection.prepareStatement("SELECT 1 FROM pg_database WHERE datname = ?")) {
            query.setString(1, name);
            try (ResultSet row = query.executeQuery()) {
                return row.next();
            }
        }
    }

    private String comment(String name) throws SQLException {
        try (Connection connection = server.connect("postgres");
                PreparedStatement query = connection.prepareStatement(
                        "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = ?")) {
            query.setString(1, name);
            try (ResultSet row = query.executeQuery()) {
                return row.next() ? row.getString(1) : null;
            }
        }
    }

    private void execute(String sql) throws SQLException {
        try (Connection connection = server.connect("postgres"); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }
}
