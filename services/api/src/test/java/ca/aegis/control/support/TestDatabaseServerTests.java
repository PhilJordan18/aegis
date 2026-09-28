package ca.aegis.control.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class TestDatabaseServerTests {

    private static final String PASSWORD = "local-test-password";

    @Test
    void loopbackServersAreAccepted() {
        for (String host : new String[] {"localhost", "127.0.0.1", "127.0.0.2", "::1"}) {
            TestDatabaseServer server = TestDatabaseServer.fromEnvironment(
                    Map.of(TestDatabaseServer.HOST, host, TestDatabaseServer.PASSWORD, PASSWORD));
            assertEquals(host, server.host());
        }
        assertEquals("jdbc:postgresql://[::1]:5432/aegis_test", TestDatabaseServer.fromEnvironment(
                Map.of(TestDatabaseServer.HOST, "::1", TestDatabaseServer.PASSWORD, PASSWORD)).url("aegis_test"));
    }

    @Test
    void applicationDatabaseSettingsNeverRedirectTheTests() {
        TestDatabaseServer server = TestDatabaseServer.fromEnvironment(Map.of(
                "AEGIS_DB_HOST", "192.0.2.10",
                "AEGIS_DB_PORT", "6543",
                "AEGIS_DB_NAME", "aegis",
                "AEGIS_DB_USER", "production",
                TestDatabaseServer.APPLICATION_PASSWORD, PASSWORD));

        assertEquals("localhost:5432", server.address());
        assertEquals("aegis", server.user());
        assertEquals(PASSWORD, server.password());
    }

    @Test
    void anyOtherServerMustBeDeclaredDisposableByItsExactAddress() {
        Map<String, String> remote = new HashMap<>(
                Map.of(TestDatabaseServer.HOST, "192.0.2.10", TestDatabaseServer.PASSWORD, PASSWORD));

        IllegalStateException refused = assertThrows(IllegalStateException.class,
                () -> TestDatabaseServer.fromEnvironment(remote));
        assertThat(refused.getMessage()).contains("192.0.2.10:5432", TestDatabaseServer.DISPOSABLE_SERVER)
                .doesNotContain(PASSWORD);

        for (String declaration : new String[] {"true", "192.0.2.10", "192.0.2.10:6543", "192.0.2.11:5432"}) {
            remote.put(TestDatabaseServer.DISPOSABLE_SERVER, declaration);
            assertThrows(IllegalStateException.class, () -> TestDatabaseServer.fromEnvironment(remote), declaration);
        }

        remote.put(TestDatabaseServer.DISPOSABLE_SERVER, "192.0.2.10:5432");
        assertEquals("192.0.2.10:5432", TestDatabaseServer.fromEnvironment(remote).address());
    }

    @Test
    void passwordIsRequiredAndNeverPrinted() {
        assertThrows(IllegalStateException.class, () -> TestDatabaseServer.fromEnvironment(Map.of()));
        assertThrows(IllegalStateException.class, () -> TestDatabaseServer.fromEnvironment(
                Map.of(TestDatabaseServer.PASSWORD, PASSWORD, TestDatabaseServer.PORT, "not-a-port")));

        assertThat(TestDatabaseServer.fromEnvironment(Map.of(TestDatabaseServer.PASSWORD, PASSWORD)).toString())
                .doesNotContain(PASSWORD);
    }
}
