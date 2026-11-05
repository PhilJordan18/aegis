package ca.aegis.control.asset;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
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

/** Document 09, sections 8.9 and 12.2, through the HTTP API with its security filter. */
class AdminAssetApiTests extends CatalogApiTest {

    @Test
    void administratorDescribesTheDemoUnitsOfAModel() throws Exception {
        String model = createModel("Multimètre démo " + suffix);
        String a1Code = "A1-" + suffix;

        ResultActions a1 = postAsset(assetBody(model, a1Code, "SN-A1-" + suffix));
        String a1Id = id(a1);
        a1.andExpect(status().isCreated())
                .andExpect(header().string("Location", ASSETS + "/" + a1Id))
                .andExpect(jsonPath("$.assetCode").value(a1Code))
                .andExpect(jsonPath("$.serialNumber").value("SN-A1-" + suffix))
                .andExpect(jsonPath("$.model.id").value(model))
                .andExpect(jsonPath("$.model.name").value("Multimètre démo " + suffix))
                .andExpect(jsonPath("$.model.manufacturer").value("Fluke"))
                .andExpect(jsonPath("$.model.modelNumber").value("117"))
                .andExpect(jsonPath("$.model.description").doesNotExist())
                .andExpect(jsonPath("$.requiredAccessLevel").value("STANDARD"))
                .andExpect(jsonPath("$.operationalStatus").value("SERVICEABLE"))
                .andExpect(jsonPath("$.calibration.required").value(true))
                .andExpect(jsonPath("$.calibration.dueAt").value("2026-12-01T05:00:00Z"))
                .andExpect(jsonPath("$.calibration.status").value("VALID"))
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.presence").value("UNKNOWN"))
                .andExpect(jsonPath("$.placement").isEmpty())
                .andExpect(jsonPath("$.operationalDiagnostic.evaluatedAt").value(START.toString()))
                .andExpect(jsonPath("$.operationalDiagnostic.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")))
                .andExpect(jsonPath("$.archivedAt").isEmpty())
                .andExpect(jsonPath("$.readiness").doesNotExist())
                .andExpect(jsonPath("$.canCheckout").doesNotExist());

        Map<String, Object> a2 = assetBody(model, "A2-" + suffix, null);
        a2.put("requiredAccessLevel", "RESTRICTED");
        a2.put("calibrationRequired", false);
        a2.put("calibrationDueAt", null);
        String a2Id = id(postAsset(a2)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.serialNumber").isEmpty())
                .andExpect(jsonPath("$.requiredAccessLevel").value("RESTRICTED"))
                .andExpect(jsonPath("$.calibration.required").value(false))
                .andExpect(jsonPath("$.calibration.dueAt").isEmpty())
                .andExpect(jsonPath("$.calibration.status").value("NOT_REQUIRED")));

        mvc.perform(asAdmin(get(ASSETS + "/" + a1Id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetCode").value(a1Code));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalItems").value(2))
                .andExpect(jsonPath("$.items[*].id").value(contains(a1Id, a2Id)));
    }

    @Test
    void administratorEditsAnAssetAndAnIdenticalReplacementChangesNothing() throws Exception {
        String model = createModel("Caméra " + suffix);
        String otherModel = createModel("Caméra thermique " + suffix);
        Map<String, Object> body = assetBody(model, "CAM-" + suffix, "SN-CAM-" + suffix);
        String id = id(postAsset(body).andExpect(status().isCreated()));

        clock.advance(Duration.ofMinutes(10));
        putAsset(id, body).andExpect(status().isOk());
        assertEquals(START, updatedAt(id));

        Map<String, Object> edited = assetBody(otherModel, " cam-edit-" + suffix + " ", "  ");
        edited.put("operationalStatus", "MAINTENANCE");
        edited.put("calibrationDueAt", "2026-09-01T00:00:00Z");
        putAsset(id, edited)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetCode").value("cam-edit-" + suffix))
                .andExpect(jsonPath("$.serialNumber").isEmpty())
                .andExpect(jsonPath("$.model.id").value(otherModel))
                .andExpect(jsonPath("$.operationalStatus").value("MAINTENANCE"))
                .andExpect(jsonPath("$.calibration.status").value("EXPIRED"))
                .andExpect(jsonPath("$.operationalDiagnostic.reasons").value(
                        contains("MAINTENANCE", "CALIBRATION_EXPIRED", "UNKNOWN_PHYSICAL_STATE")));
        assertEquals(START.plus(Duration.ofMinutes(10)), updatedAt(id));

        edited.put("operationalStatus", "DAMAGED");
        putAsset(id, edited)
                .andExpect(jsonPath("$.operationalDiagnostic.reasons").value(
                        contains("DAMAGED", "CALIBRATION_EXPIRED", "UNKNOWN_PHYSICAL_STATE")));
    }

    @Test
    void creationAndArchivalRequireAnIdempotencyKey() throws Exception {
        String model = createModel("Clé " + suffix);
        String code = "KEY-" + suffix;

        mvc.perform(asAdmin(json(post(ASSETS), assetBody(model, code, null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        assertEquals(0, count("assets", "asset_code", code));

        String id = createAsset(model, code);
        mvc.perform(asAdmin(post(ASSETS + "/" + id + "/archive")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mvc.perform(asAdmin(get(ASSETS + "/" + id))).andExpect(jsonPath("$.archivedAt").isEmpty());
    }

    @Test
    void invalidAssetsAreRefusedWithFieldViolations() throws Exception {
        String model = createModel("Validation " + suffix);

        Map<String, Object> missing = assetBody(model, " ", null);
        missing.remove("assetModelId");
        missing.remove("requiredAccessLevel");
        missing.remove("operationalStatus");
        missing.remove("calibrationRequired");
        postAsset(missing)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(5))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("assetCode")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("assetModelId")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("calibrationRequired")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("operationalStatus")))
                .andExpect(jsonPath("$.violations[*].field").value(hasItem("requiredAccessLevel")));

        postAsset(assetBody(model, "c".repeat(65), "s".repeat(121)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("assetCode"))
                .andExpect(jsonPath("$.violations[0].code").value("SIZE"))
                .andExpect(jsonPath("$.violations[1].field").value("serialNumber"));

        Map<String, Object> noDueDate = assetBody(model, "CAL-" + suffix, null);
        noDueDate.put("calibrationDueAt", null);
        postAsset(noDueDate)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("calibrationDueAt"))
                .andExpect(jsonPath("$.violations[0].code").value("REQUIRED_WHEN_CALIBRATION_REQUIRED"));

        Map<String, Object> dueDateWithoutCalibration = assetBody(model, "CAL-" + suffix, null);
        dueDateWithoutCalibration.put("calibrationRequired", false);
        postAsset(dueDateWithoutCalibration)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("NOT_ALLOWED_WITHOUT_CALIBRATION"));

        Map<String, Object> readiness = assetBody(model, "RDY-" + suffix, null);
        readiness.put("readiness", "READY");
        postAsset(readiness)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("readiness"))
                .andExpect(jsonPath("$.violations[0].code").value("UNKNOWN_FIELD"));

        Map<String, Object> badEnum = assetBody(model, "ENUM-" + suffix, null);
        badEnum.put("operationalStatus", "BROKEN");
        postAsset(badEnum)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("operationalStatus"))
                .andExpect(jsonPath("$.violations[0].code").value("INVALID_VALUE"));

        Map<String, Object> badInstant = assetBody(model, "DATE-" + suffix, null);
        badInstant.put("calibrationDueAt", "next week");
        postAsset(badInstant)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("calibrationDueAt"));

        postAsset(assetBody(UUID.randomUUID().toString(), "NOMODEL-" + suffix, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("assetModelId"))
                .andExpect(jsonPath("$.violations[0].code").value("ASSET_MODEL_NOT_ACTIVE"));

        String archivedModel = createModel("Modèle archivé " + suffix);
        archiveModel(archivedModel).andExpect(status().isOk());
        postAsset(assetBody(archivedModel, "ARCH-" + suffix, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("ASSET_MODEL_NOT_ACTIVE"));

        for (String code : new String[] {"CAL-", "RDY-", "ENUM-", "DATE-", "NOMODEL-", "ARCH-"}) {
            assertEquals(0, count("assets", "asset_code", code + suffix), code);
        }

        String id = createAsset(model, "EDIT-" + suffix);
        putAsset(id, assetBody(archivedModel, "EDIT-" + suffix, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("ASSET_MODEL_NOT_ACTIVE"));
        mvc.perform(asAdmin(get(ASSETS + "/" + id))).andExpect(jsonPath("$.model.id").value(model));
    }

    @Test
    void assetCodesAreUniqueWithoutCaseAndSerialNumbersAreUnique() throws Exception {
        String model = createModel("Unicité " + suffix);
        postAsset(assetBody(model, "UQ-" + suffix, "SN-UQ-" + suffix)).andExpect(status().isCreated());
        String other = id(postAsset(assetBody(model, "UQ2-" + suffix, "SN-UQ2-" + suffix)));

        postAsset(assetBody(model, "uq-" + suffix.toUpperCase(), null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_CODE_ALREADY_EXISTS"));
        postAsset(assetBody(model, "UQ3-" + suffix, "SN-UQ-" + suffix))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_SERIAL_NUMBER_ALREADY_EXISTS"))
                .andExpect(jsonPath("$.detail").isNotEmpty());
        putAsset(other, assetBody(model, "UQ-" + suffix, "SN-UQ2-" + suffix))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_CODE_ALREADY_EXISTS"));
        putAsset(other, assetBody(model, "UQ2-" + suffix, "SN-UQ-" + suffix))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_SERIAL_NUMBER_ALREADY_EXISTS"));

        assertEquals(0, count("assets", "asset_code", "UQ3-" + suffix));
        mvc.perform(asAdmin(get(ASSETS + "/" + other)))
                .andExpect(jsonPath("$.assetCode").value("UQ2-" + suffix))
                .andExpect(jsonPath("$.serialNumber").value("SN-UQ2-" + suffix));
    }

    @Test
    void archivedAssetKeepsItsHistoryAndCannotBeEdited() throws Exception {
        String model = createModel("Historique " + suffix);
        Map<String, Object> body = assetBody(model, "HIST-" + suffix, "SN-HIST-" + suffix);
        String id = id(postAsset(body));
        clock.advance(Duration.ofMinutes(20));
        Instant archivedAt = START.plus(Duration.ofMinutes(20));

        archiveAsset(id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()))
                .andExpect(jsonPath("$.availability").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.operationalDiagnostic.reasons").value(
                        contains("NOT_AVAILABLE", "UNKNOWN_PHYSICAL_STATE")));

        // A new key on an archived asset: no new business change, the derived fields are evaluated again.
        clock.advance(Duration.ofMinutes(10));
        archiveAsset(id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()))
                .andExpect(jsonPath("$.operationalDiagnostic.evaluatedAt")
                        .value(archivedAt.plus(Duration.ofMinutes(10)).toString()));
        assertEquals(archivedAt, updatedAt(id));
        mvc.perform(asAdmin(get(ASSETS + "/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetCode").value("HIST-" + suffix))
                .andExpect(jsonPath("$.serialNumber").value("SN-HIST-" + suffix))
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()));
        mvc.perform(asAdmin(get(ASSETS).param("q", "HIST-" + suffix)))
                .andExpect(jsonPath("$.items[0].id").value(id));

        body.put("operationalStatus", "DAMAGED");
        putAsset(id, body)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_ARCHIVED"));
        postAsset(assetBody(model, "hist-" + suffix, null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_CODE_ALREADY_EXISTS"));
        assertEquals(1, count("assets", "asset_code", "HIST-" + suffix));
    }

    @Test
    void listSearchesSortsAndPagesWithStableOrder() throws Exception {
        String beta = createModel("Beta " + suffix);
        String alpha = createModel("Alpha " + suffix);
        String b1 = createAsset(alpha, "LST-B-" + suffix);
        String a1 = createAsset(beta, "LST-A-" + suffix);
        String c1 = createAsset(alpha, "LST-C-" + suffix);

        mvc.perform(asAdmin(get(ASSETS).param("q", "  lst-%s ".formatted("a-" + suffix))))
                .andExpect(jsonPath("$.items[*].id").value(contains(a1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix)))
                .andExpect(jsonPath("$.totalItems").value(3))
                .andExpect(jsonPath("$.items[*].id").value(contains(a1, b1, c1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix).param("sort", "assetCode,desc")))
                .andExpect(jsonPath("$.items[*].id").value(contains(c1, b1, a1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix).param("sort", "modelName")))
                .andExpect(jsonPath("$.items[*].id").value(contains(b1, c1, a1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix).param("sort", "modelName,desc")))
                .andExpect(jsonPath("$.items[*].id").value(contains(a1, b1, c1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", "Alpha " + suffix)))
                .andExpect(jsonPath("$.items[*].id").value(contains(b1, c1)));
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix).param("page", "1").param("size", "2")))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalItems").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.items[*].id").value(contains(c1)))
                .andExpect(jsonPath("$.items[0].operationalDiagnostic.evaluatedAt").value(START.toString()));

        // Doc 09 §12.2: an unknown query parameter is ignored on the catalog reads.
        mvc.perform(asAdmin(get(ASSETS).param("q", suffix).param("readiness", "READY").param("x", "1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains(a1, b1, c1)));

        mvc.perform(asAdmin(get(ASSETS).param("q", "%")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalItems").value(0));
        mvc.perform(asAdmin(get(ASSETS).param("q", "_")))
                .andExpect(jsonPath("$.totalItems").value(0));

        for (String[] invalid : new String[][] {
                {"q", "   "}, {"q", "q".repeat(101)}, {"sort", "serialNumber"}, {"sort", "assetCode,up"},
                {"sort", "assetCode,asc,id"}, {"size", "500"}}) {
            mvc.perform(asAdmin(get(ASSETS).param(invalid[0], invalid[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.violations[0].field").value(invalid[0]));
        }
    }

    @Test
    void unknownAssetIsNotFound() throws Exception {
        String model = createModel("Introuvable " + suffix);
        String missing = UUID.randomUUID().toString();
        mvc.perform(asAdmin(get(ASSETS + "/" + missing)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        putAsset(missing, assetBody(model, "MISS-" + suffix, null)).andExpect(status().isNotFound());
        archiveAsset(missing).andExpect(status().isNotFound());
        mvc.perform(asAdmin(get(ASSETS + "/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void techniciansAndAnonymousCallersCannotUseTheAssetRoutes() throws Exception {
        String model = createModel("Accès " + suffix);
        String id = createAsset(model, "ACC-" + suffix);
        String technician = accessToken(accounts.technician());
        String code = "DENIED-" + suffix;

        for (String token : new String[] {technician, null}) {
            for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
                    get(ASSETS), get(ASSETS + "/" + id), withKey(json(post(ASSETS), assetBody(model, code, null))),
                    json(put(ASSETS + "/" + id), assetBody(model, code, null)),
                    withKey(post(ASSETS + "/" + id + "/archive"))}) {
                if (token == null) {
                    mvc.perform(request)
                            .andExpect(status().isUnauthorized())
                            .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
                } else {
                    mvc.perform(request.header(AUTHORIZATION, bearer(token)))
                            .andExpect(status().isForbidden())
                            .andExpect(jsonPath("$.code").value("FORBIDDEN"));
                }
            }
        }

        assertEquals(0, count("assets", "asset_code", code));
        mvc.perform(asAdmin(get(ASSETS + "/" + id)))
                .andExpect(jsonPath("$.assetCode").value("ACC-" + suffix))
                .andExpect(jsonPath("$.archivedAt").isEmpty());
    }

    private Instant updatedAt(String id) {
        return jdbc.sql("SELECT updated_at FROM aegis.assets WHERE id = :id")
                .param("id", UUID.fromString(id))
                .query((row, number) -> row.getObject(1, OffsetDateTime.class).toInstant())
                .single();
    }
}
