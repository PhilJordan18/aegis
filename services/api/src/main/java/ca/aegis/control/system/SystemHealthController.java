package ca.aegis.control.system;

import java.time.Clock;
import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class SystemHealthController {

    private final Clock clock;
    private final String version;

    public SystemHealthController(Clock clock, @Value("${aegis.version}") String version) {
        this.clock = clock;
        this.version = version;
    }

    @GetMapping("/health")
    public HealthResponse health() {
        return new HealthResponse("UP", "aegis-control", version, clock.instant());
    }

    public record HealthResponse(String status, String service, String version, Instant timestamp) {}
}
