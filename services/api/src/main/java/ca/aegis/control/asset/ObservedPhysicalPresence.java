package ca.aegis.control.asset;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.device.PresenceEvidence;
import ca.aegis.control.device.PresenceEvidence.Expectation;
import ca.aegis.control.device.PresenceEvidence.Verdict;

/**
 * Presence from the stored RFID observations (PHY-02): an asset is expected in the compartment of its current
 * placement with its active UHF tag, and {@link PresenceEvidence} decides from the scans whether it is there now. An
 * asset without a placement or without an active RFID identifier has no expectation to prove, hence {@code UNKNOWN}.
 */
@Component
class ObservedPhysicalPresence implements PhysicalPresence {

    private final JdbcClient jdbc;
    private final PresenceEvidence evidence;

    ObservedPhysicalPresence(JdbcClient jdbc, PresenceEvidence evidence) {
        this.jdbc = jdbc;
        this.evidence = evidence;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<UUID, Presence> of(Collection<UUID> assetIds, Instant now) {
        Map<UUID, Presence> presences = assetIds.stream().distinct()
                .collect(Collectors.toMap(id -> id, id -> Presence.UNKNOWN));
        if (presences.isEmpty()) {
            return presences;
        }
        Map<UUID, Expectation> expectations = new HashMap<>();
        for (ExpectedAsset expected : expected(presences.keySet())) {
            expectations.put(expected.assetId(), expected.expectation());
        }
        Map<Expectation, Verdict> verdicts = evidence.evaluate(expectations.values(), now);
        expectations.forEach((assetId, expectation) -> presences.put(assetId,
                switch (verdicts.getOrDefault(expectation, Verdict.UNKNOWN)) {
                    case PRESENT -> Presence.PRESENT;
                    case ABSENT -> Presence.ABSENT;
                    case UNKNOWN -> Presence.UNKNOWN;
                }));
        return presences;
    }

    private record ExpectedAsset(UUID assetId, Expectation expectation) {
    }

    private List<ExpectedAsset> expected(Collection<UUID> assetIds) {
        return jdbc.sql("""
                SELECT p.asset_id, p.compartment_id, i.identifier_value,
                       greatest(p.assigned_at, i.assigned_at) AS bound_since
                FROM aegis.asset_placements p
                JOIN aegis.asset_identifiers i
                  ON i.asset_id = p.asset_id AND i.active AND i.identifier_type = 'RFID_UHF'
                WHERE p.asset_id IN (:ids) AND p.removed_at IS NULL
                """)
                .param("ids", assetIds)
                .query(ObservedPhysicalPresence::expectedAsset)
                .list();
    }

    private static ExpectedAsset expectedAsset(ResultSet row, int number) throws SQLException {
        return new ExpectedAsset(row.getObject("asset_id", UUID.class),
                new Expectation(row.getObject("compartment_id", UUID.class), row.getString("identifier_value"),
                        row.getObject("bound_since", OffsetDateTime.class).toInstant()));
    }
}
