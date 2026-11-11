package ca.aegis.control.identity;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** The {@link UserSummary} of known users, read in one query for a page of administrative views. */
@Repository
public class UserSummaries {

    private final JdbcClient jdbc;

    UserSummaries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Map<UUID, UserSummary> of(Collection<UUID> ids) {
        List<UUID> distinct = ids.stream().distinct().toList();
        if (distinct.isEmpty()) {
            return Map.of();
        }
        Map<UUID, UserSummary> summaries = new HashMap<>();
        jdbc.sql("SELECT id, display_name FROM aegis.users WHERE id IN (:ids)").param("ids", distinct)
                .query((row, number) -> new UserSummary(row.getObject("id", UUID.class), row.getString("display_name")))
                .list().forEach(summary -> summaries.put(summary.id(), summary));
        return summaries;
    }
}
