package ca.aegis.control.locker;

import static org.hamcrest.Matchers.contains;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;

import tools.jackson.databind.JsonNode;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.TestAccounts.TestAccount;

/**
 * Document 09, section 13: reading and replacing a locker's operating schedule, its refusals, its history and its
 * audit. Each test creates its own locker, because the database is shared by the whole run.
 */
class OperatingScheduleApiTests extends ApiIntegrationTest {

    static final String[] DAYS = {"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"};

    @Autowired
    JdbcClient jdbc;

    TestAccount admin;
    String adminToken;
    UUID locker;

    @BeforeEach
    void createLocker() throws Exception {
        admin = accounts.admin();
        adminToken = accessToken(admin);
        locker = ScheduleFixtures.locker(jdbc);
    }

    @Test
    void anUnknownLockerAndALockerWithoutScheduleAreTwoDifferentNotFounds() throws Exception {
        UUID unknown = UUID.randomUUID();

        read(unknown).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        replace(unknown, weekdays("09:00:00", "17:00:00")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        read(locker).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("OPERATING_SCHEDULE_NOT_CONFIGURED"));
        assertEquals(0, versions(locker).size());
    }

    @Test
    void aFirstScheduleIsReturnedReadBackInDayOrderAndAuditedOnce() throws Exception {
        Map<String, Object> body = weekdays("09:00", "17:00:00");
        @SuppressWarnings("unchecked")
        List<Object> windows = (List<Object>) body.get("windows");
        Collections.reverse(windows);

        String id = id(replace(locker, body).andExpect(status().isOk())
                .andExpect(jsonPath("$.lockerId").value(locker.toString()))
                .andExpect(jsonPath("$.timeZone").value("America/Toronto"))
                .andExpect(jsonPath("$.createdAt").value(START.toString()))
                .andExpect(jsonPath("$.createdByUserId").value(admin.id().toString()))
                .andExpect(jsonPath("$.windows.length()").value(7))
                .andExpect(jsonPath("$.windows[*].dayOfWeek", contains(DAYS)))
                .andExpect(jsonPath("$.windows[0].enabled").value(true))
                .andExpect(jsonPath("$.windows[0].opensAt").value("09:00:00"))
                .andExpect(jsonPath("$.windows[0].closesAt").value("17:00:00"))
                .andExpect(jsonPath("$.windows[6].enabled").value(false))
                .andExpect(jsonPath("$.windows[6].opensAt").isEmpty())
                .andExpect(jsonPath("$.windows[6].closesAt").isEmpty()));

        String read = body(read(locker).andExpect(status().isOk()));
        assertEquals(id, JsonPath.read(read, "$.id"));
        assertEquals(List.of(DAYS), JsonPath.read(read, "$.windows[*].dayOfWeek"));
        List<JsonNode> events = events(locker);
        assertEquals(1, events.size());
        assertEquals(id, events.getFirst().get("subject").asString());
        assertEquals("ACCEPTED " + admin.id() + " " + START, events.getFirst().get("head").asString());
        JsonNode details = events.getFirst().get("details");
        assertEquals(true, details.get("previousScheduleId").isNull());
        assertEquals(true, details.get("before").isNull());
        assertEquals(jsonMapper.valueToTree(snapshot("America/Toronto", "09:00:00", "17:00:00")), details.get("after"));
    }

    @Test
    void aChangeArchivesThePreviousVersionAndKeepsTheHistory() throws Exception {
        String first = id(replace(locker, weekdays("09:00:00", "17:00:00")).andExpect(status().isOk()));
        clock.advance(Duration.ofMinutes(5));
        String changedAt = START.plus(Duration.ofMinutes(5)).toString();

        String second = id(replace(locker, weekdays("08:00:00", "16:30:00")).andExpect(status().isOk())
                .andExpect(jsonPath("$.createdAt").value(changedAt))
                .andExpect(jsonPath("$.windows[0].opensAt").value("08:00:00"))
                .andExpect(jsonPath("$.windows[0].closesAt").value("16:30:00")));
        clock.advance(Duration.ofMinutes(5));
        Map<String, Object> montreal = weekdays("08:00:00", "16:30:00");
        montreal.put("timeZone", "America/Montreal");
        String third = id(replace(locker, montreal).andExpect(status().isOk())
                .andExpect(jsonPath("$.timeZone").value("America/Montreal")));

        assertEquals(List.of(
                first + " false " + START + " " + changedAt,
                second + " false " + changedAt + " " + START.plus(Duration.ofMinutes(10)),
                third + " true " + START.plus(Duration.ofMinutes(10)) + " null"), versions(locker));
        assertEquals(21, jdbc.sql("""
                SELECT count(*) FROM aegis.operating_windows w
                JOIN aegis.operating_schedules s ON s.id = w.operating_schedule_id WHERE s.locker_id = :locker
                """).param("locker", locker).query(Long.class).single());
        read(locker).andExpect(jsonPath("$.id").value(third));
        List<JsonNode> events = events(locker);
        assertEquals(3, events.size());
        JsonNode change = events.get(1).get("details");
        assertEquals(second, events.get(1).get("subject").asString());
        assertEquals(first, change.get("previousScheduleId").asString());
        assertEquals(jsonMapper.valueToTree(snapshot("America/Toronto", "09:00:00", "17:00:00")), change.get("before"));
        assertEquals(jsonMapper.valueToTree(snapshot("America/Toronto", "08:00:00", "16:30:00")), change.get("after"));
        assertEquals("America/Montreal", events.get(2).get("details").get("after").get("timeZone").asString());
    }

    @Test
    void anIdenticalScheduleCreatesNoVersionAndNoEvent() throws Exception {
        String id = id(replace(locker, weekdays("09:00:00", "17:00:00")).andExpect(status().isOk()));
        clock.advance(Duration.ofMinutes(1));
        Map<String, Object> same = weekdays("09:00", "17:00");
        @SuppressWarnings("unchecked")
        List<Object> windows = (List<Object>) same.get("windows");
        Collections.rotate(windows, 3);

        replace(locker, same).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.createdAt").value(START.toString()));
        replace(locker, weekdays("09:00:00", "17:00:00")).andExpect(jsonPath("$.id").value(id));

        assertEquals(1, versions(locker).size());
        assertEquals(1, events(locker).size());
    }

    @Test
    void invalidSchedulesAreRefusedWithTheirViolationAndChangeNothing() throws Exception {
        replace(locker, weekdays("09:00:00", "17:00:00")).andExpect(status().isOk());
        long events = totalEvents();
        List<String> versions = versions(locker);

        for (String zone : List.of("+01:00", "Z", "UTC+1", "-05:00", "america/toronto", " America/Toronto",
                "Mars/Olympus")) {
            expectViolation(with(body -> body.put("timeZone", zone)), "timeZone", "INVALID_VALUE");
        }
        expectViolation(with(body -> body.put("timeZone", " ")), "timeZone", "NOT_BLANK");
        expectViolation(with(body -> body.put("timeZone", null)), "timeZone", "NOT_BLANK");
        expectViolation(with(body -> body.put("windows", null)), "windows", "NOT_NULL");
        expectViolation(with(body -> windows(body).removeLast()), "windows", "SIZE");
        expectViolation(with(body -> windows(body).add(closed("SUNDAY"))), "windows", "SIZE");
        expectViolation(with(body -> windows(body).set(3, null)), "windows[3]", "NOT_NULL");
        expectViolation(with(body -> day(body, 0).put("dayOfWeek", "monday")), "windows[0].dayOfWeek",
                "INVALID_VALUE");
        expectViolation(with(body -> day(body, 0).put("dayOfWeek", null)), "windows[0].dayOfWeek", "NOT_NULL");
        expectViolation(with(body -> windows(body).set(6, closed("MONDAY"))), "windows[6].dayOfWeek",
                "DUPLICATE_DAY_OF_WEEK");
        expectViolation(with(body -> day(body, 2).put("enabled", null)), "windows[2].enabled", "NOT_NULL");
        expectViolation(with(body -> day(body, 1).put("opensAt", null)), "windows[1].opensAt",
                "REQUIRED_WHEN_ENABLED");
        expectViolation(with(body -> day(body, 1).remove("closesAt")), "windows[1].closesAt",
                "REQUIRED_WHEN_ENABLED");
        expectViolation(with(body -> day(body, 5).put("opensAt", "10:00:00")), "windows[5].opensAt",
                "NOT_ALLOWED_WHEN_DISABLED");
        expectViolation(with(body -> day(body, 5).put("closesAt", "12:00:00")), "windows[5].closesAt",
                "NOT_ALLOWED_WHEN_DISABLED");
        expectViolation(with(body -> day(body, 0).put("closesAt", "09:00:00")), "windows[0].closesAt",
                "NOT_AFTER_OPENS_AT");
        expectViolation(with(body -> day(body, 0).put("closesAt", "08:00:00")), "windows[0].closesAt",
                "NOT_AFTER_OPENS_AT");
        expectViolation(with(body -> {
            day(body, 4).put("opensAt", "22:00:00");
            day(body, 4).put("closesAt", "02:00:00");
        }), "windows[4].closesAt", "NOT_AFTER_OPENS_AT");
        expectViolation(with(body -> day(body, 0).put("opensAt", "09:00:00.5")), "windows[0].opensAt",
                "INVALID_VALUE");
        expectViolation(with(body -> day(body, 3).put("closesAt", "24:00:00")), "windows[3].closesAt",
                "INVALID_VALUE");
        expectViolation(with(body -> day(body, 2).put("dayOfWeek", 1)), "windows[2].dayOfWeek", "INVALID_VALUE");
        expectViolation(with(body -> day(body, 1).put("id", UUID.randomUUID().toString())), "windows[1].id",
                "UNKNOWN_FIELD");
        expectViolation(with(body -> body.put("active", false)), "active", "UNKNOWN_FIELD");

        replace(locker, with(body -> {
            body.put("timeZone", "UTC+1");
            day(body, 6).put("opensAt", "10:00:00");
            day(body, 0).put("closesAt", "08:00:00");
        })).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[*].field",
                        contains("timeZone", "windows[0].closesAt", "windows[6].opensAt")))
                .andExpect(jsonPath("$.violations[*].code",
                        contains("INVALID_VALUE", "NOT_AFTER_OPENS_AT", "NOT_ALLOWED_WHEN_DISABLED")));

        assertEquals(events, totalEvents());
        assertEquals(versions, versions(locker));
    }

    @Test
    void techniciansCannotReadOrReplaceASchedule() throws Exception {
        String technician = bearer(accessToken(accounts.technician()));

        mvc.perform(get(path(locker)).header(AUTHORIZATION, technician)).andExpect(status().isForbidden());
        mvc.perform(json(put(path(locker)), weekdays("09:00:00", "17:00:00")).header(AUTHORIZATION, technician))
                .andExpect(status().isForbidden());
        mvc.perform(get(path(locker))).andExpect(status().isUnauthorized());
        assertEquals(0, versions(locker).size());
    }

    static Map<String, Object> weekdays(String opensAt, String closesAt) {
        List<Object> windows = new ArrayList<>();
        for (String day : DAYS) {
            windows.add(day.startsWith("S") ? closed(day) : open(day, opensAt, closesAt));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timeZone", "America/Toronto");
        body.put("windows", windows);
        return body;
    }

    static Map<String, Object> open(String day, String opensAt, String closesAt) {
        Map<String, Object> window = new LinkedHashMap<>();
        window.put("dayOfWeek", day);
        window.put("enabled", true);
        window.put("opensAt", opensAt);
        window.put("closesAt", closesAt);
        return window;
    }

    static Map<String, Object> closed(String day) {
        Map<String, Object> window = new LinkedHashMap<>();
        window.put("dayOfWeek", day);
        window.put("enabled", false);
        window.put("opensAt", null);
        window.put("closesAt", null);
        return window;
    }

    static String path(UUID locker) {
        return "/api/v1/admin/lockers/" + locker + "/operating-schedule";
    }

    @SuppressWarnings("unchecked")
    private static List<Object> windows(Map<String, Object> body) {
        return (List<Object>) body.get("windows");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> day(Map<String, Object> body, int index) {
        return (Map<String, Object>) windows(body).get(index);
    }

    private static Map<String, Object> with(Consumer<Map<String, Object>> change) {
        Map<String, Object> body = weekdays("09:00:00", "17:00:00");
        change.accept(body);
        return body;
    }

    private static Map<String, Object> snapshot(String timeZone, String opensAt, String closesAt) {
        Map<String, Object> body = weekdays(opensAt, closesAt);
        body.put("timeZone", timeZone);
        return body;
    }

    private void expectViolation(Object body, String field, String code) throws Exception {
        replace(locker, body).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value(field))
                .andExpect(jsonPath("$.violations[0].code").value(code));
    }

    private ResultActions read(UUID locker) throws Exception {
        return mvc.perform(asAdmin(get(path(locker))));
    }

    private ResultActions replace(UUID locker, Object body) throws Exception {
        return mvc.perform(asAdmin(json(put(path(locker)), body)));
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, Object body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(body));
    }

    private MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder request) {
        return request.header(AUTHORIZATION, bearer(adminToken));
    }

    private static String body(ResultActions result) throws Exception {
        return result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static String id(ResultActions result) throws Exception {
        return JsonPath.read(body(result), "$.id");
    }

    /** Each version as {@code id active createdAt archivedAt}, in creation order. */
    private List<String> versions(UUID locker) {
        return jdbc.sql("""
                SELECT id || ' ' || active || ' '
                       || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' '
                       || coalesce(to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'null')
                FROM aegis.operating_schedules WHERE locker_id = :locker ORDER BY created_at
                """).param("locker", locker).query(String.class).list();
    }

    /** The SCHEDULE_UPDATED events of the locker's versions, in order, as {subject, head, details}. */
    private List<JsonNode> events(UUID locker) {
        return jdbc.sql("""
                SELECT json_build_object(
                    'subject', e.subject_id,
                    'head', e.result || ' ' || e.actor_user_id || ' '
                            || to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'details', e.details)::text
                FROM aegis.audit_events e
                JOIN aegis.operating_schedules s ON s.id = e.subject_id
                WHERE e.event_type = 'SCHEDULE_UPDATED' AND e.subject_type = 'OPERATING_SCHEDULE'
                  AND s.locker_id = :locker
                ORDER BY e.occurred_at
                """).param("locker", locker).query(String.class).list().stream()
                .map(jsonMapper::readTree).toList();
    }

    private long totalEvents() {
        return jdbc.sql("SELECT count(*) FROM aegis.audit_events").query(Long.class).single();
    }
}
