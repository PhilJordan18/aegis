package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;

/**
 * Audit of the catalog mutations (document 08, section 4.9; document 09, sections 12.1 and 20): exactly one event per
 * effective change, written with it, and none for a replay, an identical replacement or a refusal. Test classes run
 * one after the other, so the total number of events only changes through the requests of the running test.
 */
class CatalogAuditTests extends CatalogApiTest {

    @Test
    void aModelCreationWritesOneEventThatItsReplayDoesNotRepeat() throws Exception {
        String key = UUID.randomUUID().toString();
        String name = "Audit modèle " + suffix;

        String id = id(mvc.perform(asAdmin(keyed(json(post(MODELS), modelBody(name)), key)))
                .andExpect(status().isCreated()));
        clock.advance(Duration.ofMinutes(5));
        mvc.perform(asAdmin(keyed(json(post(MODELS), modelBody(name)), key)))
                .andExpect(header().string("Idempotency-Replayed", "true"));

        List<Event> events = events("ASSET_MODEL", id);
        assertEquals(1, events.size());
        Event created = events.getFirst();
        assertEquals("ASSET_CREATED", created.type());
        assertEquals("ACCEPTED", created.result());
        assertEquals(admin.id(), created.actor());
        assertNull(created.fromState());
        assertNull(created.toState());
        assertEquals(START, created.occurredAt());
        assertEquals(START, instant("asset_models", "created_at", id));
        assertEquals(json(Map.of("created", Map.of("name", name, "manufacturer", "Fluke", "modelNumber", "117",
                "description", "Multimètre numérique", "defaultCalibrationRequired", true))), created.details());
    }

    @Test
    void anAssetCreationWritesOneEventWithASnapshotOfItsCatalogFields() throws Exception {
        String model = createModel("Audit actif " + suffix);
        String key = UUID.randomUUID().toString();
        Map<String, Object> body = assetBody(model, "AUD-" + suffix, null);

        String id = id(mvc.perform(asAdmin(keyed(json(post(ASSETS), body), key))).andExpect(status().isCreated()));
        mvc.perform(asAdmin(keyed(json(post(ASSETS), body), key)))
                .andExpect(header().string("Idempotency-Replayed", "true"));

        List<Event> events = events("ASSET", id);
        assertEquals(1, events.size());
        assertEquals("ASSET_CREATED", events.getFirst().type());
        assertEquals("ACCEPTED", events.getFirst().result());
        assertEquals(admin.id(), events.getFirst().actor());
        JsonNode snapshot = events.getFirst().details().get("created");
        assertEquals(model, snapshot.get("assetModelId").asString());
        assertEquals("AUD-" + suffix, snapshot.get("assetCode").asString());
        assertEquals(true, snapshot.get("serialNumber").isNull());
        assertEquals("STANDARD", snapshot.get("requiredAccessLevel").asString());
        assertEquals("SERVICEABLE", snapshot.get("operationalStatus").asString());
        assertEquals(true, snapshot.get("calibrationRequired").asBoolean());
        assertEquals("2026-12-01T05:00:00Z", snapshot.get("calibrationDueAt").asString());
        assertEquals(7, snapshot.size());
    }

    @Test
    void anEffectiveReplacementWritesTheChangedFieldsAndAnIdenticalOneWritesNothing() throws Exception {
        String model = createModel("Audit maj " + suffix);
        String asset = createAsset(model, "MAJ-" + suffix);
        clock.advance(Duration.ofMinutes(1));
        Instant updatedAt = clock.instant();

        Map<String, Object> modelChange = modelBody("Audit maj " + suffix);
        modelChange.put("description", null);
        putModel(model, modelChange).andExpect(status().isOk());
        putModel(model, modelChange).andExpect(status().isOk());

        Map<String, Object> assetChange = assetBody(model, "MAJ-" + suffix, null);
        assetChange.put("operationalStatus", "MAINTENANCE");
        assetChange.put("calibrationRequired", false);
        assetChange.put("calibrationDueAt", null);
        putAsset(asset, assetChange).andExpect(status().isOk());
        putAsset(asset, assetChange).andExpect(status().isOk());

        Event modelUpdate = only("ASSET_MODEL", model, "ASSET_UPDATED");
        assertEquals("ACCEPTED", modelUpdate.result());
        assertEquals(admin.id(), modelUpdate.actor());
        assertEquals(updatedAt, modelUpdate.occurredAt());
        assertEquals(updatedAt, instant("asset_models", "updated_at", model));
        assertEquals(json(Map.of("changes", Map.of("description",
                nullable("Multimètre numérique", null)))), modelUpdate.details());

        Event assetUpdate = only("ASSET", asset, "ASSET_UPDATED");
        assertEquals(admin.id(), assetUpdate.actor());
        assertEquals(updatedAt, assetUpdate.occurredAt());
        assertEquals(json(Map.of("changes", Map.of(
                "operationalStatus", nullable("SERVICEABLE", "MAINTENANCE"),
                "calibrationRequired", nullable(true, false),
                "calibrationDueAt", nullable("2026-12-01T05:00:00Z", null)))), assetUpdate.details());
        assertEquals(2, events("ASSET", asset).size());
    }

    @Test
    void aFirstArchivalIsAcceptedOnceAndARepeatedOneWithANewKeyIsAlreadyApplied() throws Exception {
        String model = createModel("Audit archivage " + suffix);
        String asset = createAsset(model, "ARCH-" + suffix);

        assertArchivedOnceThenAlreadyApplied("ASSET", ASSETS, asset, "assets");
        assertArchivedOnceThenAlreadyApplied("ASSET_MODEL", MODELS, model, "asset_models");
    }

    private void assertArchivedOnceThenAlreadyApplied(String subjectType, String collection, String id, String table)
            throws Exception {
        String archive = collection + "/" + id + "/archive";
        Instant archivedAt = clock.instant();
        String firstKey = UUID.randomUUID().toString();
        mvc.perform(asAdmin(keyed(post(archive), firstKey))).andExpect(status().isOk());
        mvc.perform(asAdmin(keyed(post(archive), firstKey))).andExpect(header().string("Idempotency-Replayed", "true"));
        clock.advance(Duration.ofMinutes(3));
        Instant repeatedAt = clock.instant();
        String secondKey = UUID.randomUUID().toString();
        mvc.perform(asAdmin(keyed(post(archive), secondKey)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(archivedAt.toString()));
        mvc.perform(asAdmin(keyed(post(archive), secondKey)))
                .andExpect(header().string("Idempotency-Replayed", "true"));

        List<Event> archivals = events(subjectType, id).stream()
                .filter(event -> event.type().equals("ASSET_ARCHIVED"))
                .toList();
        assertEquals(List.of("ACCEPTED", "ALREADY_APPLIED"), archivals.stream().map(Event::result).toList());
        assertEquals(List.of(archivedAt, repeatedAt), archivals.stream().map(Event::occurredAt).toList());
        assertEquals(List.of(admin.id(), admin.id()), archivals.stream().map(Event::actor).toList());
        JsonNode details = json(Map.of("archivedAt", archivedAt.toString()));
        assertEquals(List.of(details, details), archivals.stream().map(Event::details).toList());
        assertEquals(archivedAt, instant(table, "archived_at", id));
    }

    @Test
    void aRefusedMutationWritesNoEvent() throws Exception {
        String model = createModel("Audit refus " + suffix);
        String asset = createAsset(model, "REF-" + suffix);
        String archived = createAsset(model, "REF-ARCH-" + suffix);
        archiveAsset(archived).andExpect(status().isOk());
        long before = totalEvents();

        archiveModel(model).andExpect(jsonPath("$.code").value("ASSET_MODEL_IN_USE"));
        putAsset(archived, assetBody(model, "REF-ARCH-" + suffix, "SN-" + suffix))
                .andExpect(jsonPath("$.code").value("ASSET_ARCHIVED"));
        postAsset(assetBody(model, "ref-" + suffix, null))
                .andExpect(jsonPath("$.code").value("ASSET_CODE_ALREADY_EXISTS"));
        putAsset(asset, assetBody(model, "REF-ARCH-" + suffix, null))
                .andExpect(jsonPath("$.code").value("ASSET_CODE_ALREADY_EXISTS"));
        postModel(modelBody("AUDIT REFUS " + suffix))
                .andExpect(jsonPath("$.code").value("ASSET_MODEL_NAME_ALREADY_EXISTS"));
        Map<String, Object> invalid = assetBody(model, "REF-INV-" + suffix, null);
        invalid.put("calibrationDueAt", null);
        postAsset(invalid).andExpect(status().isBadRequest());
        putModel(model, modelBody(" ")).andExpect(status().isBadRequest());

        assertEquals(before, totalEvents());
    }

    private MockHttpServletRequestBuilder keyed(MockHttpServletRequestBuilder request, String key) {
        return request.header(IDEMPOTENCY_KEY, key);
    }

    private record Event(String type, UUID actor, String result, String fromState, String toState,
            JsonNode details, Instant occurredAt) {
    }

    private List<Event> events(String subjectType, String subjectId) {
        return jdbc.sql("""
                SELECT event_type, actor_user_id, result, from_state, to_state, details::text AS details, occurred_at
                FROM aegis.audit_events
                WHERE subject_type = :subjectType AND subject_id = :subjectId
                ORDER BY occurred_at, id
                """)
                .param("subjectType", subjectType)
                .param("subjectId", UUID.fromString(subjectId))
                .query((row, number) -> new Event(row.getString("event_type"),
                        row.getObject("actor_user_id", UUID.class), row.getString("result"),
                        row.getString("from_state"), row.getString("to_state"),
                        jsonMapper.readTree(row.getString("details")),
                        row.getObject("occurred_at", OffsetDateTime.class).toInstant()))
                .list();
    }

    private Event only(String subjectType, String subjectId, String type) {
        List<Event> matching = events(subjectType, subjectId).stream().filter(event -> event.type().equals(type))
                .toList();
        assertEquals(1, matching.size(), () -> type + " events: " + matching);
        return matching.getFirst();
    }

    private long totalEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }

    private Instant instant(String table, String column, String id) {
        return jdbc.sql("SELECT " + column + " FROM aegis." + table + " WHERE id = :id")
                .param("id", UUID.fromString(id))
                .query(OffsetDateTime.class)
                .single()
                .toInstant();
    }

    private JsonNode json(Object value) {
        return jsonMapper.valueToTree(value);
    }

    /** {@code Map.of} refuses null values, which a change to or from an empty field needs. */
    private static Map<String, Object> nullable(Object from, Object to) {
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("from", from);
        change.put("to", to);
        return change;
    }
}
