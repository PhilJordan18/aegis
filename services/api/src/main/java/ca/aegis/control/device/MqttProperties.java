package ca.aegis.control.device;

import java.net.URI;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The backend MQTT account (document 10, sections 4.2, 4.3 and 6.2), from configuration only. The password is never
 * logged; {@link #toString()} leaves it out.
 *
 * @param cleanSession false in production, so that the broker keeps the QoS 1 deliveries of a backend restart
 * @param allowInsecureRemote permits {@code tcp://} to a non-loopback broker, for an isolated Docker network only
 */
@ConfigurationProperties("aegis.mqtt")
public record MqttProperties(boolean enabled, String url, String username, String password, String clientId,
        boolean cleanSession, boolean allowInsecureRemote) {

    private static final Set<String> LOOPBACK = Set.of("localhost", "127.0.0.1", "[::1]", "::1");

    public MqttProperties {
        if (enabled) {
            require(url, "aegis.mqtt.url");
            require(username, "aegis.mqtt.username");
            require(password, "aegis.mqtt.password (AEGIS_MQTT_API_PASSWORD)");
            require(clientId, "aegis.mqtt.client-id");
            URI uri = URI.create(url);
            if ("tcp".equals(uri.getScheme())) {
                if (!allowInsecureRemote && !LOOPBACK.contains(uri.getHost())) {
                    throw new IllegalArgumentException(
                            "aegis.mqtt.url: an unencrypted broker is accepted on a loopback host only");
                }
            } else if (!"ssl".equals(uri.getScheme())) {
                throw new IllegalArgumentException("aegis.mqtt.url must use tcp:// or ssl://");
            }
        }
    }

    private static void require(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required when aegis.mqtt.enabled=true");
        }
    }

    @Override
    public String toString() {
        return "MqttProperties[enabled=%s, url=%s, username=%s, clientId=%s, cleanSession=%s]"
                .formatted(enabled, url, username, clientId, cleanSession);
    }
}
