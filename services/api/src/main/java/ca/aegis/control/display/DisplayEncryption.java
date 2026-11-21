package ca.aegis.control.display;

import java.util.Optional;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Whether the hub challenge flow may run, and with which keys (decision of 11 November 2026, #43). It fails closed:
 *
 * <ul>
 * <li>{@code aegis.display.enabled=true} without a valid key ring stops the application at start;</li>
 * <li>keys that are provided are always validated, even while the flow is disabled, so a malformed value is found
 * before the flow is turned on;</li>
 * <li>while the flow is disabled, no challenge is prepared, so no display row and no key dependency is created.</li>
 * </ul>
 */
@Component
public class DisplayEncryption {

    private final boolean enabled;
    private final DisplayKeyRing keyRing;

    DisplayEncryption(@Value("${aegis.display.enabled:false}") boolean enabled,
            @Value("${aegis.display.keys:}") String keys,
            @Value("${aegis.display.active-key-id:}") String activeKeyId) {
        boolean provided = !keys.isBlank() || !activeKeyId.isBlank();
        this.keyRing = enabled || provided ? DisplayKeyRing.parse(keys, activeKeyId) : null;
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }

    /** The key ring of an enabled flow. */
    public DisplayKeyRing keyRing() {
        if (!enabled) {
            throw new IllegalStateException("The hub challenge flow is disabled (aegis.display.enabled=false)");
        }
        return keyRing;
    }

    /** The configured keys, enabled or not; used to open rows sealed before the flow was turned off. */
    public Optional<DisplayKeyRing> configuredKeys() {
        return Optional.ofNullable(keyRing);
    }
}
