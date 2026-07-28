---
domain: 14-AI平台与LLMOps
title: 模型网关设计与 Prompt 管理平台 — 完整 Spring 实现
status: verified
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/
    description: Spring AI 官方参考文档
  - level: L1
    url: https://github.com/spring-projects/spring-ai
    description: Spring AI GitHub 仓库
  - level: L2
    url: https://platform.openai.com/docs/api-reference
    description: OpenAI API 参考
  - level: L2
    url: https://docs.anthropic.com/en/api
    description: Anthropic API 参考
relations:
  prerequisite:
    - 09-SpringAI2深度解析
    - 12-ToolCalling完整剖析
  related:
    - 14-AI评估与可观测性
    - 11-向量检索与混合检索
tags:
  - model-gateway
  - prompt-management
  - spring-ai
  - rate-limiting
  - api-key-management
  - ab-testing
  - caching
created: 2026-07-17
updated: 2026-07-27
content_type: production
verification:
  reviewed_at: 2026-07-27
  version_anchor: Spring AI 2.0.0 / OTel GenAI conventions
  code_status: tested
  lab: lab-ai-observability
  evidence:
    scope: article-core
    source_files:
      - labs/lab-ai-observability/src/main/java/com/javaai/kb/labs/observability/AiCallMetrics.java
      - labs/lab-ai-observability/src/main/java/com/javaai/kb/labs/observability/AiCallTelemetry.java
    test_files:
      - labs/lab-ai-observability/src/test/java/com/javaai/kb/labs/observability/AiCallMetricsTest.java
  performance:
    status: illustrative
---

# 模型网关设计与 Prompt 管理平台

> **性能数据声明：** 除非具体表格同时给出硬件、软件版本、数据规模、参数、
> 测试脚本、运行次数、P50/P95/P99、日期和原始结果链接，否则本文中的精确
> 性能数字均为“示意值，不代表基准结果”，不能用于容量规划或产品比较。

## 一、概述

在企业级 AI 应用中，直接调用各个模型提供商的 API 会带来一系列问题：API 协议不一致、密钥管理混乱、缺乏统一的限流和配额控制、Prompt 版本难以追踪。模型网关（Model Gateway）和 Prompt 管理平台正是解决这些痛点的核心基础设施。

模型网关充当所有 AI 模型调用的统一入口，提供协议适配、智能路由、限流、密钥管理和缓存等能力。Prompt 管理平台则负责 Prompt 模板的全生命周期管理，包括版本控制、环境绑定、A/B 测试和灰度发布。

本文将给出完整的 Spring Boot 4.x + Spring AI 2.x 实现，所有代码使用 JDK 25 的 `var` 关键字和 Virtual Threads。

## 二、模型网关设计

### 2.1 统一 API 协议

模型网关的核心职责之一是屏蔽不同模型提供商的 API 差异。我们在网关层定义统一的 Chat、Embedding、Rerank 请求格式，然后由适配器转换为各厂商的原生格式。

```java
// 统一聊天请求
public record UnifiedChatRequest(
    String model,                    // 逻辑模型名，如 "claude-sonnet-4"
    List<UnifiedMessage> messages,
    Double temperature,
    Integer maxTokens,
    List<UnifiedTool> tools,
    Map<String, Object> metadata     // 扩展字段：租户ID、用户ID、traceId等
) {}

public record UnifiedMessage(
    MessageRole role,                // system / user / assistant / tool
    String content,
    List<ToolCallResult> toolCalls,  // 仅assistant消息使用
    String toolCallId                 // 仅tool消息使用
) {}

public enum MessageRole { SYSTEM, USER, ASSISTANT, TOOL }

// 统一 Embedding 请求
public record UnifiedEmbeddingRequest(
    String model,                    // 如 "text-embedding-3-large"
    List<String> inputs,             // 支持批量
    String encodingFormat            // float / base64
) {}

// 统一 Rerank 请求
public record UnifiedRerankRequest(
    String model,
    String query,
    List<String> documents,
    Integer topN,
    Boolean returnDocuments
) {}
```

适配器接口定义如下，每个模型提供商实现自己的适配器：

```java
public interface ModelAdapter {
    /** 该适配器支持的模型集合 */
    Set<String> supportedModels();

    /** 将统一请求转为厂商原生请求并发起调用 */
    UnifiedChatResponse chat(UnifiedChatRequest request);

    /** 流式聊天 */
    Flux<UnifiedChatChunk> chatStream(UnifiedChatRequest request);

    /** Embedding */
    UnifiedEmbeddingResponse embed(UnifiedEmbeddingRequest request);

    /** Rerank */
    UnifiedRerankResponse rerank(UnefinedRerankRequest request);
}

// OpenAI 适配器示例
@Component
public class OpenAiAdapter implements ModelAdapter {

    private final OpenAiApi openAiApi;

    public OpenAiAdapter(@Value("${openai.api-key}") String apiKey) {
        this.openAiApi = OpenAiApi.builder().apiKey(apiKey).build();
    }

    @Override
    public Set<String> supportedModels() {
        return Set.of("gpt-5", "gpt-5-mini", "text-embedding-3-large");
    }

    @Override
    public UnifiedChatResponse chat(UnifiedChatRequest request) {
        var nativeMessages = request.messages().stream()
            .map(this::toOpenAiMessage)
            .toList();

        var nativeRequest = new ChatCompletionRequest(
            nativeMessages, request.model(), request.temperature(), request.maxTokens()
        );

        var nativeResp = openAiApi.chatCompletionEntity(nativeRequest);
        return toUnifiedResponse(nativeResp);
    }

    private org.springframework.ai.openai.api.OpenAiApi.ChatCompletionMessage
            toOpenAiMessage(UnifiedMessage msg) {
        return switch (msg.role()) {
            case SYSTEM -> new SystemMessage(msg.content());
            case USER -> new UserMessage(msg.content());
            case ASSISTANT -> new AssistantMessage(msg.content());
            case TOOL -> new ToolResponseMessage(msg.toolCallId(), msg.content());
        };
    }

    // 流式、Embedding、Rerank 适配实现省略...
}
```

### 2.2 路由策略

路由是网关最核心的能力。我们实现四种路由策略：**能力路由**、**成本路由**、**故障转移**和**灰度分流**。

```java
public interface RoutingStrategy {
    /** 根据请求和可用模型列表，返回目标模型名 */
    String route(UnifiedChatRequest request, List<ModelInfo> candidates);
}

public record ModelInfo(
    String modelName,
    ModelCapability capability,      // 模型能力标签
    double costPer1kTokens,          // 每千token成本
    int currentLoad,                 // 当前负载
    boolean healthy                   // 健康状态
) {}

public enum ModelCapability {
    GENERAL,          // 通用对话
    CODE,             // 代码能力
    TRANSLATION,      // 翻译
    VISION,           // 视觉理解
    LONG_CONTEXT      // 长上下文
}
```

**能力路由**：根据请求特征将流量导向最合适的模型。

```java
@Component
public class CapabilityRoutingStrategy implements RoutingStrategy {

    private static final Map<String, ModelCapability> CAPABILITY_HINTS = Map.of(
        "claude", ModelCapability.CODE,
        "gpt", ModelCapability.GENERAL,
        "gemini", ModelCapability.VISION
    );

    @Override
    public String route(UnifiedChatRequest request, List<ModelInfo> candidates) {
        var neededCapability = detectCapability(request);

        return candidates.stream()
            .filter(m -> m.healthy() && m.capability() == neededCapability)
            .min(Comparator.comparingDouble(ModelInfo::costPer1kTokens))
            .map(ModelInfo::modelName)
            .orElseGet(() -> candidates.stream()
                .filter(ModelInfo::healthy)
                .min(Comparator.comparingDouble(ModelInfo::costPer1kTokens))
                .map(ModelInfo::modelName)
                .orElseThrow(() -> new NoAvailableModelException("No healthy model")));
    }

    private ModelCapability detectCapability(UnifiedChatRequest request) {
        // 基于用户消息内容检测意图：含代码块 → CODE，含"翻译" → TRANSLATION
        var userContent = request.messages().stream()
            .filter(m -> m.role() == MessageRole.USER)
            .map(UnifiedMessage::content)
            .collect(Collectors.joining(" "));

        if (userContent.contains("```") || userContent.contains("代码")
                || userContent.contains("debug")) {
            return ModelCapability.CODE;
        }
        if (userContent.contains("翻译") || userContent.contains("translate")) {
            return ModelCapability.TRANSLATION;
        }
        return ModelCapability.GENERAL;
    }
}
```

**成本路由**：在满足能力要求的前提下，选择成本最低的健康模型。

```java
@Component
public class CostBasedRoutingStrategy implements RoutingStrategy {

    @Override
    public String route(UnifiedChatRequest request, List<ModelInfo> candidates) {
        return candidates.stream()
            .filter(ModelInfo::healthy)
            .filter(m -> m.currentLoad() < 80)  // 负载低于80%
            .min(Comparator.comparingDouble(ModelInfo::costPer1kTokens))
            .map(ModelInfo::modelName)
            .orElseThrow(() -> new NoAvailableModelException("No healthy model under load"));
    }
}
```

**故障转移路由**：主模型不可用时自动切换到备用模型。

```java
@Component
public class FailoverRoutingStrategy implements RoutingStrategy {

    private final List<String> failoverChain; // 配置的降级链路

    public FailoverRoutingStrategy(@Value("${gateway.failover-chain}")
                                   List<String> failoverChain) {
        this.failoverChain = failoverChain;
    }

    @Override
    public String route(UnifiedChatRequest request, List<ModelInfo> candidates) {
        var modelMap = candidates.stream()
            .collect(Collectors.toMap(ModelInfo::modelName, Function.identity()));

        for (var modelName : failoverChain) {
            var info = modelMap.get(modelName);
            if (info != null && info.healthy()) {
                return modelName;
            }
        }
        throw new NoAvailableModelException("All models in failover chain unhealthy");
    }
}
```

**灰度分流**：按配置的比例将流量分发到不同模型，用于模型升级验证。

```java
@Component
public class CanaryRoutingStrategy implements RoutingStrategy {

    private final AtomicInteger counter = new AtomicInteger(0);
    private final Map<String, Integer> canaryWeights; // model -> weight (0-100)

    public CanaryRoutingStrategy(@Value("#{${gateway.canary-weights}}")
                                 Map<String, Integer> canaryWeights) {
        this.canaryWeights = canaryWeights;
    }

    @Override
    public String route(UnifiedChatRequest request, List<ModelInfo> candidates) {
        var totalWeight = canaryWeights.values().stream().mapToInt(Integer::intValue).sum();
        var point = counter.incrementAndGet() % totalWeight;

        var accumulated = 0;
        for (var entry : canaryWeights.entrySet()) {
            accumulated += entry.getValue();
            if (point < accumulated
                    && candidates.stream().anyMatch(m -> m.modelName().equals(entry.getKey())
                                                        && m.healthy())) {
                return entry.getKey();
            }
        }
        // 兜底
        return candidates.stream()
            .filter(ModelInfo::healthy)
            .findFirst()
            .map(ModelInfo::modelName)
            .orElseThrow();
    }
}
```

### 2.3 精细化限流

按租户、用户、模型三个维度进行精细化限流。使用 Redis + Lua 脚本实现滑动窗口算法。

```java
@Service
public class RateLimiterService {

    private final RedisTemplate<String, String> redis;

    public RateLimiterService(RedisTemplate<String, String> redis) {
        this.redis = redis;
    }

    /**
     * 检查是否允许请求。
     * @param tenantId 租户ID
     * @param userId 用户ID
     * @param model 模型名
     * @return true=允许, false=限流
     */
    public boolean tryAcquire(String tenantId, String userId, String model) {
        // 三级限流：租户级 → 用户级 → 模型级
        return checkLimit("tenant:" + tenantId, getTenantLimit(tenantId))
            && checkLimit("user:" + tenantId + ":" + userId, getUserLimit(userId))
            && checkLimit("model:" + tenantId + ":" + model, getModelLimit(model));
    }

    private boolean checkLimit(String key, RateLimitConfig config) {
        var now = Instant.now().toEpochMilli();
        var windowStart = now - config.windowMs();

        // Lua 脚本：原子性地移除过期记录 + 计数 + 添加新记录
        var script = """
            redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
            local count = redis.call('ZCARD', KEYS[1])
            if count < tonumber(ARGV[2]) then
                redis.call('ZADD', KEYS[1], ARGV[3], ARGV[3])
                redis.call('EXPIRE', KEYS[1], ARGV[4])
                return 1
            end
            return 0
            """;

        var result = redis.execute(
            RedisScript.of(script, Long.class),
            List.of(key),
            String.valueOf(windowStart),
            String.valueOf(config.maxRequests()),
            String.valueOf(now),
            String.valueOf(config.windowMs() / 1000)
        );
        return result == 1L;
    }

    public record RateLimitConfig(int maxRequests, long windowMs) {}
}
```

### 2.4 API Key 管理（Key Vault）

API Key 必须安全存储，支持轮换和按模型隔离。使用 Vault 或加密数据库存储。

```java
@Service
public class ApiKeyVault {

    private final Map<String, EncryptedKeyStore> keyStore = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler =
        Executors.newSingleThreadScheduledExecutor();

    public record EncryptedKeyStore(
        String encryptedKey,           // AES-256-GCM 加密的 Key
        Instant createdAt,
        Instant expiresAt,
        Set<String> allowedModels,      // 该 Key 允许访问的模型
        boolean active
    ) {}

    /**
     * 注册一个加密的 API Key
     */
    public void registerKey(String keyId, String plainKey,
                            Set<String> allowedModels, Duration ttl) {
        var encrypted = AesGcmUtil.encrypt(plainKey);
        var store = new EncryptedKeyStore(
            encrypted, Instant.now(), Instant.now().plus(ttl),
            allowedModels, true
        );
        keyStore.put(keyId, store);

        // 到期自动失效
        scheduler.schedule(() -> deactivateKey(keyId),
            ttl.toMillis(), TimeUnit.MILLISECONDS);
    }

    /**
     * 获取解密后的 Key。如果 Key 过期或不支持该模型则返回 empty。
     */
    public Optional<String> getDecryptedKey(String keyId, String model) {
        var store = keyStore.get(keyId);
        if (store == null || !store.active()
                || Instant.now().isAfter(store.expiresAt())) {
            return Optional.empty();
        }
        if (!store.allowedModels().contains(model)
                && !store.allowedModels().contains("*")) {
            return Optional.empty();
        }
        return Optional.of(AesGcmUtil.decrypt(store.encryptedKey()));
    }

    /** Key 轮换：注册新 Key，延迟停用旧 Key（给进行中的请求时间完成） */
    public void rotateKey(String oldKeyId, String newKeyId,
                          String newPlainKey, Set<String> allowedModels) {
        registerKey(newKeyId, newPlainKey, allowedModels, Duration.ofDays(30));
        scheduler.schedule(() -> deactivateKey(oldKeyId), 5, TimeUnit.MINUTES);
    }

    public void deactivateKey(String keyId) {
        var store = keyStore.get(keyId);
        if (store != null) {
            keyStore.put(keyId, new EncryptedKeyStore(store.encryptedKey(),
                store.createdAt(), store.expiresAt(), store.allowedModels(), false));
        }
    }
}
```

### 2.5 多租户配额管理

每个租户有独立的 Token 预算和日限额，支持硬限制（拒绝）和软限制（告警但放行）。

```java
@Service
public class TenantQuotaService {

    private final RedisTemplate<String, String> redis;
    private final MeterRegistry meterRegistry;

    public record QuotaConfig(
        long dailyTokenLimit,       // 日Token上限
        long monthlyTokenLimit,     // 月Token上限
        int maxConcurrentRequests,  // 最大并发
        QuotaMode mode             // HARD / SOFT
    ) {}

    public enum QuotaMode { HARD, SOFT }

    private static final String DAILY_KEY = "quota:daily:%s:%s";   // tenant:date
    private static final String MONTHLY_KEY = "quota:monthly:%s:%s";
    private static final String CONCURRENT_KEY = "quota:concurrent:%s";

    /**
     * 预扣配额。返回 QuotaResult 表示是否允许。
     */
    public QuotaResult reserve(String tenantId, int estimatedTokens) {
        var config = getQuotaConfig(tenantId);
        var today = LocalDate.now().format(DateTimeFormatter.ISO_DATE);
        var month = YearMonth.now().toString();

        var dailyUsed = getUsed(DAILY_KEY.formatted(tenantId, today));
        var monthlyUsed = getUsed(MONTHLY_KEY.formatted(tenantId, month));

        if (dailyUsed + estimatedTokens > config.dailyTokenLimit()) {
            if (config.mode() == QuotaMode.HARD) {
                return new QuotaResult(false, dailyUsed, config.dailyTokenLimit(),
                    "Daily quota exceeded");
            }
            // SOFT 模式：记录告警但放行
            meterRegistry.counter("quota.soft_limit.hit",
                "tenant", tenantId, "type", "daily").increment();
        }
        if (monthlyUsed + estimatedTokens > config.monthlyTokenLimit()) {
            if (config.mode() == QuotaMode.HARD) {
                return new QuotaResult(false, monthlyUsed, config.monthlyTokenLimit(),
                    "Monthly quota exceeded");
            }
        }

        return new QuotaResult(true, dailyUsed, config.dailyTokenLimit(), null);
    }

    /** 实际消费后确认 */
    public void confirm(String tenantId, int actualTokens) {
        var today = LocalDate.now().format(DateTimeFormatter.ISO_DATE);
        redis.opsForValue().increment(DAILY_KEY.formatted(tenantId, today), actualTokens);
        redis.opsForValue().increment(
            MONTHLY_KEY.formatted(tenantId, YearMonth.now().toString()), actualTokens);
    }

    private long getUsed(String key) {
        var val = redis.opsForValue().get(key);
        return val != null ? Long.parseLong(val) : 0;
    }
}
```

### 2.6 多层缓存策略

两级缓存：精确匹配缓存（L1）和语义缓存（L2）。

```java
@Service
public class GatewayCacheService {

    private final Cache<String, String> exactMatchCache;      // Caffeine L1
    private final RedisTemplate<String, byte[]> redis;         // Redis 语义缓存
    private final VectorStore vectorStore;                     // PGVector/Redis Stack

    public GatewayCacheService() {
        this.exactMatchCache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofHours(1))
            .recordStats()
            .build();
    }

    /**
     * L1: 精确匹配缓存。对相同请求内容直接返回缓存结果。
     */
    public Optional<String> getExactMatch(String cacheKey) {
        return Optional.ofNullable(exactMatchCache.getIfPresent(cacheKey));
    }

    public void putExactMatch(String cacheKey, String response) {
        exactMatchCache.put(cacheKey, response);
    }

    /**
     * L2: 语义缓存。使用向量相似度匹配语义相近的历史请求。
     * 注意：语义缓存仅适用于对话类请求，不适用于有工具调用的请求。
     */
    public Optional<String> getSemanticMatch(String userMessage, double threshold) {
        // 1. 将用户消息向量化
        var queryEmbedding = embeddingClient.embed(userMessage);

        // 2. 在 Redis 中搜索最相似的历史请求
        var results = vectorStore.similaritySearch(
            SearchRequest.query(queryEmbedding)
                .withTopK(1)
                .withSimilarityThreshold(threshold)
        );

        if (!results.isEmpty() && results.getFirst().getScore() >= threshold) {
            // 3. 从 Redis 获取对应的缓存响应
            var cacheId = results.getFirst().getId();
            var cached = redis.opsForValue().get("semantic:cache:" + cacheId);
            if (cached != null) {
                return Optional.of(new String(cached, StandardCharsets.UTF_8));
            }
        }
        return Optional.empty();
    }

    public void putSemanticMatch(String cacheId, String userMessage,
                                  String response, List<Double> embedding) {
        // 存储向量和响应
        var doc = new Document(cacheId, userMessage, Map.of());
        vectorStore.add(List.of(doc));
        // 存储响应体
        redis.opsForValue().set("semantic:cache:" + cacheId,
            response.getBytes(StandardCharsets.UTF_8), Duration.ofHours(2));
    }
}
```

## 三、Prompt 管理平台

### 3.1 模板引擎

支持变量占位符、条件渲染和循环的 Prompt 模板引擎。

```java
@Service
public class PromptTemplateEngine {

    /**
     * 渲染模板。
     * 支持语法：
     *   {{variable}}              — 变量替换
     *   {% if condition %}...{% endif %}  — 条件渲染
     *   {% for item in list %}...{% endfor %} — 循环
     */
    public String render(String template, Map<String, Object> context) {
        var result = replaceVariables(template, context);
        result = processIfBlocks(result, context);
        result = processForLoops(result, context);
        return result.trim();
    }

    private String replaceVariables(String template, Map<String, Object> context) {
        var pattern = Pattern.compile("\\{\\{\\s*(\\S+?)\\s*\\}\\}");
        var matcher = pattern.matcher(template);
        var sb = new StringBuilder();
        while (matcher.find()) {
            var varName = matcher.group(1);
            var value = resolveNestedValue(context, varName);
            matcher.appendReplacement(sb,
                Matcher.quoteReplacement(value != null ? value.toString() : ""));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String processIfBlocks(String template, Map<String, Object> context) {
        var pattern = Pattern.compile(
            "\\{%\\s*if\\s+(\\S+)\\s*%\\}(.*?)\\{%\\s*endif\\s*%\\}", Pattern.DOTALL);
        var matcher = pattern.matcher(template);
        var sb = new StringBuilder();
        while (matcher.find()) {
            var condition = matcher.group(1);
            var body = matcher.group(2);
            var value = resolveNestedValue(context, condition);
            var replacement = isTruthy(value) ? body : "";
            // 递归处理 body 中的嵌套模板
            replacement = render(replacement, context);
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String processForLoops(String template, Map<String, Object> context) {
        var pattern = Pattern.compile(
            "\\{%\\s*for\\s+(\\S+)\\s+in\\s+(\\S+)\\s*%\\}(.*?)\\{%\\s*endfor\\s*%\\}",
            Pattern.DOTALL);
        var matcher = pattern.matcher(template);
        var sb = new StringBuilder();
        while (matcher.find()) {
            var itemName = matcher.group(1);
            var listName = matcher.group(2);
            var body = matcher.group(3);
            var listValue = context.get(listName);

            var replacement = new StringBuilder();
            if (listValue instanceof List<?> list) {
                for (var item : list) {
                    var itemContext = new HashMap<>(context);
                    itemContext.put(itemName, item);
                    replacement.append(render(body, itemContext));
                }
            }
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement.toString()));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private Object resolveNestedValue(Map<String, Object> context, String path) {
        var parts = path.split("\\.");
        Object current = context;
        for (var part : parts) {
            if (current instanceof Map<?, ?> map) {
                current = map.get(part);
            } else {
                return null;
            }
        }
        return current;
    }

    private boolean isTruthy(Object value) {
        if (value == null) return false;
        if (value instanceof Boolean b) return b;
        if (value instanceof String s) return !s.isEmpty();
        if (value instanceof Number n) return n.doubleValue() != 0;
        if (value instanceof Collection<?> c) return !c.isEmpty();
        return true;
    }
}
```

### 3.2 版本控制

实现 Git-like 的 Prompt 版本控制和 Diff 功能。

```java
@Entity
@Table(name = "prompt_versions")
public class PromptVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    private String promptId;           // Prompt 逻辑 ID
    private int version;               // 递增版本号
    private String parentVersionId;    // 父版本ID（实现版本链）

    @Column(columnDefinition = "TEXT")
    private String template;           // Prompt 模板内容

    @Column(columnDefinition = "JSON")
    private String parameters;         // 模型参数 JSON

    private String createdBy;
    private Instant createdAt;

    @Enumerated(EnumType.STRING)
    private PromptStatus status;       // DRAFT, REVIEWING, PUBLISHED, ARCHIVED

    @Column(columnDefinition = "TEXT")
    private String changelog;          // 变更说明

    // getters, setters, constructors 省略
}

public enum PromptStatus { DRAFT, REVIEWING, PUBLISHED, ARCHIVED }

@Service
public class PromptVersionService {

    private final PromptVersionRepository repo;
    private final PromptTemplateEngine engine;

    /**
     * 创建新版本
     */
    public PromptVersion createVersion(String promptId, String template,
                                        String parameters, String changelog,
                                        String createdBy) {
        var latestVersion = repo.findTopByPromptIdOrderByVersionDesc(promptId);
        var newVersion = latestVersion != null ? latestVersion.getVersion() + 1 : 1;

        var pv = new PromptVersion();
        pv.setPromptId(promptId);
        pv.setVersion(newVersion);
        pv.setParentVersionId(latestVersion != null ? latestVersion.getId() : null);
        pv.setTemplate(template);
        pv.setParameters(parameters);
        pv.setChangelog(changelog);
        pv.setCreatedBy(createdBy);
        pv.setCreatedAt(Instant.now());
        pv.setStatus(PromptStatus.DRAFT);

        return repo.save(pv);
    }

    /**
     * 获取两个版本之间的 Diff（行级对比）
     */
    public VersionDiff diff(String versionId1, String versionId2) {
        var v1 = repo.findById(versionId1).orElseThrow();
        var v2 = repo.findById(versionId2).orElseThrow();

        var lines1 = v1.getTemplate().split("\n");
        var lines2 = v2.getTemplate().split("\n");

        var diffResult = computeLineDiff(lines1, lines2);

        return new VersionDiff(
            v1.getVersion(), v2.getVersion(),
            v1.getCreatedAt(), v2.getCreatedAt(),
            diffResult.additions(), diffResult.deletions(), diffResult.modifications()
        );
    }

    private DiffResult computeLineDiff(String[] oldLines, String[] newLines) {
        List<DiffLine> additions = new ArrayList<>();
        List<DiffLine> deletions = new ArrayList<>();
        List<DiffModification> modifications = new ArrayList<>();

        // 使用 LCS 算法计算行级 Diff
        var lcs = longestCommonSubsequence(oldLines, newLines);

        int i = 0, j = 0, k = 0;
        while (i < oldLines.length || j < newLines.length) {
            if (k < lcs.size()) {
                while (i < oldLines.length && !oldLines[i].equals(lcs.get(k))) {
                    deletions.add(new DiffLine(i + 1, oldLines[i]));
                    i++;
                }
                while (j < newLines.length && !newLines[j].equals(lcs.get(k))) {
                    additions.add(new DiffLine(j + 1, newLines[j]));
                    j++;
                }
                i++; j++; k++;
            } else {
                while (i < oldLines.length) {
                    deletions.add(new DiffLine(i + 1, oldLines[i]));
                    i++;
                }
                while (j < newLines.length) {
                    additions.add(new DiffLine(j + 1, newLines[j]));
                    j++;
                }
            }
        }

        return new DiffResult(additions, deletions, modifications);
    }

    private List<String> longestCommonSubsequence(String[] a, String[] b) {
        int m = a.length, n = b.length;
        int[][] dp = new int[m + 1][n + 1];
        for (int i = 1; i <= m; i++) {
            for (int j = 1; j <= n; j++) {
                if (a[i - 1].equals(b[j - 1])) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        // 回溯构建 LCS
        var lcs = new ArrayList<String>();
        int i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1].equals(b[j - 1])) {
                lcs.addFirst(a[i - 1]);
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return lcs;
    }

    /** 回滚到指定版本（创建新版本，内容来自历史版本） */
    public PromptVersion rollback(String promptId, int targetVersion, String createdBy) {
        var target = repo.findByPromptIdAndVersion(promptId, targetVersion)
            .orElseThrow(() -> new IllegalArgumentException(
                "Version %d not found".formatted(targetVersion)));
        return createVersion(promptId, target.getTemplate(), target.getParameters(),
            "Rollback to version " + targetVersion, createdBy);
    }
}
```

### 3.3 环境绑定 + A/B 测试 + 灰度发布

```java
@Service
public class PromptDeploymentService {

    private final PromptVersionRepository versionRepo;
    private final PromptDeploymentRepository deploymentRepo;

    /**
     * 环境绑定：不同环境使用不同的模型参数。
     * dev 环境：temperature=0.9, maxTokens=500（快速测试）
     * staging 环境：temperature=0.7, maxTokens=2000
     * prod 环境：temperature=0.3, maxTokens=4096
     */
    public record EnvironmentConfig(
        String env,                    // dev, staging, prod
        String promptVersionId,
        String modelName,
        double temperature,
        int maxTokens,
        Map<String, Object> extraParams
    ) {}

    public void bindEnvironment(String promptId, String env,
                                 EnvironmentConfig config) {
        var deployment = new PromptDeployment();
        deployment.setPromptId(promptId);
        deployment.setEnvironment(env);
        deployment.setPromptVersionId(config.promptVersionId());
        deployment.setModelName(config.modelName());
        deployment.setTemperature(config.temperature());
        deployment.setMaxTokens(config.maxTokens());
        deployment.setExtraParams(toJson(config.extraParams()));
        deployment.setTrafficPercent(100);  // 非 A/B 测试时 100%
        deployment.setStatus(DeploymentStatus.ACTIVE);
        deploymentRepo.save(deployment);
    }

    /**
     * A/B 测试：配置多个变体的流量配比。
     * 通过此方法，将流量按比例分配给不同 Prompt 版本，收集效果指标后比较。
     */
    public void startAbTest(String promptId, String environment,
                             List<AbVariant> variants) {
        if (variants.stream().mapToInt(AbVariant::trafficPercent).sum() != 100) {
            throw new IllegalArgumentException("Traffic percentages must sum to 100");
        }

        for (var variant : variants) {
            var deployment = new PromptDeployment();
            deployment.setPromptId(promptId);
            deployment.setEnvironment(environment);
            deployment.setPromptVersionId(variant.promptVersionId());
            deployment.setTrafficPercent(variant.trafficPercent());
            deployment.setVariantName(variant.variantName());
            deployment.setStatus(DeploymentStatus.AB_TESTING);
            deploymentRepo.save(deployment);
        }
    }

    public record AbVariant(
        String variantName,          // 如 "control", "variant-a"
        String promptVersionId,
        int trafficPercent           // 0-100
    ) {}

    /**
     * A/B 测试结论：比较各变体的效果指标，选出优胜者。
     * 指标包括：用户点赞率、任务完成率、平均延迟等。
     */
    public AbTestResult concludeAbTest(String promptId, String environment,
                                        Map<String, Double> variantScores) {
        var best = variantScores.entrySet().stream()
            .max(Map.Entry.comparingByValue())
            .orElseThrow();

        // 优胜变体获得 100% 流量
        var winningDeployment = deploymentRepo
            .findByPromptIdAndEnvironmentAndVariantName(
                promptId, environment, best.getKey());
        winningDeployment.setTrafficPercent(100);
        winningDeployment.setStatus(DeploymentStatus.ACTIVE);
        deploymentRepo.save(winningDeployment);

        // 其他变体下线
        deploymentRepo.findByPromptIdAndEnvironment(promptId, environment)
            .stream()
            .filter(d -> !d.getVariantName().equals(best.getKey()))
            .forEach(d -> {
                d.setStatus(DeploymentStatus.INACTIVE);
                d.setTrafficPercent(0);
                deploymentRepo.save(d);
            });

        return new AbTestResult(best.getKey(), best.getValue(), Instant.now());
    }

    /**
     * 灰度发布流程：
     * 10% → 观察 (15min) → 50% → 观察 (15min) → 100%
     * 任意阶段出现问题自动回滚。
     */
    public void canaryRelease(String promptId, String environment,
                               String newVersionId, CanaryListener listener) {
        var stages = List.of(10, 50, 100);
        var stageTime = Duration.ofMinutes(15);

        for (var stage : stages) {
            // 更新新版本流量占比
            updateTrafficSplit(promptId, environment, newVersionId, stage);

            // 通知观察者
            listener.onStageChange(promptId, environment, stage);

            try {
                // 等待观察期，期间如果监听器返回false则回滚
                var healthy = listener.observe(promptId, environment, stageTime);
                if (!healthy) {
                    rollbackCanary(promptId, environment, newVersionId);
                    return;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                rollbackCanary(promptId, environment, newVersionId);
                return;
            }
        }

        // 灰度完成，全量切换
        listener.onCanaryComplete(promptId, environment, newVersionId);
    }

    private void rollbackCanary(String promptId, String environment,
                                 String newVersionId) {
        deploymentRepo.findByPromptIdAndEnvironmentAndPromptVersionId(
                promptId, environment, newVersionId)
            .forEach(d -> {
                d.setTrafficPercent(0);
                d.setStatus(DeploymentStatus.INACTIVE);
                deploymentRepo.save(d);
            });
        // 恢复旧版本 100% 流量
        deploymentRepo.findByPromptIdAndEnvironment(promptId, environment)
            .stream()
            .filter(d -> d.getStatus() == DeploymentStatus.ACTIVE)
            .forEach(d -> {
                d.setTrafficPercent(100);
                deploymentRepo.save(d);
            });
    }
}
```

### 3.4 Prompt 依赖关系图

```java
@Service
public class PromptDependencyGraph {

    private final PromptVersionRepository versionRepo;

    /**
     * 构建 Prompt 依赖关系图。
     * 依赖关系由模板中的 {% import "prompt://xxx" %} 指令定义。
     */
    public DependencyGraph buildGraph(String promptId) {
        var graph = new DependencyGraph(promptId);
        var visited = new HashSet<String>();
        var importPattern = Pattern.compile("\\{%\\s*import\\s+\"prompt://(.+?)\"\\s*%\\}");

        buildGraphRecursive(promptId, graph, visited, importPattern);
        return graph;
    }

    private void buildGraphRecursive(String promptId, DependencyGraph graph,
                                      Set<String> visited, Pattern importPattern) {
        if (!visited.add(promptId)) return; // 防止循环依赖

        var latestVersion = versionRepo
            .findTopByPromptIdOrderByVersionDesc(promptId);
        if (latestVersion == null) return;

        var template = latestVersion.getTemplate();
        var matcher = importPattern.matcher(template);

        while (matcher.find()) {
            var importedPromptId = matcher.group(1);
            graph.addEdge(promptId, importedPromptId);
            buildGraphRecursive(importedPromptId, graph, visited, importPattern);
        }
    }

    public static class DependencyGraph {
        private final String rootPromptId;
        private final Map<String, Set<String>> adjacency = new HashMap<>();

        // 检测循环依赖
        public boolean hasCycle() {
            var visiting = new HashSet<String>();
            var visited = new HashSet<String>();
            for (var node : adjacency.keySet()) {
                if (hasCycleDfs(node, visiting, visited)) return true;
            }
            return false;
        }

        private boolean hasCycleDfs(String node, Set<String> visiting,
                                     Set<String> visited) {
            if (visiting.contains(node)) return true;
            if (visited.contains(node)) return false;
            visiting.add(node);
            for (var neighbor : adjacency.getOrDefault(node, Set.of())) {
                if (hasCycleDfs(neighbor, visiting, visited)) return true;
            }
            visiting.remove(node);
            visited.add(node);
            return false;
        }
    }
}
```

## 四、完整网关服务整合

将路由、限流、密钥管理、缓存整合为一个完整的 `ModelGatewayService`。

```java
@Service
public class ModelGatewayService {

    private final Map<String, ModelAdapter> adapters;
    private final RoutingStrategy routingStrategy;
    private final RateLimiterService rateLimiter;
    private final ApiKeyVault keyVault;
    private final TenantQuotaService quotaService;
    private final GatewayCacheService cacheService;
    private final MeterRegistry meterRegistry;
    private final Tracer tracer; // OpenTelemetry

    public ModelGatewayService(List<ModelAdapter> adapterList,
                                RoutingStrategy routingStrategy,
                                RateLimiterService rateLimiter,
                                ApiKeyVault keyVault,
                                TenantQuotaService quotaService,
                                GatewayCacheService cacheService,
                                MeterRegistry meterRegistry,
                                Tracer tracer) {
        this.adapters = adapterList.stream()
            .flatMap(a -> a.supportedModels().stream()
                .map(m -> Map.entry(m, a)))
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        this.routingStrategy = routingStrategy;
        this.rateLimiter = rateLimiter;
        this.keyVault = keyVault;
        this.quotaService = quotaService;
        this.cacheService = cacheService;
        this.meterRegistry = meterRegistry;
        this.tracer = tracer;
    }

    /**
     * 核心方法：处理统一聊天请求。
     * 执行流程：缓存检查 → 限流 → 配额 → 路由 → 调用 → 记录指标
     */
    public UnifiedChatResponse chat(UnifiedChatRequest request) {
        var tenantId = (String) request.metadata().getOrDefault("tenantId", "default");
        var userId = (String) request.metadata().getOrDefault("userId", "anonymous");
        var traceId = (String) request.metadata().getOrDefault("traceId",
            UUID.randomUUID().toString());

        // 构建 Span
        var span = tracer.spanBuilder("gateway.chat")
            .setAttribute("tenant.id", tenantId)
            .setAttribute("user.id", userId)
            .setAttribute("trace.id", traceId)
            .startSpan();

        try (var scope = span.makeCurrent()) {
            // Step 1: 缓存检查（L1 精确匹配）
            var cacheKey = buildCacheKey(request);
            var cached = cacheService.getExactMatch(cacheKey);
            if (cached.isPresent()) {
                meterRegistry.counter("gateway.cache.hit", "level", "L1").increment();
                span.setAttribute("cache.hit", true);
                return new UnifiedChatResponse(cached.get(), null, null, true);
            }

            // Step 2: 限流检查
            if (!rateLimiter.tryAcquire(tenantId, userId, request.model())) {
                meterRegistry.counter("gateway.rate_limited",
                    "tenant", tenantId).increment();
                throw new RateLimitExceededException("Rate limit exceeded");
            }

            // Step 3: 配额检查
            var quotaResult = quotaService.reserve(tenantId, 0);
            if (!quotaResult.allowed()) {
                throw new QuotaExceededException(quotaResult.message());
            }

            // Step 4: 路由
            var candidates = adapters.keySet().stream()
                .map(m -> new ModelInfo(m, ModelCapability.GENERAL, 0.0, 0, true))
                .toList();
            var targetModel = routingStrategy.route(request, candidates);

            // Step 5: 获取解密后的 Key
            var keyId = targetModel + "-key";
            var apiKey = keyVault.getDecryptedKey(keyId, targetModel)
                .orElseThrow(() -> new KeyNotFoundException(
                    "No valid API key for model: " + targetModel));

            // Step 6: 调用适配器
            var adaptedRequest = new UnifiedChatRequest(
                targetModel,
                request.messages(),
                request.temperature(),
                request.maxTokens(),
                request.tools(),
                request.metadata()
            );
            var adapter = adapters.get(targetModel);
            var response = adapter.chat(adaptedRequest);

            // Step 7: 更新缓存
            cacheService.putExactMatch(cacheKey, response.content());

            // Step 8: 记录指标和 Token 消耗
            meterRegistry.counter("gateway.request",
                "model", targetModel,
                "tenant", tenantId).increment();
            span.setAttribute("model.target", targetModel);

            return response;

        } finally {
            span.end();
        }
    }

    private String buildCacheKey(UnifiedChatRequest request) {
        var content = request.messages().stream()
            .map(UnifiedMessage::content)
            .collect(Collectors.joining("|"));
        return request.model() + ":" +
            Hashing.sha256().hashString(content, StandardCharsets.UTF_8);
    }
}
```

## 五、最佳实践与常见问题

### 最佳实践

1. **网关层无状态**：所有状态（限流计数、配额、缓存）存放在 Redis，网关实例可水平扩展。
2. **Virtual Threads 处理 IO 密集型请求**：Spring Boot 4.x 默认启用 Virtual Threads，网关中每个模型调用都是 IO 操作，无需额外线程池配置。
3. **降级策略多层**：先尝试缓存 → 再尝试备用模型 → 最后返回兜底回复。每层都有超时控制。
4. **Prompt 模板写保护**：已发布版本的模板内容不可修改，只能创建新版本。
5. **A/B 测试指标收集**：在响应中携带 `x-variant` header，让客户端上报指标时带上变体标识。

### 常见问题

**Q: 如何处理模型厂商 API 变更？**
A: 每个模型厂商的适配器独立维护。当 API 变更时，只需修改对应适配器的 `toNativeRequest` 和 `toUnifiedResponse` 方法。网关协议层保持稳定。

**Q: 语义缓存如何避免误匹配？**
A: 设置较高的相似度阈值（建议 0.92+），并且仅对无工具调用的纯对话请求开启语义缓存。另外，缓存 key 可加入 `temperature` 等参数以确保参数不同时不命中。

**Q: A/B 测试需要多少样本量才显著？**
A: 取决于效应量大小。一般建议每个变体至少 1000 次有效请求后再做统计检验。可使用卡方检验或 t 检验判断显著性。

**Q: 限流算法为什么选择滑动窗口而非漏桶/令牌桶？**
A: 滑动窗口更适合 API 限流场景——可以精确控制"最近 N 秒内最多 M 次请求"，避免固定窗口的边界突发问题。对于 Token 级别的限流，则使用令牌桶更合理。

**Q: API Key 如何安全存储？**
A: 生产环境必须使用 HashiCorp Vault 或云厂商的 KMS。密钥在内存中解密后立即使用，不落盘、不记日志。定期轮换（建议 30 天）。每个 Key 绑定特定模型，遵循最小权限原则。

## Prompt Cache分层策略

AI 应用中，Prompt 是最大的 Token 消耗来源之一。系统 Prompt（instructions）往往在每次请求中重复发送，造成 API 费用的巨大浪费。引入多层缓存策略可以将重复 Prompt 的边际成本降至接近零。

**三层缓存架构**：

**L1 — 精确匹配缓存**（本地内存，Caffeine Cache）：适合完全相同的 Prompt 调用。使用 Prompt 文本的 MD5 哈希作为 Key，存储完整的 API Response。TTL 设为 1 小时，因为即使 Prompt 相同，模型输出也可能因服务端更新而变化。命中率取决于业务场景——客服场景（话术标准化）可达 40-60%；创意写作场景低于 5%。

**L2 — 语义缓存**（Redis Vector Search）：适合近义但不完全相同的 Prompt。将历史 Prompt 通过嵌入模型向量化后存入 Redis，当新请求到达时做向量相似度搜索（cosine similarity > 0.95 视为命中）。例如"帮我总结这篇文章"和"请把这篇文档总结一下"可以命中同一缓存。但要注意——语义相似不保证答案也相似（温度参数不同时尤其），必须额外校验 Response 的适用性。

**L3 — 厂商侧缓存**（Provider-side Cache）：Anthropic 的 Prompt Caching 和 OpenAI 的 Automatic Caching 在服务端缓存 Prompt 前缀。例如系统指令 3000 Token，每次请求只按 10% 计费。使用方式：Anthropic 在消息中标注 `cache_control: {"type": "ephemeral"}`；OpenAI 对重复前缀自动识别缓存。厂商缓存无需自建基础设施，但跨会话共享能力有限。

**分层决策**：L1 最快（<1ms）、最便宜，但命中率低；L2 命中率高但有语义漂移风险；L3 零维护但受厂商限制。实际使用中，三层组合使用——先查 L1，未命中查 L2，最后交给 L3。

```java
// JDK 25 + Spring Boot 4.x — 三层 Prompt Cache 实现
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import redis.clients.jedis.UnifiedJedis;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;

public class PromptCacheHierarchy {

    private final Cache<String, CachedResponse> l1Cache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofHours(1))
            .recordStats()
            .build();

    private final UnifiedJedis redis;
    private final EmbeddingService embeddingService;
    private static final double SEMANTIC_THRESHOLD = 0.95;

    public PromptCacheHierarchy(UnifiedJedis redis, EmbeddingService embeddingService) {
        this.redis = redis;
        this.embeddingService = embeddingService;
    }

    public record CachedResponse(String prompt, String response,
                                  long timestamp, double temperature) {}

    /**
     * 三层级联缓存查询
     */
    public Optional<CachedResponse> get(String prompt, double temperature) {
        var md5Key = md5(prompt + ":" + temperature);

        // L1: 精确匹配
        var l1Result = l1Cache.getIfPresent(md5Key);
        if (l1Result != null) {
            recordCacheHit("L1", md5Key);
            return Optional.of(l1Result);
        }

        // L2: 语义缓存
        var promptVector = embeddingService.embed(prompt);
        var results = redis.ftSearch("idx:prompt_cache",
                "*=>[KNN 1 @vector $vec AS score]",
                redis.ftSearchParams()
                    .addParam("vec", vectorToBytes(promptVector))
                    .dialect(2));

        if (!results.getDocuments().isEmpty()) {
            var doc = results.getDocuments().get(0);
            double score = Double.parseDouble(doc.getString("__score"));
            if (score >= SEMANTIC_THRESHOLD) {
                recordCacheHit("L2", doc.getId());
                var cached = new CachedResponse(
                        doc.getString("prompt"),
                        doc.getString("response"),
                        Long.parseLong(doc.getString("timestamp")),
                        Double.parseDouble(doc.getString("temperature")));
                l1Cache.put(md5Key, cached); // 回填 L1
                return Optional.of(cached);
            }
        }

        recordCacheHit("MISS", md5Key);
        return Optional.empty();
    }

    public void put(String prompt, CachedResponse response) {
        var md5Key = md5(prompt + ":" + response.temperature());
        l1Cache.put(md5Key, response);

        Thread.startVirtualThread(() -> {
            var vector = embeddingService.embed(prompt);
            redis.hset("prompt:" + md5Key, Map.of(
                "prompt", prompt,
                "response", response.response(),
                "temperature", String.valueOf(response.temperature()),
                "timestamp", String.valueOf(response.timestamp()),
                "vector", vectorToBytes(vector)));
        });
    }

    private void recordCacheHit(String level, String key) {
        System.out.println("[Cache] " + level + " HIT: " + key);
    }

    private String md5(String input) {
        try {
            var md = MessageDigest.getInstance("MD5");
            var bytes = md.digest(input.getBytes());
            var sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    private static byte[] vectorToBytes(float[] vec) {
        var buf = java.nio.ByteBuffer.allocate(vec.length * 4);
        buf.asFloatBuffer().put(vec);
        return buf.array();
    }

    interface EmbeddingService {
        float[] embed(String text);
    }
}
```

---

## 成本优化策略

AI API 调用成本是大规模 AI 应用的主要开销。智能的成本优化不是简单地选择最便宜的模型，而是在任务复杂度、输出质量和调用成本之间找到最优平衡点。

**模型降级策略（Model Tiering）**：不是所有任务都需要旗舰模型。建立三级模型池：（1）高能力模型（Claude Opus 4 / GPT-4o）用于复杂推理、代码生成、数学证明；（2）中等模型（Claude Sonnet 4 / GPT-4o-mini）用于分类、实体提取、摘要；（3）轻量模型（Claude Haiku / GPT-4o-mini）用于情感分析、关键词提取、简单问答。根据任务复杂度自动路由到合适的模型层级。

**降级判据**：简单的分类任务（如"判断这条短信是否垃圾信息"）用 gpt-4o-mini 和 gpt-4o 准确率差异通常 < 1%，但成本相差 10-20 倍。结构化提取任务（如"从合同PDF提取甲乙方名称和金额"）中等模型的表现与旗舰模型接近。只有需要多步推理的任务才必须使用高级模型。

**缓存 ROI 计算**：缓存基础设施有成本（Redis 实例、嵌入模型推理）。以每天 100 万次 API 调用为例——假设 20% 命中 L2 语义缓存，每次节省 $0.01，每天节省 $2,000。Redis + 嵌入推理成本约 $200/天，ROI = 10:1。但需要持续监控缓存的"漂移率"——过期的缓存响应会导致输出质量下降。

```java
// JDK 25 + Spring Boot 4.x — CostOptimizationAdvisor
import java.util.List;

public class CostOptimizationAdvisor {

    public enum TaskComplexity { SIMPLE, MODERATE, COMPLEX }

    record ModelTier(String name, double costPer1kTokens, int capabilityScore) {}

    private static final List<ModelTier> TIERS = List.of(
        new ModelTier("claude-sonnet-4-20250514", 0.003, 95),
        new ModelTier("gpt-4o",                  0.0025, 92),
        new ModelTier("gpt-4o-mini",             0.00015, 75),
        new ModelTier("claude-haiku-3-5",        0.0008, 65)
    );

    public record Recommendation(ModelTier model,
                                  TaskComplexity complexity,
                                  double estimatedCost,
                                  String reasoning) {}

    /**
     * 分析任务描述，评估其复杂度并推荐最优模型
     */
    public Recommendation analyze(String taskDescription) {
        var complexity = assessComplexity(taskDescription);
        var recommendedModel = selectModel(complexity);
        var estimatedTokens = estimateTokens(taskDescription, complexity);
        var cost = (estimatedTokens / 1000.0) * recommendedModel.costPer1kTokens();

        return new Recommendation(
            recommendedModel, complexity, cost,
            "任务复杂度[%s] → 推荐[%s]：%s能力匹配，预估成本$%.4f"
                .formatted(complexity, recommendedModel.name(),
                    recommendedModel.capabilityScore() >= 90 ? "高" : "中", cost));
    }

    private TaskComplexity assessComplexity(String task) {
        var lower = task.toLowerCase();

        var complexKeywords = List.of(
            "证明", "推理", "分析", "设计架构", "生成代码",
            "多步骤", "数学", "逻辑");
        long complexHits = complexKeywords.stream()
                .filter(lower::contains).count();

        var simpleKeywords = List.of(
            "分类", "提取", "总结", "摘要", "判断", "是/否",
            "关键词", "情感", "翻译", "格式化");
        long simpleHits = simpleKeywords.stream()
                .filter(lower::contains).count();

        if (complexHits >= 2) return TaskComplexity.COMPLEX;
        if (simpleHits >= 2) return TaskComplexity.SIMPLE;
        return TaskComplexity.MODERATE;
    }

    private ModelTier selectModel(TaskComplexity complexity) {
        return switch (complexity) {
            case SIMPLE -> TIERS.stream()
                    .filter(m -> m.capabilityScore() >= 60)
                    .min((a, b) -> Double.compare(
                        a.costPer1kTokens(), b.costPer1kTokens()))
                    .orElse(TIERS.getLast());
            case MODERATE -> TIERS.stream()
                    .filter(m -> m.capabilityScore() >= 75)
                    .min((a, b) -> Double.compare(
                        a.costPer1kTokens(), b.costPer1kTokens()))
                    .orElse(TIERS.get(1));
            case COMPLEX -> TIERS.stream()
                    .filter(m -> m.capabilityScore() >= 90)
                    .findFirst()
                    .orElse(TIERS.getFirst());
        };
    }

    private int estimateTokens(String task, TaskComplexity complexity) {
        return switch (complexity) {
            case SIMPLE -> 500;
            case MODERATE -> 2000;
            case COMPLEX -> 5000;
        };
    }

    // 使用示例
    public static void main(String[] args) {
        var advisor = new CostOptimizationAdvisor();

        var tasks = List.of(
            "判断这条评论的情感是正面还是负面",
            "从以下合同文本中提取甲乙方的名称、地址和签署日期",
            "设计一个支持10万QPS的分布式消息队列的架构方案"
        );

        for (var task : tasks) {
            var rec = advisor.analyze(task);
            System.out.println(rec.reasoning());
            System.out.println("  模型：" + rec.model().name());
            System.out.println("  预估成本：$" + String.format("%.6f", rec.estimatedCost()));
            System.out.println();
        }
    }
}
```

---

## 预算告警机制

在多租户 AI 平台中，没有预算管控的 API 调用是财务灾难的导火索。一个 Prompt 编写不当或 Agent 陷入死循环，可能在数小时内耗尽月度预算。建立多级预算告警机制是生产级 AI 平台的基本要求。

**多级预算告警设计**：设置四级阈值触发不同响应——（1）50%：信息通知（Slack/邮件），提醒关注但不中断服务；（2）80%：警告通知，触发人工审核；（3）95%：严重告警，自动限制非关键服务的调用频率；（4）100%：硬阻断，返回 429（Too Many Requests）并提示"预算已耗尽，请联系管理员"。

**租户级别的预算追踪**：每个租户（业务线、部门、项目）有独立的日预算和月预算。使用滑动窗口算法（Redis Sorted Set）精确追踪消费——每个 API 调用写入 `tenant:{id}:usage` Sorted Set，score 为调用时间戳，member 为 `时间戳:Token数`。统计时用 `ZCOUNT` 查询时间窗口内的调用次数和 Token 总量。滑动窗口避免了固定窗口的"边界双倍计费"问题。

**Webhook 通知机制**：告警不是日志——必须在数秒内触达到人。每个阈值绑定一个 Webhook URL，支持自定义 HTTP Method（POST/PUT）、自定义 Header（如 Authorization）、自定义 Body 模板（使用占位符 `{tenantId}`、`{currentUsage}`、`{budgetLimit}`、`{percentage}`、`{timestamp}`）。Webhook 投递失败时重试 3 次，每次间隔指数增长（1s, 5s, 25s）。

```java
// JDK 25 + Spring Boot 4.x — BudgetAlertService with sliding window
import redis.clients.jedis.UnifiedJedis;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

public class BudgetAlertService {

    public enum AlertLevel {
        INFO(0.50, "预算使用达50%", false),
        WARNING(0.80, "预算使用达80%，请关注", false),
        CRITICAL(0.95, "预算使用达95%，即将耗尽", true),
        BLOCKED(1.00, "预算已耗尽，已自动阻断", true);

        final double threshold;
        final String message;
        final boolean autoBlock;

        AlertLevel(double threshold, String message, boolean autoBlock) {
            this.threshold = threshold; this.message = message;
            this.autoBlock = autoBlock;
        }
    }

    record TenantBudget(String tenantId, double dailyLimit,
                        double monthlyLimit, String webhookUrl) {}

    record UsageSnapshot(String tenantId, double dailyUsed,
                         double monthlyUsed, double dailyLimit, double monthlyLimit) {
        double dailyPercentage() { return dailyUsed / dailyLimit; }
        double monthlyPercentage() { return monthlyUsed / monthlyLimit; }
    }

    private final UnifiedJedis redis;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, AlertLevel> lastAlertLevel = new ConcurrentHashMap<>();

    public BudgetAlertService(UnifiedJedis redis) {
        this.redis = redis;
    }

    /**
     * 记录一次 API 调用并触发预算检查
     */
    public void recordUsage(String tenantId, int tokensUsed) {
        long now = System.currentTimeMillis();
        var member = now + ":" + tokensUsed;
        redis.zadd("tenant:" + tenantId + ":usage", now, member);

        redis.zremrangeByScore("tenant:" + tenantId + ":usage",
                0, now - Duration.ofDays(30).toMillis());

        checkBudget(tenantId);
    }

    public UsageSnapshot checkBudget(String tenantId) {
        var budget = getTenantBudget(tenantId);
        if (budget == null) return null;

        var snapshot = getUsageSnapshot(tenantId, budget);
        var newLevel = evaluateAlertLevel(snapshot);
        var oldLevel = lastAlertLevel.get(tenantId);

        if (newLevel != null && (oldLevel == null ||
                newLevel.ordinal() > oldLevel.ordinal())) {
            triggerAlert(tenantId, snapshot, newLevel);
            lastAlertLevel.put(tenantId, newLevel);
        }

        return snapshot;
    }

    private AlertLevel evaluateAlertLevel(UsageSnapshot snapshot) {
        for (var level : AlertLevel.values()) {
            if (snapshot.dailyPercentage() >= level.threshold ||
                    snapshot.monthlyPercentage() >= level.threshold) {
                return level;
            }
        }
        return null;
    }

    private UsageSnapshot getUsageSnapshot(String tenantId, TenantBudget budget) {
        long now = System.currentTimeMillis();
        long dayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault())
                .toInstant().toEpochMilli();
        long monthStart = LocalDate.now().withDayOfMonth(1)
                .atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();

        var dailyMembers = redis.zrangeByScore(
                "tenant:" + tenantId + ":usage", dayStart, now);
        double dailyTokens = dailyMembers.stream()
                .mapToLong(m -> Long.parseLong(m.split(":")[1])).sum();

        var monthlyMembers = redis.zrangeByScore(
                "tenant:" + tenantId + ":usage", monthStart, now);
        double monthlyTokens = monthlyMembers.stream()
                .mapToLong(m -> Long.parseLong(m.split(":")[1])).sum();

        return new UsageSnapshot(tenantId, dailyTokens, monthlyTokens,
                budget.dailyLimit(), budget.monthlyLimit());
    }

    private void triggerAlert(String tenantId, UsageSnapshot snapshot,
                               AlertLevel level) {
        var budget = getTenantBudget(tenantId);
        var webhookBody = """
            {
              "tenantId": "%s",
              "alertLevel": "%s",
              "alertMessage": "%s",
              "dailyUsage": %.0f,
              "dailyLimit": %.0f,
              "dailyPercentage": %.1f%%,
              "monthlyUsage": %.0f,
              "monthlyLimit": %.0f,
              "monthlyPercentage": %.1f%%,
              "timestamp": "%s"
            }
            """.formatted(tenantId, level.name(), level.message,
                snapshot.dailyUsed(), snapshot.dailyLimit(),
                snapshot.dailyPercentage() * 100,
                snapshot.monthlyUsed(), snapshot.monthlyLimit(),
                snapshot.monthlyPercentage() * 100,
                Instant.now().toString());

        Thread.startVirtualThread(() -> sendWebhookWithRetry(
                budget.webhookUrl(), webhookBody, 3));

        if (level.autoBlock) {
            System.err.println("[BUDGET BLOCK] 租户 " + tenantId + " 已被自动阻断！");
        }
    }

    private void sendWebhookWithRetry(String url, String body, int retries) {
        for (int i = 0; i <= retries; i++) {
            try {
                var request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .timeout(Duration.ofSeconds(10))
                        .build();
                var response = httpClient.send(request,
                        HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() < 300) return;
            } catch (Exception e) {
                if (i < retries) {
                    try { Thread.sleep((long) Math.pow(5, i) * 1000); }
                    catch (InterruptedException ignored) {}
                }
            }
        }
        System.err.println("[WEBHOOK FAILED] 告警通知投递失败: " + url);
    }

    private TenantBudget getTenantBudget(String tenantId) {
        return new TenantBudget(tenantId,
                100_000,    // 日预算：100K tokens
                3_000_000,  // 月预算：3M tokens
                "https://hooks.slack.com/services/xxx");
    }

    // 使用示例
    public static void main(String[] args) {
        var service = new BudgetAlertService(null);
        var tenantId = "insurance-dept";

        for (int i = 0; i < 500; i++) {
            service.recordUsage(tenantId, 200);
        }

        var snapshot = service.checkBudget(tenantId);
        System.out.printf("日使用率: %.1f%% | 月使用率: %.1f%%%n",
                snapshot.dailyPercentage() * 100,
                snapshot.monthlyPercentage() * 100);
    }
}
```

预算告警不是"锦上添花"——它是生产级 AI 平台的财务安全保障。在 Agent 自动执行任务的场景中，一个失控的 ReAct 循环可能在 10 分钟内消耗数万 Token。没有预算熔断机制，就会在月底收到一张令人震惊的账单。实施建议：日预算从宽、月预算从严，给短时间内的突发流量留有余地，但对月度总量严格管控。

---

## 弹性降级策略

在生产环境中，模型服务不可用是常态而非异常——厂商 API 限流、网络抖动、机房故障、模型过载都可能导致调用失败。弹性降级策略的目标是确保故障发生时系统仍能提供**有损但可用**的服务。核心设计是四级降级链：**主模型 → 备选模型 → 本地模型 → 缓存兜底**。

- **第一级（主模型）**：业务指定的首选模型，如 Claude Opus 4，承载正常流量。
- **第二级（备选模型）**：同类能力的替代模型，如主模型故障时自动切换至 GPT-4o。备选模型的功能集和能力应与主模型接近，避免降级后返回格式不一致导致下游解析异常。
- **第三级（本地模型）**：部署在本地 GPU 服务器上的开源模型（如 Qwen3-72B），通过网络隔离保障基础可用性，即使外网中断仍可响应。本地模型推理延迟可能较高（100-500ms），需在网关层设置更宽松的超时。
- **第四级（缓存兜底）**：返回语义缓存中相似度最高的历史响应，并标注 `x-degraded: true` 让客户端知晓。

降级触发条件不是单一维度。推荐复合判据：（1）错误率超过 5%（连续 1 分钟窗口）；（2）延迟 P99 超过正常值 3 倍；（3）Token 消耗突然超过日预算的 50%/小时（可能是死循环）。Java 侧使用 Resilience4j 的 CircuitBreaker 配合 Fallback Chain 实现。

```java
// JDK 25 + Spring Boot 4.x — 四级降级链：Resilience4j CircuitBreaker + Fallback
import io.github.resilience4j.circuitbreaker.*;
import io.github.resilience4j.circuitbreaker.autoconfigure.*;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;
import java.util.function.Supplier;

@Service
public class GracefulDegradationService {

    /** 四级降级模型链 */
    private static final List<String> DEGRADATION_CHAIN = List.of(
        "claude-opus-4",          // 第一级：主模型
        "gpt-4o",                 // 第二级：备选模型
        "qwen3-72b-local",        // 第三级：本地模型
        "cache-fallback"          // 第四级：缓存兜底
    );

    public record DegradationResult(
        String response,
        String modelUsed,
        int degradationLevel,
        long latencyMs,
        boolean isDegraded
    ) {}

    private final Map<String, ModelAdapter> adapters;
    private final GatewayCacheService cacheService;
    private final Map<String, CircuitBreaker> circuitBreakers;
    private final DegradationMetrics metrics;

    public GracefulDegradationService(
            List<ModelAdapter> adapterList,
            GatewayCacheService cacheService,
            DegradationMetrics metrics) {
        this.cacheService = cacheService;
        this.metrics = metrics;
        this.adapters = new HashMap<>();

        // 为每个模型创建独立的 CircuitBreaker
        this.circuitBreakers = new ConcurrentHashMap<>();
        for (var modelName : DEGRADATION_CHAIN) {
            var cb = CircuitBreaker.of(modelName,
                CircuitBreakerConfig.custom()
                    .failureRateThreshold(50)           // 失败率阈值 50%
                    .slowCallRateThreshold(50)          // 慢调用阈值 50%
                    .slowCallDurationThreshold(Duration.ofSeconds(10))  // 慢=超10s
                    .slidingWindowSize(20)             // 滑动窗口 20 次
                    .minimumNumberOfCalls(10)           // 最少 10 次才熔断
                    .waitDurationInOpenState(Duration.ofSeconds(30))  // 半开等待
                    .permittedNumberOfCallsInHalfOpenState(3)
                    .automaticTransitionFromOpenToHalfOpenEnabled(true)
                    .build());
            this.circuitBreakers.put(modelName, cb);
        }
    }

    /**
     * 带降级链的聊天调用
     */
    public DegradationResult chatWithDegradation(UnifiedChatRequest request) {
        var span = metrics.startSpan("gateway.degraded_chat");
        var startTime = System.currentTimeMillis();

        for (int level = 0; level < DEGRADATION_CHAIN.size(); level++) {
            var modelName = DEGRADATION_CHAIN.get(level);
            var isLastLevel = level == DEGRADATION_CHAIN.size() - 1;

            try {
                // 检查熔断器状态
                var cb = circuitBreakers.get(modelName);
                if (cb != null && cb.getState() == CircuitBreaker.State.OPEN
                        && !isLastLevel) {
                    metrics.recordDegradation(modelName, level, "circuit_open");
                    continue; // 熔断器打开，跳至下一级
                }

                // 尝试调用
                var response = tryCallModel(modelName, request, level);
                var latency = System.currentTimeMillis() - startTime;

                var result = new DegradationResult(
                    response, modelName, level, latency, level > 0);
                metrics.recordSuccess(modelName, level, latency);
                span.setAttribute("degradation.level", level);
                span.setAttribute("model.used", modelName);
                span.end();
                return result;

            } catch (Exception e) {
                var latency = System.currentTimeMillis() - startTime;
                metrics.recordFailure(modelName, level, e.getClass().getSimpleName());

                // 记录熔断器失败
                if (circuitBreakers.containsKey(modelName)) {
                    circuitBreakers.get(modelName).acquirePermission();
                }

                if (isLastLevel) {
                    // 所有级别都失败，最后的兜底
                    var cached = cacheService.getSemanticMatch(
                        request.messages().getLast().content(), 0.80);
                    var degradedResponse = cached.orElse(
                        "抱歉，AI 服务暂时不可用，请稍后重试。");

                    span.setAttribute("degradation.all_failed", true);
                    span.end();
                    return new DegradationResult(
                        degradedResponse, "cache-fallback",
                        level, System.currentTimeMillis() - startTime, true);
                }

                System.err.printf("[降级] 模型 %s (级别%d) 调用失败: %s，切换至下一级%n",
                    modelName, level, e.getMessage());
            }
        }

        throw new IllegalStateException("Unexpected: unreachable");
    }

    /** -------------------- 降级触发条件检测 -------------------- **/

    /**
     * 复合判据：综合错误率、延迟、Token异常决定是否触发降级
     */
    public DegradationDecision evaluateDegradation(String modelName) {
        var errorRate = metrics.getErrorRate(modelName, Duration.ofMinutes(1));
        var p99Latency = metrics.getP99Latency(modelName, Duration.ofMinutes(5));
        var normalP99 = metrics.getBaselineP99(modelName);
        var tokenBurnRate = metrics.getTokenBurnRate(modelName);

        var reasons = new ArrayList<String>();
        var shouldDegrade = false;

        // 判据1: 错误率 > 5%
        if (errorRate > 0.05) {
            reasons.add("错误率 %.1f%% > 5%%".formatted(errorRate * 100));
            shouldDegrade = true;
        }

        // 判据2: P99 延迟 > 正常值 3 倍
        if (normalP99 > 0 && p99Latency > normalP99 * 3) {
            reasons.add("P99延迟 %dms > 正常值 %dms × 3".formatted(
                p99Latency, normalP99));
            shouldDegrade = true;
        }

        // 判据3: Token 消耗异常（> 日预算 50% / 小时）
        if (tokenBurnRate > 0.5) {
            reasons.add("Token消耗率 %.1f%/h > 50%/h ".formatted(tokenBurnRate * 100));
            shouldDegrade = true;
        }

        return new DegradationDecision(shouldDegrade, reasons);
    }

    public record DegradationDecision(boolean shouldDegrade, List<String> reasons) {}

    // --- 辅助方法 ---
    private String tryCallModel(String modelName, UnifiedChatRequest request,
                                 int level) throws Exception {
        var adapter = adapters.get(modelName);
        if (adapter == null) throw new IllegalArgumentException("未知模型: " + modelName);

        if (circuitBreakers.containsKey(modelName)) {
            var cb = circuitBreakers.get(modelName);
            Supplier<String> call = CircuitBreaker.decorateSupplier(cb,
                () -> {
                    try {
                        var resp = adapter.chat(request);
                        return resp.content();
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                });
            return call.get();
        }
        return adapter.chat(request).content();
    }

    // --- 指标接口（简化）---
    interface DegradationMetrics {
        Object startSpan(String name);
        void recordDegradation(String model, int level, String reason);
        void recordSuccess(String model, int level, long latencyMs);
        void recordFailure(String model, int level, String errorType);
        double getErrorRate(String model, Duration window);
        long getP99Latency(String model, Duration window);
        long getBaselineP99(String model);
        double getTokenBurnRate(String model);
    }
}
```

---

## Prompt 与数据版本化

Prompt 模板不是一成不变的静态文本——随着模型升级、场景演进和 A/B 实验结果，Prompt 会持续迭代。没有版本控制的 Prompt 管理就像没有 Git 的代码库，无法回滚、无法对比、无法追溯变更历史。

**Prompt 语义版本化（Semantic Versioning）** 借鉴 SemVer 规范：MAJOR 版本（不兼容变更）——修改输出格式要求、新增强制约束、改变工具调用协议；MINOR 版本（向后兼容的功能性变更）——新增示例、优化措辞、补充边界条件；PATCH 版本（向后兼容的修正）——修复拼写错误、调整标点、补充遗漏的字段说明。每次修改在 Prompt 仓库中以 Git commit 形式记录，commit message 需包含变更类型（MAJOR/MINOR/PATCH）和影响评估。

**Embedding 模型版本管理** 是更复杂的工程挑战。当 text-embedding-3-small (1536d) 升级到 text-embedding-3-large (3072d) 时，新旧向量维度不同且语义空间不对齐，无法直接比较。自动化迁移方案：（1）创建新索引（新维度、新索引名）；（2）在低峰期对全量文档用新模型重新 Embedding 并写入新索引；（3）查询时同时路由到新旧两套索引，按灰度比例融合结果；（4）新索引覆盖率达到 100% 后切换全量流量；（5）归档并删除旧索引。整个流程通过 CI/CD Pipeline 编排，每阶段有自动化的召回率对比验证。

**Golden Dataset 版本追踪**：评估 Prompt 质量的"金标准"数据集同样需要版本化。采用 Git-like 的版本追踪——每次 Prompt 变更时，在 Golden Dataset 上运行评估并产出对比报告（准确率、召回率、F1、延迟）。评估结果与 Prompt 版本号绑定，形成可追溯的质量档案。

```java
// JDK 25 + Spring Boot 4.x — Prompt 语义版本化与 Golden Dataset 追踪
import java.time.Instant;
import java.util.*;

public class PromptVersioningSystem {

    /** Prompt 语义版本号 */
    public record SemVersion(int major, int minor, int patch)
            implements Comparable<SemVersion> {
        public static SemVersion parse(String version) {
            var parts = version.split("\\.");
            return new SemVersion(
                Integer.parseInt(parts[0]),
                Integer.parseInt(parts[1]),
                Integer.parseInt(parts[2]));
        }

        @Override
        public String toString() {
            return "%d.%d.%d".formatted(major, minor, patch);
        }

        @Override
        public int compareTo(SemVersion o) {
            int cmp = Integer.compare(this.major, o.major);
            if (cmp != 0) return cmp;
            cmp = Integer.compare(this.minor, o.minor);
            if (cmp != 0) return cmp;
            return Integer.compare(this.patch, o.patch);
        }
    }

    /** 变更类型 */
    public enum ChangeType { MAJOR, MINOR, PATCH }

    /** Prompt 版本记录 */
    public record PromptVersionRecord(
        String promptId,
        SemVersion version,
        ChangeType changeType,
        String template,
        String commitMessage,
        String author,
        Instant timestamp,
        String parentCommitHash
    ) {}

    /** Golden Dataset 评估结果 */
    public record EvaluationResult(
        String promptId,
        SemVersion promptVersion,
        double accuracy,
        double recall,
        double f1Score,
        long avgLatencyMs,
        Map<String, Double> detailScores,
        Instant evaluatedAt
    ) {}

    /** 版本发布决策 */
    public record ReleaseDecision(
        boolean approved,
        SemVersion version,
        EvaluationResult currentResult,
        EvaluationResult baselineResult,
        String recommendation
    ) {}

    private final PromptVersionRepository versionRepo;
    private final GoldenDatasetEvaluator evaluator;

    public PromptVersioningSystem(PromptVersionRepository versionRepo,
                                   GoldenDatasetEvaluator evaluator) {
        this.versionRepo = versionRepo;
        this.evaluator = evaluator;
    }

    /**
     * 发布新版本：自动判定变更类型 + 运行 Golden Dataset 评估
     */
    public ReleaseDecision releaseVersion(
            String promptId, String newTemplate,
            String commitMessage, String author) {

        var current = versionRepo.getLatestVersion(promptId);
        var changeType = detectChangeType(current.template(), newTemplate);
        var newVersion = bumpVersion(
            current != null ? current.version() : new SemVersion(0, 0, 0),
            changeType);

        // 创建版本记录
        var record = new PromptVersionRecord(
            promptId, newVersion, changeType, newTemplate,
            commitMessage, author, Instant.now(),
            current != null ? current.parentCommitHash() : null);
        versionRepo.save(record);

        // 在 Golden Dataset 上运行评估
        var evalResult = evaluator.evaluate(promptId, newVersion, newTemplate);

        // 与基线版本对比
        var baselineResult = evaluator.getLatestEvaluation(promptId);
        var decision = makeReleaseDecision(
            newVersion, evalResult, baselineResult, changeType);

        System.out.printf("[版本发布] %s -> %s | %s | 准确率:%.2f F1:%.2f%n",
            promptId, newVersion, changeType,
            evalResult.accuracy(), evalResult.f1Score());

        return decision;
    }

    /** 自动检测变更类型 */
    private ChangeType detectChangeType(String oldTemplate, String newTemplate) {
        if (oldTemplate == null) return ChangeType.PATCH;

        // 检查是否修改了输出格式或工具调用协议（MAJOR）
        var formatPatterns = List.of(
            "输出格式", "返回JSON", "返回XML",
            "tool_call", "function_call", "必须包含");
        boolean hasMajorChange = formatPatterns.stream()
            .anyMatch(p -> !oldTemplate.contains(p) && newTemplate.contains(p))
            || formatPatterns.stream()
            .anyMatch(p -> oldTemplate.contains(p) && !newTemplate.contains(p));

        if (hasMajorChange) return ChangeType.MAJOR;

        // 检查是否为实质性内容变更（MINOR）
        var oldLines = oldTemplate.split("\n");
        var newLines = newTemplate.split("\n");
        int changedLines = Math.abs(oldLines.length - newLines.length);

        // 行数差异 > 5 行或者新增了示例/约束 → MINOR
        if (changedLines > 5 ||
            (!oldTemplate.contains("示例") && newTemplate.contains("示例")) ||
            (!oldTemplate.contains("约束") && newTemplate.contains("约束"))) {
            return ChangeType.MINOR;
        }

        return ChangeType.PATCH;
    }

    /** SemVer 版本号递增 */
    private SemVersion bumpVersion(SemVersion current, ChangeType changeType) {
        return switch (changeType) {
            case MAJOR -> new SemVersion(current.major() + 1, 0, 0);
            case MINOR -> new SemVersion(current.major(), current.minor() + 1, 0);
            case PATCH -> new SemVersion(current.major(), current.minor(),
                                         current.patch() + 1);
        };
    }

    /** 基于评估结果做发布决策 */
    private ReleaseDecision makeReleaseDecision(
            SemVersion newVersion,
            EvaluationResult currentResult,
            EvaluationResult baselineResult,
            ChangeType changeType) {

        // PATCH 变更：只需不退化即可
        if (changeType == ChangeType.PATCH) {
            var approved = baselineResult == null
                || currentResult.f1Score() >= baselineResult.f1Score() - 0.01;
            return new ReleaseDecision(approved, newVersion,
                currentResult, baselineResult,
                approved ? "PATCH 变更通过，评估指标无明显退化"
                         : "PATCH 变更导致 F1 下降 > 1%，请检查修改内容");
        }

        // MINOR/MAJOR 变更：必须达到最低质量门槛
        if (currentResult.f1Score() < 0.75) {
            return new ReleaseDecision(false, newVersion,
                currentResult, baselineResult,
                "F1 分数 %.2f 低于最低门槛 0.75，建议继续优化".formatted(
                    currentResult.f1Score()));
        }

        // 与基线对比，退化不超过 2%
        if (baselineResult != null &&
                currentResult.f1Score() < baselineResult.f1Score() - 0.02) {
            return new ReleaseDecision(false, newVersion,
                currentResult, baselineResult,
                "F1 分数较基线下降 %.2f (>2%%)，不建议发布".formatted(
                    baselineResult.f1Score() - currentResult.f1Score()));
        }

        return new ReleaseDecision(true, newVersion,
            currentResult, baselineResult, "评估通过，建议发布");
    }

    // --- 接口定义 ---
    interface PromptVersionRepository {
        PromptVersionRecord getLatestVersion(String promptId);
        void save(PromptVersionRecord record);
    }

    interface GoldenDatasetEvaluator {
        EvaluationResult evaluate(String promptId, SemVersion version,
                                   String template);
        EvaluationResult getLatestEvaluation(String promptId);
    }
}
```

---

## 成本归集与优化

AI API 调用成本是规模化 AI 应用的最大开销之一。没有精细化的成本归集，就无法回答"哪个租户消耗最多预算""哪个模型 ROI 最高"等关键问题。

**多维度成本归集**：成本应按三个维度拆分——租户（业务线/客户）、用户（终端用户）、模型（具体模型版本）。每次 API 调用后，根据响应中的 `usage.total_tokens` 和模型单价计算本次调用成本，写入时序数据库（如 InfluxDB 或 ClickHouse）。使用 Prometheus Counter + Grafana Dashboard 实时展示，支持按天/周/月聚合和钻取。关键指标包括：每租户日均成本、Top-N 高消耗用户、各模型占总成本比例、平均每请求成本。

**语义缓存成本收益分析**：缓存不是免费的——Redis 实例有存储和网络成本，语义缓存的 Embedding 计算也有推理成本。以每日 100 万次 API 调用为例：假设语义缓存命中率 20%，每次 API 调用平均 $0.005，则每日节省 $1,000。Redis 内存成本（16GB）约 $200/月 + Embedding 推理（20 万次/天 x $0.00002）约 $4/天。总体 ROI 约 8:1。但命中率是关键变量——如果 Query 高度差异化（如长尾问答），命中率可能低于 5%，此时缓存基础设施成本反而超过节省。

**模型降级策略的成本对比**：不是所有任务都需要旗舰模型。以情感分析任务为例——Claude Opus 4 ($15/M tokens) 和 GPT-5 Mini ($0.15/M tokens) 的准确率差异通常 <1%，但成本相差 100 倍。建立基于任务复杂度的自动路由：简单分类/提取任务 → 轻量模型；中等推理/总结 → 中等模型；复杂推理/代码生成 → 旗舰模型。在网关层实现复杂度检测（基于关键词 + 规则），自动选择成本最优的模型。

```java
// JDK 25 + Spring Boot 4.x — 多维度成本归集与模型降级建议
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class CostAttributionService {

    /** 模型单价表 ($/1M tokens) */
    private static final Map<String, Double> MODEL_PRICING = Map.of(
        "claude-opus-4",      15.0,
        "gpt-4o",             2.5,
        "gpt-5-mini",         0.15,
        "claude-haiku-3-5",   0.80,
        "qwen3-72b-local",    0.0     // 本地模型无 API 成本
    );

    /** 单次调用成本明细 */
    public record CostRecord(
        String tenantId,
        String userId,
        String modelName,
        int promptTokens,
        int completionTokens,
        double costUsd,
        Instant timestamp
    ) {}

    /** 租户成本汇总 */
    public record TenantCostSummary(
        String tenantId,
        double totalCost,
        double dailyCost,
        double monthlyCost,
        Map<String, Double> costByModel,    // 各模型成本占比
        List<HighCostUser> topUsers
    ) {}

    public record HighCostUser(String userId, double cost, int requestCount) {}

    /** 模型降级推荐 */
    public record DowngradeRecommendation(
        String currentModel,
        String recommendedModel,
        double currentCostPer1k,
        double recommendedCostPer1k,
        double estimatedSavingPercent,
        String reason
    ) {}

    // 按租户的成本累积计数器（生产环境应写入时序数据库）
    private final Map<String, TenantCostAccumulator> tenantCosts =
        new ConcurrentHashMap<>();

    /**
     * 记录一次 API 调用的成本
     */
    public void recordCost(CostRecord record) {
        var accumulator = tenantCosts.computeIfAbsent(
            record.tenantId(), TenantCostAccumulator::new);

        accumulator.addRecord(record);

        // 异步写入时序数据库
        Thread.startVirtualThread(() -> persistToTimeSeriesDB(record));
    }

    /**
     * 获取租户成本汇总
     */
    public TenantCostSummary getTenantSummary(String tenantId) {
        var acc = tenantCosts.get(tenantId);
        if (acc == null) {
            return new TenantCostSummary(tenantId, 0, 0, 0, Map.of(), List.of());
        }

        var now = Instant.now();
        var dayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault())
            .toInstant();

        var dailyCost = acc.getCostSince(dayStart);
        var monthlyCost = acc.getCostSince(
            LocalDate.now().withDayOfMonth(1)
                .atStartOfDay(ZoneId.systemDefault()).toInstant());
        var costByModel = acc.getCostByModel();
        var topUsers = acc.getTopUsers(5);

        return new TenantCostSummary(
            tenantId, acc.totalCost, dailyCost, monthlyCost,
            costByModel, topUsers);
    }

    /**
     * 基于任务复杂度推荐成本最优模型
     */
    public DowngradeRecommendation recommendDowngrade(
            String currentModel, String taskDescription) {

        var complexity = assessTaskComplexity(taskDescription);
        var currentPrice = MODEL_PRICING.getOrDefault(currentModel, 5.0);

        var recommendedModel = switch (complexity) {
            case SIMPLE -> selectCheapestModel(60);    // 最低能力门槛 60
            case MODERATE -> selectCheapestModel(75);   // 中等能力门槛 75
            case COMPLEX -> selectCheapestModel(90);    // 高能力门槛 90
        };

        var recommendedPrice = MODEL_PRICING.getOrDefault(recommendedModel, 5.0);
        var savingPercent = currentPrice > 0
            ? (1 - recommendedPrice / currentPrice) * 100
            : 0;

        var reason = buildRecommendationReason(
            currentModel, recommendedModel, complexity,
            currentPrice, recommendedPrice, savingPercent);

        return new DowngradeRecommendation(
            currentModel, recommendedModel,
            currentPrice, recommendedPrice, savingPercent, reason);
    }

    /** 评估任务复杂度 */
    private TaskComplexity assessTaskComplexity(String task) {
        var lower = task.toLowerCase();
        var complexKeywords = List.of(
            "证明", "推理", "分析", "设计", "生成代码",
            "多步骤", "数学", "逻辑", "架构");
        var simpleKeywords = List.of(
            "分类", "提取", "总结", "摘要", "判断",
            "是/否", "关键词", "情感", "格式化");

        long complexHits = complexKeywords.stream()
            .filter(lower::contains).count();
        long simpleHits = simpleKeywords.stream()
            .filter(lower::contains).count();

        if (complexHits >= 2) return TaskComplexity.COMPLEX;
        if (simpleHits >= 2) return TaskComplexity.SIMPLE;
        return TaskComplexity.MODERATE;
    }

    /** 选择满足能力门槛的最便宜模型 */
    private String selectCheapestModel(int minCapabilityScore) {
        var capabilityScores = Map.of(
            "claude-opus-4", 98,
            "gpt-4o", 92,
            "gpt-5-mini", 75,
            "claude-haiku-3-5", 65
        );

        return capabilityScores.entrySet().stream()
            .filter(e -> e.getValue() >= minCapabilityScore)
            .min(Comparator.comparingDouble(e ->
                MODEL_PRICING.getOrDefault(e.getKey(), 999.0)))
            .map(Map.Entry::getKey)
            .orElse("gpt-5-mini");
    }

    private String buildRecommendationReason(
            String current, String recommended, TaskComplexity complexity,
            double currentPrice, double recommendedPrice, double saving) {
        return """
            任务复杂度: %s
            当前模型: %s ($%.4f/1K tokens)
            推荐模型: %s ($%.4f/1K tokens)
            预估节省: %.0f%%
            """.formatted(complexity, current, currentPrice,
                recommended, recommendedPrice, saving);
    }

    private void persistToTimeSeriesDB(CostRecord record) {
        // 写入 InfluxDB / ClickHouse / Prometheus Pushgateway
    }

    private enum TaskComplexity { SIMPLE, MODERATE, COMPLEX }

    // --- 内部累加器 ---
    private static class TenantCostAccumulator {
        final String tenantId;
        double totalCost;
        final Map<String, Double> modelCosts = new HashMap<>();
        final Map<String, UserCost> userCosts = new HashMap<>();
        final List<CostRecord> records = new ArrayList<>();

        TenantCostAccumulator(String tenantId) { this.tenantId = tenantId; }

        synchronized void addRecord(CostRecord r) {
            totalCost += r.costUsd();
            modelCosts.merge(r.modelName(), r.costUsd(), Double::sum);
            userCosts.computeIfAbsent(r.userId(), UserCost::new)
                .addCost(r.costUsd());
            records.add(r);
        }

        synchronized double getCostSince(Instant since) {
            return records.stream()
                .filter(r -> r.timestamp().isAfter(since))
                .mapToDouble(CostRecord::costUsd).sum();
        }

        synchronized Map<String, Double> getCostByModel() {
            return new HashMap<>(modelCosts);
        }

        synchronized List<HighCostUser> getTopUsers(int n) {
            return userCosts.values().stream()
                .sorted((a, b) -> Double.compare(b.cost, a.cost))
                .limit(n)
                .map(u -> new HighCostUser(u.userId, u.cost, u.requestCount))
                .toList();
        }
    }

    private static class UserCost {
        final String userId;
        double cost;
        int requestCount;
        UserCost(String userId) { this.userId = userId; }
        void addCost(double c) { cost += c; requestCount++; }
    }
}
```

## 九、总结

本文介绍了企业级 AI 模型网关和 Prompt 管理平台的完整设计思路和 Spring 实现。模型网关提供了协议统一、智能路由、精细化限流、密钥安全管理和多层缓存等能力，是 AI 基础设施的关键组件。Prompt 管理平台通过模板引擎、版本控制、环境绑定和 A/B 测试，让 Prompt 成为可管理、可追踪、可优化的工程资产。

完整的演示代码位于配套 GitHub 仓库，包含单元测试和集成测试。生产部署时需替换内存实现为 Redis/数据库持久化，并接入监控和告警体系。
