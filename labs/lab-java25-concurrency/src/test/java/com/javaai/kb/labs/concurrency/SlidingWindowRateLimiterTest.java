package com.javaai.kb.labs.concurrency;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class SlidingWindowRateLimiterTest {

    @Test
    void rejectsRequestsAboveCapacityInTheSameWindow() {
        var clock = new AtomicLong(0);
        var limiter = new SlidingWindowRateLimiter(
            3, Duration.ofSeconds(1), 10, clock::get
        );

        assertTrue(limiter.tryAcquire());
        assertTrue(limiter.tryAcquire());
        assertTrue(limiter.tryAcquire());
        assertFalse(limiter.tryAcquire());
    }

    @Test
    void retainsCountsAcrossAdjacentBucketsAndExpiresAFullWindowLater() {
        var clock = new AtomicLong(0);
        var limiter = new SlidingWindowRateLimiter(
            2, Duration.ofSeconds(1), 10, clock::get
        );

        assertTrue(limiter.tryAcquire());
        clock.set(900);
        assertTrue(limiter.tryAcquire());
        assertFalse(limiter.tryAcquire());

        clock.set(1_000);
        assertTrue(limiter.tryAcquire(), "the request from epoch zero must expire");
        assertFalse(limiter.tryAcquire(), "the request at 900 ms remains visible");
    }

    @Test
    void enforcesCapacityUnderConcurrentCallers() throws Exception {
        var limiter = new SlidingWindowRateLimiter(
            12, Duration.ofSeconds(1), 10, () -> 0L
        );
        var accepted = new AtomicInteger();

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = IntStream.range(0, 100)
                .mapToObj(index -> executor.submit(() -> {
                    if (limiter.tryAcquire()) {
                        accepted.incrementAndGet();
                    }
                }))
                .toList();
            for (var future : futures) {
                future.get();
            }
        }

        assertTrue(accepted.get() == 12, "exactly the configured capacity is accepted");
    }

    @Test
    void rejectsInvalidConfiguration() {
        assertThrows(IllegalArgumentException.class,
            () -> new SlidingWindowRateLimiter(0, Duration.ofSeconds(1), 10));
        assertThrows(IllegalArgumentException.class,
            () -> new SlidingWindowRateLimiter(1, Duration.ofMillis(5), 10));
    }
}
