package ca.aegis.control.identity;

import java.util.List;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/** Authentication whose single authority is the role currently stored for the account. */
final class CurrentAccountAuthentication extends AbstractAuthenticationToken {

    private final CurrentAccount account;

    CurrentAccountAuthentication(CurrentAccount account) {
        super(List.of(new SimpleGrantedAuthority(account.role().authority())));
        this.account = account;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return "";
    }

    @Override
    public CurrentAccount getPrincipal() {
        return account;
    }

    @Override
    public String getName() {
        return account.id().toString();
    }
}
