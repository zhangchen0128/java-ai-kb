package com.javaai.kb.labs.observability;

import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import java.time.Duration;
import java.util.Objects;
import java.util.function.Supplier;

/** OpenTelemetry trace boundary paired with the low-cardinality metrics lab. */
public final class AiCallTelemetry {

    private final Tracer tracer;
    private final AiCallMetrics metrics;

    public AiCallTelemetry(Tracer tracer, AiCallMetrics metrics) {
        this.tracer = Objects.requireNonNull(tracer);
        this.metrics = Objects.requireNonNull(metrics);
    }

    public <T> T trace(
            String model,
            int inputTokens,
            int outputTokens,
            Duration duration,
            Supplier<T> operation) {
        Objects.requireNonNull(operation);
        var span = tracer.spanBuilder("gen_ai.model.call")
            .setSpanKind(SpanKind.CLIENT)
            .setAttribute("gen_ai.request.model", model)
            .setAttribute("gen_ai.usage.input_tokens", inputTokens)
            .setAttribute("gen_ai.usage.output_tokens", outputTokens)
            .startSpan();
        try (var ignored = span.makeCurrent()) {
            var result = operation.get();
            metrics.record(model, inputTokens, outputTokens, duration, false);
            span.setStatus(StatusCode.OK);
            return result;
        } catch (RuntimeException error) {
            metrics.record(model, inputTokens, outputTokens, duration, true);
            span.recordException(error);
            span.setStatus(StatusCode.ERROR, error.getClass().getSimpleName());
            throw error;
        } finally {
            span.end();
        }
    }
}
