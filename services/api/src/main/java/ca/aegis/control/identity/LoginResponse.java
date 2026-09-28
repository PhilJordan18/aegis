package ca.aegis.control.identity;

import java.time.Duration;
import java.time.Instant;

/** {@code POST /api/v1/auth/login} response (document 09, section 10.2). */
record LoginResponse(String accessToken, String tokenType, long expiresIn, Instant expiresAt, UserProfile user) {

    static LoginResponse of(IssuedToken token, CurrentAccount account) {
        return new LoginResponse(token.value(), "Bearer",
                Duration.between(token.issuedAt(), token.expiresAt()).toSeconds(), token.expiresAt(),
                UserProfile.of(account));
    }

    @Override
    public String toString() {
        return "LoginResponse[tokenType=%s, expiresAt=%s, user=%s]".formatted(tokenType, expiresAt, user);
    }
}
