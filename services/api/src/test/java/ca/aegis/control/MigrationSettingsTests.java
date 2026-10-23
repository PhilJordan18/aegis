package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertyResolver;
import org.springframework.core.env.PropertySourcesPropertyResolver;
import org.springframework.core.io.support.ResourcePropertySource;

/**
 * Flyway's account in {@code application.properties}, resolved without the environment of the machine running the
 * tests: the datasource account by default, a separate migration owner when one is configured (document 08, 12.1).
 */
class MigrationSettingsTests {

    @Test
    void migrationsUseTheDatasourceAccountByDefault() throws IOException {
        PropertyResolver settings = settings(Map.of("AEGIS_DB_USER", "aegis_owner", "AEGIS_DB_PASSWORD", "owner-pw"));

        assertEquals("aegis_owner", settings.getProperty("spring.flyway.user"));
        assertEquals("owner-pw", settings.getProperty("spring.flyway.password"));
        assertEquals("aegis_app", settings.getProperty("spring.flyway.placeholders[application_role]"));
    }

    @Test
    void migrationsUseTheMigrationAccountWhenConfigured() throws IOException {
        PropertyResolver settings = settings(Map.of("AEGIS_DB_USER", "aegis_app", "AEGIS_DB_PASSWORD", "app-pw",
                "AEGIS_DB_MIGRATION_USER", "aegis_migrator", "AEGIS_DB_MIGRATION_PASSWORD", "migrator-pw",
                "AEGIS_DB_APPLICATION_ROLE", "aegis_lab_app"));

        assertEquals("aegis_app", settings.getProperty("spring.datasource.username"));
        assertEquals("aegis_migrator", settings.getProperty("spring.flyway.user"));
        assertEquals("migrator-pw", settings.getProperty("spring.flyway.password"));
        assertEquals("aegis_lab_app", settings.getProperty("spring.flyway.placeholders[application_role]"));
    }

    private static PropertyResolver settings(Map<String, Object> environment) throws IOException {
        MutablePropertySources sources = new MutablePropertySources();
        sources.addFirst(new ResourcePropertySource("classpath:application.properties"));
        sources.addFirst(new MapPropertySource("environment", environment));
        return new PropertySourcesPropertyResolver(sources);
    }
}
