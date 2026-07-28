package com.javaai.kb.labs.concurrency;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * A thread-safe, bucketed sliding-window rate limiter.
 *
 * <p>The package-private clock constructor makes all boundary behavior
 * deterministic in tests without sleeping.</p>
 */
public final class SlidingWindowRateLimiter {

    private final int maxRequests;
    private final int bucketCount;
    private final long bucketWidthMillis;
    private final long[] bucketEpochs;
    private final int[] bucketCounts;
    private final LongSupplier clock;

    public SlidingWindowRateLimiter(int maxRequests, Duration window, int bucketCount) {
        this(maxRequests, window, bucketCount, System::currentTimeMillis);
    }

    SlidingWindowRateLimiter(
            int maxRequests,
            Duration window,
            int bucketCount,
            LongSupplier clock) {
        Objects.requireNonNull(window, "window");
        this.clock = Objects.requireNonNull(clock, "clock");
        long windowMillis = window.toMillis();
        if (maxRequests <= 0 || bucketCount <= 0 || windowMillis < bucketCount) {
            throw new IllegalArgumentException(
                "maxRequests and bucketCount must be positive, and window must fit all buckets"
            );
        }

        this.maxRequests = maxRequests;
        this.bucketCount = bucketCount;
        this.bucketWidthMillis = windowMillis / bucketCount;
        this.bucketEpochs = new long[bucketCount];
        this.bucketCounts = new int[bucketCount];
        java.util.Arrays.fill(bucketEpochs, Long.MIN_VALUE);
    }

    public synchronized boolean tryAcquire() {
        long epoch = Math.floorDiv(clock.getAsLong(), bucketWidthMillis);
        int currentIndex = Math.floorMod(epoch, bucketCount);
        if (bucketEpochs[currentIndex] != epoch) {
            bucketEpochs[currentIndex] = epoch;
            bucketCounts[currentIndex] = 0;
        }

        long oldestVisibleEpoch = epoch - bucketCount + 1;
        int currentRequests = 0;
        for (int index = 0; index < bucketCount; index++) {
            if (bucketEpochs[index] >= oldestVisibleEpoch
                    && bucketEpochs[index] <= epoch) {
                currentRequests += bucketCounts[index];
            }
        }

        if (currentRequests >= maxRequests) {
            return false;
        }
        bucketCounts[currentIndex]++;
        return true;
    }
}
