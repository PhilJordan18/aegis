package ca.aegis.control.identity;

import java.util.UUID;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.stereotype.Component;

/**
 * Turns a verified token into the account's current identity. A token whose account no longer exists, was
 * disabled or archived stops authenticating immediately, even before it expires.
 */
@Component
class CurrentAccountAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    private final AccountRepository accounts;

    CurrentAccountAuthenticationConverter(AccountRepository accounts) {
        this.accounts = accounts;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Account account = accounts.findById(UUID.fromString(jwt.getSubject()))
                .filter(Account::canAuthenticate)
                .orElseThrow(() -> new InvalidBearerTokenException("The token does not identify an active account"));
        return new CurrentAccountAuthentication(CurrentAccount.of(account));
    }
}
