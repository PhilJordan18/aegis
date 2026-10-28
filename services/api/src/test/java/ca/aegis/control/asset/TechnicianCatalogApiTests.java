package ca.aegis.control.asset;

import static org.hamcrest.Matchers.contains;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.identity.AccessLevel;
import ca.aegis.control.identity.Role;
import ca.aegis.control.support.TestAccounts.TestAccount;

/** Document 09, sections 8.1, 8.2, 11.1 and 11.2, through the HTTP API with its security filter. */
class TechnicianCatalogApiTests extends CatalogApiTest {

    static final String CATALOG = "/api/v1/assets";

    TestAccount technician;
    String technicianToken;
    String compliant;
    String expired;
    String restricted;

    /** Three demo-like assets of one model, found by {@code q=suffix} in the shared test database. */
    @BeforeEach
    void createDemoAssets() throws Exception {
        technician = accounts.technician();
        technicianToken = accessToken(technician);
        String model = createModel("Multimètre " + suffix);
        compliant = createAsset(model, "A1-" + suffix);

        Map<String, Object> a2 = assetBody(model, "A2-" + suffix, null);
        a2.put("calibrationDueAt", "2026-09-01T00:00:00Z");
        expired = id(postAsset(a2).andExpect(status().isCreated()));

        Map<String, Object> a3 = assetBody(model, "A3-" + suffix, null);
        a3.put("requiredAccessLevel", "RESTRICTED");
        a3.put("calibrationRequired", false);
        a3.put("calibrationDueAt", null);
        restricted = id(postAsset(a3).andExpect(status().isCreated()));
    }

    @Test
    void onlyTechniciansReadTheCatalog() throws Exception {
        String admin = bearer(adminToken);
        for (String path : List.of(CATALOG, CATALOG + "/" + compliant)) {
            mvc.perform(asTechnician(get(path))).andExpect(status().isOk());
            mvc.perform(get(path).header(AUTHORIZATION, admin))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"));
            mvc.perform(get(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTH_TOKEN_INVALID"));
        }
    }

    @Test
    void aCompliantAssetIsUnknownWithoutPhysicalProofAndNeverReady() throws Exception {
        mvc.perform(asTechnician(get(CATALOG + "/" + compliant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(compliant))
                .andExpect(jsonPath("$.assetCode").value("A1-" + suffix))
                .andExpect(jsonPath("$.requiredAccessLevel").value("STANDARD"))
                .andExpect(jsonPath("$.operationalStatus").value("SERVICEABLE"))
                .andExpect(jsonPath("$.calibration.required").value(true))
                .andExpect(jsonPath("$.calibration.dueAt").value("2026-12-01T05:00:00Z"))
                .andExpect(jsonPath("$.calibration.status").value("VALID"))
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.presence").value("UNKNOWN"))
                .andExpect(jsonPath("$.readiness.assetId").value(compliant))
                .andExpect(jsonPath("$.readiness.evaluatedForUserId").value(technician.id().toString()))
                .andExpect(jsonPath("$.readiness.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")))
                .andExpect(jsonPath("$.readiness.evaluatedAt").value(START.toString()));

        mvc.perform(asTechnician(get(CATALOG).param("readiness", "READY")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.totalItems").value(0))
                .andExpect(jsonPath("$.totalPages").value(0));
    }

    @Test
    void anExpiredCalibrationBlocksTheAsset() throws Exception {
        mvc.perform(asTechnician(get(CATALOG + "/" + expired)))
                .andExpect(jsonPath("$.calibration.status").value("EXPIRED"))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("CALIBRATION_EXPIRED")));

        clock.set(Instant.parse("2026-12-01T05:00:00Z"));
        technicianToken = accessToken(technician);
        mvc.perform(asTechnician(get(CATALOG + "/" + compliant)))
                .andExpect(jsonPath("$.calibration.status").value("EXPIRED"))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("CALIBRATION_EXPIRED")))
                .andExpect(jsonPath("$.readiness.evaluatedAt").value("2026-12-01T05:00:00Z"));
    }

    @Test
    void readinessIsPersonalToTheAccessLevelOfTheTechnician() throws Exception {
        mvc.perform(asTechnician(get(CATALOG + "/" + restricted)))
                .andExpect(jsonPath("$.requiredAccessLevel").value("RESTRICTED"))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("ACCESS_DENIED")));

        TestAccount senior = accounts.create(Role.TECHNICIAN, AccessLevel.RESTRICTED);
        mvc.perform(get(CATALOG + "/" + restricted).header(AUTHORIZATION, bearer(accessToken(senior))))
                .andExpect(jsonPath("$.readiness.evaluatedForUserId").value(senior.id().toString()))
                .andExpect(jsonPath("$.readiness.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")));
    }

    @Test
    void aCertainBlockKeepsEveryReasonAndHidesMissingProof() throws Exception {
        Map<String, Object> blocked = assetBody(createModel("Bloqué " + suffix), "A4-" + suffix, null);
        blocked.put("requiredAccessLevel", "RESTRICTED");
        blocked.put("operationalStatus", "DAMAGED");
        blocked.put("calibrationDueAt", "2026-09-01T00:00:00Z");
        String id = id(postAsset(blocked).andExpect(status().isCreated()));

        mvc.perform(asTechnician(get(CATALOG + "/" + id)))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(
                        contains("DAMAGED", "CALIBRATION_EXPIRED", "ACCESS_DENIED")));
    }

    @Test
    void nullsAreSerializedAndNoIdentifierLeaves() throws Exception {
        Map<String, Object> bareModel = modelBody("Sans fabricant " + suffix);
        bareModel.put("manufacturer", null);
        bareModel.put("modelNumber", null);
        String bare = id(postAsset(assetBody(id(postModel(bareModel).andExpect(status().isCreated())),
                "A0-" + suffix, null)).andExpect(status().isCreated()));
        String tag = "E200-" + suffix;
        mvc.perform(asAdmin(withKey(json(post(ASSETS + "/" + compliant + "/identifiers"),
                Map.of("type", "RFID_UHF", "value", tag))))).andExpect(status().isCreated());
        UUID locker = PlacementFixtures.locker(jdbc, "T-" + suffix);
        UUID compartment = PlacementFixtures.compartment(jdbc, locker, "A1", 1);
        mvc.perform(asAdmin(json(put(ASSETS + "/" + compliant + "/placement"),
                Map.of("compartmentId", compartment, "reason", "Affectation")))).andExpect(status().isOk());

        JsonNode noPlacement = body(mvc.perform(asTechnician(get(CATALOG + "/" + restricted))));
        assertExplicitNull(noPlacement, "placement");
        assertExplicitNull(noPlacement.get("calibration"), "dueAt");
        assertEquals("NOT_REQUIRED", noPlacement.get("calibration").get("status").asString());
        JsonNode bareView = body(mvc.perform(asTechnician(get(CATALOG + "/" + bare))));
        assertExplicitNull(bareView.get("model"), "manufacturer");
        assertExplicitNull(bareView.get("model"), "modelNumber");
        assertEquals(List.of("id", "assetCode", "model", "requiredAccessLevel", "operationalStatus", "calibration",
                "availability", "presence", "readiness", "placement"), List.copyOf(bareView.propertyNames()));
        assertEquals(List.of("id", "name", "manufacturer", "modelNumber"),
                List.copyOf(bareView.get("model").propertyNames()));
        assertEquals(List.of("required", "dueAt", "status"), List.copyOf(bareView.get("calibration").propertyNames()));
        assertEquals(List.of("assetId", "evaluatedForUserId", "result", "reasons", "evaluatedAt"),
                List.copyOf(bareView.get("readiness").propertyNames()));

        mvc.perform(asTechnician(get(CATALOG + "/" + compliant)))
                .andExpect(jsonPath("$.placement.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.placement.lockerCode").value("T-" + suffix))
                .andExpect(jsonPath("$.placement.compartmentId").value(compartment.toString()))
                .andExpect(jsonPath("$.placement.compartmentCode").value("A1"));
        for (String path : List.of(CATALOG + "/" + compliant, CATALOG + "?q=" + suffix)) {
            String raw = text(mvc.perform(asTechnician(get(path))).andExpect(status().isOk()));
            assertFalse(raw.contains("identifierValue"), path);
            assertFalse(raw.contains("identifiers"), path);
            assertFalse(raw.contains(tag), path);
            assertFalse(raw.contains("serialNumber"), path);
            assertFalse(raw.contains("operationalDiagnostic"), path);
            assertFalse(raw.contains("availableActions"), path);
        }
    }

    @Test
    void pagesAreStableAndSortedWithTheIdLast() throws Exception {
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("size", "2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalItems").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.items[*].id").value(contains(compliant, expired)))
                .andExpect(jsonPath("$.items[*].readiness.assetId").value(contains(compliant, expired)))
                .andExpect(jsonPath("$.items[*].readiness.evaluatedAt").value(contains(START.toString(),
                        START.toString())));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("size", "2").param("page", "1")))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.items[*].id").value(contains(restricted)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("page", "5")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.totalItems").value(3));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("sort", "assetCode,desc")))
                .andExpect(jsonPath("$.items[*].id").value(contains(restricted, expired, compliant)));

        String zModel = createModel("Zz " + suffix);
        String first = createAsset(zModel, "A0-" + suffix);
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("sort", "modelName")))
                .andExpect(jsonPath("$.items[*].id").value(contains(compliant, expired, restricted, first)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("sort", "modelName,desc")))
                .andExpect(jsonPath("$.items[*].id").value(contains(first, compliant, expired, restricted)));
    }

    @Test
    void filtersApplyBeforePaginationAndKeepExactTotals() throws Exception {
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("readiness", "BLOCKED").param("size", "1")))
                .andExpect(jsonPath("$.totalItems").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.items[*].id").value(contains(expired)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("readiness", "BLOCKED").param("size", "1")
                        .param("page", "1")))
                .andExpect(jsonPath("$.items[*].id").value(contains(restricted)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("readiness", "UNKNOWN")))
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[*].id").value(contains(compliant)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", "AVAILABLE")))
                .andExpect(jsonPath("$.totalItems").value(3));
        for (String availability : List.of("RESERVED", "BORROWED", "UNAVAILABLE")) {
            mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", availability)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalItems").value(0))
                    .andExpect(jsonPath("$.totalPages").value(0));
        }
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("readiness", "BLOCKED")
                        .param("availability", "AVAILABLE").param("sort", "assetCode,desc")))
                .andExpect(jsonPath("$.items[*].id").value(contains(restricted, expired)));
    }

    @Test
    void archivedAssetsLeaveTheCatalogButStayBlockedWhenReadDirectly() throws Exception {
        archiveAsset(expired).andExpect(status().isOk());

        mvc.perform(asTechnician(get(CATALOG).param("q", suffix)))
                .andExpect(jsonPath("$.totalItems").value(2))
                .andExpect(jsonPath("$.items[*].id").value(contains(compliant, restricted)));
        mvc.perform(asTechnician(get(CATALOG).param("q", suffix).param("availability", "UNAVAILABLE")))
                .andExpect(jsonPath("$.totalItems").value(0));
        mvc.perform(asTechnician(get(CATALOG + "/" + expired)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.readiness.result").value("BLOCKED"))
                .andExpect(jsonPath("$.readiness.reasons").value(contains("NOT_AVAILABLE", "CALIBRATION_EXPIRED")))
                .andExpect(jsonPath("$.archivedAt").doesNotExist());
    }

    @Test
    void searchMatchesCodeAndModelNameLiterally() throws Exception {
        mvc.perform(asTechnician(get(CATALOG).param("q", "  a2-" + suffix.toUpperCase() + " ")))
                .andExpect(jsonPath("$.items[*].id").value(contains(expired)));
        mvc.perform(asTechnician(get(CATALOG).param("q", "multimètre " + suffix)))
                .andExpect(jsonPath("$.totalItems").value(3));
        for (String wildcard : List.of("%" + suffix, "_1-" + suffix, "A\\" + suffix)) {
            mvc.perform(asTechnician(get(CATALOG).param("q", wildcard)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalItems").value(0));
        }
    }

    @Test
    void invalidParametersAreFieldViolations() throws Exception {
        expectViolation(get(CATALOG).param("q", "   "), "q", "SIZE");
        expectViolation(get(CATALOG).param("q", ""), "q", "SIZE");
        expectViolation(get(CATALOG).param("q", "x".repeat(101)), "q", "SIZE");
        expectViolation(get(CATALOG).param("q", "A1\u0007"), "q", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("readiness", "ready"), "readiness", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("readiness", "NOT_READY"), "readiness", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("availability", "FREE"), "availability", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("page", "-1"), "page", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("size", "0"), "size", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("size", "101"), "size", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("sort", "serialNumber"), "sort", "INVALID_VALUE");
        expectViolation(get(CATALOG).param("sort", "assetCode,up"), "sort", "INVALID_VALUE");
        mvc.perform(asTechnician(get(CATALOG).param("q", "x".repeat(100)))).andExpect(status().isOk());
        mvc.perform(asTechnician(get(CATALOG).param("size", "100"))).andExpect(status().isOk());
    }

    @Test
    void anUnknownAssetIsNotFound() throws Exception {
        mvc.perform(asTechnician(get(CATALOG + "/" + UUID.randomUUID())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSET_NOT_FOUND"));
    }

    private MockHttpServletRequestBuilder asTechnician(MockHttpServletRequestBuilder request) {
        return request.header(AUTHORIZATION, bearer(technicianToken));
    }

    private void expectViolation(MockHttpServletRequestBuilder request, String field, String code) throws Exception {
        mvc.perform(asTechnician(request))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations[0].field").value(field))
                .andExpect(jsonPath("$.violations[0].code").value(code));
    }

    private JsonNode body(ResultActions result) throws Exception {
        return jsonMapper.readTree(text(result.andExpect(status().isOk())));
    }

    private static String text(ResultActions result) throws Exception {
        return result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static void assertExplicitNull(JsonNode node, String field) {
        assertTrue(node.has(field), field + " is missing");
        assertTrue(node.get(field).isNull(), field + " is not null");
    }
}
