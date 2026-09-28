package ca.aegis.control.support;

import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

import org.springframework.boot.SpringApplication;

/**
 * Temporary PostgreSQL databases for one test run, on a {@link TestDatabaseServer} accepted as disposable.
 * <ul>
 * <li>Every name is unique to the run: {@code aegis_test_<random run id>_<purpose><n>}.</li>
 * <li>An existing database is never adopted: {@code CREATE DATABASE} fails and the test stops.</li>
 * <li>Only databases created by this instance are dropped, after checking the comment written at creation.</li>
 * <li>The shared instance drops what remains once Spring Boot has closed every test context.</li>
 * </ul>
 * A killed test JVM can leave databases behind; their comment names the run and the time it started.
 */
public final class TestDatabases {

    static final String NAME_PREFIX = "aegis_test_";
    private static final String MAINTENANCE_DATABASE = "postgres";
    private static final Pattern PURPOSE = Pattern.compile("[a-z]{1,20}");
    private static final Pattern NAME = Pattern.compile("aegis_test_[0-9a-f]{12}_[a-z]{1,20}[0-9]{1,9}");

    private static TestDatabases shared;

    private final TestDatabaseServer server;
    private final String runId;
    private final String marker;
    private final Set<String> created = ConcurrentHashMap.newKeySet();
    private final AtomicInteger sequence = new AtomicInteger();
    private String applicationDatabase;

    TestDatabases(TestDatabaseServer server) {
        byte[] random = new byte[6];
        new SecureRandom().nextBytes(random);
        this.server = server;
        this.runId = HexFormat.of().formatHex(random);
        this.marker = "Aegis API test run " + runId + " started " + Instant.now().truncatedTo(ChronoUnit.SECONDS);
    }

    /** The instance of this test JVM, configured from the environment on first use. */
    public static synchronized TestDatabases shared() {
        if (shared == null) {
            shared = new TestDatabases(TestDatabaseServer.fromEnvironment(System.getenv()));
            // Spring Boot runs its shutdown handlers after closing every context, so no pool still holds a
            // connection to these databases.
            SpringApplication.getShutdownHandlers().add(shared::dropCreated);
        }
        return shared;
    }

    public TestDatabaseServer server() {
        return server;
    }

    /** The database shared by the Spring test contexts of this run, created on first use. */
    public synchronized String applicationDatabaseUrl() {
        if (applicationDatabase == null) {
            applicationDatabase = create("app");
        }
        return server.url(applicationDatabase);
    }

    /** Creates an empty database from {@code template0} and returns its name. */
    public String create(String purpose) {
        String name = nextName(purpose);
        createExactly(name);
        return name;
    }

    /** Drops a database created by this instance; any other name is refused. */
    public void drop(String name) {
        if (!created.contains(name)) {
            throw new IllegalStateException("Refusing to drop " + name + ": this test run did not create it");
        }
        dropOwned(name, false);
    }

    String nextName(String purpose) {
        if (!PURPOSE.matcher(purpose).matches()) {
            throw new IllegalArgumentException("A test database purpose is 1 to 20 lowercase letters: " + purpose);
        }
        return NAME_PREFIX + runId + "_" + purpose + sequence.incrementAndGet();
    }

    void createExactly(String name) {
        requireNameOfThisRun(name);
        try (Connection connection = server.connect(MAINTENANCE_DATABASE);
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + name + " TEMPLATE template0");
            try {
                statement.execute("COMMENT ON DATABASE " + name + " IS '" + marker + "'");
            } catch (SQLException commentFailure) {
                statement.execute("DROP DATABASE " + name);
                throw commentFailure;
            }
            created.add(name);
        } catch (SQLException failure) {
            throw new IllegalStateException("Could not create test database " + name + " on " + server.address()
                    + "; an existing database is never reused", failure);
        }
    }

    /** Drops every database of this instance that still exists, ending sessions that only this run can hold. */
    void dropCreated() {
        for (String name : List.copyOf(created)) {
            try {
                dropOwned(name, true);
            } catch (RuntimeException failure) {
                System.err.println("Aegis tests could not drop " + name + " on " + server.address() + ": "
                        + failure.getMessage() + ". Check its comment before dropping it manually.");
            }
        }
    }

    boolean createdByThisRun(String name) {
        return created.contains(name);
    }

    private void dropOwned(String name, boolean endSessions) {
        requireNameOfThisRun(name);
        try (Connection connection = server.connect(MAINTENANCE_DATABASE);
                PreparedStatement comment = connection.prepareStatement(
                        "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = ?")) {
            comment.setString(1, name);
            try (ResultSet row = comment.executeQuery()) {
                if (!row.next()) {
                    created.remove(name);
                    return;
                }
                if (!marker.equals(row.getString(1))) {
                    throw new IllegalStateException(
                            "Refusing to drop " + name + ": its comment does not identify this test run");
                }
            }
            try (Statement drop = connection.createStatement()) {
                drop.execute("DROP DATABASE " + name + (endSessions ? " WITH (FORCE)" : ""));
            }
            created.remove(name);
        } catch (SQLException failure) {
            throw new IllegalStateException("Could not drop test database " + name, failure);
        }
    }

    private void requireNameOfThisRun(String name) {
        if (!NAME.matcher(name).matches() || !name.startsWith(NAME_PREFIX + runId + "_")) {
            throw new IllegalArgumentException("Not a database name of test run " + runId + ": " + name);
        }
    }
}
