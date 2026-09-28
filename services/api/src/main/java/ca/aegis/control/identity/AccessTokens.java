package ca.aegis.control.identity;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

/**
 * Issues and validates the P0 access token (ADR-007): an HS256 JWT valid for 60 minutes, without refresh token.
 * Claim mapping: {@code sub} = account id, {@code jti} = random token id, {@code iat}/{@code exp}, {@code iss},
 * {@code aud}, plus {@code role} and {@code maximumAccessLevel} as issued. Those two claims describe the account at
 * login time only; protected requests re-read the account and never grant a right from them.
 */
@Component
class AccessTokens {

    static final Duration LIFETIME = Duration.ofMinutes(60);
    static final String ROLE_CLAIM = "role";
    static final String ACCESS_LEVEL_CLAIM = "maximumAccessLevel";

    private final JwtEncoder encoder;
    private final JwtProperties properties;
    private final Clock clock;

    AccessTokens(JwtEncoder encoder, JwtProperties properties, Clock clock) {
        this.encoder = encoder;
        this.properties = properties;
        this.clock = clock;
    }

    IssuedToken issue(CurrentAccount account) {
        Instant issuedAt = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = issuedAt.plus(LIFETIME);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.issuer())
                .audience(List.of(properties.audience()))
                .subject(account.id().toString())
                .id(UUID.randomUUID().toString())
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .claim(ROLE_CLAIM, account.role().name())
                .claim(ACCESS_LEVEL_CLAIM, account.maximumAccessLevel().name())
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        String value = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedToken(value, issuedAt, expiresAt);
    }

    /** Validates claims after the signature and the HS256 algorithm have been checked by the decoder. */
    static final class Validator implements OAuth2TokenValidator<Jwt> {

        static final String EXPIRED = "The access token has expired";

        private final Clock clock;
        private final String issuer;
        private final String audience;

        Validator(Clock clock, String issuer, String audience) {
            this.clock = clock;
            this.issuer = issuer;
            this.audience = audience;
        }

        @Override
        public OAuth2TokenValidatorResult validate(Jwt jwt) {
            List<OAuth2Error> errors = new ArrayList<>();
            if (!issuer.equals(jwt.getClaimAsString(JwtClaimNames.ISS))) {
                errors.add(invalid("Unexpected issuer"));
            }
            List<String> audiences = jwt.getAudience();
            if (audiences == null || !audiences.contains(audience)) {
                errors.add(invalid("Unexpected audience"));
            }
            if (!isUuid(jwt.getSubject())) {
                errors.add(invalid("The subject is not an account identifier"));
            }
            if (!isUuid(jwt.getId())) {
                errors.add(invalid("The token identifier is missing"));
            }
            if (!isEnumName(Role.class, jwt.getClaimAsString(ROLE_CLAIM))
                    || !isEnumName(AccessLevel.class, jwt.getClaimAsString(ACCESS_LEVEL_CLAIM))) {
                errors.add(invalid("The account claims are missing"));
            }
            Instant now = clock.instant();
            Instant issuedAt = jwt.getIssuedAt();
            Instant expiresAt = jwt.getExpiresAt();
            if (issuedAt == null || expiresAt == null) {
                errors.add(invalid("The token lifetime is missing"));
            } else {
                Duration lifetime = Duration.between(issuedAt, expiresAt);
                if (issuedAt.isAfter(now) || lifetime.isNegative() || lifetime.isZero()
                        || lifetime.compareTo(LIFETIME) > 0) {
                    errors.add(invalid("The token lifetime is not acceptable"));
                }
                if (!now.isBefore(expiresAt)) {
                    errors.add(new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, EXPIRED, null));
                }
            }
            return errors.isEmpty() ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(errors);
        }

        private static OAuth2Error invalid(String description) {
            return new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, description, null);
        }

        private static boolean isUuid(String value) {
            if (value == null) {
                return false;
            }
            try {
                return UUID.fromString(value).toString().equals(value);
            } catch (IllegalArgumentException notUuid) {
                return false;
            }
        }

        private static <E extends Enum<E>> boolean isEnumName(Class<E> type, String value) {
            if (value == null) {
                return false;
            }
            for (E constant : type.getEnumConstants()) {
                if (constant.name().equals(value)) {
                    return true;
                }
            }
            return false;
        }
    }
}
