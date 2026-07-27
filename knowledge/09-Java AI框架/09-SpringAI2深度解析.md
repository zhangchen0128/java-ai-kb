---
domain: "09-Java AI框架"
title: "Spring AI 2.x In Depth"
status: "draft"
level: "intermediate"
sources:
  - level: "L1"
    url: "https://docs.spring.io/spring-ai/reference/"
    description: "Spring AI 2.x 官方参考文档"
  - level: "L2"
    url: "https://github.com/spring-projects/spring-ai"
    description: "Spring AI GitHub 仓库"
relations:
  prerequisite: ["03-SpringBoot4深度解析", "08-OpenAI兼容协议详解"]
  related: ["09-架构抽象层设计", "09-LangChain4j对比与选型", "08-云模型API与SDK使用"]
tags: ["spring-ai", "chat-client", "advisors", "tool-calling", "rag", "chat-memory", "mcp", "structured-output"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Spring AI 2.x In Depth

## 概述

Spring AI 2.x 是 Spring 生态的官方 AI 框架，为 Java 开发者提供了覆盖 Chat、Embedding、Image、Audio、Moderation 等多模态能力的统一抽象层。它深度集成 Spring Boot 4.x 的自动配置、Micrometer 可观测性、Spring Security 安全等能力，是 Java AI 应用开发的主栈框架。

> 技术雷达：Adopt — Java AI 框架主栈

## 核心架构

```
Spring AI 2.x 核心架构：

┌──────────────────────────────────────────────────────────────┐
│                      应用层 (Your App)                        │
├──────────────────────────────────────────────────────────────┤
│  ChatClient   │  Structured Output  │  Advisors  │  Eval    │
├──────────────────────────────────────────────────────────────┤
│          Spring AI Core Abstractions                          │
│  ChatModel │ EmbeddingModel │ ImageModel │ AudioModel        │
│  VectorStore │ ChatMemory │ ToolCallback │ Document          │
├──────────────────────────────────────────────────────────────┤
│                    Provider Implementations                    │
│  OpenAI │ Anthropic │ Ollama │ Bedrock │ Gemini │ Azure      │
│  Pgvector │ Redis │ Elasticsearch │ Milvus │ Qdrant         │
├──────────────────────────────────────────────────────────────┤
│                   Spring Boot Auto-Configuration               │
│  spring-ai-openai-spring-boot-starter                          │
│  spring-ai-ollama-spring-boot-starter                          │
│  spring-ai-pgvector-spring-boot-starter                        │
│  ...                                                           │
└──────────────────────────────────────────────────────────────┘
```

**关键抽象层：**

| 接口 | 用途 | 核心方法 |
|------|------|----------|
| ChatModel | 聊天/对话模型 | `call(Prompt)`, `stream(Prompt)` |
| EmbeddingModel | 文本向量化 | `embed(String/Document)`, `embed(List)` |
| ImageModel | 图片生成 | `call(ImagePrompt)` |
| AudioModel | 语音转文字/文字转语音 | `call(SpeechPrompt)` |
| ModerationModel | 内容审核 | `call(ModerationPrompt)` |
| VectorStore | 向量存储 | `add(List<Document>)`, `similaritySearch(String)` |
| ChatMemory | 对话记忆 | `add(String, List<Message>)`, `get(String, int)` |

## ChatClient

ChatClient 是 Spring AI 2.x 的核心入口类，提供构建式（Fluent）API。

### 基础用法

```java
@SpringBootApplication
public class ChatClientDemo {

    public static void main(String[] args) {
        SpringApplication.run(ChatClientDemo.class, args);
    }

    @Bean
    CommandLineRunner demo(ChatClient.Builder builder) {
        return args -> {
            var chatClient = builder.build();

            // 1. 最简单的调用
            String answer = chatClient.prompt()
                .user("用一句话解释什么是Spring AI")
                .call()
                .content();
            System.out.println(answer);

            // 2. 带 system prompt
            String answer2 = chatClient.prompt()
                .system("你是Java专家，回答必须包含代码示例")
                .user("如何在Spring Boot中配置虚拟线程？")
                .call()
                .content();
            System.out.println(answer2);

            // 3. 携带历史消息（多轮对话）
            String answer3 = chatClient.prompt()
                .messages(
                    new UserMessage("什么是Virtual Threads?"),
                    new AssistantMessage("Virtual Threads是JDK 21引入的轻量级线程..."),
                    new UserMessage("它和平台线程有什么区别？")
                )
                .call()
                .content();
            System.out.println(answer3);
        };
    }
}
```

### 构建式 API 详解

```java
public class ChatClientFluentApi {

    private final ChatClient chatClient;

    public ChatClientFluentApi(ChatClient.Builder builder) {
        this.chatClient = builder
            .defaultSystem("你是Java AI开发助手")
            .defaultAdvisors(new SimpleLoggerAdvisor())
            .build();
    }

    /**
     * 完整 API 展示
     */
    public String complexCall(String userQuestion) {
        return chatClient.prompt()
            // System Prompt（可覆盖 defaultSystem）
            .system(s -> s.text("回答要简洁，控制在200字以内"))

            // 用户消息（支持多种构建方式）
            .user(u -> u.text("问题：").text(userQuestion))

            // 函数/工具注册
            .tools(new DateTimeTool())
            .toolContext(Map.of("userId", "user123"))

            // Advisors（Spring AI 的拦截器链）
            .advisors(a -> a
                .param("chat_memory_conversation_id", "conv-001")
                .param("chat_memory_retrieve_size", 100))

            // 模型参数覆盖
            .options(ChatOptionsBuilder.builder()
                .withTemperature(0.7d)
                .withTopP(0.9d)
                .withMaxTokens(500)
                .build())

            // 执行
            .call()
            .content();
    }

    /**
     * 流式调用
     */
    public Flux<String> streamCall(String question) {
        return chatClient.prompt()
            .user(question)
            .stream()
            .content();  // 返回 Flux<String>
    }
}
```

### 流式处理

```java
public class StreamHandling {

    private final ChatClient chatClient;

    public StreamHandling(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    /**
     * 基本流式调用
     */
    public void basicStream() {
        chatClient.prompt()
            .user("写一首关于Java的5行短诗")
            .stream()
            .content()
            .doOnNext(token -> System.out.print(token))
            .doOnComplete(() -> System.out.println("\n[完成]"))
            .blockLast();  // 等待流结束
    }

    /**
     * 流式调用 — 获取完整 ChatResponse（含metadata）
     */
    public void streamWithMetadata() {
        chatClient.prompt()
            .user("解释Java中的Record类型")
            .stream()
            .chatResponse()
            .doOnNext(response -> {
                // 每个 chunk 是一个 ChatResponse
                System.out.print(response.getResult().getOutput().getContent());
                // 最后一个 chunk 包含 metadata
                if (response.getMetadata() != null) {
                    System.out.println("\nToken用量: " +
                        response.getMetadata().getUsage());
                }
            })
            .blockLast();
    }

    /**
     * SSE 端点 — 向前端推送流式内容
     */
    @GetMapping(value = "/api/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> sseStream(@RequestParam String question) {
        return chatClient.prompt()
            .user(question)
            .stream()
            .content()
            .map(token -> ServerSentEvent.<String>builder()
                .data(token)
                .build())
            .concatWith(Mono.just(ServerSentEvent.<String>builder()
                .event("done")
                .data("[DONE]")
                .build()));
    }
}
```

## Advisors 机制

Advisors 是 Spring AI 2.x 的拦截器链机制，类似于 Spring MVC 的 Interceptor 或 Servlet Filter。

```
请求处理管道：

ChatClient.prompt()
    → Advisor Chain 前置处理
        → 注入历史消息 (ChatMemory Advisor)
        → Query 改写 (QuestionAnswer Advisor)
        → RAG 检索 (RetrievalAugmentation Advisor)
    → 模型调用 (ChatModel.call/stream)
    → Advisor Chain 后置处理
        → 保存到记忆
        → 日志记录
    → 返回给调用方
```

### 内置 Advisors

```java
public class BuiltInAdvisors {

    private final ChatClient chatClient;
    private final VectorStore vectorStore;
    private final ChatMemory chatMemory;

    public BuiltInAdvisors(ChatClient.Builder builder,
            VectorStore vectorStore, ChatMemory chatMemory) {
        this.chatClient = builder.build();
        this.vectorStore = vectorStore;
        this.chatMemory = chatMemory;
    }

    /**
     * SimpleLoggerAdvisor — 记录请求/响应日志
     */
    public void loggerAdvisor() {
        chatClient.prompt()
            .user("Hello")
            .advisors(new SimpleLoggerAdvisor())
            .call()
            .content();
        // 日志输出：
        // [REQUEST]  user=Hello  model=gpt-4o  ...
        // [RESPONSE] content=Hi there!...  tokens=50
    }

    /**
     * QuestionAnswerAdvisor — 基于用户上下文的问答增强
     */
    public void questionAnswerAdvisor() {
        chatClient.prompt()
            .user("Virtual Threads的优势是什么？")
            .advisors(new QuestionAnswerAdvisor(vectorStore))
            .call()
            .content();
        // Advisor 会：
        // 1. 将 user question 在 vectorStore 中搜索
        // 2. 将检索到的文档注入 context
    }

    /**
     * RetrievalAugmentationAdvisor — 完整的 RAG Advisor
     */
    public void ragAdvisor() {
        chatClient.prompt()
            .user("什么是Spring AI的Advisor机制？")
            .advisors(RetrievalAugmentationAdvisor.builder()
                .vectorStore(vectorStore)
                .topK(5)
                .similarityThreshold(0.7d)
                .build())
            .call()
            .content();
    }

    /**
     * ChatMemory Advisor — 对话记忆管理
     */
    public void chatMemoryAdvisor() {
        chatClient.prompt()
            .user("我叫张三")
            .advisors(a -> a.param("chat_memory_conversation_id", "user-123"))
            .call()
            .content();

        chatClient.prompt()
            .user("我叫什么名字？")
            .advisors(a -> a.param("chat_memory_conversation_id", "user-123"))
            .call()
            .content();
        // 回答："你叫张三"（从记忆中检索）
    }

    /**
     * SafeGuard Advisor — 安全护栏
     */
    public void safeguardAdvisor() {
        chatClient.prompt()
            .user("请正常回答问题")
            .advisors(new SafeGuardAdvisor(List.of(
                "暴力", "色情", "政治敏感"  // 敏感词列表
            )))
            .call()
            .content();
    }
}
```

### 自定义 Advisor

```java
import org.springframework.ai.chat.client.advisor.api.*;
import reactor.core.publisher.Flux;

/**
 * 自定义 Advisor：Token 用量追踪和告警
 */
public class TokenUsageAdvisor implements CallAroundAdvisor, StreamAroundAdvisor {

    private static final int WARNING_THRESHOLD = 10000;

    @Override
    public String getName() {
        return "token-usage-tracker";
    }

    @Override
    public int getOrder() {
        return 100;
    }

    /**
     * 非流式调用的环绕处理
     */
    @Override
    public AdvisedResponse aroundCall(
            AdvisedRequest advisedRequest,
            CallAroundAdvisorChain chain) {

        var startTime = System.currentTimeMillis();

        // 前置处理：检查历史 token 使用量
        var messages = advisedRequest.messages();
        System.out.println("[TokenTracker] 请求消息数: " + messages.size());

        // 执行后续链
        AdvisedResponse response = chain.nextAroundCall(advisedRequest);

        // 后置处理：记录 token 使用
        var metadata = response.response().getMetadata();
        if (metadata != null && metadata.getUsage() != null) {
            var usage = metadata.getUsage();
            var elapsed = System.currentTimeMillis() - startTime;

            System.out.printf(
                "[TokenTracker] 输入:%d 输出:%d 总计:%d 耗时:%dms%n",
                usage.getPromptTokens(),
                usage.getGenerationTokens(),
                usage.getTotalTokens(),
                elapsed
            );

            if (usage.getTotalTokens() > WARNING_THRESHOLD) {
                System.out.println("[TokenTracker] 警告：Token使用超过阈值!");
                // 可以发送告警、记录metric等
            }
        }

        return response;
    }

    /**
     * 流式调用的环绕处理
     */
    @Override
    public Flux<AdvisedResponse> aroundStream(
            AdvisedRequest advisedRequest,
            StreamAroundAdvisorChain chain) {

        var startTime = System.currentTimeMillis();

        return chain.nextAroundStream(advisedRequest)
            .doOnComplete(() -> {
                var elapsed = System.currentTimeMillis() - startTime;
                System.out.println("[TokenTracker] 流式响应完成，耗时:" + elapsed + "ms");
            });
    }
}

/**
 * 自定义 Advisor：自动重试
 */
public class RetryAdvisor implements CallAroundAdvisor {

    private final int maxRetries;
    private final Duration initialBackoff;

    public RetryAdvisor(int maxRetries, Duration initialBackoff) {
        this.maxRetries = maxRetries;
        this.initialBackoff = initialBackoff;
    }

    @Override
    public String getName() {
        return "retry-advisor";
    }

    @Override
    public int getOrder() {
        return 0;  // 最外层，第一个执行
    }

    @Override
    public AdvisedResponse aroundCall(
            AdvisedRequest advisedRequest,
            CallAroundAdvisorChain chain) {

        Exception lastException = null;

        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return chain.nextAroundCall(advisedRequest);
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxRetries && isRetryable(e)) {
                    long backoffMs = initialBackoff.toMillis() * (1L << (attempt - 1));
                    System.out.printf("[Retry] 第%d次重试，等待%dms%n", attempt, backoffMs);
                    try {
                        Thread.sleep(backoffMs);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException(ie);
                    }
                }
            }
        }

        throw new RuntimeException("重试" + maxRetries + "次后仍失败", lastException);
    }

    private boolean isRetryable(Exception e) {
        return e.getMessage() != null &&
            (e.getMessage().contains("429") ||
             e.getMessage().contains("503") ||
             e.getMessage().contains("timeout"));
    }

    @Override
    public Flux<AdvisedResponse> aroundStream(
            AdvisedRequest advisedRequest,
            StreamAroundAdvisorChain chain) {
        // 流式调用不支持重试（因为已经有部分数据发送给客户端）
        return chain.nextAroundStream(advisedRequest);
    }
}
```

### Advisor 链编排

```java
/**
 * Advisor 链编排示例
 * 注意顺序：先 ChatMemory（注入上下文），
 * 再 RAG（检索知识），最后 Logger（记录完整请求）
 */
public class AdvisorChainDemo {

    private final ChatClient chatClient;

    public AdvisorChainDemo(ChatClient.Builder builder,
            VectorStore vectorStore, ChatMemory chatMemory) {
        this.chatClient = builder
            .defaultAdvisors(
                new ChatMemoryAdvisor(chatMemory, "default", 50),
                RetrievalAugmentationAdvisor.builder()
                    .vectorStore(vectorStore)
                    .topK(3)
                    .build(),
                new TokenUsageAdvisor(),
                new SimpleLoggerAdvisor()
            )
            .build();
    }

    public String chat(String conversationId, String message) {
        return chatClient.prompt()
            .user(message)
            .advisors(a -> a
                .param("chat_memory_conversation_id", conversationId))
            .call()
            .content();
    }
}
```

## Structured Output

Spring AI 2.x 支持将模型输出直接映射为 Java 对象。

```java
import org.springframework.ai.chat.client.advisor.api.Structured;

/**
 * 使用 @Structured 注解定义输出格式
 */
public class StructuredOutputDemo {

    private final ChatClient chatClient;

    public StructuredOutputDemo(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    // 定义输出实体
    public record BookRecommendation(
        String title,
        String author,
        int publicationYear,
        List<String> keyTopics,
        String suitableFor,
        int rating  // 1-10
    ) {}

    /**
     * 单个结构化输出
     */
    public BookRecommendation recommendBook(String requirement) {
        return chatClient.prompt()
            .user(u -> u.text("根据以下需求推荐一本Java书籍：").text(requirement))
            .call()
            .entity(BookRecommendation.class);  // 自动映射
    }

    /**
     * 列表结构化输出
     */
    public record JavaVersion(
        String version,
        int releaseYear,
        boolean isLts,
        List<String> keyFeatures
    ) {}

    public List<JavaVersion> listJavaVersions() {
        // 使用 ParameterizedTypeReference 处理泛型
        return chatClient.prompt()
            .user("列出JDK 17, 21, 25的主要特性")
            .call()
            .entity(new ParameterizedTypeReference<List<JavaVersion>>() {});
    }

    /**
     * 自定义 Schema 的结构化输出
     */
    @Structured(name = "code_review", description = "代码审查结果")
    public record CodeReview(
        @Structured.Prop(description = "总体评分 1-10")
        int overallScore,

        @Structured.Prop(description = "代码的优点")
        List<String> strengths,

        @Structured.Prop(description = "需要改进的地方")
        List<String> improvements,

        @Structured.Prop(description = "安全风险（如有）")
        List<String> securityIssues,

        @Structured.Prop(description = "性能建议")
        List<String> performanceHints
    ) {}

    public CodeReview reviewCode(String code) {
        return chatClient.prompt()
            .system("你是资深代码审查专家。仔细审查以下代码。")
            .user(code)
            .call()
            .entity(CodeReview.class);
    }

    /**
     * 演示使用示例
     */
    public static void demo(StructuredOutputDemo demo) {
        var book = demo.recommendBook("想深入学习JVM和并发");
        System.out.printf("推荐: 《%s》 by %s (%d)%n",
            book.title(), book.author(), book.publicationYear());
        System.out.println("核心主题: " + String.join(", ", book.keyTopics()));
        System.out.println("评分: " + book.rating() + "/10");

        var review = demo.reviewCode("""
            public class UserService {
                public User findById(Long id) {
                    String sql = "SELECT * FROM users WHERE id = " + id;
                    return jdbcTemplate.queryForObject(sql, User.class);
                }
            }
            """);
        System.out.println("代码审查 - 评分: " + review.overallScore() + "/10");
        System.out.println("安全问题: " + review.securityIssues());
    }
}
```

## Tool Calling

```java
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

/**
 * 工具定义 — 使用 @Tool 注解
 */
@Component
public class WeatherTools {

    @Tool(description = "获取指定城市的当前天气信息")
    public WeatherInfo getWeather(
            @ToolParam(description = "城市名称，如 'Beijing'") String city) {
        // 实际调用天气 API
        return new WeatherInfo(city, 25.0, "晴", 60);
    }

    @Tool(description = "获取指定城市的未来天气预报")
    public List<WeatherForecast> getForecast(
            @ToolParam(description = "城市名称") String city,
            @ToolParam(description = "预报天数 (1-7)") int days) {
        return List.of(
            new WeatherForecast("今天", 25, "晴"),
            new WeatherForecast("明天", 22, "多云"),
            new WeatherForecast("后天", 20, "小雨")
        );
    }

    public record WeatherInfo(String city, double temperature,
            String condition, int humidity) {}

    public record WeatherForecast(String day, double temperature,
            String condition) {}
}

@Component
public class DatabaseTools {

    @Tool(description = "查询用户信息")
    public UserInfo queryUser(
            @ToolParam(description = "用户ID") String userId) {
        return new UserInfo(userId, "张三", "zhang@example.com", "VIP");
    }

    @Tool(description = "查询用户的订单列表")
    public List<OrderInfo> queryOrders(
            @ToolParam(description = "用户ID") String userId,
            @ToolParam(description = "订单状态过滤 (可选): all/pending/done")
            @Nullable String status) {
        return List.of(
            new OrderInfo("ORD-001", "已完成", 99.90),
            new OrderInfo("ORD-002", "处理中", 199.00)
        );
    }

    public record UserInfo(String userId, String name,
            String email, String level) {}

    public record OrderInfo(String orderId, String status, double amount) {}
}

/**
 * 使用工具进行对话
 */
@Component
public class ToolCallingService {

    private final ChatClient chatClient;

    public ToolCallingService(ChatClient.Builder builder,
            WeatherTools weatherTools, DatabaseTools dbTools) {
        this.chatClient = builder
            .defaultTools(weatherTools, dbTools)  // 注册工具
            .build();
    }

    public String chatWithTools(String message) {
        return chatClient.prompt()
            .user(message)
            .tools("getWeather", "queryUser", "queryOrders")  // 指定可用工具
            .call()
            .content();
    }

    /**
     * 工具调用 + 结构化输出结合
     */
    public String agentWorkflow(String userRequest) {
        return chatClient.prompt()
            .system("""
                你是智能助手，可以：
                1. 查询天气
                2. 查询用户信息
                3. 查询订单
                请按步骤完成用户请求，如果需要多步操作，自动串联调用。
                """)
            .user(userRequest)
            .tools(new WeatherTools(), new DatabaseTools())
            .call()
            .content();
    }

    public static void main(String[] args) {
        // 示例：
        // "查询用户U001的信息和他的所有订单，并告诉他北京的天气"
        // → 自动调用 queryUser → queryOrders → getWeather
        // → 整合回答
    }
}
```

## Chat Memory

```java
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemory;
import org.springframework.ai.chat.memory.JdbcChatMemory;
import javax.sql.DataSource;

/**
 * Chat Memory 配置和使用
 */
@Configuration
public class ChatMemoryConfig {

    /**
     * InMemoryChatMemory — 适用于开发和测试
     */
    @Bean
    @ConditionalOnMissingBean
    ChatMemory inMemoryChatMemory() {
        return new InMemoryChatMemory();
    }

    /**
     * JdbcChatMemory — 适用于生产环境
     * 需要创建表：chat_memory (conversation_id, content, metadata, created_at)
     */
    @Bean
    @ConditionalOnProperty(name = "app.chat-memory.type", havingValue = "jdbc")
    ChatMemory jdbcChatMemory(DataSource dataSource) {
        return JdbcChatMemory.builder()
            .dataSource(dataSource)
            .maxMessagesPerConversation(100)
            .build();
    }

    /**
     * 使用 ChatMemory 的示例
     */
    @Service
    public static class MemoryAwareChatService {

        private final ChatClient chatClient;

        public MemoryAwareChatService(ChatClient.Builder builder) {
            this.chatClient = builder
                .defaultAdvisors(new ChatMemoryAdvisor(
                    new InMemoryChatMemory(), "default", 50))
                .build();
        }

        public String chat(String conversationId, String message) {
            return chatClient.prompt()
                .user(message)
                .advisors(a -> a
                    .param("chat_memory_conversation_id", conversationId))
                .call()
                .content();
        }
    }

    /**
     * 自定义消息截断策略
     */
    public static class TruncationConfig {
        /**
         * 当对话历史超出上下文窗口时：
         * 1. 保留最近 N 条消息
         * 2. 或使用摘要压缩早期消息
         */
        public static final int MAX_RECENT_MESSAGES = 20;
        public static final int MAX_SUMMARY_SIZE = 500;
    }
}
```

## Vector Store 抽象

```java
@Configuration
public class VectorStoreConfig {

    /**
     * Pgvector 向量存储
     */
    @Bean
    @ConditionalOnClass(name = "org.postgresql.ds.PGSimpleDataSource")
    VectorStore pgvectorVectorStore(JdbcTemplate jdbcTemplate) {
        return PgvectorVectorStore.builder()
            .jdbcTemplate(jdbcTemplate)
            .dimensions(1024)  // embedding 维度
            .indexType(PgvectorVectorStore.PgIndexType.HNSW)
            .distanceType(PgvectorVectorStore.PgDistanceType.COSINE_DISTANCE)
            .build();
    }

    /**
     * Redis 向量存储
     */
    @Bean
    @ConditionalOnClass(name = "redis.clients.jedis.JedisPooled")
    VectorStore redisVectorStore(RedisConnectionFactory factory) {
        return RedisVectorStore.builder()
            .connectionFactory(factory)
            .indexName("ai-documents")
            .prefix("doc:")
            .build();
    }
}

@Service
public class VectorStoreService {

    private final VectorStore vectorStore;
    private final EmbeddingModel embeddingModel;

    public VectorStoreService(VectorStore vectorStore,
            EmbeddingModel embeddingModel) {
        this.vectorStore = vectorStore;
        this.embeddingModel = embeddingModel;
    }

    /**
     * 文档入库
     */
    public void indexDocuments(List<String> texts, Map<String, Object> metadata) {
        var documents = texts.stream()
            .map(text -> Document.builder()
                .text(text)
                .metadata(metadata)
                .embedding(embeddingModel.embed(text))
                .build())
            .toList();
        vectorStore.add(documents);
    }

    /**
     * 语义搜索
     */
    public List<Document> search(String query, int topK) {
        return vectorStore.similaritySearch(
            SearchRequest.builder()
                .query(query)
                .topK(topK)
                .similarityThreshold(0.7d)
                .build()
        );
    }
}
```

## MCP 集成

```java
import org.springframework.ai.mcp.client.McpSyncClient;

/**
 * MCP (Model Context Protocol) 集成
 * Spring AI 2.x 提供了 MCP Client 来连接 MCP Server 获取工具
 */
@Configuration
public class McpIntegration {

    /**
     * 通过 stdio 连接 MCP Server
     */
    @Bean
    McpSyncClient stdioMcpClient() {
        return McpSyncClient.usingStdio(
            new StdioServerParameters(
                "python", List.of("-m", "mcp_server_weather"))
        );
    }

    /**
     * 通过 Streamable HTTP 连接 MCP Server
     */
    @Bean
    McpSyncClient httpMcpClient() {
        return McpSyncClient.usingHttp(
            "http://localhost:8080/mcp"
        );
    }

    /**
     * 使用 MCP 工具进行对话
     */
    @Service
    public static class McpChatService {

        private final ChatClient chatClient;
        private final McpSyncClient mcpClient;

        public McpChatService(ChatClient.Builder builder,
                McpSyncClient mcpClient) {
            this.mcpClient = mcpClient;
            this.chatClient = builder
                .defaultTools(mcpClient.getTools())  // 将所有 MCP 工具注册
                .build();
        }

        public String chat(String message) {
            return chatClient.prompt()
                .user(message)
                .call()
                .content();
        }
    }
}
```

## Evaluation

```java
import org.springframework.ai.evaluation.EvaluationRequest;
import org.springframework.ai.evaluation.EvaluationResponse;
import org.springframework.ai.evaluation.RelevancyEvaluator;
import org.springframework.ai.evaluation.FactCheckingEvaluator;

/**
 * AI 质量评估
 */
@Service
public class AiEvaluationService {

    private final ChatClient chatClient;
    private final RelevancyEvaluator relevancyEvaluator;
    private final FactCheckingEvaluator factEvaluator;

    public AiEvaluationService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
        this.relevancyEvaluator = new RelevancyEvaluator(chatClient);
        this.factEvaluator = new FactCheckingEvaluator(chatClient);
    }

    /**
     * 评估回答的相关性
     */
    public void evaluateRelevancy() {
        var request = EvaluationRequest.builder()
            .userQuestion("Spring AI支持哪些向量数据库？")
            .aiResponse("Spring AI支持Pgvector、Redis、Elasticsearch、Milvus、Qdrant等向量数据库。")
            .context(List.of("Spring AI VectorStore抽象支持多种实现..."))
            .build();

        EvaluationResponse result = relevancyEvaluator.evaluate(request);
        System.out.println("相关性评分: " + result.score());
        System.out.println("评语: " + result.feedback());
    }

    /**
     * 评估事实准确性
     */
    public void evaluateFactuality() {
        var request = EvaluationRequest.builder()
            .userQuestion("JDK 25有哪些新特性？")
            .aiResponse("JDK 25引入了Scoped Values、String Templates等特性...")
            .referenceFacts("""
                JDK 25主要特性：
                - Virtual Threads (JEP 444)
                - Scoped Values (JEP 481)
                - Structured Concurrency (JEP 480)
                ...
                """)
            .build();

        EvaluationResponse result = factEvaluator.evaluate(request);
        System.out.println("事实准确性评分: " + result.score());
        if (result.score() < 0.8) {
            System.out.println("警告：回答可能包含错误信息！");
        }
    }
}
```

## 完整示例：智能客服

```java
@SpringBootApplication
public class IntelligentCustomerService {

    public static void main(String[] args) {
        SpringApplication.run(IntelligentCustomerService.class, args);
    }

    /**
     * 构建完整的智能客服：
     * RAG + Tool Calling + Conversation Memory
     */
    @RestController
    @RequestMapping("/api/cs")
    public static class CustomerServiceController {

        private final ChatClient chatClient;

        public CustomerServiceController(ChatClient.Builder builder,
                VectorStore knowledgeBase,
                ChatMemory chatMemory,
                DatabaseTools dbTools) {

            this.chatClient = builder
                .defaultSystem("""
                    你是保险智能客服助手。
                    
                    职责：
                    1. 回答保险产品相关问题（通过知识库检索）
                    2. 查询用户保单和理赔信息（通过工具调用）
                    3. 协助用户完成投保、理赔等操作
                    
                    原则：
                    - 回答要准确，基于知识库而非猜测
                    - 涉及用户信息查询时，主动调用工具
                    - 保持友好、专业
                    """)
                .defaultAdvisors(
                    // 1. 对话记忆：记住对话历史
                    new ChatMemoryAdvisor(chatMemory, "insurance-default", 50),

                    // 2. RAG：从知识库检索相关知识
                    RetrievalAugmentationAdvisor.builder()
                        .vectorStore(knowledgeBase)
                        .topK(5)
                        .similarityThreshold(0.7d)
                        .build(),

                    // 3. Token 追踪和日志
                    new TokenUsageAdvisor(),
                    new SimpleLoggerAdvisor()
                )
                .defaultTools(dbTools)
                .build();
        }

        @PostMapping("/chat")
        public ChatResponse chat(
                @RequestBody ChatRequest request) {
            return chatClient.prompt()
                .user(request.message())
                .advisors(a -> a
                    .param("chat_memory_conversation_id",
                        request.conversationId()))
                .call()
                .chatResponse();
        }

        @GetMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
        public Flux<ServerSentEvent<String>> streamChat(
                @RequestParam String conversationId,
                @RequestParam String message) {
            return chatClient.prompt()
                .user(message)
                .advisors(a -> a
                    .param("chat_memory_conversation_id", conversationId))
                .stream()
                .content()
                .map(token -> ServerSentEvent.<String>builder()
                    .data(token)
                    .build())
                .concatWith(Mono.just(ServerSentEvent.<String>builder()
                    .event("done")
                    .data("[DONE]")
                    .build()));
        }

        record ChatRequest(String conversationId, String message) {}
    }
}
```

## Observability

```java
/**
 * Spring AI 2.x 自动集成 Micrometer + OpenTelemetry
 * 只需添加依赖，自动埋点：
 *
 * <dependency>
 *   <groupId>org.springframework.ai</groupId>
 *   <artifactId>spring-ai-micrometer-spring-boot-starter</artifactId>
 * </dependency>
 *
 * 自动记录的指标：
 * - spring.ai.chat.client.requests (Counter)
 * - spring.ai.chat.client.responses (Counter)
 * - spring.ai.chat.client.duration (Timer)
 * - spring.ai.chat.client.token.usage (DistributionSummary)
 * - spring.ai.vector.store.requests (Counter)
 * - spring.ai.vector.store.duration (Timer)
 */

@Configuration
public class ObservabilityConfig {

    /**
     * 自定义指标
     */
    @Bean
    MeterRegistryCustomizer<MeterRegistry> aiMetrics() {
        return registry -> {
            // 可以在此添加自定义指标
            registry.gauge("ai.model.availability",
                List.of(Tags.of("model", "gpt-4o")), 1.0);
        };
    }
}
```

## 最佳实践

1. **ChatClient.Builder 全局配置 defaultSystem 和 defaultAdvisors**：避免每次调用都重复配置
2. **Advisor 链顺序很重要**：ChatMemory 应该在最前（注入上下文），RAG 在中间（检索知识），Logger/TokenTracker 在最后（记录完整请求）
3. **生产环境使用 JdbcChatMemory 而非 InMemory**：持久化 + 支持多实例共享（通过共享数据库）
4. **工具调用必须设置超时**：长时间运行的工具会阻塞对话流
5. **Structured Output 是免费的类型安全**：能用 entity() 就不用手动解析 JSON
6. **始终使用 stream=true 用于 UX 场景**：非流式用于批处理或 ETL
7. **启用 Micrometer 埋点**：开箱即用的可观测性，几乎没有性能开销

## 常见问题

**Q: Spring AI 和直接调用 OpenAI SDK 有什么区别？**

A: Spring AI 提供了更高层的抽象和 Spring 生态集成。核心价值：(1) 统一的 API 抽象（换模型只改配置不改代码），(2) Advisors 拦截链，(3) Structured Output 自动映射，(4) Micrometer/Actuator 集成，(5) Vector Store 抽象。

**Q: Advisor 和 Spring AOP 有什么区别？**

A: Advisor 是 Spring AI 自己的拦截器概念，专为 LLM 调用设计。它工作在 Prompt 级别（可修改 System Prompt、注入消息、执行 RAG 等），而 Spring AOP 工作在方法调用级别。

**Q: 如何在 Spring AI 中切换到不同的模型提供商？**

A: 仅需改配置。例如从 OpenAI 切到 Ollama：从 `spring-ai-openai-spring-boot-starter` 改为 `spring-ai-ollama-spring-boot-starter`，修改 `application.yml` 中的 provider 配置，业务代码零改动。

## 相关条目

- [[09-架构抽象层设计]] — 在 Spring AI 上构建抽象层
- [[09-LangChain4j对比与选型]] — 与 LangChain4j 的对比
- [[08-云模型API与SDK使用]] — 各 Provider SDK 使用
- [[08-本地推理与Ollama]] — Ollama 与 Spring AI Ollama Starter
- [[11-向量检索与混合检索]] — RAG 实现（VectorStore + RetrieverAdvisor）
- [[12-ToolCalling完整剖析]] — Agent 开发（Tool Calling + Memory）
- [[13-MCP协议与JavaSDK]] — MCP 协议集成
