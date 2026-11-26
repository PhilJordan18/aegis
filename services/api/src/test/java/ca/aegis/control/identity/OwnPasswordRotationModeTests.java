package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import ca.aegis.control.support.ApiIntegrationTest;

class OwnPasswordRotationModeTests extends ApiIntegrationTest {
    @DynamicPropertySource
    static void rotation(DynamicPropertyRegistry registry) {
        registry.add("aegis.identity.demo-accounts.enabled", () -> true);
        registry.add("aegis.identity.demo-accounts.rotate-passwords", () -> true);
        registry.add("aegis.identity.demo-accounts.admin.email", () -> UUID.randomUUID() + "@aegis.test");
        registry.add("aegis.identity.demo-accounts.technician.email", () -> UUID.randomUUID() + "@aegis.test");
        registry.add("aegis.identity.demo-accounts.admin.password", () -> "test-" + UUID.randomUUID());
        registry.add("aegis.identity.demo-accounts.technician.password", () -> "test-" + UUID.randomUUID());
    }

    @Autowired AccountRepository repository;

    @Test
    void explicitOperatorRotationRefusesSelfServiceWithoutChangingTheAccount() throws Exception {
        var account = accounts.technician();
        Account before = repository.findById(account.id()).orElseThrow();
        mvc.perform(post("/api/v1/auth/password").header(AUTHORIZATION, bearer(accessToken(account)))
                        .contentType(MediaType.APPLICATION_JSON).content(jsonMapper.writeValueAsString(
                                Map.of("currentPassword", account.password(), "newPassword", "replacement-password"))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_UNAVAILABLE"));
        assertEquals(before, repository.findById(account.id()).orElseThrow());
    }
}
