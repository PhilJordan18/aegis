package ca.aegis.control.asset;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Document 09, section 12.1, through the HTTP API with its security filter. */
class AdminAssetModelApiTests extends CatalogApiTest {

    @Test
    void administratorCreatesReadsAndEditsAModel() throws Exception {
        ResultActions created = postModel(modelBody("Multimètre " + suffix));
        String id = id(created);
        created.andExpect(status().isCreated())
                .andExpect(header().string("Location", MODELS + "/" + id))
                .andExpect(jsonPath("$.name").value("Multimètre " + suffix))
                .andExpect(jsonPath("$.manufacturer").value("Fluke"))
                .andExpect(jsonPath("$.modelNumber").value("117"))
                .andExpect(jsonPath("$.description").value("Multimètre numérique"))
                .andExpect(jsonPath("$.defaultCalibrationRequired").value(true))
                .andExpect(jsonPath("$.archivedAt").isEmpty());

        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.name").value("Multimètre " + suffix));

        Map<String, Object> edited = modelBody("  Multimètre Pro " + suffix + "  ");
        edited.put("manufacturer", "   ");
        edited.put("modelNumber", null);
        edited.put("defaultCalibrationRequired", false);
        putModel(id, edited)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Multimètre Pro " + suffix))
                .andExpect(jsonPath("$.manufacturer").isEmpty())
                .andExpect(jsonPath("$.modelNumber").isEmpty())
                .andExpect(jsonPath("$.defaultCalibrationRequired").value(false));
        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(jsonPath("$.name").value("Multimètre Pro " + suffix))
                .andExpect(jsonPath("$.manufacturer").isEmpty());
    }

    @Test
    void identicalReplacementChangesNothing() throws Exception {
        String id = createModel("Oscilloscope " + suffix);
        Instant before = updatedAt(id);

        clock.advance(Duration.ofMinutes(5));
        putModel(id, modelBody("Oscilloscope " + suffix)).andExpect(status().isOk());
        assertEquals(before, updatedAt(id));

        putModel(id, modelBody("Oscilloscope 2 " + suffix)).andExpect(status().isOk());
        assertEquals(START.plus(Duration.ofMinutes(5)), updatedAt(id));
    }

    @Test
    void creationAndArchivalRequireAnIdempotencyKey() throws Exception {
        String name = "Sans clé " + suffix;
        mvc.perform(asAdmin(json(post(MODELS), modelBody(name))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mvc.perform(asAdmin(json(post(MODELS), modelBody(name)).header(IDEMPOTENCY_KEY, "  ")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mvc.perform(asAdmin(json(post(MODELS), modelBody(name)).header(IDEMPOTENCY_KEY, "k".repeat(129))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations[0].field").value(IDEMPOTENCY_KEY));
        assertEquals(0, count("asset_models", "name", name));

        mvc.perform(asAdmin(json(post(MODELS), modelBody(name)).header(IDEMPOTENCY_KEY, "k".repeat(128))))
                .andExpect(status().isCreated());

        String id = createModel("Archivage sans clé " + suffix);
        mvc.perform(asAdmin(post(MODELS + "/" + id + "/archive")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mvc.perform(asAdmin(get(MODELS + "/" + id))).andExpect(jsonPath("$.archivedAt").isEmpty());
    }

    @Test
    void invalidModelsAreRefusedWithFieldViolations() throws Exception {
        Map<String, Object> blank = modelBody("   ");
        postModel(blank)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations[0].field").value("name"))
                .andExpect(jsonPath("$.violations[0].code").value("NOT_BLANK"));

        Map<String, Object> tooLong = modelBody("n".repeat(161));
        tooLong.put("manufacturer", "m".repeat(121));
        tooLong.put("modelNumber", "x".repeat(121));
        tooLong.put("description", "d".repeat(2001));
        tooLong.remove("defaultCalibrationRequired");
        postModel(tooLong)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations.length()").value(5))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("defaultCalibrationRequired")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("description")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("manufacturer")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("modelNumber")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("name")));

        Map<String, Object> atLimits = modelBody("n".repeat(150) + suffix);
        atLimits.put("manufacturer", "m".repeat(120));
        atLimits.put("modelNumber", "x".repeat(120));
        atLimits.put("description", "d".repeat(2000));
        postModel(atLimits).andExpect(status().isCreated());

        Map<String, Object> unknownField = modelBody("Inconnu " + suffix);
        unknownField.put("ready", true);
        postModel(unknownField)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("ready"))
                .andExpect(jsonPath("$.violations[0].code").value("UNKNOWN_FIELD"));

        Map<String, Object> wrongType = modelBody("Type " + suffix);
        wrongType.put("defaultCalibrationRequired", "maybe");
        postModel(wrongType)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("defaultCalibrationRequired"));

        mvc.perform(asAdmin(withKey(post(MODELS).contentType("application/json").content("{"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("MALFORMED_BODY"));
        assertEquals(0, count("asset_models", "name", "Inconnu " + suffix));
    }

    @Test
    void activeModelNamesAreUniqueWithoutCase() throws Exception {
        String first = createModel("Pince " + suffix);
        String other = createModel("Pince bis " + suffix);

        postModel(modelBody("  PINCE " + suffix + " "))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_MODEL_NAME_ALREADY_EXISTS"))
                .andExpect(jsonPath("$.detail").isNotEmpty());
        putModel(other, modelBody("pince " + suffix))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_MODEL_NAME_ALREADY_EXISTS"));
        mvc.perform(asAdmin(get(MODELS + "/" + other))).andExpect(jsonPath("$.name").value("Pince bis " + suffix));

        archiveModel(first).andExpect(status().isOk());
        postModel(modelBody("Pince " + suffix)).andExpect(status().isCreated());
    }

    @Test
    void archivedModelKeepsItsDataAndCannotBeEdited() throws Exception {
        String id = createModel("Archivé " + suffix);
        clock.advance(Duration.ofMinutes(20));
        Instant archivedAt = START.plus(Duration.ofMinutes(20));

        archiveModel(id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()))
                .andExpect(jsonPath("$.name").value("Archivé " + suffix));

        // A new key on an archived model: no new business change.
        clock.advance(Duration.ofMinutes(10));
        archiveModel(id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()));
        assertEquals(archivedAt, updatedAt(id));
        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()));
        putModel(id, modelBody("Renommé " + suffix))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_MODEL_ARCHIVED"));
        assertEquals(1, count("asset_models", "name", "Archivé " + suffix));
    }

    @Test
    void modelUsedByAnUnarchivedAssetCannotBeArchived() throws Exception {
        String model = createModel("Utilisé " + suffix);
        String asset = createAsset(model, "U-" + suffix);

        archiveModel(model)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_MODEL_IN_USE"));
        mvc.perform(asAdmin(get(MODELS + "/" + model))).andExpect(jsonPath("$.archivedAt").isEmpty());

        archiveAsset(asset).andExpect(status().isOk());
        archiveModel(model).andExpect(status().isOk()).andExpect(jsonPath("$.archivedAt").isNotEmpty());
        mvc.perform(asAdmin(get(ASSETS + "/" + asset)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.model.id").value(model));
    }

    @Test
    void listIsPagedAndKeepsArchivedModels() throws Exception {
        String archived = createModel("AAA archivé " + suffix);
        archiveModel(archived).andExpect(status().isOk());

        mvc.perform(asAdmin(get(MODELS)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.items.length()").value(lessThanOrEqualTo(20)));

        long total = jdbc.sql("SELECT count(*) FROM aegis.asset_models").query(Long.class).single();
        mvc.perform(asAdmin(get(MODELS).param("page", "0").param("size", "100")))
                .andExpect(jsonPath("$.totalItems").value((int) total))
                .andExpect(jsonPath("$.totalPages").value((int) ((total + 99) / 100)))
                .andExpect(jsonPath("$.items[*].id").value(hasItem(archived)));
        mvc.perform(asAdmin(get(MODELS).param("page", "1").param("size", "1")))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.totalPages").value((int) total));
        mvc.perform(asAdmin(get(MODELS).param("q", "ignored").param("sort", "name")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalItems").value((int) total));

        for (String[] invalid : new String[][] {{"page", "-1"}, {"size", "0"}, {"size", "101"}, {"page", "x"}}) {
            mvc.perform(asAdmin(get(MODELS).param(invalid[0], invalid[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.violations[*].field").value(everyItem(is(invalid[0]))));
        }
    }

    @Test
    void unknownModelIsNotFound() throws Exception {
        String missing = UUID.randomUUID().toString();
        mvc.perform(asAdmin(get(MODELS + "/" + missing)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        putModel(missing, modelBody("Absent " + suffix)).andExpect(status().isNotFound());
        archiveModel(missing).andExpect(status().isNotFound());
    }

    @Test
    void techniciansAndAnonymousCallersCannotUseTheModelRoutes() throws Exception {
        String id = createModel("Protégé " + suffix);
        String technician = accessToken(accounts.technician());
        String name = "Interdit " + suffix;

        for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
                get(MODELS), get(MODELS + "/" + id), withKey(json(post(MODELS), modelBody(name))),
                json(put(MODELS + "/" + id), modelBody(name)), withKey(post(MODELS + "/" + id + "/archive"))}) {
            mvc.perform(request.header(AUTHORIZATION, bearer(technician)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        }
        for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
                get(MODELS), get(MODELS + "/" + id), withKey(json(post(MODELS), modelBody(name))),
                json(put(MODELS + "/" + id), modelBody(name)), withKey(post(MODELS + "/" + id + "/archive"))}) {
            mvc.perform(request)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }

        assertEquals(0, count("asset_models", "name", name));
        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(jsonPath("$.name").value("Protégé " + suffix))
                .andExpect(jsonPath("$.archivedAt").isEmpty());
    }

    private Instant updatedAt(String id) {
        return jdbc.sql("SELECT updated_at FROM aegis.asset_models WHERE id = :id")
                .param("id", UUID.fromString(id))
                .query((row, number) -> row.getObject(1, OffsetDateTime.class).toInstant())
                .single();
    }
}
