package ca.aegis.control.system;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

class SystemHealthControllerTests {

    @Test
    void returnsOnlyThePublicHealthContract() {
        Instant now = Instant.parse("2026-09-27T14:30:00Z");
        var controller = new SystemHealthController(Clock.fixed(now, ZoneOffset.UTC), "0.1.0");

        var response = controller.health();

        assertEquals("UP", response.status());
        assertEquals("aegis-control", response.service());
        assertEquals("0.1.0", response.version());
        assertEquals(now, response.timestamp());
    }
}
