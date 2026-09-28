package ca.aegis.control.identity;

import java.time.Instant;

record IssuedToken(String value, Instant issuedAt, Instant expiresAt) {

    @Override
    public String toString() {
        return "IssuedToken[issuedAt=%s, expiresAt=%s]".formatted(issuedAt, expiresAt);
    }
}
