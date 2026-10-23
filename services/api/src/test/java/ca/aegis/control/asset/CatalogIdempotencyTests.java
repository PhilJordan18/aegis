package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.identity.Role;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * The four catalog mutations of document 09, section 20.1, wired to the shared idempotency service: replay, reuse
 * with another intent, authorization before any replay, scope per actor, refusals that leave no key, and the
 * mandatory header. Every test goes through the real routes and their security filter.
 */
class CatalogIdempotencyTests extends CatalogApiTest {

    static final String REPLAYED = "Idempotency-Replayed";

    @Test
    void aRepeatedAssetCreationReplaysTheOriginalResponseWithOneAsset() throws Exception {
        String model = createModel("Rejeu actif " + suffix);
        String key = UUID.randomUUID().toString();
        String code = "RPL-" + suffix;
        Map<String, Object> body = assetBody(model, code, "SN-RPL-" + suffix);

        MockHttpServletResponse first = send(admin(keyed(json(post(ASSETS), body), key)));
        clock.advance(Duration.ofMinutes(10));
        MockHttpServletResponse replay = send(admin(keyed(json(post(ASSETS), body), key)));

        assertEquals(201, first.getStatus());
        String id = read(first).get("id").asString();
        assertEquals(ASSETS + "/" + id, first.getHeader(HttpHeaders.LOCATION));
        assertNull(first.getHeader(REPLAYED));
        assertEquals(201, replay.getStatus());
        assertEquals(read(first), read(replay));
        assertEquals(first.getHeader(HttpHeaders.LOCATION), replay.getHeader(HttpHeaders.LOCATION));
        assertEquals(MediaType.APPLICATION_JSON_VALUE, replay.getContentType());
        assertEquals("true", replay.getHeader(REPLAYED));
        // A new execution would evaluate the diagnostic ten minutes later.
        assertEquals(START.toString(), read(replay).get("operationalDiagnostic").get("evaluatedAt").asString());

        assertEquals(1, count("assets", "asset_code", code));
        assertEquals(Map.of("endpoint", "POST /admin/assets", "status", "COMPLETED", "response_status", 201,
                "resource_type", "ASSET", "resource_id", id), storedKey(admin, key));
    }

    @Test
    void aRepeatedModelCreationReplaysTheOriginalResponseWithOneModel() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Rejeu modèle " + suffix;

        MockHttpServletResponse first = send(admin(keyed(json(post(MODELS), modelBody(name)), key)));
        MockHttpServletResponse replay = send(admin(keyed(json(post(MODELS), modelBody(name)), key)));

        assertEquals(201, first.getStatus());
        String id = read(first).get("id").asString();
        assertEquals(MODELS + "/" + id, first.getHeader(HttpHeaders.LOCATION));
        assertNull(first.getHeader(REPLAYED));
        assertEquals(201, replay.getStatus());
        assertEquals(read(first), read(replay));
        assertEquals(first.getHeader(HttpHeaders.LOCATION), replay.getHeader(HttpHeaders.LOCATION));
        assertEquals("true", replay.getHeader(REPLAYED));

        assertEquals(1, count("asset_models", "name", name));
        assertEquals(Map.of("endpoint", "POST /admin/asset-models", "status", "COMPLETED", "response_status", 201,
                "resource_type", "ASSET_MODEL", "resource_id", id), storedKey(admin, key));
    }

    @Test
    void aRepeatedArchivalReplaysItsResponse() throws Exception {
        String model = createModel("Rejeu archivage " + suffix);
        String asset = createAsset(model, "ARC-" + suffix);
        String assetKey = UUID.randomUUID().toString();

        MockHttpServletResponse first = send(admin(keyed(post(ASSETS + "/" + asset + "/archive"), assetKey)));
        clock.advance(Duration.ofMinutes(10));
        MockHttpServletResponse replay = send(admin(keyed(post(ASSETS + "/" + asset + "/archive"), assetKey)));

        assertEquals(200, first.getStatus());
        assertEquals(START.toString(), read(first).get("archivedAt").asString());
        assertNull(first.getHeader(HttpHeaders.LOCATION));
        assertNull(first.getHeader(REPLAYED));
        assertEquals(200, replay.getStatus());
        assertEquals(read(first), read(replay));
        assertNull(replay.getHeader(HttpHeaders.LOCATION));
        assertEquals("true", replay.getHeader(REPLAYED));
        assertEquals(START.toString(), read(replay).get("operationalDiagnostic").get("evaluatedAt").asString());
        Map<String, Object> stored = storedKey(admin, assetKey);
        assertEquals("POST /admin/assets/{assetId}/archive", stored.get("endpoint"));
        assertEquals(200, stored.get("response_status"));
        assertNull(stored.get("resource_type"));

        String modelKey = UUID.randomUUID().toString();
        MockHttpServletResponse modelFirst = send(admin(keyed(post(MODELS + "/" + model + "/archive"), modelKey)));
        MockHttpServletResponse modelReplay = send(admin(keyed(post(MODELS + "/" + model + "/archive"), modelKey)));
        assertEquals(200, modelFirst.getStatus());
        assertNull(modelFirst.getHeader(REPLAYED));
        assertEquals(200, modelReplay.getStatus());
        assertEquals(read(modelFirst), read(modelReplay));
        assertEquals("true", modelReplay.getHeader(REPLAYED));
        assertEquals("POST /admin/asset-models/{modelId}/archive", storedKey(admin, modelKey).get("endpoint"));
    }

    @Test
    void theSameKeyWithAnotherBodyIsRefusedWithoutEffect() throws Exception {
        String model = createModel("Autre corps " + suffix);
        String key = UUID.randomUUID().toString();
        assertEquals(201, send(admin(keyed(json(post(ASSETS), assetBody(model, "BODY1-" + suffix, null)), key)))
                .getStatus());

        MockHttpServletResponse reused = send(admin(keyed(json(post(ASSETS),
                assetBody(model, "BODY2-" + suffix, null)), key)));

        assertProblem(reused, 409, "IDEMPOTENCY_KEY_REUSED");
        assertNull(reused.getHeader(REPLAYED));
        assertEquals(0, count("assets", "asset_code", "BODY2-" + suffix));

        String modelKey = UUID.randomUUID().toString();
        assertEquals(201, send(admin(keyed(json(post(MODELS), modelBody("Corps 1 " + suffix)), modelKey)))
                .getStatus());
        assertProblem(send(admin(keyed(json(post(MODELS), modelBody("Corps 2 " + suffix)), modelKey))), 409,
                "IDEMPOTENCY_KEY_REUSED");
        assertEquals(0, count("asset_models", "name", "Corps 2 " + suffix));
    }

    @Test
    void theSameKeyOnTheArchivalOfAnotherResourceIsRefusedWithoutEffect() throws Exception {
        String model = createModel("Autre ressource " + suffix);
        String archived = createAsset(model, "PATH1-" + suffix);
        String other = createAsset(model, "PATH2-" + suffix);
        String key = UUID.randomUUID().toString();
        assertEquals(200, send(admin(keyed(post(ASSETS + "/" + archived + "/archive"), key))).getStatus());

        assertProblem(send(admin(keyed(post(ASSETS + "/" + other + "/archive"), key))), 409,
                "IDEMPOTENCY_KEY_REUSED");
        assertTrue(archivedAtIsNull("assets", other));

        String firstModel = createModel("Modèle 1 " + suffix);
        String otherModel = createModel("Modèle 2 " + suffix);
        String modelKey = UUID.randomUUID().toString();
        assertEquals(200, send(admin(keyed(post(MODELS + "/" + firstModel + "/archive"), modelKey))).getStatus());
        assertProblem(send(admin(keyed(post(MODELS + "/" + otherModel + "/archive"), modelKey))), 409,
                "IDEMPOTENCY_KEY_REUSED");
        assertTrue(archivedAtIsNull("asset_models", otherModel));
    }

    @Test
    void rightsAreCheckedOnEveryAttemptBeforeAnyReplay() throws Exception {
        String model = createModel("Droits " + suffix);
        String key = UUID.randomUUID().toString();
        Map<String, Object> body = assetBody(model, "RIGHTS-" + suffix, null);
        MockHttpServletResponse original = send(admin(keyed(json(post(ASSETS), body), key)));
        assertEquals(201, original.getStatus());
        String id = read(original).get("id").asString();

        TestAccount technician = accounts.technician();
        MockHttpServletResponse forbidden = send(keyed(json(post(ASSETS), body), key)
                .header(AUTHORIZATION, bearer(accessToken(technician))));
        assertProblem(forbidden, 403, "FORBIDDEN");
        assertFalse(forbidden.getContentAsString(StandardCharsets.UTF_8).contains(id));
        assertNull(forbidden.getHeader(REPLAYED));
        assertNull(forbidden.getHeader(HttpHeaders.LOCATION));

        MockHttpServletResponse anonymous = send(keyed(json(post(ASSETS), body), key));
        assertProblem(anonymous, 401, "AUTH_TOKEN_INVALID");
        assertNull(anonymous.getHeader(REPLAYED));

        accounts.changeRole(admin.id(), Role.TECHNICIAN);
        MockHttpServletResponse downgraded = send(admin(keyed(json(post(ASSETS), body), key)));
        assertProblem(downgraded, 403, "FORBIDDEN");
        assertNull(downgraded.getHeader(REPLAYED));
        accounts.changeRole(admin.id(), Role.ADMIN);
        assertEquals("true", send(admin(keyed(json(post(ASSETS), body), key))).getHeader(REPLAYED));

        accounts.disable(admin.id());
        MockHttpServletResponse disabled = send(admin(keyed(json(post(ASSETS), body), key)));
        assertProblem(disabled, 401, "AUTH_TOKEN_INVALID");
        assertNull(disabled.getHeader(REPLAYED));

        assertEquals(1, count("assets", "asset_code", "RIGHTS-" + suffix));
        assertEquals(1, keyRows(admin.id(), key));
        assertEquals(0, keyRows(technician.id(), key));
    }

    @Test
    void anotherAdministratorWithTheSameKeyExecutesIndependently() throws Exception {
        String model = createModel("Deux admins " + suffix);
        String key = UUID.randomUUID().toString();
        Map<String, Object> body = assetBody(model, "TWO-" + suffix, null);
        String id = read(send(admin(keyed(json(post(ASSETS), body), key)))).get("id").asString();

        TestAccount otherAdmin = accounts.admin();
        String otherToken = accessToken(otherAdmin);
        MockHttpServletResponse sameBody = send(keyed(json(post(ASSETS), body), key)
                .header(AUTHORIZATION, bearer(otherToken)));
        // Executed, not replayed: the second actor meets the code the first one created.
        assertProblem(sameBody, 409, "ASSET_CODE_ALREADY_EXISTS");
        assertNull(sameBody.getHeader(REPLAYED));

        MockHttpServletResponse otherBody = send(keyed(json(post(ASSETS),
                assetBody(model, "TWO-B-" + suffix, null)), key).header(AUTHORIZATION, bearer(otherToken)));
        assertEquals(201, otherBody.getStatus());
        assertNull(otherBody.getHeader(REPLAYED));
        assertNotEquals(id, read(otherBody).get("id").asString());

        assertEquals(1, keyRows(admin.id(), key));
        assertEquals(1, keyRows(otherAdmin.id(), key));
    }

    @Test
    void aBusinessRefusalLeavesNoKeyAndARetryRunsAgainstTheCurrentState() throws Exception {
        String model = createModel("Refus " + suffix);
        String asset = createAsset(model, "DUP-" + suffix);

        String duplicateCode = UUID.randomUUID().toString();
        assertProblem(send(admin(keyed(json(post(ASSETS), assetBody(model, "dup-" + suffix, null)), duplicateCode))),
                409, "ASSET_CODE_ALREADY_EXISTS");
        assertEquals(0, keyRows(admin.id(), duplicateCode));

        String duplicateName = UUID.randomUUID().toString();
        assertProblem(send(admin(keyed(json(post(MODELS), modelBody("Refus " + suffix)), duplicateName))), 409,
                "ASSET_MODEL_NAME_ALREADY_EXISTS");
        assertEquals(0, keyRows(admin.id(), duplicateName));

        String inactiveModel = UUID.randomUUID().toString();
        assertProblem(send(admin(keyed(json(post(ASSETS), assetBody(UUID.randomUUID().toString(), "NOMOD-" + suffix,
                null)), inactiveModel))), 400, "VALIDATION_ERROR");
        assertEquals(0, keyRows(admin.id(), inactiveModel));

        String missing = UUID.randomUUID().toString();
        assertProblem(send(admin(keyed(post(ASSETS + "/" + UUID.randomUUID() + "/archive"), missing))), 404,
                "RESOURCE_NOT_FOUND");
        assertProblem(send(admin(keyed(post(MODELS + "/" + UUID.randomUUID() + "/archive"), missing))), 404,
                "RESOURCE_NOT_FOUND");
        assertEquals(0, keyRows(admin.id(), missing));

        String inUse = UUID.randomUUID().toString();
        assertProblem(send(admin(keyed(post(MODELS + "/" + model + "/archive"), inUse))), 409,
                "ASSET_MODEL_IN_USE");
        assertEquals(0, keyRows(admin.id(), inUse));
        assertTrue(archivedAtIsNull("asset_models", model));

        archiveAsset(asset).andExpect(status().isOk());
        MockHttpServletResponse retried = send(admin(keyed(post(MODELS + "/" + model + "/archive"), inUse)));
        assertEquals(200, retried.getStatus());
        assertNull(retried.getHeader(REPLAYED));
        assertEquals(1, keyRows(admin.id(), inUse));
    }

    @Test
    void everyCatalogMutationRequiresAKey() throws Exception {
        String model = createModel("Sans clé " + suffix);
        String asset = createAsset(model, "NOKEY-" + suffix);
        MockHttpServletRequestBuilder[] mutations = {
                json(post(MODELS), modelBody("Sans clé 2 " + suffix)),
                post(MODELS + "/" + model + "/archive"),
                json(post(ASSETS), assetBody(model, "NOKEY-2-" + suffix, null)),
                post(ASSETS + "/" + asset + "/archive")};
        for (MockHttpServletRequestBuilder mutation : mutations) {
            assertProblem(send(admin(mutation)), 400, "IDEMPOTENCY_KEY_REQUIRED");
        }
        for (MockHttpServletRequestBuilder mutation : new MockHttpServletRequestBuilder[] {
                keyed(json(post(MODELS), modelBody("Sans clé 2 " + suffix)), "   "),
                keyed(post(ASSETS + "/" + asset + "/archive"), "")}) {
            assertProblem(send(admin(mutation)), 400, "IDEMPOTENCY_KEY_REQUIRED");
        }
        MockHttpServletResponse tooLong = send(admin(keyed(post(ASSETS + "/" + asset + "/archive"), "k".repeat(129))));
        assertProblem(tooLong, 400, "VALIDATION_ERROR");
        assertEquals("Idempotency-Key", read(tooLong).get("violations").get(0).get("field").asString());

        assertEquals(0, count("asset_models", "name", "Sans clé 2 " + suffix));
        assertEquals(0, count("assets", "asset_code", "NOKEY-2-" + suffix));
        assertTrue(archivedAtIsNull("asset_models", model));
        assertTrue(archivedAtIsNull("assets", asset));
        assertEquals(0L, jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys WHERE actor_user_id = :actor"
                + " AND endpoint LIKE '%/archive'").param("actor", admin.id()).query(Long.class).single());
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return asAdmin(request);
    }

    private static MockHttpServletRequestBuilder keyed(MockHttpServletRequestBuilder request, String key) {
        return request.header(IDEMPOTENCY_KEY, key);
    }

    private MockHttpServletResponse send(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request).andReturn().getResponse();
    }

    private JsonNode read(MockHttpServletResponse response) throws Exception {
        return jsonMapper.readTree(response.getContentAsString(StandardCharsets.UTF_8));
    }

    private void assertProblem(MockHttpServletResponse response, int status, String code) throws Exception {
        assertEquals(status, response.getStatus(), () -> contentOf(response));
        assertEquals(code, read(response).get("code").asString());
    }

    private static String contentOf(MockHttpServletResponse response) {
        try {
            return response.getContentAsString(StandardCharsets.UTF_8);
        } catch (Exception unreadable) {
            return unreadable.toString();
        }
    }

    /** The stored row without its null columns. */
    private Map<String, Object> storedKey(TestAccount actor, String key) {
        return Map.copyOf(jdbc.sql("""
                SELECT endpoint, status, response_status, coalesce(resource_type, '') AS resource_type,
                       coalesce(resource_id::text, '') AS resource_id
                FROM aegis.rest_idempotency_keys WHERE actor_user_id = :actor AND idempotency_key = :key
                """).param("actor", actor.id()).param("key", key).query().singleRow()).entrySet().stream()
                .filter(entry -> !"".equals(entry.getValue()))
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private long keyRows(UUID actor, String key) {
        return jdbc.sql("""
                SELECT count(*) FROM aegis.rest_idempotency_keys
                WHERE actor_user_id = :actor AND idempotency_key = :key
                """).param("actor", actor).param("key", key).query(Long.class).single();
    }

    private boolean archivedAtIsNull(String table, String id) {
        return jdbc.sql("SELECT archived_at IS NULL FROM aegis." + table + " WHERE id = :id")
                .param("id", UUID.fromString(id))
                .query(Boolean.class)
                .single();
    }
}
