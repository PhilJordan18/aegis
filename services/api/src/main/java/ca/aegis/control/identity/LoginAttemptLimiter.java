package ca.aegis.control.identity;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Sliding-window limit of document 09, section 23.4: at most five sign-in attempts per minute for each client
 * address and account combination.
 * <p>
 * State is in memory and per instance, which holds only for the single-instance P0 deployment: several instances
 * would each allow five attempts, and a restart forgets every window. Memory is bounded by expiring windows and,
 * when every tracked window is still active, by refusing new combinations instead of evicting one, so that
 * saturation can never reset an active limit.
 */
@Component
class LoginAttemptLimiter {

    static final int MAX_ATTEMPTS = 5;
    static final Duration WINDOW = Duration.ofMinutes(1);
    static final int DEFAULT_CAPACITY = 10_000;

    private static final Logger log = LoggerFactory.getLogger(LoginAttemptLimiter.class);

    private final Clock clock;
    private final int capacity;
    /** Iteration order is the order of each combination's latest recorded attempt, oldest first. */
    private final LinkedHashMap<String, Deque<Instant>> windows = new LinkedHashMap<>();
    private boolean saturated;

    @Autowired
    LoginAttemptLimiter(Clock clock) {
        this(clock, DEFAULT_CAPACITY);
    }

    LoginAttemptLimiter(Clock clock, int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.clock = clock;
        this.capacity = capacity;
    }

    /** Records an attempt, or refuses it without recording it. */
    synchronized void acquire(String clientAddress, String normalizedEmail) {
        Instant now = clock.instant();
        Instant windowStart = now.minus(WINDOW);
        discardExpiredWindows(windowStart);
        String key = clientAddress + '\n' + normalizedEmail;
        Deque<Instant> attempts = windows.get(key);
        if (attempts == null) {
            attempts = startWindow(now);
        } else {
            while (!attempts.isEmpty() && !attempts.peekFirst().isAfter(windowStart)) {
                attempts.pollFirst();
            }
            if (attempts.size() >= MAX_ATTEMPTS) {
                throw new LoginRateLimitedException(Duration.between(now, attempts.peekFirst().plus(WINDOW)));
            }
            windows.remove(key);
        }
        attempts.addLast(now);
        windows.put(key, attempts);
    }

    private Deque<Instant> startWindow(Instant now) {
        if (windows.size() >= capacity) {
            if (!saturated) {
                saturated = true;
                log.warn("Sign-in attempt tracking holds {} active windows; new combinations are refused until "
                        + "windows expire", capacity);
            }
            Instant oldestLatestAttempt = windows.firstEntry().getValue().peekLast();
            throw new LoginRateLimitedException(Duration.between(now, oldestLatestAttempt.plus(WINDOW)));
        }
        if (saturated) {
            saturated = false;
            log.info("Sign-in attempt tracking accepts new combinations again");
        }
        return new ArrayDeque<>(MAX_ATTEMPTS);
    }

    /** Expired windows are at the head, because each recorded attempt moves its combination to the tail. */
    private void discardExpiredWindows(Instant windowStart) {
        Iterator<Deque<Instant>> oldestFirst = windows.values().iterator();
        while (oldestFirst.hasNext()) {
            if (oldestFirst.next().peekLast().isAfter(windowStart)) {
                return;
            }
            oldestFirst.remove();
        }
    }
}
