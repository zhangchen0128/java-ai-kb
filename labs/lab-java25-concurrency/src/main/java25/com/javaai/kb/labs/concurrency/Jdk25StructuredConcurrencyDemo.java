package com.javaai.kb.labs.concurrency;

import java.lang.ScopedValue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.StructuredTaskScope;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * JDK 25 source set: Scoped Values (final, JEP 506) and Structured
 * Concurrency (fifth preview, JEP 505).
 */
public final class Jdk25StructuredConcurrencyDemo {

    private static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

    private Jdk25StructuredConcurrencyDemo() {
    }

    public record Pair(String left, String right) {
    }

    /**
     * Both subtasks inherit the immutable scoped value captured when the scope
     * is opened. The default join policy fails and cancels the scope when
     * either subtask fails.
     */
    public static Pair runPair(String requestId) throws Exception {
        return ScopedValue.where(REQUEST_ID, requestId).call(() -> {
            try (var scope = StructuredTaskScope.open()) {
                var left = scope.fork(() -> "left:" + REQUEST_ID.get());
                var right = scope.fork(() -> "right:" + REQUEST_ID.get());
                scope.join();
                return new Pair(left.get(), right.get());
            }
        });
    }

    /**
     * Starts one interruptible sibling and one failing task. The failing task
     * cancels the scope, so the unfinished sibling observes interruption.
     */
    public static Throwable runFailureAndObserveCancellation(AtomicBoolean interrupted)
            throws InterruptedException {
        var siblingStarted = new CountDownLatch(1);
        try (var scope = StructuredTaskScope.open()) {
            scope.fork(() -> {
                siblingStarted.countDown();
                try {
                    new CountDownLatch(1).await();
                    return "unexpected";
                } catch (InterruptedException expected) {
                    interrupted.set(true);
                    throw expected;
                }
            });
            scope.fork(() -> {
                siblingStarted.await();
                throw new IllegalStateException("deterministic failure");
            });
            scope.join();
            throw new AssertionError("join should propagate the failed subtask");
        } catch (StructuredTaskScope.FailedException expected) {
            return expected.getCause();
        }
    }
}
