package com.javaai.kb.labs.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.Objects;

/** Low-cardinality AI metrics that intentionally never record prompt content. */
public final class AiCallMetrics {

    private final MeterRegistry registry;

    public AiCallMetrics(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry);
    }

    public void record(String model, int inputTokens, int outputTokens, Duration duration, boolean error) {
        if (model == null || model.isBlank()) throw new IllegalArgumentException("model is required");
        if (inputTokens < 0 || outputTokens < 0) throw new IllegalArgumentException("tokens must be non-negative");

        Counter.builder("ai.tokens")
            .tag("model", model)
            .tag("direction", "input")
            .register(registry)
            .increment(inputTokens);
        Counter.builder("ai.tokens")
            .tag("model", model)
            .tag("direction", "output")
            .register(registry)
            .increment(outputTokens);
        Counter.builder("ai.requests")
            .tag("model", model)
            .tag("outcome", error ? "error" : "success")
            .register(registry)
            .increment();
        Timer.builder("ai.request.duration")
            .tag("model", model)
            .register(registry)
            .record(duration);
    }
}
