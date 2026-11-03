package ca.aegis.control.reservation;

import static org.hamcrest.Matchers.contains;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.support.ApiIntegrationTest;

/**
 * The production presence (decision of 28 October 2026): until PHY-02 no asset has physical proof, so no readiness is
 * {@code READY} and every reservation is refused, even for an otherwise eligible asset in an open window.
 */
class ReservationProductionPresenceTests extends ApiIntegrationTest {

    @Autowired
    JdbcClient jdbc;

    @Autowired
    ApplicationContext context;

    @Test
    void withoutPhysicalProofAnEligibleAssetIsNotReady() throws Exception {
        Class<?> presence = Class.forName("ca.aegis.control.asset.PhysicalPresence");
        assertEquals("NoPhysicalProofPresence", context.getBean(presence).getClass().getSimpleName());
        ReservationFixtures fixtures = new ReservationFixtures(jdbc);
        UUID asset = fixtures.asset(fixtures.scheduledLocker(accounts.admin().id()));
        String token = accessToken(accounts.technician());

        mvc.perform(post("/api/v1/reservations").header(AUTHORIZATION, bearer(token))
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetId\":\"" + asset + "\",\"reservedUntil\":\"2026-09-28T15:30:00Z\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("ASSET_NOT_READY"))
                .andExpect(jsonPath("$.reasons").value(contains("UNKNOWN_PHYSICAL_STATE")));
        assertEquals(0L, fixtures.count("SELECT count(*) FROM aegis.reservations WHERE asset_id = :id", asset));
    }
}
