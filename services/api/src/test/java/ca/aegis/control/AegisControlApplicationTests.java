package ca.aegis.control;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import ca.aegis.control.support.ApiIntegrationTest;

class AegisControlApplicationTests extends ApiIntegrationTest {

	@Autowired
	JdbcTemplate jdbc;

	@Test
	void flywayAppliesEachMigrationOnce() {
		assertEquals("aegis", jdbc.queryForObject("SELECT nspname FROM pg_namespace WHERE nspname = 'aegis'", String.class));
		assertEquals(List.of("001", "002"), jdbc.queryForList(
				"SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank", String.class));
	}

}
