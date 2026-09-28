package ca.aegis.control.shared.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class WebContractTests {

    @Test
    void violationCodesAreDerivedFromConstraintNames() {
        assertEquals("NOT_BLANK", ApiExceptionHandler.violationCode("NotBlank"));
        assertEquals("NOT_EMPTY", ApiExceptionHandler.violationCode("NotEmpty"));
        assertEquals("EMAIL", ApiExceptionHandler.violationCode("Email"));
        assertEquals("MAX_UTF8_BYTES", ApiExceptionHandler.violationCode("MaxUtf8Bytes"));
        assertEquals("INVALID_VALUE", ApiExceptionHandler.violationCode(null));
    }

    @Test
    void validClientRequestIdIsKeptAndAnyOtherIsReplaced() {
        String client = "5f4bc22e-66a4-48ef-8bf3-6e7184d71c30";
        assertEquals(client, RequestIdFilter.acceptedOrGenerated(client));

        for (String rejected : new String[] {null, "", "request-1", client + "\n", "x".repeat(200)}) {
            String generated = RequestIdFilter.acceptedOrGenerated(rejected);
            assertEquals(generated, UUID.fromString(generated).toString());
            assertNotEquals(rejected, generated);
        }
    }

    @Test
    void problemTypesFollowTheStableCode() {
        assertEquals("https://aegis.local/problems/auth-invalid-credentials",
                ApiError.AUTH_INVALID_CREDENTIALS.type().toString());
        assertEquals("https://aegis.local/problems/rate-limited", ApiError.RATE_LIMITED.type().toString());
    }
}
