---
domain: 13-AI协议
title: A2A协议背景与Agent互操作实战
status: draft
level: intermediate
sources:
  - level: L0
    url: https://a2a-protocol.org/latest/specification/
    description: A2A 1.0 规范
  - level: L1
    url: https://github.com/a2aproject/a2a-java
    description: A2A Java SDK官方仓库
  - level: L1
    url: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
    description: A2A协议背景与技术概览（Google Blog）
relations:
  prerequisite:
    - 13-MCP协议与JavaSDK
    - 09-SpringAI2深度解析
  related:
    - 12-多Agent协作架构
tags:
  - a2a
  - a2a-1.0
  - agent-to-agent
  - agent-interop
  - java
  - spring-ai
  - multi-agent
  - mcp
  - protocol-binding
  - json-rpc
  - grpc
created: 2026-07-17
updated: 2026-07-27
content_type: production
verification:
  reviewed_at: 2026-07-27
  version_anchor: A2A 1.0 / a2a-java 1.1.0.Final
  code_status: illustrative
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

Agent Card 是 A2A 1.0 协议的基石——每个 Agent 通过一个标准化的 JSON 文档（`agent-card.json`）声明自己的身份、能力、端点、认证方式等元数据。其他 Agent 通过读取这个文件来发现和了解对方，无需事先约定。

**Agent Card 的核心字段（A2A 1.0 规范）：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Agent 的人类可读名称 |
| `description` | string | 是 | Agent 的功能描述 |
| `url` | string | 是 | Agent 的基础 URL |
| `version` | string | 是 | 语义化版本号 |
| `capabilities` | object | 是 | 能力声明（streaming、pushNotifications 等） |
| `skills` | array | 是 | Agent 的技能列表，每个 skill 含 id、name、description、tags、examples、inputModes、outputModes |
| `authentication` | object | 否 | 认证方案（schemes 数组 + credentials 等） |
| `defaultInputModes` | array | 是 | 默认支持的输入类型：text、file、data |
| `defaultOutputModes` | array | 是 | 默认支持的输出类型：text、file、data |
| `provider` | object | 否 | 提供商信息（organization、url） |
| `security` | object | 否 | 安全策略（签名算法、信任模型） |

**Agent Card 发现机制：Well-Known URI**

A2A 1.0 采用 IETF RFC 8615 标准的 Well-Known URI 模式进行 Agent 自动发现。每个 Agent 必须在其根路径下暴露：

```
GET https://<agent-base-url>/.well-known/agent-card.json
```

客户端无需任何预先配置，仅通过 Agent 的基础 URL 即可自动发现其完整能力。此外，A2A 1.0 还支持通过 DNS TXT 记录和 Agent Registry（注册中心）进行辅助发现，适用于大规模 Agent 集群场景。

```json
{
  "name": "Research Agent",
  "description": "Specialized in web research, data gathering, and fact verification",
  "url": "https://agents.example.com/research",
  "version": "1.2.0",
  "provider": {
    "organization": "AI Research Labs",
    "url": "https://example.com"
  },
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": true
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
      ],
      "inputModes": ["text"],
      "outputModes": ["text", "file"]
    }
  ],
  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "file"],
  "authentication": {
    "schemes": ["bearer"],
    "credentials": {
      "serviceUrl": "https://auth.example.com/token"
    }
  }
}
```

### 2.2 Message（消息）

Message 是 A2A 1.0 中 Agent 间通信的基本单位，代表一次对话回合（turn）。每条 Message 包含 `role`（发送方角色）、`parts`（内容片段数组）、`metadata`（扩展元数据）。

**Message 结构（A2A 1.0）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `messageId` | string | 消息唯一标识 |
| `role` | string | `"user"`（最终用户）或 `"agent"`（Agent 代用户发出的消息） |
| `parts` | array | 内容片段列表，支持 TextPart、FilePart、DataPart |
| `metadata` | object | 可选的扩展元数据（如 priority、locale 等） |
| `contextId` | string | 可选的会话上下文 ID，用于关联多轮对话 |
| `taskId` | string | 可选的任务 ID，关联到所属 Task |

**Part 类型：**

- **TextPart**：纯文本内容，`type: "text"`，包含 `text` 字段
- **FilePart**：文件引用或内联内容，`type: "file"`，包含 `name`、`mimeType`、`content`（或 `uri`）
- **DataPart**：结构化数据，`type: "data"`，包含 `data` 字段（JSON 对象）

A2A 1.0 中 role 仅有 `user` 和 `agent` 两种——没有 `system` role。系统级指令和上下文应通过 Agent Card 的 skills 描述或 Task 的配置传递。

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

Task 是 A2A 1.0 对长耗时、多步骤操作的统一抽象。当一个 Agent 向另一个 Agent 发起请求时，后者创建一个 Task 来跟踪整个工作流程的生命周期。

**Task 状态机（A2A 1.0）：**

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │ 开始处理
                         ▼
                   ┌──────────────┐
                   │ in-progress  │
                   └───┬─────┬────┘
             完成     /     \    失败/取消
                     /       \
                    ▼         ▼
           ┌───────────┐  ┌─────────┐
           │ completed │  │ failed  │
           └───────────┘  └─────────┘
                          ┌──────────┐
                          │ cancelled│
                          └──────────┘
```

五个核心状态：
- **pending**：任务已创建，等待开始处理
- **in-progress**：任务正在执行中，可附带进度信息
- **completed**：任务成功完成，产出 Artifact 可供获取
- **failed**：任务执行失败，附带错误信息
- **cancelled**：任务被主动取消

**Task 对象核心字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 任务唯一标识符 |
| `status` | object | 当前状态（`state` + 可选 `message`、`timestamp`） |
| `history` | array | 任务处理过程中的所有 Message（对话历史） |
| `artifacts` | array | 任务产生的产出物列表 |
| `metadata` | object | 扩展元数据 |

### 2.4 Artifact（产出物）

Artifact 是 Task 产出的具体成果。一个 Task 可以产生多个 Artifact（例如一份报告的多个章节，或图文混合内容）。

**Artifact 对象结构（A2A 1.0）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 产出物名称（如文件名） |
| `description` | string | 产出物描述 |
| `parts` | array | 内容部分（与 Message 的 parts 结构一致：TextPart、FilePart、DataPart） |
| `mimeType` | string | 产出物的 MIME 类型（如 `text/markdown`、`application/json`、`image/png`） |
| `metadata` | object | 扩展元数据 |

```java
var artifact = Artifact.builder()
    .name("research-report.md")
    .description("电动汽车市场研究报告")
    .mimeType("text/markdown")
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

### 3.2 任务创建（message:send）

当Agent A需要Agent B执行任务时，A向B的`/message:send`端点发送消息：

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
            .uri(java.net.URI.create(agentEndpoint + "/message:send"))
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
            .uri(java.net.URI.create(agentEndpoint + "/message:send"))
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

### 3.3 任务状态轮询（GET /tasks/{id}）

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
            case CANCELLED -> throw new RuntimeException("Task was cancelled");
            default -> {
                // pending / in-progress, 继续等待
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
        .uri(java.net.URI.create(agentEndpoint + "/tasks/" + taskId))
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

### 3.4 任务取消（DELETE /tasks/{id}）

```java
/**
 * 取消正在执行的任务
 */
public Task cancelTask(String taskId) throws Exception {
    var cancelRequest = Map.of("taskId", taskId);

    var request = java.net.http.HttpRequest.newBuilder()
        .uri(java.net.URI.create(agentEndpoint + "/tasks/"))
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
data: {"taskId": "task-001", "state": "in-progress", "timestamp": "..."}

event: artifact_update
data: {"taskId": "task-001", "artifact": {"name": "report.md", "parts": [...]}}

event: status_change
data: {"taskId": "task-001", "state": "completed", "timestamp": "..."}
```

## 四、协议绑定（Protocol Binding）

A2A 1.0 设计了传输层无关的协议绑定机制——核心语义（Message、Task、Artifact）保持一致，而传输层可以选择不同的序列化格式和传输协议。

### 4.1 A2A-Version Header

所有 A2A 1.0 请求和响应都必须携带 `A2A-Version` HTTP Header，用于版本协商和兼容性检测：

```
A2A-Version: 1.0
```

客户端和服务器通过此 Header 宣告自己支持的 A2A 协议版本。如果版本不兼容，服务器应返回 `400 Bad Request` 并附带明确的错误信息。未来 A2A 协议升级（如 1.1、2.0）时，此 Header 是保证平滑迁移的关键机制。

### 4.2 HTTP+JSON Binding（默认绑定）

HTTP+JSON 是 A2A 1.0 的**主要绑定方式**，也是最简单的入门方式。所有 A2A 端点均以 HTTP RESTful 风格暴露，Payload 使用 JSON 格式：

- Agent Card 发现：`GET /.well-known/agent-card.json` → JSON
- 消息发送：`POST /message:send` → JSON Request/Response
- 任务查询：`GET /tasks/xxx` → JSON
- 任务取消：`POST /tasks/` → JSON
- 流式响应：`POST /message:send` + `Accept: text/event-stream` → SSE

```java
// A2A 1.0 HTTP+JSON 请求示例
var request = java.net.http.HttpRequest.newBuilder()
    .uri(java.net.URI.create(agentUrl + "/message:send"))
    .header("Content-Type", "application/json")
    .header("A2A-Version", "1.0")
    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(jsonPayload))
    .build();
```

### 4.3 JSON-RPC Binding

对于更结构化的远程调用场景，A2A 1.0 支持 JSON-RPC 2.0 绑定。所有 A2A 操作映射到 JSON-RPC 方法调用，通过同一个端点处理：

```
POST /a2a/jsonrpc
Content-Type: application/json
A2A-Version: 1.0

{
  "jsonrpc": "2.0",
  "method": "SendMessage",
  "params": { "message": {...} },
  "id": "req-001"
}
```

JSON-RPC 绑定的优势在于：统一的错误码体系、批量调用支持、与现有 JSON-RPC 基础设施集成。注意 HTTP+JSON 的 `/message:send` 路径与 JSON-RPC 的 `SendMessage` 方法名是两套绑定，不能混用。

### 4.4 gRPC Binding

对于高性能、强类型的 Agent 间通信，A2A 1.0 定义了 gRPC 绑定。A2A 的核心数据结构（AgentCard、Message、Task、Artifact）被映射到 Protobuf 定义：

```protobuf
service A2AService {
  rpc GetAgentCard(GetAgentCardRequest) returns (AgentCard);
  rpc SendTask(SendTaskRequest) returns (Task);
  rpc GetTask(GetTaskRequest) returns (Task);
  rpc CancelTask(CancelTaskRequest) returns (Task);
  rpc SendTaskStreaming(SendTaskRequest) returns (stream TaskUpdate);
}
```

gRPC 绑定适用于：
- 高吞吐量的 Agent 间通信（HTTP/2 多路复用）
- 需要双向流的场景
- 多语言 Agent 系统（利用 gRPC 的代码生成能力）
- 需要严格接口契约的企业级部署

### 4.5 Binding 对比

| 维度 | HTTP+JSON | JSON-RPC | gRPC |
|------|-----------|----------|------|
| 复杂度 | 低 | 中 | 中高 |
| 性能 | 中 | 中 | 高（HTTP/2） |
| 流式支持 | SSE | SSE | 原生双向流 |
| 类型安全 | 弱 | 弱 | 强（Protobuf） |
| 调试友好 | 高（curl/Postman） | 中 | 低（需工具） |
| 适用场景 | 简单集成、原型 | 结构化调用、批量 | 高性能、多语言 |

**建议**：原型和简单集成使用 HTTP+JSON，需要结构化调用和批量处理时升级到 JSON-RPC，高性能 Agent 间通信采用 gRPC。


## 五、安全与扩展

### 5.1 Agent Card 签名

A2A 1.0 支持对 Agent Card 进行数字签名，防止 Agent 身份伪造和能力篡改。Agent Card 签名遵循 JWS（JSON Web Signature，RFC 7515）规范——将 Agent Card JSON 序列化为 JWS Payload，使用 Agent 的私钥签名，其他 Agent 通过公钥验证。

```
签名流程：
Agent Card JSON → JWS Payload → Sign(PrivateKey) → Signed Agent Card (JWS Compact Serialization)

验证流程：
Signed Agent Card → Verify(PublicKey) → Extract Payload → Agent Card JSON
```

签名后的 Agent Card 可以通过 Well-Known URI 发布，或注册到 Agent Registry 中。验证方通过 Agent Card 中声明的公钥 URL（`jwksUrl` 字段）获取公钥进行验证。

### 5.2 OAuth2 / OIDC 集成

A2A 1.0 推荐使用 OAuth 2.0 进行 Agent 间认证和授权。Agent Card 的 `authentication` 字段声明其支持的认证方案和 Token 端点，客户端通过标准 OAuth 2.0 流程获取 Access Token：

```
Client → Authorization Server: POST /token (client_credentials)
Client ← Authorization Server: {"access_token": "...", "expires_in": 3600}

Client → Agent B: GET /tasks/xxx
           Authorization: Bearer <access_token>
           A2A-Version: 1.0
```

对于需要用户身份传递的场景，A2A 1.0 支持 OIDC（OpenID Connect）集成，通过 ID Token 传递用户身份信息。Agent 间还可以通过 Token Exchange（RFC 8693）实现权限委托。

### 5.3 Agent 间权限委托（Delegation）

当 Agent A 代表用户向 Agent B 请求服务时，A2A 1.0 支持权限委托机制。Agent A 可以携带用户的权限声明，Agent B 根据权限声明决定是否执行操作。

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

### 5.4 扩展字段的兼容性处理

A2A 1.0 采用 **前向兼容** 策略：所有核心对象（AgentCard、Message、Task、Artifact）均允许额外的扩展字段。客户端和服务器的兼容性规则：

- **未知字段忽略**：接收方遇到不认识的字段时**必须忽略**（而非报错），确保旧版客户端可以与新版服务端互通。
- **metadata 扩展**：每个核心对象都有 `metadata` 字段（`Map<String, Object>`），用于携带自定义业务数据，不影响协议核心逻辑。
- **Capability 协商**：通过 Agent Card 的 `capabilities` 字段声明支持的特性（如 streaming），调用方据此决定是否使用特定功能。
- **Semantic Versioning**：Agent Card 的 `version` 字段遵循语义化版本，大版本号变更表示不兼容改动。

### 5.5 错误码映射

A2A 1.0 定义了标准化的错误码体系，覆盖 HTTP 层、协议层和业务层：

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `TASK_NOT_FOUND` | 404 | 指定 taskId 的任务不存在 |
| `TASK_NOT_CANCELABLE` | 409 | 任务当前状态不允许取消 |
| `INVALID_REQUEST` | 400 | 请求参数不符合协议规范 |
| `UNSUPPORTED_OPERATION` | 501 | 请求的操作不被该 Agent 支持 |
| `AUTHENTICATION_REQUIRED` | 401 | 需要认证但未提供凭据 |
| `PERMISSION_DENIED` | 403 | 认证通过但权限不足 |
| `RATE_LIMIT_EXCEEDED` | 429 | 超出速率限制 |
| `INTERNAL_ERROR` | 500 | Agent 内部处理错误 |
| `SERVICE_UNAVAILABLE` | 503 | Agent 暂时不可用（如过载、维护） |
| `TIMEOUT` | 504 | 任务执行超时 |

所有错误响应均包含统一的 JSON 结构：

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with id 'task-001' not found",
    "details": {
      "taskId": "task-001"
    }
  }
}
```

`details` 字段为可选的扩展信息，遵循 5.4 节的兼容性原则——客户端应忽略无法识别的 details 字段。

## 六、Java A2A SDK使用

### 6.1 Maven依赖

```xml
<!-- A2A Java SDK -->
<dependency>
    <groupId>org.a2aproject.sdk</groupId>
    <artifactId>a2a-java-sdk-reference-jsonrpc</artifactId>
    <version>1.1.0.Final</version>
</dependency>
```

`labs/lab-a2a-agent` 使用上述官方 SDK 坐标并执行 Agent Card、SendMessage、
GetTask 和版本头的确定性测试。下面的 Server 代码用于说明处理流程，是架构伪代码，
不是官方 SDK 类型清单；可编译的 SDK 用法以 Lab 为准。

### 6.2 构建 A2A Agent Server（架构伪代码）

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
            .status(new TaskStatus(TaskStatus.IN_PROGRESS, "开始研究: " + query))
            .build();

        // 执行研究（这里用Virtual Thread）
        Thread.ofVirtual().start(() -> {
            try {
                // 步骤1: 搜索资料
                context.updateStatus(new TaskStatus(TaskStatus.IN_PROGRESS, "正在搜索相关资源..."));
                var searchResults = performWebSearch(query);

                // 步骤2: 交叉验证
                context.updateStatus(new TaskStatus(TaskStatus.IN_PROGRESS, "正在交叉验证信息..."));
                var verifiedResults = crossVerify(searchResults);

                // 步骤3: 生成报告
                context.updateStatus(new TaskStatus(TaskStatus.IN_PROGRESS, "正在生成研究报告..."));
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

## 七、MCP与A2A的对比与协作

### 7.1 对比表

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

### 7.2 协同工作模式

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

## 八、完整示例：多Agent协作系统

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
        server.createContext("/message:send", exchange -> {
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
                "status", Map.of("state", "in-progress",
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
    static final String PENDING = "pending";
    static final String IN_PROGRESS = "in-progress";
    static final String COMPLETED = "completed";
    static final String FAILED = "failed";
    static final String CANCELLED = "cancelled";
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

## 九、常见问题与最佳实践

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
    // 伪代码：由实际 MCP SDK 注册 search_database 工具
    public SearchResult searchDatabase(String query) { /* ... */ }

    // 伪代码：由实际 MCP SDK 注册 schema://tables/{name} 资源
    public TableSchema getTableSchema(String name) { /* ... */ }

    // A2A: Agent协作层
    // 伪代码：由实际 A2A transport 注册 /message:send
    public Task handleExternalTask(A2aMessage message) {
        // 1. 解析外部Agent的请求
        // 2. 使用本地MCP Tool收集数据
        // 3. 调用LLM进行推理
        // 4. 将结果作为Artifact返回
    }

    // Orchestration: 编排其他Agent
    public Report orchestrateResearch() {
        var dataAgentResult = a2aClient.sendTask(
            "http://data-agent:8081/message:send", queryMessage);
        var analysisAgentResult = a2aClient.sendTask(
            "http://analysis-agent:8082/message:send", dataMessage);
        var writerAgentResult = a2aClient.sendTask(
            "http://writer-agent:8083/message:send", analysisMessage);
        return compileFinalReport(writerAgentResult);
    }
}
```

---

**关键要点**：
- A2A解决的是Agent之间的互操作问题，与MCP是互补关系
- Agent Card是Agent发现和能力声明的核心机制
- Task抽象支持长耗时操作的跟踪和管理
- 官方 A2A Java SDK 提供协议类型和 transport；具体并发策略由应用和运行时实现
- 安全方面：OAuth 2.0认证、权限委托、mTLS是生产环境的标配
- MCP + A2A组合构成了完整的企业级AI Agent架构：MCP管工具和数据，A2A管Agent协作
