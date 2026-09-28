package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.Base64;

import javax.crypto.SecretKey;

import org.junit.jupiter.api.Test;

import ca.aegis.control.support.ApiIntegrationTest;

class JwtPropertiesTests {

    @Test
    void base64KeyOfAtLeast256BitsBecomesAnHmacSha256Key() {
        SecretKey key = new JwtProperties(ApiIntegrationTest.randomBase64(32), "aegis-control", "aegis-api")
                .signingKey();

        assertEquals("HmacSHA256", key.getAlgorithm());
        assertEquals(32, key.getEncoded().length);
    }

    @Test
    void missingMalformedOrShortKeyStopsStartupWithoutEchoingIt() {
        String shortKey = Base64.getEncoder().encodeToString(new byte[31]);
        for (String secret : Arrays.asList(null, "", "   ", "not base64 !", shortKey)) {
            IllegalStateException failure = assertThrows(IllegalStateException.class,
                    () -> new JwtProperties(secret, "aegis-control", "aegis-api").signingKey());
            assertThat(failure.getMessage()).contains("AEGIS_JWT_SECRET");
            if (secret != null && !secret.isBlank()) {
                assertThat(failure.getMessage()).doesNotContain(secret);
            }
        }
    }

    @Test
    void issuerAndAudienceAreRequired() {
        String secret = ApiIntegrationTest.randomBase64(32);
        assertThrows(IllegalStateException.class, () -> new JwtProperties(secret, " ", "aegis-api"));
        assertThrows(IllegalStateException.class, () -> new JwtProperties(secret, "aegis-control", null));
    }

    @Test
    void keyIsNeverPrinted() {
        String secret = ApiIntegrationTest.randomBase64(32);
        assertThat(new JwtProperties(secret, "aegis-control", "aegis-api").toString()).doesNotContain(secret);
    }
}
