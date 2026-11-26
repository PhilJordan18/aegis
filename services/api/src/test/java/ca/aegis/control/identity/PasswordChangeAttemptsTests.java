package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.support.ApiIntegrationTest;
import ca.aegis.control.support.MutableClock;

class PasswordChangeAttemptsTests {
    @Test
    void rollingWindowIsPerAccountAndIndependentOfSignInBudget() {
        var clock = new MutableClock(ApiIntegrationTest.START);
        var passwords = new PasswordChangeAttempts(clock);
        var logins = new LoginAttemptLimiter(clock);
        UUID owner = UUID.randomUUID();
        for (int n = 0; n < 5; n++) {
            passwords.acquire(owner);
            clock.advance(Duration.ofSeconds(10));
        }
        assertThrows(LoginRateLimitedException.class, () -> passwords.acquire(owner));
        assertDoesNotThrow(() -> passwords.acquire(UUID.randomUUID()));
        assertDoesNotThrow(() -> logins.acquire("password-change", owner.toString()));
        clock.advance(Duration.ofSeconds(10));
        passwords.acquire(owner);
        assertThrows(LoginRateLimitedException.class, () -> passwords.acquire(owner));
    }

    @Test
    void fullTrackingRefusesNewAccountsWithoutEvictingAnActiveBudget() {
        var clock = new MutableClock(ApiIntegrationTest.START);
        var passwords = new PasswordChangeAttempts(clock, 2);
        UUID first = UUID.randomUUID();
        for (int n = 0; n < 5; n++) passwords.acquire(first);
        passwords.acquire(UUID.randomUUID());
        UUID third = UUID.randomUUID();
        assertThrows(LoginRateLimitedException.class, () -> passwords.acquire(third));
        assertThrows(LoginRateLimitedException.class, () -> passwords.acquire(first));
        clock.advance(Duration.ofSeconds(60));
        assertDoesNotThrow(() -> passwords.acquire(third));
    }
}
