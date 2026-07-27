---
domain: "06-云原生与SRE"
title: "OpenTelemetry 可观测性体系"
status: "verified"
verification:
  reviewed_at: "2026-07-27"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
level: "advanced"
sources:
  - level: "L1"
    url: "https://opentelemetry.io/docs/languages/java/"
    description: "OpenTelemetry Java 官方文档"
  - level: "L1"
    url: "https://opentelemetry.io/docs/specs/semconv/gen-ai/"
    description: "OpenTelemetry GenAI 语义约定"
  - level: "L1"
    url: "https://grafana.com/docs/grafana/latest/"
    description: "Grafana 官方文档"
  - level: "L1"
    url: "https://prometheus.io/docs/introduction/overview/"
    description: "Prometheus 官方文档"
relations:
  prerequisite: ["05-分布式一致性与事务方案", "06-Docker与Kubernetes云原生部署"]
  related: ["06-CICD与基础设施即代码", "14-模型网关与Prompt管理"]
tags: ["opentelemetry", "observability", "metrics", "tracing", "logging", "genai-semconv", "prometheus", "grafana", "tempo", "loki"]
created: "2026-07-17"
updated: "2026-07-17"
---

# OpenTelemetry 可观测性体系

## 概述

可观测性（Observability）是生产系统运维的基础能力。OpenTelemetry（OTel）作为 CNCF 孵化项目，已成为分布式追踪、指标和日志的统一标准。在 AI 应用中，GenAI 语义约定（SemConv）为 LLM 调用、RAG 检索、Tool Calling 提供了标准化的观测维度。

本文深入 OTel 架构、Java 集成方案、GenAI 语义约定的完整应用、Prometheus + Grafana 实现，以及 AI 应用专属的 Dashboard 和告警设计。

---

## 一、可观测性三支柱

| 支柱 | 回答的问题 | 典型工具 | 数据模型 |
|------|-----------|----------|----------|
| Metrics | "系统发生了什么？" | Prometheus | Counter/Gauge/Histogram/Summary |
| Tracing | "一次请求如何流转？" | Tempo/Jaeger | Span/Trace |
| Logging | "具体发生了什么？" | Loki/ELK | 结构化日志 |

**三者关系：** Metrics 发现问题，Tracing 定位问题范围，Logging 提供问题细节。

```
请求示例：
  Metrics: "延迟 P99 从 200ms 飙升到 2s"（发现问题）
  Tracing: "RAG 检索耗时 1.5s，ES 查询占 1.2s"（定位范围）
  Logging: "ES 查询日志显示 shard failure"（定位原因）
```

---

## 二、OpenTelemetry 架构

### 2.1 核心组件

```
┌──────────────────────────────────────────────────────────────────┐
│                         Application                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │   Tracer    │  │   Meter     │  │   Logger                 │ │
│  │  (Span)     │  │  (Metric)   │  │  (LogRecord)             │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────────────────┘ │
│         │                │                │                      │
│  ┌──────▼────────────────▼────────────────▼──────────────────┐  │
│  │              OTel SDK / API                                │  │
│  │  SpanProcessor / MetricReader / LogRecordProcessor         │  │
│  └──────┬─────────────────────────────────────────────────────┘  │
└─────────┼────────────────────────────────────────────────────────┘
          │ OTLP (OpenTelemetry Protocol): gRPC/HTTP
          ▼
┌─────────────────────────────────────────────────────┐
│               OTel Collector                        │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐          │
│  │Receivers│  │Processors│  │ Exporters │          │
│  │ OTLP    │  │ Batch    │  │ Prometheus│          │
│  │ Jaeger  │  │ Filter   │  │ OTLP     │          │
│  │ Zipkin  │  │ Transform│  │ Jaeger   │          │
│  └─────────┘  └──────────┘  └──────────┘          │
└─────────────────┬─────────────────┬─────────────────┘
                  │                 │
         ┌────────▼────┐   ┌───────▼──────┐
         │  Prometheus  │   │  Tempo/Jaeger│
         │  (Metrics)   │   │  (Traces)    │
         └──────────────┘   └──────────────┘
```

### 2.2 Context Propagation

```
HTTP Request Headers:
  traceparent: 00-<trace_id>-<span_id>-01
  tracestate: vendor-specific-key=value

W3C TraceContext 格式：
  version(2hex)-trace-id(32hex)-span-id(16hex)-trace-flags(2hex)
  例: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

### 2.3 Span 结构

```
Trace:
├── Span A: "POST /api/chat"              [duration: 3.2s]
│   ├── Span B: "llm request gpt-4"       [duration: 3.0s]
│   │   └── Span C: "openai.chat.completions"  [duration: 2.9s]
│   ├── Span D: "rag retrieve"            [duration: 0.15s]
│   │   ├── Span E: "embed query"         [duration: 0.05s]
│   │   └── Span F: "pgvector search"     [duration: 0.10s]
│   └── Span G: "prompt assemble"         [duration: 0.02s]
```

---

## 三、Java 集成

### 3.1 OpenTelemetry Java Agent（零代码接入）

```bash
# 启动时附加 Java Agent
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.service.name=ai-rag-service \
  -Dotel.traces.exporter=otlp \
  -Dotel.metrics.exporter=otlp \
  -Dotel.logs.exporter=otlp \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4317 \
  -Dotel.resource.attributes=deployment.environment=production \
  -jar ai-rag-service.jar
```

**Agent 自动埋点覆盖：**
- Spring Web (HTTP Server/Client)
- JDBC (数据库查询)
- Kafka (生产者/消费者)
- Redis (Lettuce/Jedis)
- gRPC
- Spring Scheduling
- 等等（60+ 库）

### 3.2 手动埋点

```java
@Configuration
public class OpenTelemetryConfig {

    @Bean
    public OpenTelemetry openTelemetry() {
        var resource = Resource.getDefault()
                .merge(Resource.builder()
                        .put(ResourceAttributes.SERVICE_NAME, "ai-rag-service")
                        .put(ResourceAttributes.SERVICE_VERSION, "1.0.0")
                        .put(ResourceAttributes.DEPLOYMENT_ENVIRONMENT,
                                System.getenv().getOrDefault("ENV", "dev"))
                        .build());

        var sdkTracerProvider = SdkTracerProvider.builder()
                .setResource(resource)
                .addSpanProcessor(BatchSpanProcessor
                        .builder(OtlpGrpcSpanExporter.builder()
                                .setEndpoint("http://otel-collector:4317")
                                .build())
                        .build())
                .build();

        var sdkMeterProvider = SdkMeterProvider.builder()
                .setResource(resource)
                .registerMetricReader(PeriodicMetricReader
                        .builder(OtlpGrpcMetricExporter.builder()
                                .setEndpoint("http://otel-collector:4317")
                                .build())
                        .setInterval(Duration.ofSeconds(30))
                        .build())
                .build();

        return OpenTelemetrySdk.builder()
                .setTracerProvider(sdkTracerProvider)
                .setMeterProvider(sdkMeterProvider)
                .setPropagators(ContextPropagators.create(
                        W3CTraceContextPropagator.getInstance()))
                .build();
    }
}
```

### 3.3 Micrometer 桥接

```yaml
management:
  metrics:
    tags:
      application: ai-rag-service
      environment: production
  tracing:
    sampling:
      probability: 0.1  # 10% 采样率（生产环境）
  otlp:
    metrics:
      export:
        enabled: true
        url: http://otel-collector:4317
    tracing:
      endpoint: http://otel-collector:4317

  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
```

```java
// Spring Boot Actuator + Micrometer 自定义指标
@Component
public class AiServiceMetrics {

    private final MeterRegistry meterRegistry;
    private final Counter llmRequestCounter;
    private final Timer llmRequestTimer;
    private final Histogram retrievalResultCount;

    public AiServiceMetrics(MeterRegistry meterRegistry) {
        this.llmRequestCounter = Counter.builder("ai.llm.requests")
                .description("LLM API call count")
                .tag("provider", "openai")
                .register(meterRegistry);

        this.llmRequestTimer = Timer.builder("ai.llm.request.duration")
                .description("LLM API response time")
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(meterRegistry);

        this.retrievalResultCount = Histogram.builder("ai.retrieval.results")
                .description("RAG retrieval result count")
                .serviceLevelObjectives(1, 5, 10, 20, 50)
                .register(meterRegistry);
    }

    public <T> T recordLlmCall(String model, Supplier<T> call) {
        llmRequestCounter.increment();
        return llmRequestTimer.record(call);
    }

    public void recordRetrievalResults(int count) {
        retrievalResultCount.record(count);
    }
}
```

---

## 四、GenAI 语义约定

### 4.1 LLM Span

```java
@Service
public class TracedLlmService {

    private final Tracer tracer;
    private final Meter meter;

    public record LlmCallResult(String content, int inputTokens, int outputTokens,
                                 String model, String provider, Duration duration) {}

    public String chat(String prompt) {
        // 创建 LLM Span
        var span = tracer.spanBuilder("chat gpt-4o")
                .setSpanKind(SpanKind.CLIENT)
                .setAttribute("gen_ai.system", "openai")           // 提供商
                .setAttribute("gen_ai.operation.name", "chat")     // 操作类型
                .setAttribute("gen_ai.request.model", "gpt-4o")    // 模型名称
                .setAttribute("gen_ai.request.max_tokens", 4096)
                .setAttribute("gen_ai.request.temperature", 0.7)
                .setAttribute("gen_ai.request.top_p", 1.0)
                // Prompt 内容（可采样存储）
                .setAttribute("gen_ai.prompt", prompt)
                .startSpan();

        try (var scope = span.makeCurrent()) {
            // 执行 LLM 调用
            var result = openAiClient.chatCompletion(new ChatRequest(prompt, "gpt-4o"));

            // 记录响应属性
            span.setAttribute("gen_ai.response.id", result.id());
            span.setAttribute("gen_ai.response.model", result.model());
            span.setAttribute("gen_ai.response.finish_reasons",
                    String.join(",", result.choices().getFirst().finishReason()));
            span.setAttribute("gen_ai.usage.input_tokens", result.usage().promptTokens());
            span.setAttribute("gen_ai.usage.output_tokens", result.usage().completionTokens());
            span.setAttribute("gen_ai.usage.total_tokens", result.usage().totalTokens());
            // Content（可采样存储）
            span.setAttribute("gen_ai.completion",
                    result.choices().getFirst().message().content());

            return result.choices().getFirst().message().content();
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, e.getMessage());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### 4.2 Tool Call Span

```java
@Component
public class TracedToolExecutor {

    private final Tracer tracer;

    public ToolResult executeTool(String toolName, Map<String, Object> params) {
        var span = tracer.spanBuilder("execute_tool " + toolName)
                .setSpanKind(SpanKind.INTERNAL)
                // GenAI 工具调用约定
                .setAttribute("gen_ai.tool.name", toolName)
                .setAttribute("gen_ai.tool.parameters",
                        JsonUtils.toJson(params))
                .setAttribute("gen_ai.tool.call.id",
                        UUID.randomUUID().toString())
                .startSpan();

        try (var scope = span.makeCurrent()) {
            var result = toolRegistry.execute(toolName, params);
            span.setAttribute("gen_ai.tool.result",
                    JsonUtils.toJson(result));
            span.setAttribute("gen_ai.tool.success", true);
            return result;
        } catch (Exception e) {
            span.setAttribute("gen_ai.tool.success", false);
            span.setAttribute("error.type", e.getClass().getSimpleName());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### 4.3 RAG 检索 Span

```java
@Service
public class TracedRagService {

    private final Tracer tracer;

    public List<Document> retrieve(String query) {
        var span = tracer.spanBuilder("rag_retrieve")
                .setSpanKind(SpanKind.INTERNAL)
                // GenAI RAG 检索约定
                .setAttribute("gen_ai.retrieval.query", query)
                .setAttribute("gen_ai.retrieval.strategy", "hybrid")  // bm25/vector/hybrid
                .setAttribute("gen_ai.retrieval.top_k", 10)
                .startSpan();

        try (var scope = span.makeCurrent()) {
            // Embedding
            var embedSpan = tracer.spanBuilder("rag_embed_query")
                    .setAttribute("gen_ai.system", "openai")
                    .setAttribute("gen_ai.operation.name", "embeddings")
                    .setAttribute("gen_ai.request.model", "text-embedding-3-small")
                    .startSpan();
            var embedding = embedQuery(query);
            embedSpan.setAttribute("gen_ai.usage.total_tokens", embedding.tokenCount());
            embedSpan.end();

            // Vector Search
            var vectorSpan = tracer.spanBuilder("rag_vector_search")
                    .setAttribute("gen_ai.retrieval.search_type", "knn")
                    .setAttribute("db.system", "elasticsearch")
                    .startSpan();
            var vectorResults = vectorStore.similaritySearch(embedding.vector(), 10);
            vectorSpan.setAttribute("gen_ai.retrieval.document_count", vectorResults.size());
            vectorSpan.setAttribute("gen_ai.retrieval.duration_ms", vectorSpanDuration);
            vectorSpan.end();

            // BM25 Search
            var bm25Span = tracer.spanBuilder("rag_bm25_search")
                    .setAttribute("gen_ai.retrieval.search_type", "keyword")
                    .startSpan();
            var bm25Results = searchEngine.bm25Search(query, 10);
            bm25Span.setAttribute("gen_ai.retrieval.document_count", bm25Results.size());
            bm25Span.end();

            // RRF Fusion
            var fused = rrfFusion(vectorResults, bm25Results);
            span.setAttribute("gen_ai.retrieval.final_document_count", fused.size());
            span.setAttribute("gen_ai.retrieval.min_score",
                    fused.stream().mapToDouble(Document::score).min().orElse(0));
            span.setAttribute("gen_ai.retrieval.max_score",
                    fused.stream().mapToDouble(Document::score).max().orElse(0));

            return fused;
        } finally {
            span.end();
        }
    }
}
```

### 4.4 完整的 GenAI Span 属性清单

| 属性 | 类型 | LLM | Embedding | Tool | RAG |
|------|------|-----|-----------|------|-----|
| `gen_ai.system` | string | openai/anthropic/... | openai/... | - | - |
| `gen_ai.operation.name` | string | chat/completions | embeddings | execute_tool | - |
| `gen_ai.request.model` | string | gpt-4o | text-embedding-3-small | - | - |
| `gen_ai.request.max_tokens` | int | Y | - | - | - |
| `gen_ai.request.temperature` | float | Y | - | - | - |
| `gen_ai.response.id` | string | Y | - | - | - |
| `gen_ai.response.finish_reasons` | string | Y | - | - | - |
| `gen_ai.usage.input_tokens` | int | Y | - | - | - |
| `gen_ai.usage.output_tokens` | int | Y | - | - | - |
| `gen_ai.prompt` | string | Y | - | - | - |
| `gen_ai.completion` | string | Y | - | - | - |
| `gen_ai.tool.name` | string | - | - | Y | - |
| `gen_ai.tool.call.id` | string | - | - | Y | - |
| `gen_ai.tool.success` | bool | - | - | Y | - |
| `gen_ai.retrieval.query` | string | - | - | - | Y |
| `gen_ai.retrieval.strategy` | string | - | - | - | Y |
| `gen_ai.retrieval.document_count` | int | - | - | - | Y |
| `gen_ai.retrieval.duration_ms` | int | - | - | - | Y |
| `gen_ai.retrieval.min_score` | float | - | - | - | Y |
| `gen_ai.retrieval.max_score` | float | - | - | - | Y |

---

## 五、Prometheus + Grafana

### 5.1 Metric 类型

```java
// Counter: 只增不减（请求计数、错误计数）
Counter requestCounter = Counter.builder("http_requests_total")
        .description("Total HTTP requests")
        .tag("method", "GET")
        .register(meterRegistry);
requestCounter.increment();

// Gauge: 瞬时值（内存使用、活跃连接数）
Gauge memoryGauge = Gauge.builder("jvm_memory_used_bytes", () ->
                Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory())
        .register(meterRegistry);

// Histogram: 分布统计（请求延迟、响应大小）
Histogram latencyHistogram = Histogram.builder("http_request_duration_seconds")
        .serviceLevelObjectives(0.01, 0.05, 0.1, 0.5, 1.0, 5.0)
        .register(meterRegistry);
latencyHistogram.record(0.25);

// Summary: 客户端百分比计算（与 Histogram 类似，但分位数在客户端计算）
```

### 5.2 PromQL 查询

```promql
# AI 请求量
rate(ai_llm_requests_total[5m])

# LLM 调用 P95 延迟
histogram_quantile(0.95, rate(ai_llm_request_duration_seconds_bucket[5m]))

# Token 消耗速率（按模型）
sum by(model) (rate(gen_ai_usage_input_tokens_total[1h]))
sum by(model) (rate(gen_ai_usage_output_tokens_total[1h]))

# RAG 检索延迟
avg(gen_ai_retrieval_duration_ms) by (strategy)

# 错误率
rate(ai_llm_requests_total{status="error"}[5m])
  / rate(ai_llm_requests_total[5m]) * 100

# LLM 调用 QPS 按 Provider
sum by (gen_ai_system) (rate(ai_llm_requests_total[5m]))
```

### 5.3 AI 应用 Dashboard 设计

```
┌─────────────────────────────────────────────────────────┐
│  AI Service Dashboard                                   │
├──────────────┬──────────────┬──────────────┬────────────┤
│ 总请求量      │ 成功率        │ P95 延迟      │ 平均 Token/请求│
│ 12,345       │ 98.5%        │ 2.3s         │ 1,850       │
├──────────────┴──────────────┴──────────────┴────────────┤
│                                                         │
│  LLM 调用趋势 (折线图)                                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │  QPS by Provider (openai vs anthropic vs ollama)    ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Token 消耗 (堆叠面积图)                                  │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Input Tokens | Output Tokens | Total Tokens        ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  RAG 检索性能 (双线图)                                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │  检索延迟 (ms) | 检索结果数量                          ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Tool 调用统计 (饼图 + 表格)                              │
│  ┌─────────────────────────────────────────────────────┐│
│  │  search:45% | db_query:30% | calculator:15% | ...   ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  成本估算 (计数器)                                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │  今日总成本: $42.17 | 估算月成本: $1,265              ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  错误分布 (饼图)                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  timeout:45% | rate_limit:30% | server_error:25%    ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 六、Tempo 与 Loki

### 6.1 Tempo 分布式追踪

```yaml
# Tempo 配置（用于 Trace 查询）
tempo:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
  storage:
    trace:
      backend: s3
      s3:
        bucket: tempo-traces
```

**Grafana TraceQL 查询：**

```
# 查找 P95 延迟的 LLM 调用
{ span.gen_ai.operation.name = "chat" &&
  duration > 5s }

# 查找包含错误的 Tool Call
{ span.gen_ai.tool.name = "database_query" &&
  status.code = ERROR }

# 查找特定用户的 RAG 检索
{ resource.service.name = "ai-rag-service" &&
  span.gen_ai.retrieval.strategy = "hybrid" }
```

### 6.2 Loki 日志聚合

```yaml
# application.yml — 日志输出格式设置为 JSON
logging:
  pattern:
    console: '{"timestamp":"%d{ISO8601}","level":"%level","logger":"%logger","message":"%msg","traceId":"%mdc{traceId}","spanId":"%mdc{spanId}"}%n'
```

**LogQL 查询：**

```logql
# 按 traceId 关联日志
{app="ai-rag-service"} |= "error" | json | traceId = `abc123`

# 错误日志趋势
rate({app="ai-rag-service"} |= "ERROR" [5m])

# Token 使用日志
{app="ai-rag-service"} | json
  | line_format "{{.gen_ai_system}} {{.gen_ai_usage_total_tokens}}"
```

---

## 七、告警设计

```yaml
# Prometheus Alert Rules
groups:
  - name: ai-service-alerts
    rules:
      # 1. 错误率告警
      - alert: HighLlmErrorRate
        expr: |
          rate(ai_llm_requests_total{status="error"}[5m])
          / rate(ai_llm_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "LLM 错误率超过 5%"
          description: "当前错误率 {{ $value | humanizePercentage }}"

      # 2. P95 延迟告警
      - alert: HighLlmLatency
        expr: |
          histogram_quantile(0.95,
            rate(ai_llm_request_duration_seconds_bucket[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "LLM P95 延迟超过 10 秒"

      # 3. Token 消耗异常
      - alert: TokenConsumptionAnomaly
        expr: |
          rate(gen_ai_usage_total_tokens_total[1h])
          / rate(gen_ai_usage_total_tokens_total[1h] offset 24h) > 1.5
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Token 消耗比昨天同时间增长 50%"

      # 4. RAG 检索异常
      - alert: RagRetrievalZeroResults
        expr: |
          rate(gen_ai_retrieval_document_count_bucket{le="0"}[10m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RAG 无结果返回率超过 10%"

      # 5. 熔断器开启告警
      - alert: CircuitBreakerOpen
        expr: |
          resilience4j_circuitbreaker_state{state="open"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "熔断器 {{ $labels.name }} 已开启"
```

---

## 常见问题

**Q: 追踪采样率如何设置？**
A: 生产环境通常 1-10%。高 QPS 服务更低。根据 `tail sampling` 策略保留错误/慢请求的全量数据。

**Q: OTel Collector 有必要吗？**
A: 推荐。Collector 提供：统一接收端点、批量+重试发送、数据过滤和转换、多后端导出。减少应用端配置复杂度。

**Q: Prometheus Histogram vs Summary 怎么选？**
A: Histogram（服务端聚合，任意分位数可查询，推荐）。Summary（客户端计算分位数，查询直接，但不能跨实例聚合）。

**Q: GenAI 语义约定的采样建议？**
A: LLM Prompt 和 Completion 内容通常较大，建议通过自定义 SpanProcessor 配置内容采样（如 5% 采样率），Token 量和延迟等数值指标全量采集。

---

## 相关条目

- [[06-Docker与Kubernetes云原生部署]] — K8s 中的可观测性集成
- [[06-CICD与基础设施即代码]] — CI/CD 中的可观测性
- [[14-模型网关与Prompt管理]] — AI 平台可观测性
