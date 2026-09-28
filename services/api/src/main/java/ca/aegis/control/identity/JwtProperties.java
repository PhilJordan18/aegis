package ca.aegis.control.identity;

import java.util.Base64;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Access-token settings. The HS256 key comes from {@code AEGIS_JWT_SECRET} and is never committed; startup fails
 * when it is absent, not Base64 or shorter than 256 bits. Rotating it invalidates every issued token.
 */
@ConfigurationProperties("aegis.security.jwt")
public record JwtProperties(String secret, String issuer, String audience) {

    static final int MINIMUM_KEY_BYTES = 32;

    public JwtProperties {
        if (issuer == null || issuer.isBlank()) {
            throw new IllegalStateException("aegis.security.jwt.issuer must not be blank");
        }
        if (audience == null || audience.isBlank()) {
            throw new IllegalStateException("aegis.security.jwt.audience must not be blank");
        }
    }

    SecretKey signingKey() {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "AEGIS_JWT_SECRET (aegis.security.jwt.secret) must be set to a Base64 value of at least 32 random bytes");
        }
        byte[] key;
        try {
            key = Base64.getDecoder().decode(secret.strip());
        } catch (IllegalArgumentException notBase64) {
            throw new IllegalStateException("AEGIS_JWT_SECRET (aegis.security.jwt.secret) must be Base64 encoded");
        }
        if (key.length < MINIMUM_KEY_BYTES) {
            throw new IllegalStateException(
                    "AEGIS_JWT_SECRET (aegis.security.jwt.secret) must decode to at least 32 bytes");
        }
        return new SecretKeySpec(key, "HmacSHA256");
    }

    @Override
    public String toString() {
        return "JwtProperties[issuer=%s, audience=%s, secret=<redacted>]".formatted(issuer, audience);
    }
}
