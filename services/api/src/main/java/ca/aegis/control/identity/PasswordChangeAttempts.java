package ca.aegis.control.identity;

import java.time.Clock;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;

/** Independent account-wide budget; rotating source addresses cannot renew it. Keys are server-authenticated UUIDs. */
@Component
class PasswordChangeAttempts {
    private final LoginAttemptLimiter windows;

    @Autowired
    PasswordChangeAttempts(Clock clock) {
        this(clock, LoginAttemptLimiter.DEFAULT_CAPACITY);
    }

    PasswordChangeAttempts(Clock clock, int capacity) {
        windows = new LoginAttemptLimiter(clock, capacity);
    }

    void acquire(UUID accountId) {
        windows.acquire("password-change", accountId.toString());
    }
}
