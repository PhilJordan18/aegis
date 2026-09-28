package ca.aegis.control.support;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Map;

/**
 * The PostgreSQL server on which tests create their temporary databases. Only the {@code AEGIS_TEST_DB_*}
 * variables select it, so exporting the application's {@code AEGIS_DB_HOST} or {@code AEGIS_DB_NAME} for a real
 * server never redirects the tests. A loopback server is accepted; any other server is refused unless
 * {@code AEGIS_TEST_DB_DISPOSABLE_SERVER} names that exact {@code host:port}, which declares it disposable.
 */
public record TestDatabaseServer(String host, int port, String user, String password) {

    static final String HOST = "AEGIS_TEST_DB_HOST";
    static final String PORT = "AEGIS_TEST_DB_PORT";
    static final String USER = "AEGIS_TEST_DB_USER";
    static final String PASSWORD = "AEGIS_TEST_DB_PASSWORD";
    static final String DISPOSABLE_SERVER = "AEGIS_TEST_DB_DISPOSABLE_SERVER";
    /** Fallback that keeps the documented {@code AEGIS_DB_PASSWORD=... ./mvnw test} command working. */
    static final String APPLICATION_PASSWORD = "AEGIS_DB_PASSWORD";

    public static TestDatabaseServer fromEnvironment(Map<String, String> environment) {
        String host = valueOf(environment, HOST, "localhost");
        int port = port(valueOf(environment, PORT, "5432"));
        String user = valueOf(environment, USER, "aegis");
        String password = valueOf(environment, PASSWORD, environment.get(APPLICATION_PASSWORD));
        if (password == null || password.isEmpty()) {
            throw new IllegalStateException(
                    PASSWORD + " or " + APPLICATION_PASSWORD + " must be set to run the PostgreSQL tests");
        }
        String address = host + ":" + port;
        if (!isLoopback(host) && !address.equals(environment.get(DISPOSABLE_SERVER))) {
            throw new IllegalStateException("Refusing to create test databases on " + address
                    + ": tests use a loopback PostgreSQL server unless " + DISPOSABLE_SERVER + "=" + address
                    + " declares that exact server disposable");
        }
        return new TestDatabaseServer(host, port, user, password);
    }

    public String url(String database) {
        String literalHost = host.indexOf(':') >= 0 ? "[" + host + "]" : host;
        return "jdbc:postgresql://" + literalHost + ":" + port + "/" + database;
    }

    public String address() {
        return host + ":" + port;
    }

    Connection connect(String database) throws SQLException {
        return DriverManager.getConnection(url(database), user, password);
    }

    static boolean isLoopback(String host) {
        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            return addresses.length > 0 && Arrays.stream(addresses).allMatch(InetAddress::isLoopbackAddress);
        } catch (UnknownHostException unresolved) {
            return false;
        }
    }

    private static String valueOf(Map<String, String> environment, String name, String fallback) {
        String value = environment.get(name);
        return value == null || value.isBlank() ? fallback : value.strip();
    }

    private static int port(String value) {
        try {
            int port = Integer.parseInt(value);
            if (port > 0 && port <= 65_535) {
                return port;
            }
        } catch (NumberFormatException notANumber) {
            // Reported below with the expected format.
        }
        throw new IllegalStateException(PORT + " must be a TCP port number");
    }

    @Override
    public String toString() {
        return "TestDatabaseServer[address=%s, user=%s, password=<redacted>]".formatted(address(), user);
    }
}
