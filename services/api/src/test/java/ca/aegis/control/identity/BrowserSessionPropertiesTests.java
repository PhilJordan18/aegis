package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;

class BrowserSessionPropertiesTests {

    @Test
    void defaultsToEightHoursAndNoOrigin() {
        BrowserSessionProperties properties = new BrowserSessionProperties(null, null);
        assertEquals(Duration.ofHours(8), properties.lifetime());
        assertFalse(properties.allows("https://manager.example"));
        assertFalse(properties.allows(null));
    }

    @Test
    void matchesOnlyTheExactConfiguredOrigins() {
        BrowserSessionProperties properties = new BrowserSessionProperties(
                List.of(" https://manager.example ", "", "http://localhost:5173"), Duration.ofHours(1));
        assertTrue(properties.allows("https://manager.example"));
        assertTrue(properties.allows("http://localhost:5173"));
        assertFalse(properties.allows("https://manager.example/"));
        assertFalse(properties.allows("http://manager.example"));
        assertFalse(properties.allows("https://MANAGER.example.evil"));
        assertFalse(properties.allows("null"));
    }

    @Test
    void refusesAnOriginThatIsNotOneOrIsPlainHttpOutsideLocalhost() {
        for (String origin : List.of("manager.example", "https://manager.example/", "https://manager.example/path",
                "http://manager.example", "ftp://manager.example", "https://user@manager.example", "*")) {
            assertThrows(IllegalStateException.class,
                    () -> new BrowserSessionProperties(List.of(origin), null), origin);
        }
    }

    @Test
    void refusesALifetimeAboveTwelveHoursOrNotPositive() {
        for (Duration lifetime : List.of(Duration.ZERO, Duration.ofMinutes(-1), Duration.ofHours(12).plusSeconds(1))) {
            assertThrows(IllegalStateException.class, () -> new BrowserSessionProperties(List.of(), lifetime));
        }
        assertEquals(Duration.ofHours(12), new BrowserSessionProperties(List.of(), Duration.ofHours(12)).lifetime());
    }
}
