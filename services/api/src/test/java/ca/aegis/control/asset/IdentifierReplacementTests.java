package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/** CAT-02, decided on 28 October 2026: an asset carries at most one active identifier of each type. */
class IdentifierReplacementTests extends CatalogApiTest {

    @Test
    void aNewIdentifierOfTheSameTypeRevokesThePreviousOneAndBothChangesAreAudited() throws Exception {
        String model = createModel("Remplacement tag " + suffix);
        String asset = createAsset(model, "RTG-" + suffix);
        String other = createAsset(model, "RTG-OTHER-" + suffix);
        String previous = id(assign(asset, "RFID_UHF", epc("E400")).andExpect(status().isCreated()));
        String nfc = id(assign(asset, "NFC", "N400" + suffix).andExpect(status().isCreated()));
        clock.advance(Duration.ofMinutes(2));
        String replacedAt = START.plus(Duration.ofMinutes(2)).toString();

        String current = id(assign(asset, "RFID_UHF", epc("E401")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true)));

        assertEquals(List.of(previous + " false " + replacedAt, nfc + " true null", current + " true null"),
                jdbc.sql("""
                        SELECT id || ' ' || active || ' '
                               || coalesce(to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'null')
                        FROM aegis.asset_identifiers WHERE asset_id = :id ORDER BY assigned_at, identifier_value
                        """).param("id", UUID.fromString(asset)).query(String.class).list());
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED", "ASSET_UPDATED ACCEPTED"), events(previous));
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED"), events(current));
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED"), events(nfc));
        assign(other, "RFID_UHF", epc("E400")).andExpect(status().isCreated());
    }

    @Test
    void aRefusedReplacementKeepsThePreviousIdentifierActive() throws Exception {
        String model = createModel("Remplacement refusé " + suffix);
        String asset = createAsset(model, "RTR-" + suffix);
        String other = createAsset(model, "RTR-OTHER-" + suffix);
        String previous = id(assign(asset, "QR", "Q500" + suffix));
        assign(other, "QR", "Q501" + suffix).andExpect(status().isCreated());

        assign(asset, "QR", "Q501" + suffix).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDENTIFIER_ALREADY_ASSIGNED"));

        assertEquals(true, jdbc.sql("SELECT active FROM aegis.asset_identifiers WHERE id = :id")
                .param("id", UUID.fromString(previous)).query(Boolean.class).single());
        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED"), events(previous));
    }

    private ResultActions assign(String asset, String type, String value) throws Exception {
        return mvc.perform(asAdmin(withKey(json(post(AssetIdentifierApiTests.identifiers(asset)),
                AssetIdentifierApiTests.body(type, value)))));
    }

    private List<String> events(String identifier) {
        return jdbc.sql("""
                SELECT event_type || ' ' || result FROM aegis.audit_events
                WHERE subject_type = 'ASSET_IDENTIFIER' AND subject_id = :id ORDER BY occurred_at, event_type
                """).param("id", UUID.fromString(identifier)).query(String.class).list();
    }
}
