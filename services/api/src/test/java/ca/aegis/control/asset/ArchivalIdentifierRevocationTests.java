package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/** Pending decision of CAT-02: archival revokes the asset's active identifiers and keeps their history. */
class ArchivalIdentifierRevocationTests extends CatalogApiTest {

    @Test
    void archivalRevokesEachActiveIdentifierOnceAndFreesItsTag() throws Exception {
        String model = createModel("Archivage tags " + suffix);
        String asset = createAsset(model, "ART-" + suffix);
        String other = createAsset(model, "ART-OTHER-" + suffix);
        String rfid = id(assign(asset, "RFID_UHF", "E600" + suffix));
        String nfc = id(assign(asset, "NFC", "N600" + suffix));
        String early = id(assign(asset, "QR", "Q600" + suffix));
        mvc.perform(asAdmin(withKey(post(AssetIdentifierApiTests.identifiers(asset) + "/" + early + "/revoke"))))
                .andExpect(status().isOk());
        clock.advance(Duration.ofMinutes(6));
        String archivedAt = START.plus(Duration.ofMinutes(6)).toString();

        archiveAsset(asset).andExpect(status().isOk());
        clock.advance(Duration.ofMinutes(1));
        archiveAsset(asset).andExpect(status().isOk());

        assertEquals(List.of(
                early + " false " + START,
                nfc + " false " + archivedAt,
                rfid + " false " + archivedAt), jdbc.sql("""
                SELECT id || ' ' || active || ' '
                       || to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                FROM aegis.asset_identifiers WHERE asset_id = :id ORDER BY revoked_at, identifier_type
                """).param("id", UUID.fromString(asset)).query(String.class).list());
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED", "ASSET_UPDATED ACCEPTED " + archivedAt),
                events(rfid));
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED", "ASSET_UPDATED ACCEPTED " + archivedAt),
                events(nfc));
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED", "ASSET_UPDATED ACCEPTED " + START),
                events(early));
        assign(other, "RFID_UHF", "E600" + suffix).andExpect(status().isCreated());
    }

    private ResultActions assign(String asset, String type, String value) throws Exception {
        return mvc.perform(asAdmin(withKey(json(post(AssetIdentifierApiTests.identifiers(asset)),
                AssetIdentifierApiTests.body(type, value)))));
    }

    /** The instant is shown only for revocations, which are the subject of this test. */
    private List<String> events(String identifier) {
        return jdbc.sql("""
                SELECT event_type || ' ' || result
                       || CASE WHEN event_type = 'ASSET_UPDATED'
                               THEN ' ' || to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                               ELSE '' END
                FROM aegis.audit_events
                WHERE subject_type = 'ASSET_IDENTIFIER' AND subject_id = :id ORDER BY occurred_at, event_type
                """).param("id", UUID.fromString(identifier)).query(String.class).list();
    }
}
