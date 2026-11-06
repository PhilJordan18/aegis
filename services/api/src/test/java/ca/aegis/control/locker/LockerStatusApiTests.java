package ca.aegis.control.locker;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;

/** Document 09, sections 8.6 and 16.1, on lockers without a hub device; the broker tests cover the heartbeats. */
class LockerStatusApiTests extends ApiIntegrationTest {

    @Autowired
    JdbcClient jdbc;

    private ReservationFixtures fixtures;

    @BeforeEach
    void fixtures() {
        fixtures = new ReservationFixtures(jdbc);
    }

    @Test
    void aTechnicianAndAnAdministratorReadTheStatusOfALockerWithoutDevice() throws Exception {
        UUID locker = fixtures.locker();
        fixtures.assetAt(locker, 3);

        for (String token : new String[] {accessToken(accounts.technician()), accessToken(accounts.admin())}) {
            mvc.perform(get(path(locker)).header(AUTHORIZATION, bearer(token)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.lockerId").value(locker.toString()))
                    .andExpect(jsonPath("$.name").value("Casier réservation"))
                    .andExpect(jsonPath("$.topology").value("HUB_CELL"))
                    .andExpect(jsonPath("$.connectionStatus").value("UNKNOWN"))
                    .andExpect(jsonPath("$.lastSeenAt").value(nullValue()))
                    .andExpect(jsonPath("$.evaluatedAt").value(START.toString()))
                    .andExpect(jsonPath("$.currentWindow.open").value(false))
                    .andExpect(jsonPath("$.currentWindow.timeZone").value(nullValue()))
                    .andExpect(jsonPath("$.currentWindow.closesAt").value(nullValue()))
                    .andExpect(jsonPath("$.currentWindow.nextOpensAt").value(nullValue()))
                    .andExpect(jsonPath("$.compartments[*].code").value(contains(
                            jdbc.sql("SELECT code FROM aegis.compartments WHERE locker_id = :l").param("l", locker)
                                    .query(String.class).single())))
                    .andExpect(jsonPath("$.compartments[0].enabled").value(true))
                    .andExpect(jsonPath("$.compartments[0].connectionStatus").value("UNKNOWN"))
                    .andExpect(jsonPath("$.compartments[0].rfidReaderStatus").value("UNKNOWN"))
                    .andExpect(jsonPath("$.compartments[0].doorState").value("UNKNOWN"))
                    .andExpect(jsonPath("$.compartments[0].lockState").value("UNKNOWN"))
                    .andExpect(jsonPath("$.compartments[0].lastObservedAt").value(nullValue()))
                    .andExpect(jsonPath("$.deviceErrors").isArray())
                    .andExpect(jsonPath("$.deviceErrors.length()").value(0));
        }
    }

    /** 09:00 in Toronto on Monday 28 September 2026, inside the 08:00-17:00 window of the fixtures. */
    @Test
    void theCurrentWindowComesFromTheActiveSchedule() throws Exception {
        UUID locker = fixtures.scheduledLocker(accounts.admin().id());
        String token = accessToken(accounts.technician());

        mvc.perform(get(path(locker)).header(AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentWindow.timeZone").value("America/Toronto"))
                .andExpect(jsonPath("$.currentWindow.open").value(true))
                .andExpect(jsonPath("$.currentWindow.closesAt").value("2026-09-28T21:00:00Z"))
                .andExpect(jsonPath("$.currentWindow.nextOpensAt").value(nullValue()));

        clock.set(java.time.Instant.parse("2026-09-28T21:00:00Z"));
        mvc.perform(get(path(locker)).header(AUTHORIZATION, bearer(accessToken(accounts.technician()))))
                .andExpect(jsonPath("$.currentWindow.open").value(false))
                .andExpect(jsonPath("$.currentWindow.closesAt").value(nullValue()))
                .andExpect(jsonPath("$.currentWindow.nextOpensAt").value("2026-09-29T12:00:00Z"));
    }

    @Test
    void withoutATokenTheStatusIsUnauthorizedAndAnUnknownLockerIsNotFound() throws Exception {
        UUID locker = fixtures.locker();
        mvc.perform(get(path(locker))).andExpect(status().isUnauthorized());

        mvc.perform(get(path(UUID.randomUUID())).header(AUTHORIZATION, bearer(accessToken(accounts.technician()))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    }

    /** No route forces a status: the status is derived from heartbeats only. */
    @Test
    void theStatusCannotBeWritten() throws Exception {
        UUID locker = fixtures.locker();
        String admin = bearer(accessToken(accounts.admin()));
        for (var request : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[] {
                put(path(locker)), post(path(locker))}) {
            mvc.perform(request.header(AUTHORIZATION, admin).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"connectionStatus\": \"ONLINE\"}"))
                    .andExpect(result -> {
                        int code = result.getResponse().getStatus();
                        if (code < 400) {
                            throw new AssertionError("status written with " + code);
                        }
                    });
        }
        mvc.perform(get(path(locker)).header(AUTHORIZATION, admin))
                .andExpect(jsonPath("$.connectionStatus").value("UNKNOWN"));
    }

    private static String path(UUID locker) {
        return "/api/v1/lockers/" + locker + "/status";
    }
}
