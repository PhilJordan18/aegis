package ca.aegis.control.shared.jdbc;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * The optional equality and interval filters of an administrative list, always bound as parameters: the column names
 * come from the repository, never from the request.
 */
public final class Where {

    private final List<String> conditions = new ArrayList<>();
    private final Map<String, Object> params = new LinkedHashMap<>();

    public Where equal(String column, Object value) {
        if (value != null) {
            String name = "p" + params.size();
            conditions.add(column + " = :" + name);
            params.put(name, value instanceof Enum<?> constant ? constant.name() : value);
        }
        return this;
    }

    /** {@code from} inclusive and {@code to} exclusive (document 09, section 17). */
    public Where interval(String column, Instant from, Instant to) {
        if (from != null) {
            String name = "p" + params.size();
            conditions.add(column + " >= :" + name);
            params.put(name, from.atOffset(ZoneOffset.UTC));
        }
        if (to != null) {
            String name = "p" + params.size();
            conditions.add(column + " < :" + name);
            params.put(name, to.atOffset(ZoneOffset.UTC));
        }
        return this;
    }

    /** Keyset continuation of an {@code (timeColumn DESC, idColumn DESC)} order: the rows strictly after a cursor. */
    public Where before(String timeColumn, String idColumn, Instant time, UUID id) {
        String at = "p" + params.size();
        params.put(at, time.atOffset(ZoneOffset.UTC));
        String key = "p" + params.size();
        params.put(key, id);
        conditions.add("(" + timeColumn + ", " + idColumn + ") < (:" + at + ", :" + key + ")");
        return this;
    }

    /** {@code ""} or {@code " WHERE a AND b"}. */
    public String sql() {
        return conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
    }

    public JdbcClient.StatementSpec bind(JdbcClient.StatementSpec statement) {
        return statement.params(params);
    }
}
