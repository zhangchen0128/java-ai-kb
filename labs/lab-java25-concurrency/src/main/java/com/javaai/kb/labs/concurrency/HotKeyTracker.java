package com.javaai.kb.labs.concurrency;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * Counts accesses in deterministic time windows and emits one promotion event
 * when a key reaches the configured hot-key threshold.
 */
public final class HotKeyTracker {

    private static final int DEFAULT_MAX_TRACKED_KEYS = 10_000;

    @FunctionalInterface
    public interface PromotionListener {
        void promote(String key, int requestsInWindow);
    }

    public record Observation(
            int requestsInWindow,
            boolean promotedNow,
            boolean tracked) {
    }

    private final int threshold;
    private final long windowMillis;
    private final int maxTrackedKeys;
    private final LongSupplier clock;
    private final PromotionListener listener;
    private final Map<String, WindowCounter> counters = new HashMap<>();

    public HotKeyTracker(
            int threshold,
            Duration window,
            PromotionListener listener) {
        this(
            threshold,
            window,
            DEFAULT_MAX_TRACKED_KEYS,
            System::currentTimeMillis,
            listener
        );
    }

    HotKeyTracker(
            int threshold,
            Duration window,
            LongSupplier clock,
            PromotionListener listener) {
        this(threshold, window, DEFAULT_MAX_TRACKED_KEYS, clock, listener);
    }

    HotKeyTracker(
            int threshold,
            Duration window,
            int maxTrackedKeys,
            LongSupplier clock,
            PromotionListener listener) {
        Objects.requireNonNull(window, "window");
        long resolvedWindowMillis = window.toMillis();
        if (threshold <= 0 || resolvedWindowMillis <= 0 || maxTrackedKeys <= 0) {
            throw new IllegalArgumentException(
                "threshold, millisecond window, and maxTrackedKeys must be positive"
            );
        }
        this.threshold = threshold;
        this.windowMillis = resolvedWindowMillis;
        this.maxTrackedKeys = maxTrackedKeys;
        this.clock = Objects.requireNonNull(clock, "clock");
        this.listener = Objects.requireNonNull(listener, "listener");
    }

    public Observation recordAccess(String key) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("key must not be blank");
        }

        long windowId = Math.floorDiv(clock.getAsLong(), windowMillis);
        Observation observation;
        String keyToPromote = null;
        synchronized (this) {
            var counter = counters.get(key);
            if (counter == null) {
                counters.entrySet().removeIf(
                    entry -> entry.getValue().windowId != windowId
                );
                if (counters.size() >= maxTrackedKeys) {
                    return new Observation(0, false, false);
                }
                counter = new WindowCounter(windowId);
                counters.put(key, counter);
            } else if (counter.windowId != windowId) {
                counter = new WindowCounter(windowId);
                counters.put(key, counter);
            }

            counter.requests++;
            boolean promotedNow =
                counter.requests >= threshold && !counter.promoted;
            if (promotedNow) {
                counter.promoted = true;
                keyToPromote = key;
            }
            observation = new Observation(counter.requests, promotedNow, true);
        }

        // A cache/Redis callback may block; never execute it while holding the
        // counter-map monitor.
        if (keyToPromote != null) {
            listener.promote(keyToPromote, observation.requestsInWindow());
        }
        return observation;
    }

    private static final class WindowCounter {
        private final long windowId;
        private int requests;
        private boolean promoted;

        private WindowCounter(long windowId) {
            this.windowId = windowId;
        }
    }
}
