package ca.aegis.control.identity;

import java.time.Clock;
import java.util.UUID;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.stereotype.Component;

/**
 * Turns a verified token into the account's current identity. A token whose account no longer exists, was
 * disabled or archived stops authenticating immediately, even before it expires. So does a token issued before the
 * account's last password change, and a token whose browser session was revoked or ended (ADR-018): both are checked
 * against the same single read of the account.
 *
 * <p>A request authenticated just before a revocation commits still completes: the accepted window is the length of one
 * request, not the token lifetime.
 */
@Component
class CurrentAccountAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    private final AccountRepository accounts;
    private final Clock clock;

    CurrentAccountAuthenticationConverter(AccountRepository accounts, Clock clock) {
        this.accounts = accounts;
        this.clock = clock;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        long credentialVersion = AccessTokens.Validator.credentialVersion(jwt);
        UUID sessionId = AccessTokens.Validator.sessionId(jwt);
        Account account = accounts.findTokenOwner(UUID.fromString(jwt.getSubject()), sessionId, clock.instant())
                .filter(owner -> sessionId == null || owner.sessionOpen())
                .map(AccountRepository.TokenOwner::account)
                .filter(Account::canAuthenticate)
                .filter(existing -> existing.credentialVersion() == credentialVersion)
                .orElseThrow(() -> new InvalidBearerTokenException("The token does not identify an active account"));
        return new CurrentAccountAuthentication(CurrentAccount.of(account));
    }
}
