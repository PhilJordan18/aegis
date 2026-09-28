package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.http.HttpHeaders.RETRY_AFTER;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.support.MutableClock;

class LoginAttemptLimiterTests {

    private static final String ADDRESS = "198.51.100.7";
    private static final String EMAIL = "technician@aegis.test";

    private final MutableClock clock = new MutableClock(Instant.parse("2026-09-28T13:00:00Z"));
    private final LoginAttemptLimiter limiter = new LoginAttemptLimiter(clock);

    @Test
    void allowsFiveAttemptsPerMinuteForEachAddressAndAccount() {
        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.acquire(ADDRESS, EMAIL);
            clock.advance(Duration.ofSeconds(10));
        }

        LoginRateLimitedException refused = assertThrows(LoginRateLimitedException.class,
                () -> limiter.acquire(ADDRESS, EMAIL));
        assertEquals(ApiError.RATE_LIMITED, refused.error());
        assertEquals(Duration.ofSeconds(10), refused.retryAfter());
        assertEquals("10", refused.headers().getFirst(RETRY_AFTER));

        assertDoesNotThrow(() -> limiter.acquire("198.51.100.8", EMAIL));
        assertDoesNotThrow(() -> limiter.acquire(ADDRESS, "other@aegis.test"));
    }

    @Test
    void windowSlidesAndRefusedAttemptsAreNotRecorded() {
        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.acquire(ADDRESS, EMAIL);
        }
        clock.advance(Duration.ofSeconds(30));
        assertThrows(LoginRateLimitedException.class, () -> limiter.acquire(ADDRESS, EMAIL));

        clock.advance(Duration.ofSeconds(30));
        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.acquire(ADDRESS, EMAIL);
        }
        assertThrows(LoginRateLimitedException.class, () -> limiter.acquire(ADDRESS, EMAIL));
    }

    @Test
    void retryAfterIsRoundedUpToAWholeSecond() {
        assertEquals("2", new LoginRateLimitedException(Duration.ofMillis(1500)).headers().getFirst(RETRY_AFTER));
        assertEquals("1", new LoginRateLimitedException(Duration.ZERO).headers().getFirst(RETRY_AFTER));
    }

    @Test
    void saturationRefusesNewCombinationsWithoutResettingAnActiveLimit() {
        LoginAttemptLimiter small = new LoginAttemptLimiter(clock, 3);
        for (int attempt = 0; attempt < 5; attempt++) {
            small.acquire(ADDRESS, EMAIL);
        }
        clock.advance(Duration.ofSeconds(10));
        small.acquire("198.51.100.8", EMAIL);
        small.acquire("198.51.100.9", EMAIL);

        // Capacity is reached: a new combination is refused until the oldest window expires...
        LoginRateLimitedException full = assertThrows(LoginRateLimitedException.class,
                () -> small.acquire("203.0.113.1", EMAIL));
        assertEquals(Duration.ofSeconds(50), full.retryAfter());
        for (int flood = 0; flood < 100; flood++) {
            String address = "203.0.113." + flood;
            assertThrows(LoginRateLimitedException.class, () -> small.acquire(address, EMAIL));
        }
        // ...while the limited combination stays limited and the others keep their own remaining attempts.
        assertThrows(LoginRateLimitedException.class, () -> small.acquire(ADDRESS, EMAIL));
        for (int attempt = 0; attempt < 4; attempt++) {
            small.acquire("198.51.100.8", EMAIL);
        }
        assertThrows(LoginRateLimitedException.class, () -> small.acquire("198.51.100.8", EMAIL));

        // Once the limited window has expired, its combination may try again and takes the freed slot.
        clock.advance(Duration.ofSeconds(50));
        assertDoesNotThrow(() -> small.acquire(ADDRESS, EMAIL));
        LoginRateLimitedException stillFull = assertThrows(LoginRateLimitedException.class,
                () -> small.acquire("203.0.113.1", EMAIL));
        assertEquals(Duration.ofSeconds(10), stillFull.retryAfter());
    }

    @Test
    void expiredWindowsMakeRoomForNewCombinations() {
        LoginAttemptLimiter small = new LoginAttemptLimiter(clock, 2);
        small.acquire("198.51.100.1", EMAIL);
        clock.advance(Duration.ofSeconds(30));
        small.acquire("198.51.100.2", EMAIL);

        clock.advance(Duration.ofSeconds(30));
        assertDoesNotThrow(() -> small.acquire("198.51.100.3", EMAIL));

        LoginRateLimitedException full = assertThrows(LoginRateLimitedException.class,
                () -> small.acquire("198.51.100.4", EMAIL));
        assertEquals(Duration.ofSeconds(30), full.retryAfter());
    }

    @Test
    void defaultCapacityBoundsTrackedCombinations() {
        for (int address = 0; address < LoginAttemptLimiter.DEFAULT_CAPACITY; address++) {
            limiter.acquire("10.0." + (address / 256) + "." + (address % 256), EMAIL);
        }

        assertThrows(LoginRateLimitedException.class, () -> limiter.acquire(ADDRESS, EMAIL));
        assertDoesNotThrow(() -> limiter.acquire("10.0.0.0", EMAIL));
    }
}
