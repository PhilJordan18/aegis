package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Catalog text never carries a control character or an unpaired surrogate: PostgreSQL cannot store NUL, the driver
 * silently replaces an unpaired surrogate, and any other control character would be stored invisibly in a code or a
 * name. Each is refused with {@code 400 VALIDATION_ERROR} before any SQL; only the free-text description keeps its
 * tabulations and line breaks. A violation never repeats the refused value (document 09, section 7).
 */
class CatalogTextCharacterTests extends CatalogApiTest {

    /** Written into the JSON as the escape {@code \uD800}: a Java string would be encoded as {@code ?} first. */
    private static final String LONE_SURROGATE = "@LONE-SURROGATE@";

    /** NUL, other C0 controls, DEL, a C1 control and an unpaired surrogate, each inside the value. */
    private static final List<String> REFUSED = List.of("\u0000", "\u0001", "\t", "\n", "\r", "\u001B", "\u001F",
            "\u007F", "\u0085", "\u009F", LONE_SURROGATE);

    /** Refused in the description too: only tabulation, line feed and carriage return are allowed there. */
    private static final List<String> REFUSED_IN_DESCRIPTION = List.of("\u0000", "\u0001", "\u000B", "\u001F",
            "\u007F", "\u0085", LONE_SURROGATE);

    @Test
    void modelCreationRefusesAControlCharacterInEverySingleLineField() throws Exception {
        for (String field : List.of("name", "manufacturer", "modelNumber")) {
            for (String character : REFUSED) {
                String marker = marker();
                Map<String, Object> body = modelBody("Contrôle " + marker);
                body.put(field, "A" + marker + character + "B");
                expectInvalidValue(mvc.perform(asAdmin(withKey(raw(post(MODELS), body)))), field, marker);
                assertEquals(0, modelsContaining(marker), field + " " + describe(character));
            }
        }
    }

    @Test
    void modelDescriptionKeepsLineBreaksAndTabulationsButRefusesOtherControlCharacters() throws Exception {
        for (String character : REFUSED_IN_DESCRIPTION) {
            String marker = marker();
            Map<String, Object> body = modelBody("Description " + marker);
            body.put("description", "A" + marker + character + "B");
            expectInvalidValue(mvc.perform(asAdmin(withKey(raw(post(MODELS), body)))), "description", marker);
            assertEquals(0, modelsContaining(marker), describe(character));
        }

        Map<String, Object> multiline = modelBody("Multiligne " + suffix);
        multiline.put("description", "Ligne 1\r\nLigne 2\n\tRetrait");
        postModel(multiline)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.description").value("Ligne 1\r\nLigne 2\n\tRetrait"));
    }

    @Test
    void modelReplacementRefusesAControlCharacterAndKeepsTheModel() throws Exception {
        String id = createModel("Remplacement contrôle " + suffix);

        for (String field : List.of("name", "manufacturer", "modelNumber", "description")) {
            for (String character : List.of("\u0000", "\u0001", LONE_SURROGATE)) {
                String marker = marker();
                Map<String, Object> body = modelBody("Remplacement contrôle " + suffix);
                body.put(field, "A" + marker + character + "B");
                expectInvalidValue(mvc.perform(asAdmin(raw(put(MODELS + "/" + id), body))), field, marker);
            }
        }
        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(jsonPath("$.name").value("Remplacement contrôle " + suffix))
                .andExpect(jsonPath("$.manufacturer").value("Fluke"))
                .andExpect(jsonPath("$.modelNumber").value("117"))
                .andExpect(jsonPath("$.description").value("Multimètre numérique"));
    }

    @Test
    void assetCreationRefusesAControlCharacterInTheCodeAndTheSerialNumber() throws Exception {
        String modelId = createModel("Actif contrôle " + suffix);

        for (String field : List.of("assetCode", "serialNumber")) {
            for (String character : REFUSED) {
                String marker = marker();
                Map<String, Object> body = assetBody(modelId, "CTL-" + marker, "SN-" + marker);
                body.put(field, "A" + marker + character + "B");
                expectInvalidValue(mvc.perform(asAdmin(withKey(raw(post(ASSETS), body)))), field, marker);
                assertEquals(0, assetsContaining(marker), field + " " + describe(character));
            }
        }
    }

    @Test
    void assetReplacementRefusesAControlCharacterAndKeepsTheAsset() throws Exception {
        String modelId = createModel("Actif remplacement " + suffix);
        String id = createAsset(modelId, "CTL-" + suffix);

        for (String field : List.of("assetCode", "serialNumber")) {
            for (String character : List.of("\u0000", "\u0001", LONE_SURROGATE)) {
                String marker = marker();
                Map<String, Object> body = assetBody(modelId, "CTL-" + suffix, null);
                body.put(field, "A" + marker + character + "B");
                expectInvalidValue(mvc.perform(asAdmin(raw(put(ASSETS + "/" + id), body))), field, marker);
            }
        }
        mvc.perform(asAdmin(get(ASSETS + "/" + id)))
                .andExpect(jsonPath("$.assetCode").value("CTL-" + suffix))
                .andExpect(jsonPath("$.serialNumber").isEmpty());
    }

    @Test
    void assetSearchRefusesAControlCharacterBeforeAnySql() throws Exception {
        for (String character : List.of("\u0000", "\u0001", "\u001F", "\u007F", "\u0085", "\uD800")) {
            String marker = marker();
            expectInvalidValue(mvc.perform(asAdmin(get(ASSETS).param("q", marker + character + "b"))), "q", marker);
        }
        // A percent-encoded NUL in the query string, as a browser or a client library sends it.
        String marker = marker();
        expectInvalidValue(mvc.perform(asAdmin(get(URI.create(ASSETS + "?q=" + marker + "%00b")))), "q", marker);
    }

    /** The security firewall refuses most of them when the header is read; it lets a tabulation through. */
    @Test
    void anIdempotencyKeyWithAControlCharacterIsRefusedAndLeavesNoKey() throws Exception {
        for (String character : List.of("\u0000", "\u0001", "\t", "\n", "\u007F", "\u0085")) {
            String marker = marker();
            expectInvalidValue(mvc.perform(asAdmin(json(post(MODELS), modelBody("Clé " + marker))
                    .header(IDEMPOTENCY_KEY, "key-" + marker + character))), IDEMPOTENCY_KEY, marker);
            assertEquals(0, modelsContaining(marker));
            assertEquals(0L, jdbc.sql(
                    "SELECT count(*) FROM aegis.rest_idempotency_keys WHERE idempotency_key LIKE :key")
                    .param("key", "key-" + marker + "%")
                    .query(Long.class)
                    .single());
        }
    }

    private static String marker() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static void expectInvalidValue(ResultActions result, String field, String echoed) throws Exception {
        String body = result.andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value(field))
                .andExpect(jsonPath("$.violations[0].code").value("INVALID_VALUE"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertFalse(body.contains(echoed), "the problem must not echo the refused value");
    }

    /** A body whose lone-surrogate placeholder becomes a JSON escape, so that it reaches the server unchanged. */
    private MockHttpServletRequestBuilder raw(MockHttpServletRequestBuilder request, Map<String, Object> body) {
        String text = jsonMapper.writeValueAsString(body).replace(LONE_SURROGATE, "\\uD800");
        return request.contentType(MediaType.APPLICATION_JSON).content(text.getBytes(StandardCharsets.UTF_8));
    }

    private long modelsContaining(String marker) {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE concat(name, manufacturer, model_number, "
                + "description) LIKE :marker")
                .param("marker", "%" + marker + "%")
                .query(Long.class)
                .single();
    }

    private long assetsContaining(String marker) {
        return jdbc.sql("SELECT count(*) FROM aegis.assets WHERE concat(asset_code, serial_number) LIKE :marker")
                .param("marker", "%" + marker + "%")
                .query(Long.class)
                .single();
    }

    private static String describe(String character) {
        return character.equals(LONE_SURROGATE) ? "U+D800" : String.format("U+%04X", (int) character.charAt(0));
    }
}
