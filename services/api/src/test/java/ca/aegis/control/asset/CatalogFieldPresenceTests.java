package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Document 09, sections 12.1 and 12.2: every request field is required, including the nullable ones. Omitting a
 * nullable field is refused; sending it as an explicit null clears it.
 */
class CatalogFieldPresenceTests extends CatalogApiTest {

    @Test
    void modelCreationRefusesAnOmittedNullableFieldButAcceptsAnExplicitNull() throws Exception {
        for (String field : new String[] {"manufacturer", "modelNumber", "description"}) {
            Map<String, Object> omitted = modelBody("Omis " + field + " " + suffix);
            omitted.remove(field);
            expectRequired(postModel(omitted), field);
            assertEquals(0, count("asset_models", "name", "Omis " + field + " " + suffix));
        }

        Map<String, Object> explicitNulls = modelBody("Nul " + suffix);
        explicitNulls.put("manufacturer", null);
        explicitNulls.put("modelNumber", null);
        explicitNulls.put("description", null);
        postModel(explicitNulls)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.manufacturer").isEmpty())
                .andExpect(jsonPath("$.modelNumber").isEmpty())
                .andExpect(jsonPath("$.description").isEmpty());
    }

    @Test
    void modelReplacementKeepsTheFieldWhenOmittedAndClearsItWhenNull() throws Exception {
        String id = createModel("Remplacement " + suffix);

        Map<String, Object> omitted = modelBody("Remplacement " + suffix);
        omitted.remove("description");
        expectRequired(putModel(id, omitted), "description");
        mvc.perform(asAdmin(get(MODELS + "/" + id)))
                .andExpect(jsonPath("$.description").value("Multimètre numérique"));

        Map<String, Object> cleared = modelBody("Remplacement " + suffix);
        cleared.put("description", null);
        putModel(id, cleared)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").isEmpty());
    }

    @Test
    void assetCreationRefusesAnOmittedSerialNumberButAcceptsAnExplicitNull() throws Exception {
        String modelId = createModel("Série " + suffix);

        Map<String, Object> omitted = assetBody(modelId, "OMIS-" + suffix, null);
        omitted.remove("serialNumber");
        expectRequired(postAsset(omitted), "serialNumber");
        assertEquals(0, count("assets", "asset_code", "OMIS-" + suffix));

        postAsset(assetBody(modelId, "NUL-" + suffix, null))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.serialNumber").isEmpty());
    }

    @Test
    void assetReplacementRefusesAnOmittedCalibrationDateButAcceptsAnExplicitNull() throws Exception {
        String modelId = createModel("Calibration " + suffix);
        String id = createAsset(modelId, "CAL-" + suffix);

        Map<String, Object> omitted = assetBody(modelId, "CAL-" + suffix, null);
        omitted.put("calibrationRequired", false);
        omitted.remove("calibrationDueAt");
        expectRequired(putAsset(id, omitted), "calibrationDueAt");
        mvc.perform(asAdmin(get(ASSETS + "/" + id)))
                .andExpect(jsonPath("$.calibration.required").value(true));

        Map<String, Object> withoutCalibration = assetBody(modelId, "CAL-" + suffix, null);
        withoutCalibration.put("calibrationRequired", false);
        withoutCalibration.put("calibrationDueAt", null);
        putAsset(id, withoutCalibration)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.calibration.required").value(false));
    }

    private static void expectRequired(ResultActions result, String field) throws Exception {
        result.andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value(field))
                .andExpect(jsonPath("$.violations[0].code").value("REQUIRED"));
    }
}
