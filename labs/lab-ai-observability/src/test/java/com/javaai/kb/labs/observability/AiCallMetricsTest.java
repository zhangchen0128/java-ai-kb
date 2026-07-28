package com.javaai.kb.labs.observability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class AiCallMetricsTest {

    @Test
    void recordsTokensLatencyAndOutcomeWithoutPromptContent() {
        var registry = new SimpleMeterRegistry();
        var metrics = new AiCallMetrics(registry);
        metrics.record("test-model", 12, 5, Duration.ofMillis(40), false);

        assertEquals(12, registry.get("ai.tokens").tag("direction", "input").counter().count());
        assertEquals(5, registry.get("ai.tokens").tag("direction", "output").counter().count());
        assertEquals(1, registry.get("ai.requests").tag("outcome", "success").counter().count());
        assertEquals(1, registry.get("ai.request.duration").timer().count());
        assertFalse(registry.getMeters().stream()
            .flatMap(meter -> meter.getId().getTags().stream())
            .anyMatch(tag -> tag.getKey().toLowerCase().contains("prompt")));
    }

    @Test
    void exportsOpenTelemetrySpanWithoutSensitivePromptAttributes() {
        var exporter = InMemorySpanExporter.create();
        try (var provider = SdkTracerProvider.builder()
            .addSpanProcessor(SimpleSpanProcessor.create(exporter))
            .build()) {
            var openTelemetry = OpenTelemetrySdk.builder().setTracerProvider(provider).build();
            var registry = new SimpleMeterRegistry();
            var telemetry = new AiCallTelemetry(
                openTelemetry.getTracer("java-ai-kb"),
                new AiCallMetrics(registry)
            );

            assertEquals("ok", telemetry.trace(
                "test-model", 12, 5, Duration.ofMillis(40), () -> "ok"
            ));

            var span = exporter.getFinishedSpanItems().getFirst();
            assertEquals("test-model",
                span.getAttributes().get(AttributeKey.stringKey("gen_ai.request.model")));
            assertEquals(12L,
                span.getAttributes().get(AttributeKey.longKey("gen_ai.usage.input_tokens")));
            assertFalse(span.getAttributes().asMap().keySet().stream()
                .anyMatch(key -> key.getKey().toLowerCase().contains("prompt")));
        }
    }

    @Test
    void marksFailedModelCallInMetricsAndTrace() {
        var exporter = InMemorySpanExporter.create();
        try (var provider = SdkTracerProvider.builder()
            .addSpanProcessor(SimpleSpanProcessor.create(exporter))
            .build()) {
            var openTelemetry = OpenTelemetrySdk.builder().setTracerProvider(provider).build();
            var registry = new SimpleMeterRegistry();
            var telemetry = new AiCallTelemetry(
                openTelemetry.getTracer("java-ai-kb"),
                new AiCallMetrics(registry)
            );

            assertThrows(IllegalStateException.class, () -> telemetry.trace(
                "test-model", 1, 0, Duration.ofMillis(10),
                () -> { throw new IllegalStateException("provider failed"); }
            ));

            assertEquals(StatusCode.ERROR, exporter.getFinishedSpanItems().getFirst().getStatus().getStatusCode());
            assertEquals(1, registry.get("ai.requests").tag("outcome", "error").counter().count());
        }
    }
}
