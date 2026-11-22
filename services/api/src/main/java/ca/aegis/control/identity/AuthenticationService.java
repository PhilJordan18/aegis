package ca.aegis.control.identity;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
class AuthenticationService {

    private final AccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final AccessTokens accessTokens;
    private final BrowserSessions browserSessions;
    private final LoginAttemptLimiter attempts;
    private final String unknownAccountHash;

    AuthenticationService(AccountRepository accounts, PasswordEncoder passwordEncoder, AccessTokens accessTokens,
            BrowserSessions browserSessions, LoginAttemptLimiter attempts) {
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.accessTokens = accessTokens;
        this.browserSessions = browserSessions;
        this.attempts = attempts;
        this.unknownAccountHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    /** A successful sign-in: the response body and, when one was asked for, the browser session it opened. */
    record SignedIn(LoginResponse response, Optional<BrowserSessions.Started> browserSession) {

        @Override
        public String toString() {
            return "SignedIn[userId=%s, browserSession=%s]".formatted(response.user().id(), browserSession.isPresent());
        }
    }

    /**
     * A browser sign-in opens its session before the token is issued, so that the token carries the session id
     * (ADR-018). The credential version is the one read with the hash that was just verified: a password change that
     * commits after that read leaves this token with a stale version, refused on first use.
     */
    SignedIn login(LoginRequest request, String clientAddress) {
        attempts.acquire(clientAddress, request.email());
        Optional<Account> candidate = accounts.findByEmail(request.email());
        // A hash is always checked so that response time does not reveal which addresses have an account.
        boolean passwordMatches = passwordEncoder.matches(request.password(),
                candidate.map(Account::passwordHash).orElse(unknownAccountHash));
        Account account = candidate
                .filter(existing -> passwordMatches && existing.canAuthenticate())
                .orElseThrow(InvalidCredentialsException::new);
        CurrentAccount current = CurrentAccount.of(account);
        Optional<BrowserSessions.Started> started = request.wantsBrowserSession()
                ? Optional.of(browserSessions.start(current, account.passwordHash(), account.credentialVersion()))
                : Optional.empty();
        IssuedToken token = accessTokens.issue(current, account.credentialVersion(),
                started.map(BrowserSessions.Started::id).orElse(null), Instant.MAX);
        return new SignedIn(LoginResponse.of(token, current), started);
    }
}
