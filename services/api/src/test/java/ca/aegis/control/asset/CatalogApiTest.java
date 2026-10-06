package ca.aegis.control.asset;

import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * Catalog API tests share one database per run, so every model name, asset code and serial number is made unique
 * with a random suffix.
 */
abstract class CatalogApiTest extends ApiIntegrationTest {

    static final String MODELS = "/api/v1/admin/asset-models";
    static final String ASSETS = "/api/v1/admin/assets";
    static final String IDEMPOTENCY_KEY = "Idempotency-Key";

    @Autowired
    JdbcClient jdbc;

    String adminToken;
    String suffix;

    @BeforeEach
    void signInAsAdministrator() throws Exception {
        adminToken = accessToken(accounts.admin());
        suffix = UUID.randomUUID().toString().substring(0, 8);
    }

    static Map<String, Object> modelBody(String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("manufacturer", "Fluke");
        body.put("modelNumber", "117");
        body.put("description", "Multimètre numérique");
        body.put("defaultCalibrationRequired", true);
        return body;
    }

    static Map<String, Object> assetBody(String modelId, String assetCode, String serialNumber) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("assetModelId", modelId);
        body.put("assetCode", assetCode);
        body.put("serialNumber", serialNumber);
        body.put("requiredAccessLevel", "STANDARD");
        body.put("operationalStatus", "SERVICEABLE");
        body.put("calibrationRequired", true);
        body.put("calibrationDueAt", "2026-12-01T05:00:00Z");
        return body;
    }

    MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, Object body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(body));
    }

    MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder request) {
        return request.header(AUTHORIZATION, bearer(adminToken));
    }

    MockHttpServletRequestBuilder withKey(MockHttpServletRequestBuilder request) {
        return request.header(IDEMPOTENCY_KEY, UUID.randomUUID().toString());
    }

    ResultActions postModel(Object body) throws Exception {
        return mvc.perform(asAdmin(withKey(json(post(MODELS), body))));
    }

    ResultActions putModel(String id, Object body) throws Exception {
        return mvc.perform(asAdmin(json(put(MODELS + "/" + id), body)));
    }

    ResultActions archiveModel(String id) throws Exception {
        return mvc.perform(asAdmin(withKey(post(MODELS + "/" + id + "/archive"))));
    }

    ResultActions postAsset(Object body) throws Exception {
        return mvc.perform(asAdmin(withKey(json(post(ASSETS), body))));
    }

    ResultActions putAsset(String id, Object body) throws Exception {
        return mvc.perform(asAdmin(json(put(ASSETS + "/" + id), body)));
    }

    ResultActions archiveAsset(String id) throws Exception {
        return mvc.perform(asAdmin(withKey(post(ASSETS + "/" + id + "/archive"))));
    }

    String createModel(String name) throws Exception {
        return id(postModel(modelBody(name)).andExpect(status().isCreated()));
    }

    String createAsset(String modelId, String assetCode) throws Exception {
        return id(postAsset(assetBody(modelId, assetCode, null)).andExpect(status().isCreated()));
    }

    static String id(ResultActions result) throws Exception {
        return JsonPath.read(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), "$.id");
    }

    long count(String table, String column, String value) {
        return jdbc.sql("SELECT count(*) FROM aegis." + table + " WHERE " + column + " = :value")
                .param("value", value)
                .query(Long.class)
                .single();
    }
}
