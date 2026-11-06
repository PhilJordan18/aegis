package ca.aegis.control.locker;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.locker.AdminLockerView.AdminCompartmentView;
import ca.aegis.control.locker.AdminLockerView.CurrentAsset;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;

/**
 * {@code GET /admin/lockers} (document 09, section 16.2): lockers by code without case, then id; their compartments
 * by code without case, then id. Three statements per page whatever its size, in one snapshot so that the count,
 * the lockers and the occupancy agree.
 */
@Service
class AdminLockerService {

    private final JdbcClient jdbc;

    AdminLockerService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PageResponse<AdminLockerView> list(PageQuery page) {
        long total = jdbc.sql("SELECT count(*) FROM aegis.lockers").query(Long.class).single();
        Map<UUID, LockerRow> lockers = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT id, code, name, topology FROM aegis.lockers
                ORDER BY lower(code), id LIMIT :limit OFFSET :offset
                """).param("limit", page.size()).param("offset", page.offset()).query(row -> {
                    UUID id = row.getObject("id", UUID.class);
                    lockers.put(id, new LockerRow(id, row.getString("code"), row.getString("name"),
                            row.getString("topology"), new ArrayList<>()));
                });
        if (!lockers.isEmpty()) {
            jdbc.sql("""
                    SELECT c.locker_id, c.id, c.code, c.enabled, a.id AS asset_id, a.asset_code
                    FROM aegis.compartments c
                    LEFT JOIN aegis.asset_placements p ON p.compartment_id = c.id AND p.removed_at IS NULL
                    LEFT JOIN aegis.assets a ON a.id = p.asset_id
                    WHERE c.locker_id IN (:lockers)
                    ORDER BY lower(c.code), c.id
                    """).param("lockers", lockers.keySet()).query(row -> {
                        UUID asset = row.getObject("asset_id", UUID.class);
                        lockers.get(row.getObject("locker_id", UUID.class)).compartments().add(
                                new AdminCompartmentView(row.getObject("id", UUID.class), row.getString("code"),
                                        row.getBoolean("enabled"),
                                        asset == null ? null : new CurrentAsset(asset, row.getString("asset_code"))));
                    });
        }
        List<AdminLockerView> items = lockers.values().stream()
                .map(locker -> new AdminLockerView(locker.id(), locker.code(), locker.name(), locker.topology(),
                        List.copyOf(locker.compartments())))
                .toList();
        return PageResponse.of(items, page, total);
    }

    private record LockerRow(UUID id, String code, String name, String topology,
            List<AdminCompartmentView> compartments) {
    }
}
