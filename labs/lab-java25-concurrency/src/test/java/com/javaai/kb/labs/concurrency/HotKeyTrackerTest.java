package com.javaai.kb.labs.concurrency;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class HotKeyTrackerTest {

    @Test
    void promotesExactlyOnceWhenThresholdIsReached() {
        var promotions = new AtomicInteger();
        var tracker = new HotKeyTracker(
            3, Duration.ofSeconds(1), () -> 0L,
            (key, requests) -> promotions.incrementAndGet()
        );

        assertFalse(tracker.recordAccess("user:42").promotedNow());
        assertFalse(tracker.recordAccess("user:42").promotedNow());
        assertTrue(tracker.recordAccess("user:42").promotedNow());
        assertFalse(tracker.recordAccess("user:42").promotedNow());
        assertEquals(1, promotions.get());
    }

    @Test
    void startsANewCounterAndCanPromoteAgainInTheNextWindow() {
        var clock = new AtomicLong(0);
        var promotions = new AtomicInteger();
        var tracker = new HotKeyTracker(
            2, Duration.ofSeconds(1), clock::get,
            (key, requests) -> promotions.incrementAndGet()
        );

        tracker.recordAccess("catalog");
        tracker.recordAccess("catalog");
        clock.set(1_000);
        assertEquals(1, tracker.recordAccess("catalog").requestsInWindow());
        assertTrue(tracker.recordAccess("catalog").promotedNow());
        assertEquals(2, promotions.get());
    }

    @Test
    void emitsOnePromotionUnderConcurrentAccess() throws Exception {
        var promotions = new AtomicInteger();
        var tracker = new HotKeyTracker(
            10, Duration.ofSeconds(1), () -> 0L,
            (key, requests) -> promotions.incrementAndGet()
        );

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = IntStream.range(0, 100)
                .mapToObj(index -> executor.submit(() -> tracker.recordAccess("hot")))
                .toList();
            for (var future : futures) {
                future.get();
            }
        }

        assertEquals(1, promotions.get());
        assertEquals(101, tracker.recordAccess("hot").requestsInWindow());
    }

    @Test
    void rejectsInvalidInput() {
        assertThrows(IllegalArgumentException.class,
            () -> new HotKeyTracker(0, Duration.ofSeconds(1), (key, count) -> { }));
        assertThrows(IllegalArgumentException.class,
            () -> new HotKeyTracker(1, Duration.ofNanos(1), (key, count) -> { }));
        var tracker = new HotKeyTracker(
            1, Duration.ofSeconds(1), (key, count) -> { }
        );
        assertThrows(IllegalArgumentException.class, () -> tracker.recordAccess(" "));

        var bounded = new HotKeyTracker(
            2, Duration.ofSeconds(1), 1, () -> 0L, (key, count) -> { }
        );
        assertTrue(bounded.recordAccess("first").tracked());
        assertFalse(bounded.recordAccess("second").tracked());
    }
}
