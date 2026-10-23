package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Document 09, section 12.3: assignment and revocation of a physical identifier, their refusals and their audit.
 * Tag values are made unique per test because the database is shared by the whole run.
 */
class AssetIdentifierApiTests extends CatalogApiTest {

    @Test
    void anAssignmentReturnsTheActiveIdentifierAndIsAuditedOnce() throws Exception {
        String asset = createAsset(createModel("Tag " + suffix), "TAG-" + suffix);
        String key = UUID.randomUUID().toString();
        String tag = "E200" + suffix;

        String id = id(assign(asset, body("RFID_UHF", "  " + tag + " "), key)
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/admin/assets/" + asset))
                .andExpect(jsonPath("$.assetId").value(asset))
                .andExpect(jsonPath("$.type").value("RFID_UHF"))
                .andExpect(jsonPath("$.value").value(tag))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.assignedAt").value(START.toString()))
                .andExpect(jsonPath("$.revokedAt").isEmpty()));
        clock.advance(Duration.ofMinutes(1));
        assign(asset, body("RFID_UHF", "  " + tag + " "), key)
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andExpect(header().string("Location", "/api/v1/admin/assets/" + asset))
                .andExpect(jsonPath("$.id").value(id));

        assertEquals(List.of("ASSET_IDENTIFIER_ASSIGNED ACCEPTED " + admin.id() + " " + START), events(id));
        assertEquals(Map.of("assigned", Map.of("assetId", asset, "type", "RFID_UHF", "value", tag)),
                jsonMapper.readValue(details(id).getFirst(), Map.class));
        assign(asset, body("NFC", tag), null).andExpect(status().isCreated());
        assign(asset, body("QR", "QR-" + suffix), null).andExpect(status().isCreated());
    }

    @Test
    void refusedAssignmentsChangeNothingAndWriteNoEvent() throws Exception {
        String model = createModel("Refus tag " + suffix);
        String asset = createAsset(model, "RTAG-" + suffix);
        String other = createAsset(model, "RTAG-OTHER-" + suffix);
        String archived = createAsset(model, "RTAG-ARCH-" + suffix);
        archiveAsset(archived).andExpect(status().isOk());
        String tag = "E201" + suffix;
        assign(other, body("RFID_UHF", tag), null).andExpect(status().isCreated());
        long events = totalEvents();
        long identifiers = totalIdentifiers();

        expectCode(assign(asset, body("RFID_UHF", tag), null), 409, "IDENTIFIER_ALREADY_ASSIGNED");
        expectCode(assign(other, body("RFID_UHF", tag), null), 409, "IDENTIFIER_ALREADY_ASSIGNED");
        expectCode(assign(asset, body("BARCODE", tag), null), 422, "IDENTIFIER_TYPE_UNSUPPORTED");
        expectCode(assign(asset, body("rfid_uhf", tag), null), 422, "IDENTIFIER_TYPE_UNSUPPORTED");
        expectCode(assign(archived, body("NFC", "N-" + suffix), null), 409, "ASSET_ARCHIVED");
        expectCode(assign(UUID.randomUUID().toString(), body("NFC", "N-" + suffix), null), 404,
                "RESOURCE_NOT_FOUND");
        expectCode(assign(asset, body(" ", "N-" + suffix), null), 400, "VALIDATION_ERROR");
        expectCode(assign(asset, body("NFC", " "), null), 400, "VALIDATION_ERROR");
        expectCode(assign(asset, body("NFC", "x".repeat(129)), null), 400, "VALIDATION_ERROR");
        expectCode(assign(asset, body("NFC", "N\u0000" + suffix), null), 400, "VALIDATION_ERROR");
        Map<String, Object> extra = body("NFC", "N-" + suffix);
        extra.put("active", false);
        expectCode(assign(asset, extra, null), 400, "VALIDATION_ERROR");
        expectCode(mvc.perform(asAdmin(json(post(identifiers(asset)), body("NFC", "N-" + suffix)))), 400,
                "IDEMPOTENCY_KEY_REQUIRED");

        assertEquals(events, totalEvents());
        assertEquals(identifiers, totalIdentifiers());
    }

    @Test
    void aRevocationKeepsTheRowAndFreesTheTagAndARepeatIsAlreadyApplied() throws Exception {
        String model = createModel("Révocation " + suffix);
        String asset = createAsset(model, "REV-" + suffix);
        String other = createAsset(model, "REV-OTHER-" + suffix);
        String tag = "E202" + suffix;
        String id = id(assign(asset, body("RFID_UHF", tag), null).andExpect(status().isCreated()));
        clock.advance(Duration.ofMinutes(2));
        String revokedAt = START.plus(Duration.ofMinutes(2)).toString();
        String firstKey = UUID.randomUUID().toString();

        revoke(asset, id, firstKey)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.assignedAt").value(START.toString()))
                .andExpect(jsonPath("$.revokedAt").value(revokedAt));
        clock.advance(Duration.ofMinutes(3));
        revoke(asset, id, firstKey).andExpect(header().string("Idempotency-Replayed", "true"));
        revoke(asset, id, null)
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.revokedAt").value(revokedAt));

        assertEquals(List.of(
                "ASSET_IDENTIFIER_ASSIGNED ACCEPTED " + admin.id() + " " + START,
                "ASSET_UPDATED ACCEPTED " + admin.id() + " " + revokedAt,
                "ASSET_UPDATED ALREADY_APPLIED " + admin.id() + " " + START.plus(Duration.ofMinutes(5))),
                events(id));
        assertEquals(Map.of("revoked", Map.of("assetId", asset, "type", "RFID_UHF", "value", tag),
                "revokedAt", revokedAt), jsonMapper.readValue(details(id).get(2), Map.class));
        assertEquals(1, count("asset_identifiers", "identifier_value", tag));

        assign(other, body("RFID_UHF", tag), null).andExpect(status().isCreated());
        assertEquals(2, count("asset_identifiers", "identifier_value", tag));
    }

    @Test
    void refusedRevocationsChangeNothingAndWriteNoEvent() throws Exception {
        String model = createModel("Refus révocation " + suffix);
        String asset = createAsset(model, "RREV-" + suffix);
        String other = createAsset(model, "RREV-OTHER-" + suffix);
        String archived = createAsset(model, "RREV-ARCH-" + suffix);
        String id = id(assign(asset, body("NFC", "N1-" + suffix), null));
        String archivedTag = id(assign(archived, body("NFC", "N2-" + suffix), null));
        archiveAsset(archived).andExpect(status().isOk());
        long events = totalEvents();

        expectCode(revoke(other, id, null), 404, "RESOURCE_NOT_FOUND");
        expectCode(revoke(asset, UUID.randomUUID().toString(), null), 404, "RESOURCE_NOT_FOUND");
        expectCode(revoke(UUID.randomUUID().toString(), id, null), 404, "RESOURCE_NOT_FOUND");
        expectCode(revoke(archived, archivedTag, null), 409, "ASSET_ARCHIVED");
        expectCode(mvc.perform(asAdmin(post(identifiers(asset) + "/" + id + "/revoke"))), 400,
                "IDEMPOTENCY_KEY_REQUIRED");

        assertEquals(events, totalEvents());
        assertEquals(1, jdbc.sql("SELECT count(*) FROM aegis.asset_identifiers WHERE id = :id AND active")
                .param("id", UUID.fromString(id)).query(Long.class).single());
    }

    @Test
    void techniciansCannotAssignOrRevoke() throws Exception {
        String asset = createAsset(createModel("Rôle tag " + suffix), "ROLE-" + suffix);
        String id = id(assign(asset, body("QR", "Q-" + suffix), null));
        String technician = bearer(accessToken(accounts.technician()));

        mvc.perform(withKey(json(post(identifiers(asset)), body("QR", "Q2-" + suffix)))
                .header(AUTHORIZATION, technician)).andExpect(status().isForbidden());
        mvc.perform(withKey(post(identifiers(asset) + "/" + id + "/revoke")).header(AUTHORIZATION, technician))
                .andExpect(status().isForbidden());
    }

    static Map<String, Object> body(String type, String value) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", type);
        body.put("value", value);
        return body;
    }

    static String identifiers(String asset) {
        return ASSETS + "/" + asset + "/identifiers";
    }

    ResultActions assign(String asset, Object body, String key) throws Exception {
        return mvc.perform(asAdmin(keyed(json(post(identifiers(asset)), body), key)));
    }

    ResultActions revoke(String asset, String identifier, String key) throws Exception {
        return mvc.perform(asAdmin(keyed(post(identifiers(asset) + "/" + identifier + "/revoke"), key)));
    }

    private static MockHttpServletRequestBuilder keyed(MockHttpServletRequestBuilder request, String key) {
        return request.header(IDEMPOTENCY_KEY, key == null ? UUID.randomUUID().toString() : key);
    }

    private static void expectCode(ResultActions result, int status, String code) throws Exception {
        result.andExpect(status().is(status)).andExpect(jsonPath("$.code").value(code));
    }

    private List<String> events(String identifier) {
        return jdbc.sql("""
                SELECT event_type || ' ' || result || ' ' || actor_user_id || ' '
                       || to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                FROM aegis.audit_events
                WHERE subject_type = 'ASSET_IDENTIFIER' AND subject_id = :id
                ORDER BY occurred_at, event_type
                """).param("id", UUID.fromString(identifier)).query(String.class).list();
    }

    private List<String> details(String identifier) {
        return jdbc.sql("""
                SELECT details::text FROM aegis.audit_events
                WHERE subject_type = 'ASSET_IDENTIFIER' AND subject_id = :id
                ORDER BY occurred_at, event_type
                """).param("id", UUID.fromString(identifier)).query(String.class).list();
    }

    private long totalEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    private long totalIdentifiers() {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_identifiers").query(Long.class).single();
    }
}
