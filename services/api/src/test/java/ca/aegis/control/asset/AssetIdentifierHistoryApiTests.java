package ca.aegis.control.asset;

import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * {@code GET /admin/assets/{assetId}/identifiers} (document 09, section 12.3, approved on 6 November 2026): the
 * {@code AssetIdentifierView} history of one asset, active first, then the latest assignment, then id.
 */
class AssetIdentifierHistoryApiTests extends ApiIntegrationTest {

    private static final String ASSETS = "/api/v1/admin/assets/";

    @Autowired
    JdbcClient jdbc;

    String admin;
    String suffix;

    @BeforeEach
    void prepare() throws Exception {
        admin = accessToken(accounts.admin());
        suffix = UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    void theHistoryListsActiveIdentifiersFirstThenTheLatestAssignmentThenId() throws Exception {
        UUID asset = asset(false);
        UUID oldRfid = identifier(asset, "RFID_UHF", "E2-OLD-" + suffix, "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z");
        UUID rfid = identifier(asset, "RFID_UHF", "E2-NEW-" + suffix, "2026-03-01T00:00:00Z", null);
        UUID nfc = identifier(asset, "NFC", "NFC-" + suffix, "2026-01-15T00:00:00Z", null);
        UUID revokedQr = identifier(asset, "QR", "QR-" + suffix, "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z");

        mvc.perform(get(ASSETS + asset + "/identifiers").header(AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[0].id").value(rfid.toString()))
                .andExpect(jsonPath("$[1].id").value(nfc.toString()))
                .andExpect(jsonPath("$[2].id").value(revokedQr.toString()))
                .andExpect(jsonPath("$[3].id").value(oldRfid.toString()))
                .andExpect(jsonPath("$[0].assetId").value(asset.toString()))
                .andExpect(jsonPath("$[0].type").value("RFID_UHF"))
                .andExpect(jsonPath("$[0].value").value("E2-NEW-" + suffix))
                .andExpect(jsonPath("$[0].active").value(true))
                .andExpect(jsonPath("$[0].assignedAt").value("2026-03-01T00:00:00Z"))
                .andExpect(jsonPath("$[0].revokedAt").isEmpty())
                .andExpect(jsonPath("$[3].active").value(false))
                .andExpect(jsonPath("$[3].revokedAt").value("2026-03-01T00:00:00Z"));
    }

    @Test
    void anArchivedAssetIsReadableAndAnAssetWithoutIdentifierGivesAnEmptyList() throws Exception {
        UUID archived = asset(true);
        identifier(archived, "RFID_UHF", "E2-ARCH-" + suffix, "2026-02-01T00:00:00Z", "2026-05-01T00:00:00Z");
        mvc.perform(get(ASSETS + archived + "/identifiers").header(AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].active").value(false));

        mvc.perform(get(ASSETS + asset(false) + "/identifiers").header(AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void anUnknownAssetIsNotFoundAndOnlyAnAdministratorReads() throws Exception {
        mvc.perform(get(ASSETS + UUID.randomUUID() + "/identifiers").header(AUTHORIZATION, bearer(admin)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        mvc.perform(get(ASSETS + "not-a-uuid/identifiers").header(AUTHORIZATION, bearer(admin)))
                .andExpect(status().is4xxClientError());

        UUID asset = asset(false);
        mvc.perform(get(ASSETS + asset + "/identifiers")).andExpect(status().isUnauthorized());
        mvc.perform(get(ASSETS + asset + "/identifiers")
                        .header(AUTHORIZATION, bearer(accessToken(accounts.technician()))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    private UUID asset(boolean archived) {
        UUID model = jdbc.sql("INSERT INTO aegis.asset_models (name) VALUES (:name) RETURNING id")
                .param("name", "Modèle " + UUID.randomUUID()).query(UUID.class).single();
        return jdbc.sql("""
                INSERT INTO aegis.assets (asset_model_id, asset_code, required_access_level, operational_status,
                                          calibration_required, archived_at)
                VALUES (:model, :code, 'STANDARD', 'SERVICEABLE', false, :archived)
                RETURNING id
                """).param("model", model).param("code", "HIST-" + UUID.randomUUID())
                .param("archived", archived ? at("2026-06-01T00:00:00Z") : null).query(UUID.class).single();
    }

    private UUID identifier(UUID asset, String type, String value, String assignedAt, String revokedAt) {
        return jdbc.sql("""
                INSERT INTO aegis.asset_identifiers (asset_id, identifier_type, identifier_value, active,
                                                     assigned_at, revoked_at)
                VALUES (:asset, :type, :value, :active, :assigned, :revoked)
                RETURNING id
                """).param("asset", asset).param("type", type).param("value", value)
                .param("active", revokedAt == null).param("assigned", at(assignedAt))
                .param("revoked", revokedAt == null ? null : at(revokedAt)).query(UUID.class).single();
    }

    private static OffsetDateTime at(String instant) {
        return OffsetDateTime.parse(instant).withOffsetSameInstant(ZoneOffset.UTC);
    }
}
