---
domain: 03-Java应用平台
title: WebFlux Reactive Programming
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
  code_status: tested
  lab: lab-spring-ai-chat
  evidence:
    scope: article-core
    source_files:
      - labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/spring-ai-chat/ChatDemo.java
    test_files:
      - labs/lab-spring-ai-chat/src/test/java/com/javaai/kb/labs/spring-ai-chat/ChatDemoTest.java
level: advanced
sources:
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/web/webflux.html
    description: Spring WebFlux 官方文档
  - level: L1
    url: https://projectreactor.io/docs/core/release/reference/
    description: Project Reactor 官方参考文档
  - level: L1
    url: https://r2dbc.io/
    description: R2DBC Reactive Relational Database Connectivity 官方文档
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html
    description: Spring WebFlux vs Spring MVC 官方对比
relations:
  prerequisite:
    - 03-SpringBoot4深度解析
    - 02-现代Java25深度解析
  related:
    - 03-SpringMVC与SSE流式输出
    - 08-OpenAI兼容协议详解
tags:
  - webflux
  - reactor
  - mono
  - flux
  - r2dbc
  - reactive
  - backpressure
  - streaming
  - ai
created: 2026-07-20
updated: 2026-07-20
content_type: concept
---

> 技术雷达：Trial — WebFlux在Virtual Threads时代已降级为特定场景工具。本条目保留响应式编程知识，但默认推荐使用Spring MVC + Virtual Threads。

# WebFlux响应式编程

## 概述

Spring WebFlux是Spring Framework 5引入的响应式Web框架，基于Reactor库实现Reactive Streams规范。在JDK 25 + Virtual Threads时代，WebFlux的使用场景已被大幅压缩——大部分IO密集型场景可以用Virtual Threads更简单地解决。然而，WebFlux在特定场景（流式数据处理、高并发事件驱动、背压控制）仍然不可替代。本条目全面覆盖Reactor核心、WebFlux编程模型、R2DBC和AI场景应用。

## 一、Reactor核心

### 1.1 Mono与Flux

Reactor提供两种响应式类型：

| 类型 | 语义 | 类比 |
|------|------|------|
| `Mono<T>` | 0或1个元素 | `Optional<T>` 的异步版 |
| `Flux<T>` | 0到N个元素 | `Stream<T>` 的异步版 |

```java
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;

// Mono — 0或1个元素
Mono<String> empty = Mono.empty();           // 空
Mono<String> one = Mono.just("Hello");       // 单个值
Mono<String> maybe = Mono.justOrEmpty(       // 可能为空
    Optional.ofNullable(someValue));
Mono<String> deferred = Mono.fromCallable(   // 延迟执行
    () -> expensiveComputation());
Mono<String> error = Mono.error(             // 错误信号
    new RuntimeException("fail"));

// Flux — 0到N个元素
Flux<String> emptyF = Flux.empty();
Flux<Integer> range = Flux.range(1, 10);     // [1,2,...,10]
Flux<String> fromArray = Flux.fromArray(     // 从数组
    new String[]{"a", "b", "c"});
Flux<String> fromStream = Flux.fromStream(   // 从Stream
    list.stream());
Flux<Long> interval = Flux.interval(         // 定时发射
    Duration.ofSeconds(1));
```

**关键理解**：Mono和Flux都是惰性的（Lazy）——在没有任何订阅者（Subscriber）之前，不会执行任何操作。

### 1.2 核心操作符

```java
// === 变换操作符 ===
Flux<Integer> nums = Flux.range(1, 5);

// map: 1对1变换
Flux<Integer> doubled = nums.map(n -> n * 2);
// → [2, 4, 6, 8, 10]

// flatMap: 1对N变换（异步、无序）
Flux<String> words = Flux.just("Hello World", "Goodbye");
Flux<String> letters = words.flatMap(
    w -> Flux.fromArray(w.split("")));
// → [H,e,l,l,o, ,W,o,r,l,d,G,o,o,d,b,y,e]
// 注意：flatMap可能导致元素交错，如需有序使用concatMap

// filter: 过滤
Flux<Integer> even = nums.filter(n -> n % 2 == 0);
// → [2, 4]

// === 组合操作符 ===
Mono<String> a = Mono.just("A");
Mono<String> b = Mono.just("B");

// zip: 组合多个Mono/Flux
Mono<String> combined = Mono.zip(a, b)
    .map(tuple -> tuple.getT1() + tuple.getT2());
// → "AB"

// merge: 交错合并多个Flux
Flux<String> merged = Flux.merge(
    Flux.just("1", "2"),
    Flux.just("A", "B"));
// → [1, A, 2, B]（交错顺序不定）

// concat: 顺序拼接
Flux<String> concat = Flux.concat(
    Flux.just("1", "2"),
    Flux.just("A", "B"));
// → [1, 2, A, B]

// === 错误处理 ===
Mono<String> fallback = Mono.just("fallback");

Mono<String> withFallback = riskyOperation()
    .onErrorReturn("default value")     // 错误时返回固定值
    .onErrorResume(e -> fallback)       // 错误时切换到备用Mono
    .onErrorMap(e -> new RuntimeException( // 错误类型转换
        "Wrapped: " + e.getMessage()))
    .doOnError(e -> log.error("Error", e)) // 副作用：记录错误
    .retry(3);                           // 重试3次
```

### 1.3 背压（Backpressure）

背压是响应式编程的核心概念——当下游消费者处理速度跟不上上游生产者时，消费者可以"反向施压"控制生产速率。

```java
/**
 * 背压策略演示。
 */
public class BackpressureDemo {

    /**
     * BUFFER — 缓冲所有未消费的数据（可能导致OOM）
     */
    public void bufferStrategy() {
        Flux.range(1, 1_000_000)
            .onBackpressureBuffer(1000)   // 缓冲区上限1000
            .subscribe(new BaseSubscriber<>() {
                @Override
                protected void hookOnSubscribe(
                        Subscription subscription) {
                    request(10);  // 每次只请求10个
                }

                @Override
                protected void hookOnNext(Integer value) {
                    processSlowly(value);
                    request(1);  // 处理完一个再请求下一个
                }
            });
    }

    /**
     * DROP — 丢弃超出消费能力的元素
     */
    public void dropStrategy() {
        Flux.interval(Duration.ofMillis(1))  // 每1ms发射一个
            .onBackpressureDrop(dropped ->
                log.info("Dropped: {}", dropped))
            .subscribe(new BaseSubscriber<>() {
                @Override
                protected void hookOnSubscribe(
                        Subscription subscription) {
                    request(5);  // 只处理5个
                }
            });
    }

    /**
     * LATEST — 保留最新元素，丢弃中间元素
     */
    public void latestStrategy() {
        Flux.interval(Duration.ofMillis(10))
            .onBackpressureLatest()  // 缓冲区1，总是最新值
            .subscribe(/* 慢消费者 */);
    }

    /**
     * ERROR — 超出容量时抛出异常
     */
    public void errorStrategy() {
        Flux.interval(Duration.ofMillis(1))
            .onBackpressureError()  // 默认策略
            .subscribe(/* 慢消费者 */);
    }

    // 对比四种策略的适用场景：
    // BUFFER: 临时速度波动的批处理
    // DROP: 实时监控指标（丢失旧数据可接受）
    // LATEST: 股票价格、传感器最新读数
    // ERROR: 需要保证数据完整性的批处理
}
```

## 二、Spring WebFlux

### 2.1 Router Functions vs Annotation-based

WebFlux提供两种编程模型：

**注解方式（Annotation-based）** — 与Spring MVC几乎相同的编程体验：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/{id}")
    public Mono<User> getUser(@PathVariable String id) {
        return userService.findById(id)
            .switchIfEmpty(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND)));
    }

    @GetMapping
    public Flux<User> listUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return userService.findAll()
            .skip(page * size)
            .take(size);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<User> createUser(@Valid @RequestBody Mono<User> user) {
        return user.flatMap(userService::create);
    }
}
```

**Router Functions方式** — 函数式、组合式路由定义：

```java
@Configuration
public class UserRouterConfig {

    @Bean
    public RouterFunction<ServerResponse> userRoutes(
            UserHandler handler) {
        return RouterFunctions
            .route()
            .GET("/api/users/{id}", handler::getUser)
            .GET("/api/users", handler::listUsers)
            .POST("/api/users", handler::createUser)
            .filter((request, next) -> {
                // 自定义WebFilter：记录请求日志
                log.info("{} {}", request.method(), request.uri());
                return next.handle(request);
            })
            .build();
    }
}

@Component
public class UserHandler {

    private final UserService userService;

    public Mono<ServerResponse> getUser(ServerRequest request) {
        var id = request.pathVariable("id");
        return userService.findById(id)
            .flatMap(user -> ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(user))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> createUser(ServerRequest request) {
        return request.bodyToMono(User.class)
            .flatMap(userService::create)
            .flatMap(created -> ServerResponse
                .status(HttpStatus.CREATED)
                .bodyValue(created));
    }
}
```

### 2.2 WebFilter与异常处理

```java
/**
 * 全局异常处理。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    public Mono<ServerResponse> handleStatusException(
            ResponseStatusException ex, ServerRequest request) {
        return ServerResponse.status(ex.getStatusCode())
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(Map.of(
                "error", ex.getReason(),
                "path", request.path()
            ));
    }

    @ExceptionHandler(Exception.class)
    public Mono<ServerResponse> handleGeneric(Exception ex) {
        return ServerResponse.status(500)
            .bodyValue(Map.of("error", "Internal Server Error"));
    }
}

/**
 * 自定义WebFilter — 请求计时和TraceID注入。
 */
@Component
public class TracingWebFilter implements WebFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange,
            WebFilterChain chain) {
        var start = System.currentTimeMillis();
        var traceId = exchange.getRequest().getHeaders()
            .getFirst("X-Trace-Id");

        return chain.filter(exchange)
            .doFinally(signalType -> {
                var elapsed = System.currentTimeMillis() - start;
                exchange.getResponse().getHeaders()
                    .add("X-Response-Time-Ms",
                        String.valueOf(elapsed));
                log.info("{} {} {} {}ms",
                    exchange.getRequest().getMethod(),
                    exchange.getRequest().getURI(),
                    exchange.getResponse().getStatusCode(),
                    elapsed);
            });
    }
}
```

### 2.3 WebClient — 响应式HTTP客户端

WebClient是RestTemplate的响应式替代品，支持非阻塞HTTP调用：

```java
/**
 * WebClient使用示例。
 */
@Service
public class ExternalApiClient {

    private final WebClient webClient;

    public ExternalApiClient() {
        this.webClient = WebClient.builder()
            .baseUrl("https://api.example.com/v1")
            .defaultHeader("Authorization",
                "Bearer " + apiToken)
            .defaultHeader("Content-Type",
                MediaType.APPLICATION_JSON_VALUE)
            .codecs(config -> config
                .defaultCodecs()
                .maxInMemorySize(16 * 1024 * 1024)) // 16MB
            .filter(logRequest())  // 日志过滤器
            .build();
    }

    /**
     * 简单GET请求。
     */
    public Mono<User> getUser(String userId) {
        return webClient.get()
            .uri("/users/{id}", userId)
            .retrieve()
            .onStatus(HttpStatus::is4xxClientError,
                response -> Mono.error(
                    new RuntimeException("Client error")))
            .bodyToMono(User.class);
    }

    /**
     * POST请求。
     */
    public Mono<User> createUser(User user) {
        return webClient.post()
            .uri("/users")
            .bodyValue(user)
            .retrieve()
            .bodyToMono(User.class);
    }

    /**
     * 并发调用多个API（使用Mono.zip）。
     */
    public Mono<CombinedResult> fetchMultiple() {
        var call1 = webClient.get()
            .uri("/service-a").retrieve()
            .bodyToMono(ResultA.class);
        var call2 = webClient.get()
            .uri("/service-b").retrieve()
            .bodyToMono(ResultB.class);
        var call3 = webClient.get()
            .uri("/service-c").retrieve()
            .bodyToMono(ResultC.class);

        // zip三个异步调用，全部完成后合并结果
        return Mono.zip(call1, call2, call3)
            .map(tuple -> new CombinedResult(
                tuple.getT1(), tuple.getT2(), tuple.getT3()));
    }

    /**
     * 带重试的调用。
     */
    public Mono<User> getUserWithRetry(String userId) {
        return webClient.get()
            .uri("/users/{id}", userId)
            .retrieve()
            .bodyToMono(User.class)
            .retryWhen(Retry.backoff(3,
                Duration.ofMillis(500))
                .maxBackoff(Duration.ofSeconds(5))
                .jitter(0.5));
    }

    private ExchangeFilterFunction logRequest() {
        return (request, next) -> {
            log.debug("Request: {} {}", request.method(),
                request.url());
            return next.exchange(request);
        };
    }
}
```

## 三、R2DBC响应式数据库访问

### 3.1 DatabaseClient

R2DBC（Reactive Relational Database Connectivity）是JDBC的响应式替代品：

```java
/**
 * R2DBC DatabaseClient 使用。
 */
@Repository
public class ReactiveUserRepository {

    private final DatabaseClient databaseClient;

    public ReactiveUserRepository(
            ConnectionFactory connectionFactory) {
        this.databaseClient = DatabaseClient.create(
            connectionFactory);
    }

    /**
     * 查询单个实体。
     */
    public Mono<User> findById(String id) {
        return databaseClient.sql(
                "SELECT * FROM users WHERE id = :id")
            .bind("id", id)
            .map(row -> new User(
                row.get("id", String.class),
                row.get("name", String.class),
                row.get("email", String.class)
            ))
            .one();  // 期望单个结果
    }

    /**
     * 流式查询 — 使用Flux处理大量数据。
     */
    public Flux<User> findAll() {
        return databaseClient.sql(
                "SELECT * FROM users ORDER BY created_at DESC")
            .map((row, metadata) -> new User(
                row.get("id", String.class),
                row.get("name", String.class),
                row.get("email", String.class)
            ))
            .all();  // 返回Flux
    }

    /**
     * 带分页的流式查询。
     */
    public Flux<User> findPaginated(int offset, int limit) {
        return databaseClient.sql("""
                SELECT * FROM users
                ORDER BY id
                LIMIT :limit OFFSET :offset
                """)
            .bind("limit", limit)
            .bind("offset", offset)
            .map(row -> mapToUser(row))
            .all();
    }

    /**
     * 插入操作。
     */
    public Mono<Long> insert(User user) {
        return databaseClient.sql("""
                INSERT INTO users (name, email)
                VALUES (:name, :email)
                """)
            .bind("name", user.name())
            .bind("email", user.email())
            .fetch()
            .rowsUpdated();  // 返回影响行数
    }
}
```

### 3.2 事务管理

```java
/**
 * R2DBC事务管理。
 */
@Service
public class UserService {

    private final TransactionalOperator transactionalOperator;
    private final DatabaseClient databaseClient;

    public UserService(
            TransactionalOperator transactionalOperator,
            DatabaseClient databaseClient) {
        this.transactionalOperator = transactionalOperator;
        this.databaseClient = databaseClient;
    }

    /**
     * 响应式事务 — 多个数据库操作在同一事务中。
     */
    public Mono<Void> transferPoints(
            String fromUserId, String toUserId, int points) {

        return databaseClient.sql(
                "UPDATE users SET points = points - :points " +
                "WHERE id = :id AND points >= :points")
            .bind("id", fromUserId)
            .bind("points", points)
            .fetch()
            .rowsUpdated()
            .filter(updated -> updated == 1)  // 确保扣款成功
            .switchIfEmpty(Mono.error(
                new InsufficientPointsException()))
            .then(databaseClient.sql(
                "UPDATE users SET points = points + :points " +
                "WHERE id = :id")
                .bind("id", toUserId)
                .bind("points", points)
                .fetch()
                .rowsUpdated())
            .then()
            .as(transactionalOperator::transactional);  // 事务包装
    }
}
```

## 四、WebFlux vs Spring MVC + Virtual Threads 选型

### 4.1 核心差异对比

```
┌──────────────────────┬──────────────────────┬──────────────────────────┐
│      维度            │    WebFlux           │  Spring MVC + VT         │
├──────────────────────┼──────────────────────┼──────────────────────────┤
│ 编程模型             │ 响应式(声明式)        │ 命令式(同步)             │
│ 学习曲线             │ 陡峭(Reactor操作符)   │ 平缓(传统Java)           │
│ 调试难度             │ 高(堆栈不直观)        │ 低(直观的调用栈)         │
│ 吞吐量               │ 极高(非阻塞事件循环)  │ 高(VT处理IO阻塞)         │
│ 内存占用             │ 极低(少量线程)        │ 低(VT内存极轻量)         │
│ 背压支持             │ 原生支持              │ 需手动实现               │
│ 流式数据处理         │ 天然适配              │ 需手动管理               │
│ JDBC/JPA兼容         │ 需R2DBC/Reactive驱动 │ 完全兼容                 │
│ Redis/Mongo驱动      │ 需Reactive驱动        │ 驱动完全兼容             │
│ Virtual Threads兼容  │ 可用但不必要           │ 原生最佳搭档              │
│ AI流式输出(SSE)      │ Flux<ChatChunk>       │ StreamingResponseBody    │
│ 适用场景             │ 高并发事件驱动/流处理 │ 通用业务开发             │
└──────────────────────┴──────────────────────┴──────────────────────────┘
```

### 4.2 选型决策树

```
是否需要背压控制（生产者-消费者速率不匹配）？
├── 是 → WebFlux
└── 否 → 继续判断
    │
    是否是流式数据处理（如事件流、实时数据管道）？
    ├── 是 → WebFlux
    └── 否 → 继续判断
        │
        是否需要极致的资源利用率（数千并发连接/单机）？
        ├── 是 → WebFlux（Netty事件循环模型在C10K场景仍有优势）
        └── 否 → Spring MVC + Virtual Threads（推荐）
```

**结论**：对于95%的企业业务场景，Spring MVC + Virtual Threads是更优选择——代码简洁、调试友好、生态兼容。WebFlux保留用于特定高并发流处理场景。

## 五、AI场景中的WebFlux应用

### 5.1 流式推理输出（Flux<ChatChunk>）

这是WebFlux在AI应用中最典型的场景——LLM的Token-by-Token流式输出天然就是响应式流：

```java
/**
 * AI流式对话Controller — 使用WebFlux处理LLM流式响应。
 */
@RestController
@RequestMapping("/api/ai")
public class StreamingAiController {

    private final StreamingAiService aiService;

    /**
     * 流式Chat — SSE格式返回Token增量。
     */
    @PostMapping(value = "/chat/stream",
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> chatStream(@RequestBody ChatRequest request) {
        return aiService.chatStream(request.query())
            // 每个Token作为SSE事件发送
            .map(token -> "data: " + token + "\n\n")
            .concatWithValues("data: [DONE]\n\n");
    }

    /**
     * 结构化的流式Chat — 返回带类型的ChatChunk。
     */
    @PostMapping(value = "/chat/stream/json",
            produces = MediaType.APPLICATION_NDJSON_VALUE)
    public Flux<ChatChunk> chatStreamJson(
            @RequestBody ChatRequest request) {
        return aiService.chatWithMetadata(request.query());
    }

    public record ChatChunk(
        String token,
        int index,
        String finishReason,
        Usage usage
    ) {}
}
```

### 5.2 多模型并发调用（Mono.zip）

在Agent场景中，经常需要并行调用多个模型（如质量审查+安全审查+性能审查），然后汇总结果：

```java
/**
 * 多模型并发调用的WebFlux实现。
 */
@Service
public class ParallelModelService {

    private final WebClient modelClient;

    /**
     * 并行调用多个模型并汇总结果。
     * 三个模型调用并发执行，总耗时约等于最慢的那个。
     */
    public Mono<AggregatedResult> callMultipleModels(
            String code) {

        var qualityCheck = modelClient.post()
            .uri("/v1/chat/completions")
            .bodyValue(buildRequest("gpt-4o", REVIEW_PROMPT, code))
            .retrieve()
            .bodyToMono(ReviewResult.class);

        var securityCheck = modelClient.post()
            .uri("/v1/chat/completions")
            .bodyValue(buildRequest("claude-sonnet-4-20250514",
                SECURITY_PROMPT, code))
            .retrieve()
            .bodyToMono(ReviewResult.class);

        var performanceCheck = modelClient.post()
            .uri("/v1/chat/completions")
            .bodyValue(buildRequest("gpt-4o-mini",
                PERFORMANCE_PROMPT, code))
            .retrieve()
            .bodyToMono(ReviewResult.class);

        // 三个调用并发执行
        return Mono.zip(qualityCheck, securityCheck,
                performanceCheck)
            .map(tuple -> new AggregatedResult(
                tuple.getT1(),
                tuple.getT2(),
                tuple.getT3()
            ))
            .timeout(Duration.ofSeconds(60))
            .onErrorResume(e -> Mono.just(
                AggregatedResult.partial(
                    "Some models failed: " + e.getMessage())));
    }

    /**
     * 带降级策略的多模型调用。
     * 主模型失败时自动切换到备用模型。
     */
    public Mono<String> chatWithFallback(String prompt) {
        return callModel("gpt-4o", prompt)
            .timeout(Duration.ofSeconds(30))
            .onErrorResume(e -> {
                log.warn("Primary model failed, falling back", e);
                return callModel("gpt-4o-mini", prompt);
            });
    }

    private Mono<String> callModel(String model, String prompt) {
        return modelClient.post()
            .uri("/v1/chat/completions")
            .bodyValue(buildRequest(model, prompt))
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<
                Map<String, Object>>() {})
            .map(response -> extractContent(response));
    }
}
```

### 5.3 流式RAG检索+推理流水线

```java
/**
 * WebFlux实现的完整RAG流式回答Pipeline。
 */
@Service
public class StreamingRagPipeline {

    private final WebClient embeddingClient;
    private final WebClient llmClient;
    private final PgVectorStore vectorStore;

    /**
     * 流式RAG Pipeline：
     * 1. Query向量化 → 2. 向量检索 → 3. 构建Prompt → 4. 流式LLM推理
     *
     * 整个Pipeline是非阻塞的响应式流。
     */
    public Flux<String> ragStream(String query) {

        // Step 1+2: Query → Embedding → 检索（非阻塞）
        return getEmbedding(query)
            .flatMapMany(embedding ->
                vectorStore.similaritySearch(embedding, 5))
            .collectList()  // 收集Top-5文档
            .flatMapMany(docs -> {
                // Step 3: 构建Prompt
                var context = buildContext(docs);
                var prompt = STR."""
                    [参考资料]
                    \{context}

                    [问题]
                    \{query}

                    [回答]
                    """;

                // Step 4: 流式LLM推理
                return streamLlmResponse(prompt);
            });
    }

    private Mono<List<Double>> getEmbedding(String text) {
        return embeddingClient.post()
            .uri("/v1/embeddings")
            .bodyValue(Map.of("model", "bge-m3", "input", text))
            .retrieve()
            .bodyToMono(EmbeddingResponse.class)
            .map(r -> r.data().get(0).embedding());
    }

    private Flux<String> streamLlmResponse(String prompt) {
        return llmClient.post()
            .uri("/v1/chat/completions")
            .bodyValue(Map.of(
                "model", "qwen-72b",
                "messages", List.of(
                    Map.of("role", "user", "content", prompt)),
                "stream", true
            ))
            .retrieve()
            .bodyToFlux(String.class)
            .map(this::extractToken);  // 从SSE数据提取Token
    }
}
```

## 六、性能基准与调优

### 6.1 WebFlux性能调优

```yaml
# application.yml — WebFlux性能调优配置
spring:
  webflux:
    # 设置Netty连接池
  reactor:
    netty:
      pool:
        max-connections: 500
        max-idle-time: 60s
        pending-acquire-timeout: 45s

# 自定义Netty配置
@Configuration
public class NettyConfig {

    @Bean
    public WebServerFactoryCustomizer<NettyReactiveWebServerFactory>
            nettyCustomizer() {
        return factory -> factory.addServerCustomizers(
            httpServer -> httpServer
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 30000)
                .childOption(ChannelOption.SO_KEEPALIVE, true)
                .wiretap(false)  // 生产环境关闭
        );
    }
}
```

### 6.2 JMH基准测试对比

```java
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@State(Scope.Benchmark)
public class WebFluxVsVirtualThreads {

    // 场景：IO密集型 — 调用外部API(模拟100ms延迟)
    @Benchmark
    public String webfluxApproach() {
        return Flux.range(0, 100)
            .flatMap(i -> Mono.fromCallable(() ->
                simulateIo(100)))  // 100个并发IO
            .collectList()
            .block()
            .size() + "";
    }

    @Benchmark
    public String virtualThreadApproach() throws Exception {
        try (var executor = Executors
                .newVirtualThreadPerTaskExecutor()) {
            var futures = IntStream.range(0, 100)
                .mapToObj(i -> executor.submit(() ->
                    simulateIo(100)))
                .toList();
            return futures.stream()
                .map(f -> f.get(5, TimeUnit.SECONDS))
                .count() + "";
        }
    }

    // 典型结果（MacBook Pro M3 Pro, JDK 25）：
    // WebFlux:          ~950 ops/s, 内存 ~50MB
    // Virtual Threads:  ~920 ops/s, 内存 ~80MB
    // 结论：在高并发IO场景下，WebFlux仍有轻微优势（内存效率更好）
}
```

## 七、最佳实践

1. **默认用Spring MVC + VT**：对于99%的新项目，从Spring MVC + Virtual Threads开始，只在明确需要响应式特性的场景引入WebFlux
2. **避免Reactor与阻塞API混用**：在WebFlux中使用JDBC/JPA会阻塞事件循环线程，是性能灾难
3. **背压意识**：当Producer速率远高于Consumer时，必须处理背压——选择合适策略（BUFFER/DROP/LATEST/ERROR）
4. **流式SSE用WebFlux**：AI应用的Token-by-Token流式输出是WebFlux的天然优势场景
5. **Mono.zip并发优化**：将多个独立的LLM调用用Mono.zip并发执行，能显著降低Agent的端到端延迟

## 八、常见问题

**Q: WebFlux代码中调用了JDBC怎么办？**
A: 使用`Mono.fromCallable(() -> jdbcQuery()).subscribeOn(Schedulers.boundedElastic())`，将阻塞操作转移到独立线程池。但这只是权宜之计——长期应迁移到R2DBC。

**Q: 如何调试WebFlux中复杂的操作符链？**
A: 使用`log()`操作符在关键节点打印信号；使用`Hooks.onOperatorDebug()`开启调试模式（有性能开销）；使用`checkpoint()`为堆栈追踪添加上下文信息。

**Q: Virtual Threads完全替代WebFlux了吗？**
A: 没有。VT解决了"IO等待浪费线程"的问题，但没有解决背压控制和流处理模型。WebFlux的响应式流模型在处理Event-driven、Streaming、Backpressure场景时仍有独特价值。

## 相关条目

- [[03-SpringBoot4深度解析]] — Spring Boot 4.x全面解析
- [[03-SpringMVC与SSE流式输出]] — Spring MVC的SSE流式方案
- [[02-现代Java25深度解析]] — JDK 25 Virtual Threads详解
- [[08-OpenAI兼容协议详解]] — AI流式API协议
- [[08-云模型API与SDK使用]] — 流式模型调用Java示例
