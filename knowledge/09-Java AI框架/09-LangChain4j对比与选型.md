---
domain: 09-Java AI框架
title: LangChain4j Comparison
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
level: intermediate
sources:
  - level: L1
    url: https://docs.langchain4j.dev/
    description: LangChain4j 官方文档
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/
    description: Spring AI 官方文档
  - level: L2
    url: https://github.com/langchain4j/langchain4j
    description: LangChain4j GitHub 仓库
relations:
  prerequisite:
    - 09-SpringAI2深度解析
  related:
    - 09-架构抽象层设计
    - 08-云模型API与SDK使用
tags:
  - langchain4j
  - spring-ai
  - comparison
  - framework-selection
  - ai-services
  - migration
created: 2026-07-17
updated: 2026-07-17
content_type: concept
---

# LangChain4j Comparison

## 概述

LangChain4j 是 Java 生态的另一大 AI 框架，借鉴了 Python LangChain 的设计理念但完全 Java 原生实现。本条目从架构理念、API 设计、生态集成等维度对两者进行全面对比，帮助团队做出选型决策。

> 技术雷达：Spring AI — Adopt（主栈）；LangChain4j — Trial（对比框架）

## LangChain4j 架构概述

```
LangChain4j 核心架构：

┌──────────────────────────────────────────────────────────────┐
│                    应用层 (Your App)                          │
├──────────────────────────────────────────────────────────────┤
│  AiServices (Auto-Proxy) │ Chain/SequentialChain │ Agent    │
├──────────────────────────────────────────────────────────────┤
│          LangChain4j Core Abstractions                        │
│  ChatLanguageModel │ EmbeddingModel │ ImageModel             │
│  EmbeddingStore │ ChatMemory │ ToolSpecification             │
│  DocumentLoader │ DocumentSplitter │ Retriever │ Content     │
├──────────────────────────────────────────────────────────────┤
│                  Provider Integrations                        │
│  OpenAI │ Anthropic │ Ollama │ Bedrock │ Vertex AI           │
│  Pgvector │ Redis │ Elasticsearch │ Milvus │ Qdrant         │
└──────────────────────────────────────────────────────────────┘
```

## 与 Spring AI 的架构差异对比

### 1. AiServices (Auto-Proxy) vs ChatClient (Fluent API)

这是两者最大的设计哲学差异。

**LangChain4j — AiServices（声明式，接口代理）：**

```java
// 定义一个接口
public interface CustomerServiceAgent {

    @SystemMessage("""
        你是保险客服助手。
        产品知识：
        - 团体意外险：保额10-100万，职业1-4类
        - 团体健康险：住院最高50万，等待期30天
        """)
    String chat(@UserMessage String userMessage);

    @SystemMessage("提取保单号、投保人、生效日期。以JSON格式输出。")
    Policy extractPolicy(@UserMessage String documentText);

    @SystemMessage("判断用户意图：INQUIRE / QUOTE / CLAIM / OTHER")
    String classifyIntent(@UserMessage String message);
}

// 使用 — 自动生成代理实例
public class AiServicesDemo {
    public static void main(String[] args) {
        ChatLanguageModel model = OpenAiChatModel.builder()
            .apiKey(System.getenv("OPENAI_API_KEY"))
            .modelName("gpt-4o")
            .build();

        // AiServices 自动创建代理
        var agent = AiServices.create(CustomerServiceAgent.class, model);

        // 直接调用 — 就像调用普通 Java 方法
        String answer = agent.chat("我想了解团体意外险");
        System.out.println(answer);

        Policy policy = agent.extractPolicy("""
            保单号: P20240001
            投保人: 张三
            生效日期: 2024-01-15
            """);
        System.out.println(policy);

        String intent = agent.classifyIntent("我的保险怎么理赔");
        System.out.println(intent);  // CLAIM
    }

    record Policy(String policyNo, String holder, String effectiveDate) {}
}
```

**Spring AI — ChatClient（构建式，链式调用）：**

```java
// 命令式、构建式 API
var chatClient = chatClientBuilder.build();

String answer = chatClient.prompt()
    .system("你是保险客服助手...")
    .user("我想了解团体意外险")
    .call()
    .content();

Policy policy = chatClient.prompt()
    .system("提取保单号、投保人、生效日期")
    .user(documentText)
    .call()
    .entity(Policy.class);

String intent = chatClient.prompt()
    .system("判断用户意图")
    .user(message)
    .call()
    .content();
```

**对比分析：**

```
┌──────────────────────┬─────────────────────┬─────────────────────────┐
│ 维度                  │ LangChain4j          │ Spring AI               │
│                       │ AiServices           │ ChatClient              │
├──────────────────────┼─────────────────────┼─────────────────────────┤
│ 编程风格              │ 声明式（接口+注解）   │ 命令式（构建式API）     │
│ 学习曲线              │ 低（像调用普通方法）  │ 中（需要理解构建模式）  │
│ 类型安全              │ 强（编译时检查）      │ 强（泛型参数）          │
│ 灵活性                │ 低（接口定死）        │ 高（动态组合）          │
│ Prompt 重用            │ ★★★★★（接口方法=模板）│ ★★★★（可提取到变量）   │
│ 动态行为              │ 弱（接口方法固定）    │ 强（运行时决定参数）    │
│ Spring 集成深度       │ 浅（可选Spring）      │ ★★★★★（原生Spring）    │
│ 单元测试              │ ★★★★★（Mock接口即可） │ ★★★★（Mock ChatClient） │
└──────────────────────┴─────────────────────┴─────────────────────────┘
```

### 2. @Tool 注解对比

**LangChain4j — 函数式定义：**

```java
// LangChain4j 的 Tool 使用 @Tool 注解在方法上
public class WeatherTools {

    @Tool("获取指定城市的当前天气")
    public String getWeather(
            @P("城市名称，如 'Beijing'") String city) {
        return "北京，25度，晴";
    }

    @Tool("获取天气预报")
    public String getForecast(
            @P("城市名称") String city,
            @P("天数 (1-7)") int days) {
        return "未来" + days + "天：晴转多云";
    }
}

// 使用
var tools = ToolSpecifications.toolSpecificationsFrom(
    new WeatherTools());

// 手动处理工具调用循环
var response = model.generate(
    List.of(SystemMessage.from("..."), UserMessage.from("...")),
    tools);
```

**Spring AI — 类级别注册：**

```java
// Spring AI 的 @Tool 也在方法上，但注册方式不同
@Component
public class WeatherTools {

    @Tool(description = "获取天气")
    public WeatherInfo getWeather(@ToolParam(description = "城市") String city) {
        return new WeatherInfo(city, 25.0, "晴");
    }
}

// 使用 — 自动注册到 ChatClient
var chatClient = builder
    .defaultTools(new WeatherTools())
    .build();
// ChatClient 自动管理工具调用循环
```

```
┌──────────────────────┬─────────────────────┬─────────────────────────┐
│ Tool 特性              │ LangChain4j          │ Spring AI               │
├──────────────────────┼─────────────────────┼─────────────────────────┤
│ 注解位置              │ 方法上 @Tool         │ 方法上 @Tool            │
│ 参数注解              │ @P                   │ @ToolParam              │
│ 工具调用循环          │ 需手动管理           │ ChatClient自动管理      │
│ Bean 发现             │ 手动注册             │ @Component自动发现      │
│ 工具结果处理          │ 手动构建消息         │ 框架自动处理            │
└──────────────────────┴─────────────────────┴─────────────────────────┘
```

### 3. EmbeddingStore vs VectorStore

```
LangChain4j EmbeddingStore:
  EmbeddingStore<TextSegment> — 泛型接口
  方法：add(id, embedding, segment) / search(request)

Spring AI VectorStore:
  VectorStore — 非泛型接口
  方法：add(List<Document>) / similaritySearch(request)

关键差异：
  LangChain4j 使用 TextSegment（支持泛型metadata）
  Spring AI 使用 Document（更丰富的元数据结构）
```

### 4. InMemoryChatMemory vs ChatMemory

```java
// LangChain4j ChatMemory
ChatMemory memory = MessageWindowChatMemory.withMaxMessages(10);

// Spring AI ChatMemory
ChatMemory memory = new InMemoryChatMemory();
// 或 JdbcChatMemory.builder().dataSource(ds).build()
```

两者概念类似，但 Spring AI 的实现更适配 Spring 生态（JdbcChatMemory 使用 JdbcTemplate）。

## 选型对比表

### 功能维度

```
┌──────────────────────────┬──────────────┬──────────────┬──────────────┐
│ 功能                      │ Spring AI    │ LangChain4j  │ 说明         │
├──────────────────────────┼──────────────┼──────────────┼──────────────┤
│ 文档完整性                │ ★★★★        │ ★★★★        │ 都较好       │
│ 社区活跃度                │ ★★★★★       │ ★★★★        │ Spring 更大  │
│ Spring 集成深度           │ ★★★★★       │ ★★★         │ Spring AI原生│
│ Boot Auto-Configuration  │ ★★★★★       │ ★★★         │              │
│ Micrometer / Actuator    │ ★★★★★       │ ★★          │ Spring AI原生│
│ Spring Security 集成      │ ★★★★★       │ ★★★         │              │
│ MCP 支持                  │ ★★★★★       │ ★★★         │ Spring AI优先│
│ Tool Calling 易用性       │ ★★★★        │ ★★★★        │ 各有千秋    │
│ Structured Output         │ ★★★★★       │ ★★★★        │              │
│ Advisors / Interceptors  │ ★★★★★       │ ★★★★        │              │
│ RAG Pipeline              │ ★★★★        │ ★★★★★       │ LC4j更丰富   │
│ 多模态支持                │ ★★★★★       │ ★★★★        │              │
│ 文档加载器 (Loader)       │ ★★★         │ ★★★★★       │ LC4j显著更多 │
│ 可观测性集成              │ ★★★★★       │ ★★★         │              │
│ 流式响应                  │ ★★★★★       │ ★★★★★       │              │
│ Python 互操作 (LangSmith) │ ★            │ ★★★★★       │              │
│ 非 Spring 项目支持        │ ★★★         │ ★★★★★       │ LC4j可在任何 │
│                           │              │              │ Java项目使用 │
└──────────────────────────┴──────────────┴──────────────┴──────────────┘
```

### 各自优势场景

**Spring AI 更适合：**

```
1. 已有 Spring Boot 技术栈的团队
   - 自动配置、Bean管理、属性绑定都是开箱即用
   - Spring Security / Actuator / Micrometer 无缝集成

2. 需要深度可观测性的场景
   - Micrometer 自动埋点 → Prometheus/Grafana
   - OpenTelemetry GenAI 语义约定支持

3. MCP 协议重度使用的场景
   - Spring AI 对 MCP 的支持最完整

4. 需要 Structured Output 的场景
   - @Structured 注解 + 自动 JSON Schema 生成

5. 企业环境
   - Spring Security OAuth2/OIDC 集成
   - 审计日志、多租户支持
```

**LangChain4j 更适合：**

```
1. Python LangChain 用户迁移到 Java
   - API 命名和概念模型接近 Python 版
   - 学习曲线低

2. 需要与 LangSmith 集成
   - LangSmith 是 LangChain 生态的追踪/评估平台
   - LangChain4j 有原生支持

3. 需要丰富的文档加载器
   - LangChain4j 内置了几十种 DocumentLoader
   - PDF、HTML、Notion、Confluence、GitHub 等

4. 非 Spring 项目
   - 可在任何 Java 项目中使用（Quarkus, Micronaut, 纯Java等）

5. 复杂的 Chain/Agent 编排
   - SequentialChain, RouterChain 等概念
```

## 共存方案

对于大型项目，两者可以共存。推荐的分工：

```
项目中的分工：

Spring AI（主力 — 80%的AI代码）：
  - 聊天对话 (ChatClient)
  - RAG检索 (VectorStore)
  - 工具调用 (Tool Calling)
  - 对话记忆 (ChatMemory)
  - MCP 集成
  - 可观测性 (Micrometer)
  - Structured Output

LangChain4j（补充 — 20%的AI代码）：
  - 复杂文档加载 (DocumentLoader)
  - LangSmith 追踪
  - 特殊场景的 Chain 编排
  - 非 Spring 模块的 AI 能力
```

**共存架构示例：**

```
┌──────────────────────────────────────────────────────┐
│                    业务代码                           │
│              (依赖 ChatModelPort 接口)                │
└──────────┬───────────────────────┬──────────────────┘
           │                       │
    ┌──────▼──────┐        ┌──────▼──────┐
    │ Spring AI   │        │ LangChain4j │
    │ Adapter     │        │ Adapter     │
    │ (主力)      │        │ (补充)      │
    └──────┬──────┘        └──────┬──────┘
           │                       │
    ┌──────▼──────┐        ┌──────▼──────┐
    │ ChatClient  │        │ ChatLanguage│
    │ VectorStore │        │ Model       │
    │ ChatMemory  │        │ Embedding   │
    │ ToolCalling │        │ Store       │
    └─────────────┘        └─────────────┘
```

## 迁移路径：LangChain4j → Spring AI

如果团队决定从 LangChain4j 迁移到 Spring AI，以下是关键映射：

```java
// ─── LangChain4j 代码 ───

// 1. 模型调用
ChatLanguageModel model = OpenAiChatModel.builder()
    .apiKey("sk-...").modelName("gpt-4o").build();
String answer = model.generate("Hello");

// 2. AiServices
interface MyAgent {
    String chat(@UserMessage String msg);
}
var agent = AiServices.create(MyAgent.class, model);


// ─── Spring AI 等效代码 ───

// 1. 模型调用
@Autowired ChatClient.Builder builder;
var client = builder.build();
String answer = client.prompt().user("Hello").call().content();

// 2. 没有直接对应的 AiServices，但有等效模式：
// 方式A：使用结构化输出的 @Service
@Service
class MyAgentService {
    private final ChatClient client;
    String chat(String msg) {
        return client.prompt().user(msg).call().content();
    }
}

// 方式B：使用 Interface + default method (JDK 25)
interface MyAgent {
    ChatClient client();
    default String chat(String msg) {
        return client().prompt().user(msg).call().content();
    }
}
```

**迁移映射表：**

```
LangChain4j                         Spring AI
──────────────────────────────────────────────────────────────
ChatLanguageModel.generate()  →    ChatClient.prompt()...call().content()
ChatLanguageModel.generate(msgs,tools) → ChatClient.prompt()...tools()...call()
StreamingChatLanguageModel     →    ChatClient.prompt()...stream().content()
EmbeddingModel.embed()         →    EmbeddingModel.embed()
EmbeddingStore<TextSegment>    →    VectorStore
DocumentLoader                 →    DocumentReader (需引入spring-ai-document-reader)
TextSplitter                   →    DocumentTransformer
ChatMemory                     →    ChatMemory (同名，API不同)
AiServices.create(Class, model)→    无直接等价物，用 @Service 替代
@SystemMessage                 →    .system() 或 defaultSystem()
@UserMessage                   →    .user()
@Tool / @P                     →    @Tool / @ToolParam
ToolSpecifications             →    自动通过 @Tool 注解识别
RetrievalAugmentor             →    RetrievalAugmentationAdvisor
Chain / SequentialChain        →    Advisor 链或编程式组合
```

**Java 迁移工具代码示例（辅助迁移）：**

```java
/**
 * LangChain4j → Spring AI 兼容层
 * 在迁移期间使用此适配器，让旧代码逐步切换到 Spring AI
 */
public class LangChain4jToSpringAiBridge {

    /**
     * 将 LangChain4j 的 ChatLanguageModel 适配为 Spring AI 的 ChatModel
     */
    public static ChatModel adapt(ChatLanguageModel lc4jModel) {
        return new ChatModel() {
            @Override
            public ChatResponse call(Prompt prompt) {
                // 转换消息格式
                var lc4jMessages = prompt.getInstructions().stream()
                    .map(msg -> {
                        if (msg instanceof UserMessage um) {
                            return dev.langchain4j.data.message.UserMessage.from(um.getContent());
                        } else if (msg instanceof SystemMessage sm) {
                            return dev.langchain4j.data.message.SystemMessage.from(sm.getContent());
                        }
                        return dev.langchain4j.data.message.UserMessage.from(msg.getContent());
                    })
                    .toList();

                var lc4jResponse = lc4jModel.generate(lc4jMessages);

                var aiMessage = new AssistantMessage(lc4jResponse.content().text());
                return new ChatResponse(List.of(new Generation(aiMessage)));
            }

            @Override
            public ChatOptions getDefaultOptions() {
                return ChatOptionsBuilder.builder().build();
            }

            @Override
            public Flux<ChatResponse> stream(Prompt prompt) {
                // 流式适配（需配合 StreamingChatLanguageModel）
                throw new UnsupportedOperationException(
                    "Use StreamingChatLanguageModel instead");
            }
        };
    }

    /**
     * 在迁移期间，让 LangChain4j AiServices 也能通过 Spring DI 工作
     */
    public static <T> T createSpringAiService(
            Class<T> serviceInterface,
            ChatClient.Builder builder) {

        var chatClient = builder.build();

        // 使用 JDK Proxy 创建实现
        @SuppressWarnings("unchecked")
        T proxy = (T) java.lang.reflect.Proxy.newProxyInstance(
            serviceInterface.getClassLoader(),
            new Class[]{serviceInterface},
            (proxyObj, method, args) -> {
                // 解析 @SystemMessage 和 @UserMessage 注解
                var systemMessage = method.getAnnotation(
                    dev.langchain4j.service.SystemMessage.class);
                var prompt = chatClient.prompt();

                if (systemMessage != null) {
                    prompt.system(systemMessage.value());
                }
                if (args != null && args.length > 0 && args[0] instanceof String msg) {
                    prompt.user(msg);
                }

                return prompt.call().content();
            }
        );
        return proxy;
    }
}
```

## 选型决策树

```
你的团队背景？
├── 已有 Spring Boot 技术栈
│   └── 选 Spring AI 2.x ★
│       理由：原生集成、零学习成本、全生态联动
│
├── Python LangChain 用户迁移到 Java
│   └── 选 LangChain4j
│       理由：概念相通、学习成本低、LangSmith 集成
│
├── 非 Spring 项目 (Quarkus / Micronaut / 纯Java)
│   └── 选 LangChain4j
│       理由：无 Spring 依赖，任何 Java 项目可用
│
├── 团队同时需要多种文档加载器
│   └── 选 LangChain4j (或 Spring AI + 手动实现Loader)
│       理由：LC4j 内置几十种 DocumentLoader
│
└── 新项目，无历史包袱
    └── 选 Spring AI 2.x ★ (默认推荐)
        理由：Spring 生态优势 + 更大社区 + 更快迭代
```

## 最佳实践

1. **不要同时深度维护两个框架** — 选一个为主。两个框架一起用会增加认知负担、依赖冲突风险和构建复杂度
2. **如果选择 Spring AI**：LangChain4j 可以作为"特殊场景工具"——只在需要 LangSmith 追踪或特殊 DocumentLoader 时引入
3. **如果选择 LangChain4j**：仍然建议在它之上构建一个薄抽象层（参考 [[09-架构抽象层设计]]），为未来切换留后路
4. **迁移时不要"大爆炸"**：选择独立的微服务或功能模块先试点迁移，验证效果后再逐步推广
5. **重点关注可观测性**：无论选哪个框架，确保 AI 调用的 metrics/tracing 到位，否则出了问题无从排查

## 常见问题

**Q: 两者底层都支持相同的模型 Provider 吗？**

A: 绝大部分是的。两者都支持 OpenAI、Anthropic、AWS Bedrock、Google Gemini、Ollama 等主流 Provider。但 Spring AI 对 AWS Bedrock Converse API 的支持更好，LangChain4j 对 Vertex AI 的支持略早。

**Q: LangChain4j 的 AiServices 是不是比 Spring AI 的 ChatClient 更好用？**

A: 主观偏好问题。AiServices 对于固定 prompt 模板的场景非常优雅（一个接口方法 = 一个 prompt），但对需要动态组装 prompt 的场景灵活性不足。ChatClient 的 Fluent API 更灵活但更冗长。两者没有绝对的优劣。

**Q: 可以用 Spring AI 的 ChatClient + LangChain4j 的 DocumentLoader 吗？**

A: 可以，但要注意依赖冲突。两个框架都可能引入同一个库的不同版本（如 OkHttp、Jackson）。建议用一个统一的 BOM 管理版本，或在 Maven 中显式排除冲突的传递依赖。

## 相关条目

- [[09-SpringAI2深度解析]] — Spring AI 框架深度使用
- [[09-架构抽象层设计]] — 在框架之上构建抽象层（无论选择哪个框架都推荐）
- [[08-云模型API与SDK使用]] — 各 Provider SDK（框架不支持时降级）
- [[14-模型网关与Prompt管理]] — 模型网关和平台建设
