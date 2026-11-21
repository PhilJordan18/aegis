package ca.aegis.control.display;

import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Key retirement rule of the decision of 11 November 2026: a key may leave {@code AEGIS_DISPLAY_KEYS} only once no
 * stored ciphertext depends on it. At start, every key still referenced by an unpurged row but missing from the
 * configuration is reported; those rows are never published (they are cancelled when claimed), so a challenge that
 * depends on one expires without being displayed. Only key ids and counts are logged, never key material.
 */
@Component
class DisplayKeyDependencies {

    private static final Logger log = LoggerFactory.getLogger(DisplayKeyDependencies.class);

    private final JdbcClient jdbc;
    private final DisplayEncryption encryption;

    DisplayKeyDependencies(JdbcClient jdbc, DisplayEncryption encryption) {
        this.jdbc = jdbc;
        this.encryption = encryption;
    }

    record Dependency(String keyId, long rows) {
    }

    /** Keys referenced by unpurged display rows, with their row counts. */
    List<Dependency> referenced() {
        return jdbc.sql("""
                SELECT encryption_key_id, count(*) AS rows FROM aegis.hub_display_outbox
                WHERE encrypted_payload IS NOT NULL
                GROUP BY encryption_key_id ORDER BY encryption_key_id
                """)
                .query((row, number) -> new Dependency(row.getString("encryption_key_id"), row.getLong("rows")))
                .list();
    }

    /** Referenced keys absent from the configuration. */
    List<Dependency> missing() {
        Set<String> configured = encryption.configuredKeys().map(DisplayKeyRing::keyIds).orElse(Set.of());
        return referenced().stream().filter(dependency -> !configured.contains(dependency.keyId())).toList();
    }

    @EventListener(ApplicationReadyEvent.class)
    void reportAtStart() {
        for (Dependency dependency : missing()) {
            log.warn("Display key not configured but still referenced: keyId={}, unpurgedRows={}; these instructions "
                    + "will be cancelled unpublished", dependency.keyId(), dependency.rows());
        }
    }
}
