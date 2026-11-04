package ca.aegis.control.device;

import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** Canonical UUIDs of the MQTT contract: 8-4-4-4-12 lowercase hexadecimal digits (document 10, section 5). */
final class Uuids {

    static final String CANONICAL = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    private static final Pattern PATTERN = Pattern.compile(CANONICAL);

    private Uuids() {
    }

    static Optional<UUID> canonical(String text) {
        return PATTERN.matcher(text).matches() ? Optional.of(UUID.fromString(text)) : Optional.empty();
    }
}
