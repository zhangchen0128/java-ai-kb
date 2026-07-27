---
domain: "13-AI协议"
title: "A2A协议背景与Agent互操作实战"
status: "draft"
level: "intermediate"
sources:
  - level: "L1"
    url: "https://a2a-protocol.org/specification/latest/"
    description: "A2A官方协议规范最新版"
  - level: "L1"
    url: "https://github.com/a2a-protocol/a2a-java"
    description: "A2A Java SDK官方仓库"
  - level: "L1"
    url: "https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/"
    description: "A2A协议背景与技术概览（Google Blog）"
  - level: "L2"
    url: "https://spring.io/blog/2025/06/spring-ai-a2a-support"
    description: "Spring AI A2A集成支持"
relations:
  prerequisite: ["13-MCP协议与JavaSDK", "09-SpringAI2深度解析"]
  related: ["09-SpringAI2深度解析", "12-多Agent协作架构"]
tags: ["a2a", "agent-to-agent", "agent-interop", "java", "spring-ai", "multi-agent", "mcp"]
created: "2026-07-17"
updated: "2026-07-17"
---

# A2A协议背景与Agent互操作实战

## 一、A2A协议背景与动机

### 1.1 为什么需要A2A？

MCP（Model Context Protocol）解决了AI模型如何调用外部工具和数据的问题——它将LLM与外部世界连接起来。然而，随着Agent技术的成熟，一个更高级的问题浮现：**不同的AI Agent之间如何协作？**

考虑以下场景：
- 一个Research Agent负责搜索和收集资料
- 一个Writer Agent负责将资料整理成文档
- 一个Reviewer Agent负责审查文档质量
- 一个Translator Agent负责将文档翻译成多语言

这些Agent可能由不同团队开发、运行在不同的服务器上、使用不同的框架。如何让它们自主发现彼此、协商能力、传递任务、交换结果？这就是Agent-to-Agent（A2A）协议要解决的核心问题。

### 1.2 A2A的定位

A2A是一个开放标准协议，定义了AI Agent之间通信的规范。它不关注Agent的内部实现（用的是哪个LLM、用了什么框架），而是规范Agent对外暴露的接口和行为。

```
┌──────────┐  A2A Protocol  ┌──────────┐
│ Agent A  │ ◄──────────────► │ Agent B  │
│ (Research)│                 │ (Writer) │
└────┬─────┘                 └────┬─────┘
     │ MCP                         │ MCP
     ▼                             ▼
┌──────────┐                 ┌──────────┐
│ Tools &  │                 │ Tools &  │
│ Resources│                 │ Resources│
└──────────┘                 └──────────┘
```

**A2A与MCP的关系**：MCP解决Agent与工具/数据之间的交互（纵向），A2A解决Agent与Agent之间的协作（横向）。两者是互补的，不是替代关系。

## 二、核心概念

### 2.1 Agent Card（Agent名片）

Agent Card是A2A协议的基石——每个Agent通过一个JSON描述文件声明自己的身份和能力。其他Agent通过读取这个文件来发现和了解对方。

Agent Card包含以下关键信息：

- **身份信息**：name、description、version、url
- **能力声明**：skills列表（每个skill有id、name、description、tags、examples）
- **端点信息**：任务创建端点、状态查询端点、流式响应端点
- **认证方式**：支持的认证机制（OAuth2、API Key等）
- **安全策略**：支持的签名算法、信任模型

```json
{
  "name": "Research Agent",
  "description": "Specialized in web research, data gathering, and fact verification",
  "url": "https://agents.example.com/research",
  "version": "1.2.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "web_search",
      "name": "Web Search",
      "description": "Search the web for information on any topic",
      "tags": ["search", "research", "information-gathering"],
      "examples": [
        "Find the latest papers on quantum computing",
        "Search for market data on electric vehicles"
      ]
    }
  ],
  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "file"],
  "authentication": {
    "schemes": ["oauth2"],
    "authorizationServer": "https://auth.example.com"
  }
}
```

### 2.2 Message（消息）

A2A中的Message是Agent间通信的基本单位。每条Message包含role（谁发送的）、parts（内容部分）、metadata（元数据）。

Message的role可以是：
- `user`：最终用户的消息
- `agent`：Agent代理用户发出的消息
- `system`：系统级指令和上下文

每个part可以是文本、文件引用、结构化数据等。

```java
// Message构建示例
var message = A2aMessage.builder()
    .messageId("msg-001")
    .role(A2aMessage.Role.AGENT)
    .parts(List.of(
        A2aPart.text("请根据以下资料撰写一份技术报告"),
        A2aPart.file("research-data.json", "application/json",
            "{'findings': ['...']}".getBytes()),
        A2aPart.data(Map.of("targetLength", 2000, "format", "markdown"))
    ))
    .metadata(Map.of("priority", "high", "deadline", "2026-07-20"))
    .build();
```

### 2.3 Task（任务）

Task是A2A对长耗时操作的抽象。当一个Agent向另一个Agent发起请求时，后者可能创建一个Task来跟踪工作进度。

Task的生命周期状态：
- `input-required`：等待用户或上游Agent提供更多信息
- `working`：正在处理中
- `rejected`：任务被拒绝
- `completed`：任务成功完成
- `failed`：任务处理失败
- `canceled`：任务被取消

每个Task包含：
- **id**：唯一标识符
- **status**：当前状态
- **history**：任务处理过程中的所有Message
- **artifacts**：任务产生的产出物

### 2.4 Artifact（产出物）

Artifact是Task完成后产生的成果。一个Task可以产生多个Artifact。每个Artifact包含：
- **name**：产出物名称
- **parts**：内容部分（与Message的parts结构相同）
- **metadata**：扩展元数据

```java
var artifact = Artifact.builder()
    .name("research-report.md")
    .description("电动汽车市场研究报告")
    .parts(List.of(
        A2aPart.text("# 电动汽车市场研究报告\n\n## 摘要\n..."),
        A2aPart.file("chart.png", "image/png", chartBytes)
    ))
    .metadata(Map.of("wordCount", 2500, "language", "zh-CN"))
    .build();
```

## 三、协议交互流程

### 3.1 Agent Card发现

A2A采用Well-Known URI模式进行Agent发现。每个Agent在其域名根路径下暴露发现端点：

```
GET https://agents.example.com/.well-known/agent-card.json
```

此外，Agent Card还支持通过DNS TXT记录和Agent Registry进行发现。

```java
// Agent Card 发现客户端
public class AgentCardDiscovery {

    private final java.net.http.HttpClient httpClient;

    public AgentCardDiscovery() {
        this.httpClient = java.net.http.HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .build();
    }

    /**
     * 通过 Well-Known URI 发现 Agent Card
     */
    public AgentCard discover(String agentBaseUrl) throws Exception {
        var wellKnownUrl = agentBaseUrl + "/.well-known/agent-card.json";
        var request = java.net.http.HttpRequest.newBuilder()
            .uri(java.net.URI.create(wellKnownUrl))
            .GET()
            .header("Accept", "application/json")
            .build();

        var response = httpClient.send(request,
            java.net.http.HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 200) {
            return parseAgentCard(response.body());
        }
        throw new RuntimeException("Failed to discover agent card: HTTP " 
            + response.statusCode());
    }

    /**
     * 从Agent Card JSON解析
     */
    private AgentCard parseAgentCard(String json) {
        // 使用Jackson或Gson解析
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        try {
            return mapper.readValue(json, AgentCard.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse agent card", e);
        }
    }
}
```

### 3.2 任务创建（tasks/send）

当Agent A需要Agent B执行任务时，A向B的`/tasks/send`端点发送消息：

```java
// 任务发送示例
public class TaskClient {

    private final java.net.http.HttpClient httpClient;
    private final String agentEndpoint;

    public TaskClient(String agentEndpoint) {
        this.agentEndpoint = agentEndpoint;
        this.httpClient = java.net.http.HttpClient.newBuilder()
            .version(java.net.http.HttpClient.Version.HTTP_2)
            .connectTimeout(java.time.Duration.ofSeconds(30))
            .build();
    }

    /**
     * 向目标Agent发送任务
     */
    public Task sendTask(A2aMessage message, boolean stream) throws Exception {
        var taskRequest = Map.of(
            "message", message,
            "streaming", stream,
            "configuration", Map.of(
                "blocking", false,
                "timeoutSeconds", 300
            )
        );

        var request = java.net.http.HttpRequest.newBuilder()
            .uri(java.net.URI.create(agentEndpoint + "/tasks/send"))
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                JacksonUtils.toJson(taskRequest)))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + getAccessToken())
            .build();

        var response = httpClient.send(request,
            java.net.http.HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 200) {
            return parseTask(response.body());
        }
        throw new RuntimeException("Task send failed: HTTP " + response.statusCode());
    }

    /**
     * 发送任务并流式接收结果（SSE）
     */
    public void sendTaskStreaming(A2aMessage message,
            java.util.function.Consumer<StreamEvent> eventHandler) throws Exception {
        var taskRequest = Map.of("message", message, "streaming", true);

        var request = java.net.http.HttpRequest.newBuilder()
            .uri(java.net.URI.create(agentEndpoint + "/tasks/send"))
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                JacksonUtils.toJson(taskRequest)))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .build();

        // 使用SSE流式解析
        httpClient.send(request, java.net.http.HttpResponse.BodyHandlers
            .ofLines())
            .body()
            .forEach(line -> {
                if (line.startsWith("data: ")) {
                    var eventData = line.substring(6);
                    var event = parseStreamEvent(eventData);
                    eventHandler.accept(event);
                }
            });
    }

    private Task parseTask(String json) {
        // JSON解析逻辑
        return new ObjectMapper().readValue(json, Task.class);
    }

    private StreamEvent parseStreamEvent(String json) {
        return new ObjectMapper().readValue(json, StreamEvent.class);
    }

    private String getAccessToken() {
        // OAuth2 Token获取逻辑
        return System.getenv("A2A_ACCESS_TOKEN");
    }
}
```

### 3.3 任务状态轮询（tasks/get）

对于非流式任务，客户端通过轮询获取任务状态：

```java
/**
 * 轮询任务直到完成
 */
public Task pollUntilComplete(String taskId, 
        java.time.Duration maxWait,
        java.time.Duration pollInterval) throws Exception {
    
    var deadline = java.time.Instant.now().plus(maxWait);

    while (java.time.Instant.now().isBefore(deadline)) {
        var task = getTaskStatus(taskId);
        var status = task.getStatus().getState();

        switch (status) {
            case COMPLETED -> { return task; }
            case FAILED -> throw new RuntimeException(
                "Task failed: " + task.getStatus().getMessage());
            case CANCELED -> throw new RuntimeException("Task was canceled");
            case REJECTED -> throw new RuntimeException("Task was rejected");
            case INPUT_REQUIRED -> {
                // 需要用户输入——返回当前Task让调用方处理
                return task;
            }
            case WORKING -> {
                // 继续等待
                Thread.sleep(pollInterval.toMillis());
            }
        }
    }

    throw new RuntimeException("Task timeout after " + maxWait);
}

/**
 * 获取任务状态
 */
public Task getTaskStatus(String taskId) throws Exception {
    var request = java.net.http.HttpRequest.newBuilder()
        .uri(java.net.URI.create(agentEndpoint + "/tasks/get?taskId=" + taskId))
        .GET()
        .header("Authorization", "Bearer " + getAccessToken())
        .build();

    var response = httpClient.send(request,
        java.net.http.HttpResponse.BodyHandlers.ofString());

    if (response.statusCode() == 200) {
        return parseTask(response.body());
    }
    throw new RuntimeException("Failed to get task status: HTTP " 
        + response.statusCode());
}
```

### 3.4 任务取消（tasks/cancel）

```java
/**
 * 取消正在执行的任务
 */
public Task cancelTask(String taskId) throws Exception {
    var cancelRequest = Map.of("taskId", taskId);

    var request = java.net.http.HttpRequest.newBuilder()
        .uri(java.net.URI.create(agentEndpoint + "/tasks/cancel"))
        .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
            JacksonUtils.toJson(cancelRequest)))
        .header("Content-Type", "application/json")
        .header("Authorization", "Bearer " + getAccessToken())
        .build();

    var response = httpClient.send(request,
        java.net.http.HttpResponse.BodyHandlers.ofString());

    return parseTask(response.body());
}
```

### 3.5 流式响应（SSE Events）

A2A支持通过Server-Sent Events（SSE）进行流式响应：

```
event: status_change
data: {"taskId": "task-001", "state": "working", "timestamp": "..."}

event: artifact_update
data: {"taskId": "task-001", "artifact": {"name": "report.md", "parts": [...]}}

event: status_change
data: {"taskId": "task-001", "state": "completed", "timestamp": "..."}
```

## 四、认证与信任

### 4.1 OAuth2 / OIDC集成

A2A推荐使用OAuth 2.0进行Agent间认证。Agent Card中声明其Authorization Server，客户端通过标准OAuth流程获取Token：

```
Client → Authorization Server: POST /token (client_credentials)
Client ← Authorization Server: {"access_token": "...", "expires_in": 3600}

Client → Agent B: GET /tasks/get?taskId=xxx
           Authorization: Bearer <access_token>
```

### 4.2 Agent间权限委托（Delegation）

当Agent A代表用户向Agent B请求服务时，A2A支持权限委托机制。Agent A可以携带用户的权限声明，Agent B根据权限声明决定是否执行操作。

```java
// Delegation Token构建
public record DelegationProof(
    String userIdentity,      // 用户身份
    String[] scopes,          // 授权的权限范围
    String delegatedBy,       // 委托方Agent ID
    java.time.Instant issuedAt,
    java.time.Instant expiresAt,
    String signature          // 数字签名
) {}

public class DelegationManager {

    /**
     * 创建委托证明
     */
    public DelegationProof createDelegation(String userId, 
            String[] scopes, String agentId) {
        var now = java.time.Instant.now();
        var proof = new DelegationProof(
            userId,
            scopes,
            agentId,
            now,
            now.plus(java.time.Duration.ofHours(1)),
            null  // 待签名
        );
        // 使用Agent私钥签名
        return sign(proof);
    }

    /**
     * 验证委托证明
     */
    public boolean verifyDelegation(DelegationProof proof, String agentId) {
        // 1. 检查过期时间
        if (java.time.Instant.now().isAfter(proof.expiresAt())) {
            return false;
        }
        // 2. 验证数字签名
        if (!verifySignature(proof)) {
            return false;
        }
        // 3. 检查权限范围是否足够
        return true;
    }

    private DelegationProof sign(DelegationProof proof) {
        // 实际应使用 Ed25519 或 RS256 签名
        var signed = new DelegationProof(
            proof.userIdentity(), proof.scopes(), proof.delegatedBy(),
            proof.issuedAt(), proof.expiresAt(),
            "base64-encoded-signature"
        );
        return signed;
    }

    private boolean verifySignature(DelegationProof proof) {
        // 验证数字签名
        return proof.signature() != null && !proof.signature().isEmpty();
    }
}
```

## 五、Java A2A SDK使用

### 5.1 Maven依赖

```xml
<!-- A2A Java SDK -->
<dependency>
    <groupId>org.a2a-protocol</groupId>
    <artifactId>a2a-sdk</artifactId>
    <version>0.8.0</version>
</dependency>

<!-- Spring AI A2A Starter -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-a2a-spring-boot-starter</artifactId>
    <version>2.1.0</version>
</dependency>
```

### 5.2 构建A2A Agent Server

```java
// A2aAgentServer.java
import org.a2a.protocol.server.A2aServer;
import org.a2a.protocol.server.AgentCardBuilder;
import org.a2a.protocol.model.*;

@SpringBootApplication
public class A2aAgentServer {

    public static void main(String[] args) {
        SpringApplication.run(A2aAgentServer.class, args);
    }

    @Bean
    A2aServer a2aServer() {
        var agentCard = AgentCardBuilder.create()
            .name("Research Agent")
            .description("专业网络研究Agent，负责信息搜集和事实核查")
            .version("1.2.0")
            .url("https://agents.example.com/research")
            .addSkill(Skill.builder()
                .id("web_search")
                .name("网络搜索")
                .description("搜索互联网信息")
                .addTag("search")
                .addExample("搜索量子计算最新进展")
                .build())
            .addSkill(Skill.builder()
                .id("fact_check")
                .name("事实核查")
                .description("验证信息的真实性")
                .addTag("verification")
                .build())
            .streamingCapable(true)
            .addAuthScheme("oauth2")
            .build();

        return A2aServer.builder()
            .agentCard(agentCard)
            .port(8080)
            .taskHandler(new ResearchTaskHandler())
            .build();
    }
}

/**
 * 任务处理器——实现Agent的核心逻辑
 */
class ResearchTaskHandler implements A2aTaskHandler {

    @Override
    public Task handleTask(A2aMessage message, TaskContext context) {
        // 解析用户请求
        var query = extractUserQuery(message);
        
        // 创建Task跟踪进度
        var task = Task.builder()
            .id(context.taskId())
            .status(TaskStatus.working("开始研究: " + query))
            .build();

        // 执行研究（这里用Virtual Thread）
        Thread.ofVirtual().start(() -> {
            try {
                // 步骤1: 搜索资料
                context.updateStatus(TaskStatus.working("正在搜索相关资源..."));
                var searchResults = performWebSearch(query);

                // 步骤2: 交叉验证
                context.updateStatus(TaskStatus.working("正在交叉验证信息..."));
                var verifiedResults = crossVerify(searchResults);

                // 步骤3: 生成报告
                context.updateStatus(TaskStatus.working("正在生成研究报告..."));
                var report = generateReport(verifiedResults);

                // 完成
                context.completeWithArtifact(Artifact.builder()
                    .name("research-report.md")
                    .description("研究报告: " + query)
                    .addPart(A2aPart.text(report))
                    .build());
            } catch (Exception e) {
                context.fail("研究过程中出现错误: " + e.getMessage());
            }
        });

        return task;
    }

    private String extractUserQuery(A2aMessage message) {
        return message.getParts().stream()
            .filter(p -> p instanceof A2aPart.TextPart)
            .map(p -> ((A2aPart.TextPart) p).getText())
            .collect(java.util.stream.Collectors.joining("\n"));
    }

    private List<SearchResult> performWebSearch(String query) {
        // 模拟搜索
        return List.of(
            new SearchResult("量子计算论文", "https://arxiv.org/...", 0.95),
            new SearchResult("量子芯片进展", "https://example.com/...", 0.88)
        );
    }

    private List<SearchResult> crossVerify(List<SearchResult> results) {
        // 模拟交叉验证
        return results;
    }

    private String generateReport(List<SearchResult> results) {
        return "# 研究报告\n\n" + results.stream()
            .map(r -> "## " + r.title() + "\n来源: " + r.url() + "\n可信度: " + r.confidence())
            .collect(java.util.stream.Collectors.joining("\n\n"));
    }

    record SearchResult(String title, String url, double confidence) {}
}
```

## 六、MCP与A2A的对比与协作

### 6.1 对比表

| 维度 | MCP | A2A |
|------|-----|-----|
| **解决什么问题** | Agent如何调用外部工具和数据 | Agent之间如何协作通信 |
| **通信方向** | 纵向：Agent ↔ 工具/数据 | 横向：Agent ↔ Agent |
| **核心原语** | Tools, Resources, Prompts | Messages, Tasks, Artifacts |
| **生命周期** | 请求-响应（短连接） | 任务跟踪（长连接/轮询） |
| **发现机制** | Client在初始化时获取能力列表 | Agent Card Well-Known URI |
| **交互模式** | 工具调用、资源读取 | 任务委托、结果传递、状态同步 |
| **传输协议** | stdio / HTTP (JSON-RPC 2.0) | HTTP (REST + SSE) |
| **典型场景** | 查询数据库、发送邮件、读取文件 | Agent协作流水线、分布式任务编排 |

### 6.2 协同工作模式

MCP和A2A不是互斥的，在实际系统中它们经常配合使用：

```
用户请求: "分析Q2销售数据并生成报告"

┌─────────────────────────────────────────────────────┐
│ Orchestrator Agent (A2A)                           │
│  - 接收用户请求                                      │
│  - 分解任务                                          │
│  - 协调子Agent                                       │
└──────┬──────────────┬──────────────────────┬────────┘
       │ A2A          │ A2A                  │ A2A
       ▼              ▼                      ▼
┌────────────┐  ┌────────────┐  ┌────────────────────┐
│Data Agent  │  │Analysis    │  │Writer Agent        │
│            │  │Agent       │  │                    │
│ MCP Tools: │  │ MCP Tools: │  │ MCP Tools:         │
│ - SQL查询  │  │ - 统计分析 │  │ - 文档模板          │
│ - 数据导出 │  │ - 图表生成 │  │ - 格式转换          │
│ MCP Res:   │  │ MCP Res:   │  │ MCP Res:           │
│ - DB Schema│  │ - 分析模型  │  │ - 样式库           │
│ - 数据字典 │  │ - 指标定义 │  │ - 模板库           │
└────────────┘  └────────────┘  └────────────────────┘
```

## 七、完整示例：多Agent协作系统

以下是一个完整的多Agent协作示例：Research Agent负责收集信息，Writer Agent负责撰写报告，Orchestrator Agent负责协调。

```java
// ===== 1. Agent Card定义 =====
// ResearchAgentCard.java
public class ResearchAgentCard {
    public static AgentCard create() {
        return AgentCard.builder()
            .name("Research Agent")
            .description("专业研究Agent：网络搜索、信息搜集、事实核查")
            .version("1.2.0")
            .url("http://localhost:8081")
            .addSkill(org.a2a.protocol.model.Skill.builder()
                .id("deep_research")
                .name("深度研究")
                .description("对指定主题进行全面的网络研究和信息搜集")
                .addTag("research")
                .addExample("研究2026年电动车市场趋势")
                .build())
            .addSkill(org.a2a.protocol.model.Skill.builder()
                .id("fact_verification")
                .name("事实核查")
                .description("验证给定信息的准确性和来源可靠性")
                .addTag("verification")
                .build())
            .streamingCapable(true)
            .addInputMode("text")
            .addOutputMode("text")
            .addOutputMode("file")
            .addAuthScheme("none")
            .build();
    }
}

// WriterAgentCard.java
public class WriterAgentCard {
    public static AgentCard create() {
        return AgentCard.builder()
            .name("Writer Agent")
            .description("专业写作Agent：根据研究资料撰写结构化文档")
            .version("2.0.0")
            .url("http://localhost:8082")
            .addSkill(org.a2a.protocol.model.Skill.builder()
                .id("report_writing")
                .name("报告撰写")
                .description("根据提供的研究资料撰写格式化的报告")
                .addTag("writing")
                .addTag("report")
                .build())
            .addSkill(org.a2a.protocol.model.Skill.builder()
                .id("content_summarize")
                .name("内容摘要")
                .description("将长文档精炼为简洁的摘要")
                .addTag("summary")
                .build())
            .streamingCapable(false)
            .addInputMode("text")
            .addOutputMode("text")
            .addOutputMode("file")
            .addAuthScheme("none")
            .build();
    }
}

// ===== 2. Research Agent 实现 =====
// ResearchAgentServer.java
public class ResearchAgentServer {

    public static void main(String[] args) throws Exception {
        var agentCard = ResearchAgentCard.create();
        var server = com.sun.net.httpserver.HttpServer.create(
            new java.net.InetSocketAddress(8081), 0);

        // Agent Card发现端点
        server.createContext("/.well-known/agent-card.json", exchange -> {
            var cardJson = agentCard.toJson();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, cardJson.getBytes().length);
            try (var os = exchange.getResponseBody()) {
                os.write(cardJson.getBytes());
            }
        });

        // Task处理端点
        server.createContext("/tasks/send", exchange -> {
            if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                return;
            }

            var body = new String(exchange.getRequestBody().readAllBytes());
            var request = JacksonUtils.fromJson(body, Map.class);

            // 使用Virtual Thread处理任务
            Thread.ofVirtual().start(() -> {
                try {
                    var query = extractQuery(request);
                    System.out.println("[Research Agent] 开始研究: " + query);

                    // 模拟研究过程
                    Thread.sleep(java.time.Duration.ofSeconds(2));
                    var findings = performResearch(query);

                    // 构建响应
                    var response = Map.of(
                        "taskId", "research-" + System.currentTimeMillis(),
                        "status", Map.of("state", "completed"),
                        "artifacts", List.of(Map.of(
                            "name", "research-findings.md",
                            "description", "研究结果: " + query,
                            "parts", List.of(Map.of(
                                "type", "text",
                                "text", findings
                            ))
                        ))
                    );

                    // 注意：非流式场景下，Server直接返回结果
                    // 流式场景下，通过SSE逐步发送
                } catch (Exception e) {
                    System.err.println("[Research Agent] 错误: " + e.getMessage());
                }
            });

            // 立即返回Task ID
            var taskResponse = JacksonUtils.toJson(Map.of(
                "taskId", "research-" + System.currentTimeMillis(),
                "status", Map.of("state", "working",
                    "message", "正在研究中...")
            ));
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(202, taskResponse.getBytes().length);
            try (var os = exchange.getResponseBody()) {
                os.write(taskResponse.getBytes());
            }
        });

        server.setExecutor(java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.println("[Research Agent] 启动于 http://localhost:8081");
    }

    @SuppressWarnings("unchecked")
    private static String extractQuery(Map<String, Object> request) {
        var message = (Map<String, Object>) request.get("message");
        var parts = (List<Map<String, Object>>) message.get("parts");
        return parts.stream()
            .filter(p -> "text".equals(p.get("type")))
            .map(p -> (String) p.get("text"))
            .collect(java.util.stream.Collectors.joining("\n"));
    }

    private static String performResearch(String query) {
        return """
            # 研究报告: %s
            
            ## 核心发现
            1. 市场规模预计在2026年达到5000亿美元
            2. 技术创新集中在固态电池和自动驾驶领域
            3. 各国政策持续向新能源汽车倾斜
            
            ## 数据支持
            - 全球电动车销量同比增长35%%
            - 中国市场占比超过60%%
            - 充电基础设施增长40%%
            
            ## 关键参与者
            - 特斯拉: Model Y持续领跑
            - 比亚迪: 刀片电池技术领先
            - 蔚来: 换电模式差异化
            
            ---
            研究时间: %s
            数据来源: 多渠道交叉验证
            """.formatted(query, java.time.Instant.now());
    }
}

// ===== 3. Orchestrator Agent（协调者）=====
// OrchestratorAgent.java
public class OrchestratorAgent {

    private final AgentCardDiscovery discovery;
    private final TaskClient taskClient;

    public OrchestratorAgent() {
        this.discovery = new AgentCardDiscovery();
        this.taskClient = new TaskClient(null); // endpoint动态设置
    }

    /**
     * 完整的协作流程：Research Agent研究 → Writer Agent撰写 → 返回最终报告
     */
    public String executeCollaboration(String userQuery) throws Exception {
        // 阶段1: 发现Agent
        System.out.println("[Orchestrator] 阶段1: 发现可用Agent...");
        var researchCard = discovery.discover("http://localhost:8081");
        var writerCard = discovery.discover("http://localhost:8082");
        
        System.out.println("[Orchestrator] 发现: " + researchCard.getName());
        System.out.println("[Orchestrator] 发现: " + writerCard.getName());

        // 阶段2: 委托Research Agent进行研究
        System.out.println("[Orchestrator] 阶段2: 委托Research Agent...");
        var researchMessage = A2aMessage.builder()
            .messageId("msg-" + System.currentTimeMillis())
            .role(A2aMessage.Role.AGENT)
            .parts(List.of(A2aPart.text("请研究以下主题并提供详细报告: " + userQuery)))
            .metadata(Map.of(
                "priority", "high",
                "depth", "comprehensive"
            ))
            .build();

        var researchTask = taskClientFor(researchCard.getUrl())
            .sendTask(researchMessage, false);
        var completedResearch = taskClientFor(researchCard.getUrl())
            .pollUntilComplete(researchTask.getId(),
                java.time.Duration.ofMinutes(5),
                java.time.Duration.ofSeconds(5));

        var researchFindings = extractArtifactText(completedResearch);
        System.out.println("[Orchestrator] 研究完成, 获取到 " +
            researchFindings.length() + " 字符的研究结果");

        // 阶段3: 委托Writer Agent撰写报告
        System.out.println("[Orchestrator] 阶段3: 委托Writer Agent...");
        var writerMessage = A2aMessage.builder()
            .messageId("msg-" + System.currentTimeMillis())
            .role(A2aMessage.Role.AGENT)
            .parts(List.of(
                A2aPart.text("""
                    请根据以下研究结果撰写一份结构清晰、语言专业的正式报告。
                    要求: 包含摘要、分析、结论三部分，总字数约2000字。
                    
                    研究资料:
                    """),
                A2aPart.text(researchFindings)
            ))
            .metadata(Map.of(
                "format", "report",
                "targetLength", 2000,
                "language", "zh-CN"
            ))
            .build();

        var writerTask = taskClientFor(writerCard.getUrl())
            .sendTask(writerMessage, false);
        var completedWriter = taskClientFor(writerCard.getUrl())
            .pollUntilComplete(writerTask.getId(),
                java.time.Duration.ofMinutes(5),
                java.time.Duration.ofSeconds(5));

        var finalReport = extractArtifactText(completedWriter);
        System.out.println("[Orchestrator] 协作完成! 最终报告长度: " +
            finalReport.length() + " 字符");

        return finalReport;
    }

    /**
     * 为指定endpoint创建TaskClient
     */
    private TaskClient taskClientFor(String endpoint) {
        return new TaskClient(endpoint);
    }

    /**
     * 从Task中提取Artifact文本内容
     */
    private String extractArtifactText(Task task) {
        if (task.getArtifacts() == null || task.getArtifacts().isEmpty()) {
            return "";
        }
        return task.getArtifacts().get(0).getParts().stream()
            .filter(p -> p instanceof A2aPart.TextPart)
            .map(p -> ((A2aPart.TextPart) p).getText())
            .collect(java.util.stream.Collectors.joining("\n"));
    }

    // ===== 主程序入口 =====
    public static void main(String[] args) {
        var orchestrator = new OrchestratorAgent();

        try {
            var query = "2026年全球电动车市场趋势分析";
            System.out.println("\n=== 多Agent协作开始 ===");
            System.out.println("用户查询: " + query + "\n");

            var finalReport = orchestrator.executeCollaboration(query);

            System.out.println("\n=== 最终报告 ===");
            System.out.println(finalReport);
            System.out.println("\n=== 协作完成 ===");

        } catch (Exception e) {
            System.err.println("协作失败: " + e.getMessage());
            e.printStackTrace();
        }
    }
}

// ===== 4. 支持模型类 =====
// 简化版A2A模型（实际应使用A2A SDK的模型类）
record AgentCard(String name, String description, String version, 
                 String url, List<Skill> skills, 
                 Map<String, Object> properties) {}

record Skill(String id, String name, String description, 
             List<String> tags, List<String> examples) {}

record Task(String id, TaskStatus status, List<A2aMessage> history, 
            List<Artifact> artifacts) {}

record TaskStatus(String state, String message) {
    static final String INPUT_REQUIRED = "input-required";
    static final String WORKING = "working";
    static final String REJECTED = "rejected";
    static final String COMPLETED = "completed";
    static final String FAILED = "failed";
    static final String CANCELED = "canceled";
}

record Artifact(String name, String description, List<A2aPart> parts,
                Map<String, Object> metadata) {}

interface A2aPart {
    record TextPart(String text) implements A2aPart {}
    record FilePart(String name, String mimeType, byte[] content) 
        implements A2aPart {}
    record DataPart(Map<String, Object> data) implements A2aPart {}
}

record A2aMessage(String messageId, String role, List<A2aPart> parts,
                  Map<String, Object> metadata) {}

record StreamEvent(String eventType, String taskId, Artifact artifact) {}
```

## 八、常见问题与最佳实践

### Q1: 如何处理A2A中的超时和重试？

A2A的Task机制天然支持长耗时操作。对于超时场景，建议：
- 在Task创建时设置合理的`timeoutSeconds`
- 使用指数退避策略进行重试
- 对于幂等操作，使用`idempotencyKey`防止重复执行

### Q2: Agent Card的缓存策略？

Agent Card可能频繁变化（Agent升级、能力变更）。建议：
- 缓存Agent Card但设置较短的TTL（如5分钟）
- 支持`ETag`/`If-None-Match`条件请求
- Agent启动时主动向Registry更新自己的Card

### Q3: 如何处理Agent之间的版本兼容性？

- Agent Card中包含version字段
- 遵循语义化版本规范
- 重大变更时创建新Agent端点，保留旧版本一段时间

### Q4: A2A的安全性考量？

- 始终使用HTTPS传输
- 启用双向TLS（mTLS）进行Agent身份验证
- 实现细粒度的权限控制：不是所有Agent都需要访问全部能力
- 审计所有跨Agent的Task操作
- 对敏感数据在Artifact中进行脱敏处理

### Q5: MCP + A2A应该怎样组合使用？

最佳实践是分层架构：
- **工具层（MCP）**：每个Agent通过MCP连接所需的工具和数据源
- **协作层（A2A）**：Agent之间通过A2A进行任务委托和结果传递
- **编排层**：一个Orchestrator Agent负责整体工作流的编排和监控

```java
// 理想的Agent架构
public class IdealAgentArchitecture {

    // MCP: 工具和数据层
    @MCPTool(name = "search_database", description = "...")
    public SearchResult searchDatabase(String query) { /* ... */ }

    @MCPResource(uri = "schema://tables/{name}")
    public TableSchema getTableSchema(String name) { /* ... */ }

    // A2A: Agent协作层
    @A2AEndpoint(path = "/tasks/send")
    public Task handleExternalTask(A2aMessage message) {
        // 1. 解析外部Agent的请求
        // 2. 使用本地MCP Tool收集数据
        // 3. 调用LLM进行推理
        // 4. 将结果作为Artifact返回
    }

    // Orchestration: 编排其他Agent
    public Report orchestrateResearch() {
        var dataAgentResult = a2aClient.sendTask(
            "http://data-agent:8081/tasks/send", queryMessage);
        var analysisAgentResult = a2aClient.sendTask(
            "http://analysis-agent:8082/tasks/send", dataMessage);
        var writerAgentResult = a2aClient.sendTask(
            "http://writer-agent:8083/tasks/send", analysisMessage);
        return compileFinalReport(writerAgentResult);
    }
}
```

---

**关键要点**：
- A2A解决的是Agent之间的互操作问题，与MCP是互补关系
- Agent Card是Agent发现和能力声明的核心机制
- Task抽象支持长耗时操作的跟踪和管理
- A2A SDK提供了完整的Java API，配合Virtual Threads实现高效并发
- 安全方面：OAuth 2.0认证、权限委托、mTLS是生产环境的标配
- MCP + A2A组合构成了完整的企业级AI Agent架构：MCP管工具和数据，A2A管Agent协作
