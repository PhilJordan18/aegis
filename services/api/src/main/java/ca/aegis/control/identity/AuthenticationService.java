package ca.aegis.control.identity;

import java.util.Optional;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
class AuthenticationService {

    private final AccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final AccessTokens accessTokens;
    private final LoginAttemptLimiter attempts;
    private final String unknownAccountHash;

    AuthenticationService(AccountRepository accounts, PasswordEncoder passwordEncoder, AccessTokens accessTokens,
            LoginAttemptLimiter attempts) {
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.accessTokens = accessTokens;
        this.attempts = attempts;
        this.unknownAccountHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    LoginResponse login(LoginRequest request, String clientAddress) {
        attempts.acquire(clientAddress, request.email());
        Optional<Account> candidate = accounts.findByEmail(request.email());
        // A hash is always checked so that response time does not reveal which addresses have an account.
        boolean passwordMatches = passwordEncoder.matches(request.password(),
                candidate.map(Account::passwordHash).orElse(unknownAccountHash));
        Account account = candidate
                .filter(existing -> passwordMatches && existing.canAuthenticate())
                .orElseThrow(InvalidCredentialsException::new);
        CurrentAccount current = CurrentAccount.of(account);
        return LoginResponse.of(accessTokens.issue(current), current);
    }
}
