---
domain: "13-AI协议"
title: "MCP协议深入与Java SDK实战"
status: "draft"
level: "intermediate"
sources:
  - level: "L0"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/"
    description: "MCP 规范 2025-11-25"
  - level: "L1"
    url: "https://modelcontextprotocol.io/sdk/java/mcp-server"
    description: "MCP Java SDK官方文档 - Server端"
  - level: "L1"
    url: "https://modelcontextprotocol.io/sdk/java/mcp-client"
    description: "MCP Java SDK官方文档 - Client端"
  - level: "L2"
    url: "https://docs.spring.io/spring-ai/reference/api/mcp/mcp-overview.html"
    description: "Spring AI MCP集成文档"
relations:
  prerequisite: ["09-SpringAI2深度解析", "09-SpringAI2深度解析"]
  related: ["13-A2A协议与Agent互操作", "12-ToolCalling完整剖析"]
tags: ["mcp", "model-context-protocol", "java", "spring-ai", "tool-calling", "agent-protocol"]
created: "2026-07-17"
updated: "2026-07-27"
---

# MCP协议深入与Java SDK实战

## 一、MCP架构深入

### 1.1 三层模型

MCP（Model Context Protocol）定义了三层架构模型，每一层职责清晰：

**Host（宿主层）**：Host是AI应用的载体，例如Claude Desktop、VS Code、Spring AI应用。Host负责管理多个MCP Client的生命周期，协调它们与LLM之间的交互。Host通常还承担权限控制、安全沙箱等职责。

**Client（客户端层）**：Client是与特定MCP Server建立一对一连接的实体。Client负责Transport管理、协议握手、请求路由。一个Host可以管理多个Client，每个Client连接一个Server。

**Server（服务端层）**：Server是实际提供能力的实体，暴露Tools（工具）、Resources（资源）、Prompts（提示模板）。Server运行在独立进程中（stdio Transport）或远程服务上（HTTP Transport）。

```
┌─────────────────────────────────────┐
│              AI Host                │
│  ┌──────────┐  ┌──────────────────┐ │
│  │ LLM      │  │ MCP Client Mgr   │ │
│  │ (Claude) │  │  ┌────────────┐  │ │
│  └──────────┘  │  │ MCP Client │──┼─┼──→ MCP Server A (Database)
│                │  ├────────────┤  │ │
│                │  │ MCP Client │──┼─┼──→ MCP Server B (Filesystem)
│                │  └────────────┘  │ │
│                └──────────────────┘ │
└─────────────────────────────────────┘
```

### 1.2 Transport层

MCP定义了两种标准Transport方式：

**stdio Transport**：Server作为子进程运行，Client通过标准输入/输出与Server通信。使用JSON-RPC 2.0编码消息，以换行符分隔。这种方式的优势是安全隔离好，Server无法主动访问网络；劣势是只能在本机使用。

```
Client启动Server子进程 → fork/exec java -jar my-mcp-server.jar
消息格式: JSON-RPC 2.0 + 换行符分隔
每条消息独占一行（不支持消息体内换行）
```

**Streamable HTTP Transport**：Server作为HTTP服务运行，Client通过HTTP请求与之通信。支持Server到Client的推送（通过SSE），适合远程部署场景。

### 1.3 核心原语

MCP定义了三种核心原语，对应AI应用与外部世界交互的三种模式：

**Tools（工具调用）**：Tools是Server暴露的可调用函数，LLM通过function calling机制发现并调用。每个Tool有名称、描述、输入Schema（JSON Schema）。典型场景：查询数据库、发送邮件、创建Jira工单。

**Resources（资源暴露）**：Resources是Server暴露的只读数据源，LLM可以读取但不能修改。每个Resource有URI标识、MIME type、可选的描述。典型场景：读取文件内容、获取数据库Schema、查看API文档。Resources支持动态发现——Server可以暴露Resource Templates（如 `schema://tables/{name}`），Client传入参数获取具体Resource。

**Prompts（Prompt模板）**：Prompts是Server提供的预定义Prompt模板，包含参数化的消息序列。LLM可以获取Prompt模板并填充参数来引导用户交互。典型场景：代码审查模板、测试用例生成模板。

## 二、MCP协议交互流程

### 2.1 初始化握手

MCP协议的生命周期从初始化握手开始：

```
Client → Server: initialize {
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "roots": {"listChanged": true},
      "sampling": {}
    },
    "clientInfo": {
      "name": "my-ai-app",
      "version": "1.0.0"
    }
  }
}

Server → Client: {
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {"listChanged": true},
      "resources": {"subscribe": true, "listChanged": true}
    },
    "serverInfo": {
      "name": "database-mcp-server",
      "version": "2.3.0"
    }
  }
}

Client → Server: {"jsonrpc": "2.0", "method": "notifications/initialized"}
```

### 2.2 能力协商（Capability Negotiation）

双方在 initialize 阶段交换 capabilities，声明各自支持的功能。这是 MCP 协议的核心设计之一——Client 和 Server 各自独立声明能力，最终可用功能取双方能力的交集。例如，如果 Server 声明了 `tools` 能力但 Client 未声明，则该 Server 的 Tool 不会被 LLM 调用。这种设计保证了协议的向前兼容：新版本 Server 添加新能力时，旧版本 Client 可以安全忽略。

**Client 侧能力声明**：
- `roots`：Client 可向 Server 提供文件系统根目录信息，`listChanged` 表示根目录列表可动态变化
- `sampling`：Client 可代表 Server 调用 LLM，支持 Server 端智能处理
- `elicitation`：Client 支持 Server 发起的用户输入请求（表单、确认、URL 跳转等）

**Server 侧能力声明**：
- `tools`：Server 可提供工具调用能力，`listChanged` 表示工具列表可动态变化（支持运行时注册/注销 Tool）
- `resources`：Server 可暴露资源，支持 `subscribe`（订阅资源变更通知）和 `listChanged`（资源列表可动态变化）
- `prompts`：Server 可提供 Prompt 模板，`listChanged` 表示模板列表可动态变化
- `logging`：Server 可向 Client 发送日志消息

**协商策略**：Client 在 initialize 请求中声明自己的能力，Server 在响应中声明自己的能力。双方根据对方的能力声明决定后续行为。例如，如果 Client 声明了 `elicitation` 能力，Server 就可以在需要用户确认时发送 `elicitation/create` 请求；如果 Client 未声明，Server 应采用降级策略（如默认允许或直接拒绝）。在 Java SDK 中，`McpSchema.ClientCapabilities` 和 `McpSchema.ServerCapabilities` 的 Builder 模式提供了清晰的能力声明 API。

### 2.3 Tools查询与调用

```
// 列出所有工具
Client → Server: {"method": "tools/list"}
Server → Client: {
  "tools": [
    {
      "name": "query_table",
      "description": "在指定表中执行SELECT查询",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sql": {"type": "string", "description": "SQL查询语句"},
          "params": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["sql"]
      }
    }
  ]
}

// 调用工具
Client → Server: {
  "method": "tools/call",
  "params": {
    "name": "query_table",
    "arguments": {"sql": "SELECT * FROM users WHERE age > ?", "params": ["18"]}
  }
}
Server → Client: {
  "content": [{"type": "text", "text": "{\"rows\": [...], \"rowCount\": 42}"}]
}
```

### 2.4 Resources查询与读取

```
// 列出资源
Client → Server: {"method": "resources/list"}
// 读取资源
Client → Server: {
  "method": "resources/read",
  "params": {"uri": "schema://tables/users"}
}
```

### 2.5 Sampling与Elicitation

#### 2.5.1 Sampling（服务端调用LLM）

Sampling 允许 Server 反向请求 Client 调用 LLM，实现 Server 端的智能处理。典型流程：Server 发送 `sampling/createMessage` 请求，携带 messages（对话上下文）、modelPreferences（模型偏好）、maxTokens 等参数；Client 收到后调用绑定的 LLM，将生成的文本返回给 Server。这一机制使 MCP Server 不再是被动的工具提供者，而可以在内部实现智能决策——例如，一个数据库 MCP Server 可以使用 Sampling 将自然语言查询转换为 SQL，而无需在 Server 端集成 LLM SDK。

```
Server → Client: {
  "method": "sampling/createMessage",
  "params": {
    "messages": [{"role": "user", "content": {"type": "text", "text": "..."}}],
    "maxTokens": 1000
  }
}
Client → Server: {
  "result": {
    "role": "assistant",
    "content": {"type": "text", "text": "SELECT ..."},
    "model": "claude-sonnet-4-20250514",
    "stopReason": "endTurn"
  }
}
```

**注意**：Sampling 需要 Client 声明 `sampling` 能力。在安全敏感场景中，Client 应限制 Sampling 的调用频率和 Token 消耗上限，防止 Server 滥用 LLM 资源。

#### 2.5.2 Elicitation（服务端请求用户输入）

Elicitation 是 MCP 规范 2025-11-25 中明确定义的能力，允许 Server 向 Client 请求用户输入，用于敏感操作确认、参数补充、表单填写等场景。与 Sampling 不同，Elicitation 的目标是人类用户而非 LLM。

Server 发送 `elicitation/create` 请求，携带 `mode`（交互模式）和 `message`（提示信息）等参数。MCP 定义了三种 Elicitation 模式：

- **`form` 模式**：向用户展示表单，用户填写后返回结构化数据。适用于需要多个输入参数但 LLM 无法推断的场景。
- **`url` 模式**：引导用户打开外部 URL（如 OAuth 授权页面），完成后返回。适用于需要用户在第三方系统操作的场景。
- **`schema` 模式**：向用户展示 Schema，用户选择或确认后返回。适用于敏感操作确认。

```
Server → Client: {
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "请确认删除以下数据: [用户ID: 42, 订单数: 15]",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "confirm": {"type": "boolean", "title": "确认删除"},
        "reason": {"type": "string", "title": "删除原因"}
      }
    }
  }
}
Client → Server: {
  "result": {
    "action": "accept",
    "content": {"confirm": true, "reason": "用户已注销"}
  }
}
```

**关键点**：Elicitation 依赖于 Client 声明 `elicitation` 能力。如果 Client 未声明此能力，Server 应采用降级策略——例如对所有敏感操作默认拒绝，或在 Tool 描述中提示 LLM 先获取用户确认再调用。MCP Java SDK 2.0 提供了更丰富的 Elicitation 支持，包括客户端 Schema 默认值、URL Elicitation 和基于表单的多步交互。

### 2.6 Authorization流程

MCP 规范定义了一套基于 OAuth 2.0 / OIDC 的授权模型，用于保护 HTTP Transport 上的 MCP Server 访问。授权流程如下：

**1. 发现 Authorization Server**：Client 首先向 MCP Server 的 `/.well-known/oauth-protected-resource` 端点发起请求（HTTP 401 响应或直接访问），获取 Authorization Server 的元数据，包括 `authorization_endpoint`、`token_endpoint`、`registration_endpoint` 等。

**2. 动态客户端注册（DCR）**：如果 Client 尚未在 Authorization Server 注册，需要通过 `registration_endpoint` 动态注册，获取 `client_id` 和 `client_secret`。MCP 允许 Client 在注册时声明所需的 scope。

**3. 获取 Access Token**：Client 使用标准 OAuth 2.0 流程（Authorization Code + PKCE 推荐）获取 Access Token。MCP 定义的常用 scope 包括：
- `mcp:tools`：允许访问 Server 的 Tool
- `mcp:resources`：允许访问 Server 的 Resource
- `mcp:prompts`：允许访问 Server 的 Prompt
- `mcp:sampling`：允许 Server 通过 Client 调用 LLM
- `mcp:elicitation`：允许 Server 向用户请求输入

**4. 携带 Token 访问**：获取 Token 后，Client 在每次 HTTP 请求的 `Authorization: Bearer <token>` 头中携带。Server 验证 Token 的有效性和 scope，决定是否允许操作。

**5. Token 刷新**：Access Token 过期后，Client 使用 Refresh Token 刷新。MCP 规范建议 Access Token 有效期为 1 小时，Refresh Token 有效期为 30 天。

```
Client → Server: GET /.well-known/oauth-protected-resource
Server → Client: 401 {"authorization_endpoint": "https://auth.example.com/oauth/authorize", ...}
Client → AuthServer: POST /oauth/register {"scope": "mcp:tools mcp:resources"}
AuthServer → Client: {"client_id": "...", "client_secret": "..."}
Client → AuthServer: ...OAuth 2.0 flow with PKCE...
AuthServer → Client: {"access_token": "...", "refresh_token": "...", "expires_in": 3600}
Client → MCP Server: POST /mcp {"Authorization": "Bearer <access_token>", ...}
```

**注意**：stdio Transport 不经过网络，天然无需 Authorization。Java MCP Client 通过 `HttpClientTransport` 构造函数的 headers 参数传入 Token，配合令牌刷新机制实现无缝授权管理。

### 2.7 错误处理与兼容策略

MCP 协议在设计中考虑了版本演进和错误处理的场景，确保 Server 升级时不会破坏现有 Client 的集成。

**协议版本协商**：Client 在 initialize 请求中声明自己支持的 `protocolVersion`（如 `"2025-11-25"`），Server 在响应中确认可接受的版本。如果 Server 不支持 Client 请求的版本，应返回兼容的最高版本或拒绝连接。最佳实践是 Client 始终请求自己支持的最新版本，Server 尽可能支持多个版本的范围。

**向后兼容原则**：MCP 规范要求所有变更必须向后兼容（在同一个大版本内）。新增字段应设置为可选，删除字段应预留过渡期。Server 不应假设 Client 实现了所有能力——例如，若 Client 未声明 `elicitation`，Server 不应发送 Elicitation 请求，而应使用 Tool 描述中的提示信息作为降级方案。

**未知 Capability 处理**：Client 应安全忽略 Server 声明的未知 capability，不应因未知能力而拒绝连接。同样，Server 也应安全忽略 Client 声明的未知 capability。这保证了未来新能力被添加到规范时，旧版实现不会被破坏。

**JSON-RPC 错误码**：MCP 使用标准 JSON-RPC 2.0 错误码，另外定义了 MCP 特定错误：
- `-32000`（Server not initialized）：在 initialize 完成前尝试调用其他方法
- `-32001`（Request timed out）：请求处理超时
- `-32002`（Invalid params）：参数校验失败（如 Tool 调用参数不符合 inputSchema）
- `-32003`（Method not found）：调用了不存在的方法
- `-32603`（Internal error）：Server 内部异常

**降级策略设计**：在实现 MCP Server 时，应为每个能力提供降级方案。例如，当一个需要用户确认的 Tool（依赖 Elicitation）被不支持 Elicitation 的 Client 调用时，Server 应返回明确错误信息并提示 LLM 先获取用户确认，而非静默失败。Java SDK 提供了能力检测 API，Server 可在运行时判断 Client 是否支持特定能力并据此调整行为。

**生产环境建议**：在部署 MCP Server 新版本时，建议使用金丝雀或灰度发布策略——先部署新版 Server 到部分流量，验证兼容性后再全量切换。监控 JSON-RPC 错误码分布，对 `-32003`（Method not found）和版本不匹配错误设置告警。对于破坏性变更（如移除 Tool），应在 Agent Card 或变更日志中提前通知下游 Client 开发者。

### 3.1 Maven依赖

```xml
<!-- MCP Java SDK (JDK 25, Spring Boot 4.x) -->
<dependency>
    <groupId>io.modelcontextprotocol.sdk</groupId>
    <artifactId>mcp</artifactId>
    <version>2.0.0</version>
</dependency>
<!-- 也可使用 mcp-core（精简版，推荐新项目使用） -->
<dependency>
    <groupId>io.modelcontextprotocol.sdk</groupId>
    <artifactId>mcp-core</artifactId>
    <version>2.0.0</version>
</dependency>

<!-- Spring AI MCP Boot Starter（Spring AI 2.0.0） -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-mcp-server</artifactId>
    <version>2.0.0</version>
</dependency>
<!-- Spring AI BOM 统一版本管理 -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-bom</artifactId>
    <version>2.0.0</version>
    <type>pom</type>
    <scope>import</scope>
</dependency>
```

### 3.2 构建MCP Server

```java
// McpServerConfiguration.java
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.transport.StdioServerTransport;
import io.modelcontextprotocol.spec.McpSchema;

public class McpServerConfiguration {

    public static void main(String[] args) {
        // 1. 创建Server实例
        var server = McpServer.sync(
            McpServer.ServerInfo.create("database-mcp-server", "2.3.0")
        )
        .serverInfo(McpServer.ServerInfo.create("database-mcp-server", "2.3.0"))
        .capabilities(McpSchema.ServerCapabilities.builder()
            .tools(true)      // 启用工具能力
            .resources(true, true) // 启用资源能力，支持订阅
            .build())
        .build();

        // 2. 注册Tool
        server.addTool(
            McpServerFeatures.SyncToolSpecification.builder()
                .name("query_table")
                .description("在数据库表中执行SELECT查询")
                .inputSchema(McpSchema.JsonSchema.builder()
                    .type("object")
                    .property("sql", McpSchema.JsonSchema.builder()
                        .type("string")
                        .description("要执行的SELECT语句")
                        .build())
                    .required(java.util.List.of("sql"))
                    .build())
                .handler((exchange, request) -> {
                    var sql = request.arguments().get("sql").toString();
                    var result = DatabaseService.query(sql);
                    return McpSchema.CallToolResult.builder()
                        .content(java.util.List.of(
                            McpSchema.TextContent.builder()
                                .text(JacksonUtils.toJson(result))
                                .build()
                        ))
                        .build();
                })
                .build()
        );

        // 3. 注册Resource
        server.addResource(
            McpServerFeatures.SyncResourceSpecification.builder()
                .uri("schema://status")
                .name("数据库连接状态")
                .description("返回当前数据库的连接状态信息")
                .mimeType("application/json")
                .handler(exchange -> McpSchema.ReadResourceResult.builder()
                    .contents(java.util.List.of(
                        McpSchema.TextResourceContents.builder()
                            .uri("schema://status")
                            .mimeType("application/json")
                            .text(JacksonUtils.toJson(DatabaseService.getStatus()))
                            .build()
                    ))
                    .build())
                .build()
        );

        // 4. 注册Resource Template
        server.addResourceTemplate(
            McpServerFeatures.SyncResourceTemplateSpecification.builder()
                .uriTemplate("schema://tables/{tableName}")
                .name("表结构信息")
                .description("获取指定数据库表的结构信息")
                .mimeType("application/json")
                .handler((exchange, request) -> {
                    var tableName = request.pathVariables().get("tableName");
                    var schema = DatabaseService.describeTable(tableName);
                    return McpSchema.ReadResourceResult.builder()
                        .contents(java.util.List.of(
                            McpSchema.TextResourceContents.builder()
                                .uri("schema://tables/" + tableName)
                                .mimeType("application/json")
                                .text(JacksonUtils.toJson(schema))
                                .build()
                        ))
                        .build();
                })
                .build()
        );

        // 5. 启动stdio Transport
        var transport = new StdioServerTransport();
        server.connect(transport).join();

        System.out.println("Database MCP Server started via stdio");
    }
}
```

### 3.3 构建MCP Client

```java
// McpClientConfiguration.java
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.StdioClientTransport;
import io.modelcontextprotocol.client.transport.HttpClientTransport;

public class McpClientConfiguration {

    // === stdio方式连接 ===
    public static McpSyncClient createStdioClient() {
        // 启动Server子进程，通过stdio通信
        var transport = new StdioClientTransport(
            new StdioClientTransport.Parameters(
                "java",                                    // 命令
                java.util.List.of("-jar", "database-mcp-server.jar") // 参数
            )
        );

        var client = McpClient.sync(transport)
            .requestTimeout(java.time.Duration.ofSeconds(30))
            .capabilities(McpSchema.ClientCapabilities.builder()
                .roots(true)
                .sampling()
                .build())
            .clientInfo(McpSchema.Implementation.builder()
                .name("my-ai-app")
                .version("1.0.0")
                .build())
            .build();

        client.initialize();
        return client;
    }

    // === HTTP方式连接（远程） ===
    public static McpSyncClient createHttpClient() {
        var transport = new HttpClientTransport(
            "https://mcp-server.example.com",
            java.util.Map.of("Authorization", "Bearer " + System.getenv("MCP_TOKEN"))
        );

        var client = McpClient.sync(transport)
            .requestTimeout(java.time.Duration.ofSeconds(60))
            .build();

        client.initialize();
        return client;
    }

    // === 使用Client调用Tool ===
    public static void useClient(McpSyncClient client) {
        // 列出所有Tools
        var tools = client.listTools();
        System.out.println("Available tools: " + tools.tools().size());

        // 调用Tool
        var result = client.callTool(
            McpSchema.CallToolRequest.builder()
                .name("query_table")
                .arguments(java.util.Map.of(
                    "sql", "SELECT * FROM users WHERE status = ?",
                    "params", java.util.List.of("active")
                ))
                .build()
        );

        // 处理结果
        for (var content : result.content()) {
            if (content instanceof McpSchema.TextContent text) {
                System.out.println("Query result: " + text.text());
            }
        }

        // 列出Resources
        var resources = client.listResources();
        resources.resources().forEach(r ->
            System.out.println("Resource: " + r.uri() + " - " + r.name())
        );

        // 读取Resource
        var resource = client.readResource(
            McpSchema.ReadResourceRequest.builder()
                .uri("schema://tables/users")
                .build()
        );
    }

    // === Virtual Threads 异步调用 ===
    public static void asyncExample(McpSyncClient client) {
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var future1 = executor.submit(() -> {
                var result = client.callTool(
                    McpSchema.CallToolRequest.builder()
                        .name("query_table")
                        .arguments(java.util.Map.of("sql", "SELECT COUNT(*) FROM orders"))
                        .build()
                );
                System.out.println("Order count: " + result);
                return result;
            });

            var future2 = executor.submit(() -> {
                var result = client.callTool(
                    McpSchema.CallToolRequest.builder()
                        .name("query_table")
                        .arguments(java.util.Map.of("sql", "SELECT COUNT(*) FROM users"))
                        .build()
                );
                System.out.println("User count: " + result);
                return result;
            });

            future1.get();
            future2.get();
        } catch (Exception e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

### 3.4 Spring AI MCP集成

Spring AI 2.0 提供了注解驱动的 MCP 编程模型，通过 `@McpTool`、`@McpResource`、`@McpPrompt` 等注解声明式地暴露 MCP 能力：

```java
// SpringAiMcpConfig.java — Spring AI 2.0 注解驱动 MCP Server
import org.springframework.ai.mcp.server.McpServerProperties;
import org.springframework.ai.tool.annotation.McpTool;
import org.springframework.ai.tool.annotation.McpToolParam;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SpringAiMcpConfig {

    // Spring Boot 自动配置通过 @McpTool 注解发现并注册 MCP Tool
    @Bean
    McpServerProperties mcpServerProperties() {
        var props = new McpServerProperties();
        props.setType(McpServerProperties.ServerType.SYNC);
        props.setName("spring-ai-mcp-server");
        props.setVersion("1.0.0");
        return props;
    }
}

// 声明式 Tool 定义 — 使用注解替代手动构建 JSON Schema
// 放在任意 @Component / @Service 类中即可被自动发现
@Component
class DatabaseMcpTools {

    @McpTool(description = "在数据库表中执行只读SELECT查询")
    public String queryTable(
        @McpToolParam(description = "SELECT查询语句") String sql,
        @McpToolParam(description = "查询参数") java.util.List<String> params) {
        var result = DatabaseService.query(sql, params);
        return JacksonUtils.toJson(result);
    }

    @McpTool(description = "获取指定数据库表的结构信息")
    public String describeTable(
        @McpToolParam(description = "表名") String tableName) {
        return JacksonUtils.toJson(DatabaseService.describeTable(tableName));
    }
}

// 在application.yml中配置（Spring AI 2.0）
// spring:
//   ai:
//     mcp:
//       server:
//         name: "my-ai-server"
//         version: "1.0.0"
//         type: SYNC
//         protocol-version: "2025-11-25"
//       client:
//         type: ASYNC
//         streamable-http:
//           connections:
//             database:
//               url: "http://localhost:8080/mcp"
```

### 3.5 Transport选择指南

在实际开发中，Transport的选择直接影响系统架构和服务部署方式。以下是两种Transport的详细对比和适用场景分析：

| Transport | 适用场景 | 优势 | 劣势 |
|-----------|---------|------|------|
| stdio | 本地开发、桌面应用 | 简单、安全隔离、无需网络 | 仅本机、需启动子进程 |
| HTTP (Streamable) | 生产环境、远程服务 | 可远程部署、多Client共享 | 需处理认证授权 |

**stdio Transport的工作原理**：Client通过`ProcessBuilder`启动Server子进程，Server的`System.in`和`System.out`被重定向为Client的通信通道。每条JSON-RPC消息以换行符分隔，因此消息体内部不能包含未转义的换行符。由于Server运行在子进程中，它天然受到进程隔离保护——Server无法访问Client的内存空间，也无法主动发起网络请求（除非Server自行建立网络连接）。

**HTTP Transport的工作原理**：Server以独立HTTP服务形式运行（可以是Servlet容器、Netty、或嵌入式Tomcat），Client通过HTTP POST发送JSON-RPC请求。HTTP Transport支持连接池、负载均衡、水平扩展等企业级特性。MCP Java SDK 2.0 将 Streamable HTTP 作为主要 HTTP Transport 方式（SSE Transport 已标记为 deprecated），支持 Server 到 Client 的流式推送和双向通信。

**选择建议**：本地开发和桌面应用首选stdio，因为部署简单且天然安全隔离；生产环境的微服务架构中，MCP Server应作为独立服务部署，使用HTTP Transport并配置认证、限流、监控等基础设施；混合场景下，可以在本地使用stdio连接开发工具MCP Server，同时通过HTTP连接远程的企业级MCP服务。

## 四、安全性最佳实践

### 4.1 工具权限白名单

```java
// ToolSecurityFilter.java
public class ToolSecurityFilter {

    private static final java.util.Set<String> ALLOWED_TOOLS = java.util.Set.of(
        "query_table", "describe_table", "list_tables"
    );

    private static final java.util.Set<String> READ_ONLY_TOOLS = java.util.Set.of(
        "query_table", "describe_table", "list_tables"
    );

    /**
     * 校验工具是否在白名单中
     */
    public static void validateTool(String toolName) {
        if (!ALLOWED_TOOLS.contains(toolName)) {
            throw new SecurityException("Tool not allowed: " + toolName);
        }
    }

    /**
     * 仅允许只读操作
     */
    public static void ensureReadOnly(String toolName) {
        if (!READ_ONLY_TOOLS.contains(toolName)) {
            throw new SecurityException("Write operations are not permitted: " + toolName);
        }
    }
}
```

### 4.2 参数校验

```java
// ParameterValidator.java
public class ParameterValidator {

    /**
     * 校验SQL注入防护
     */
    public static void validateSql(String sql) {
        // 仅允许SELECT语句
        var trimmed = sql.trim().toUpperCase();
        if (!trimmed.startsWith("SELECT")) {
            throw new IllegalArgumentException("Only SELECT statements are allowed");
        }

        // 禁止危险关键字
        var dangerous = java.util.Set.of("DROP", "DELETE", "TRUNCATE", "ALTER",
                                         "INSERT", "UPDATE", "CREATE", "EXEC", "EXECUTE");
        for (var keyword : dangerous) {
            if (trimmed.contains(keyword)) {
                throw new IllegalArgumentException(
                    "Dangerous SQL keyword detected: " + keyword);
            }
        }
    }

    /**
     * 校验表名（防止路径遍历）
     */
    public static void validateTableName(String tableName) {
        if (tableName == null || tableName.isBlank()) {
            throw new IllegalArgumentException("Table name cannot be empty");
        }
        if (!tableName.matches("^[a-zA-Z_][a-zA-Z0-9_]*$")) {
            throw new IllegalArgumentException("Invalid table name format: " + tableName);
        }
    }

    /**
     * 参数数量限制
     */
    public static void validateParamCount(java.util.List<?> params, int maxParams) {
        if (params != null && params.size() > maxParams) {
            throw new IllegalArgumentException(
                "Too many parameters: " + params.size() + " (max: " + maxParams + ")");
        }
    }
}
```

### 4.3 调用审计

```java
// AuditLogger.java
public class AuditLogger {

    private static final java.util.logging.Logger logger =
        java.util.logging.Logger.getLogger("mcp-audit");

    /**
     * 记录每次工具调用
     */
    public record AuditEntry(
        String toolName,
        java.util.Map<String, Object> arguments,
        String clientId,
        java.time.Instant timestamp,
        boolean success,
        String errorMessage
    ) {}

    private static final java.util.List<AuditEntry> auditLog =
        java.util.Collections.synchronizedList(new java.util.ArrayList<>());

    public static void log(String toolName, java.util.Map<String, Object> args,
                           String clientId, boolean success, String error) {
        var entry = new AuditEntry(
            toolName,
            sanitize(args),  // 脱敏处理
            clientId,
            java.time.Instant.now(),
            success,
            error
        );
        auditLog.add(entry);
        logger.info("AUDIT: " + entry);
    }

    private static java.util.Map<String, Object> sanitize(
            java.util.Map<String, Object> args) {
        // 移除敏感字段如密码、Token
        var sanitized = new java.util.HashMap<>(args);
        sanitized.keySet().removeIf(k ->
            k.toLowerCase().contains("password") ||
            k.toLowerCase().contains("token") ||
            k.toLowerCase().contains("secret")
        );
        return java.util.Map.copyOf(sanitized);
    }

    public static java.util.List<AuditEntry> getAuditLog() {
        return java.util.List.copyOf(auditLog);
    }
}
```

## 五、MCP Apps概念

### 5.1 什么是MCP App

MCP Apps是MCP生态中相对较新的概念，它的提出是为了解决"如何复用和组合多个MCP Server能力"的问题。随着MCP生态的繁荣，出现了大量MCP Server——从数据库查询到文件操作、从日历管理到邮件发送。每个Server独立工作没有问题，但当一个AI应用需要同时使用多个Server的能力时，问题就出现了：如何管理多个连接？如何协调跨Server的操作？如何确保整体安全性？

MCP App正是为解决这些痛点而设计的。一个MCP App将多个MCP Server的能力聚合在一起，对外暴露为一个"超级Server"。它不仅仅是简单的代理转发，而是在聚合的基础上提供了编排能力，允许定义跨Server的工作流。

### 5.2 核心特性

MCP App的关键特性包括以下几个方面：

**聚合（Aggregation）**：MCP App可以将多个独立MCP Server的Tool和Resource组合在一起，对外暴露统一的API。例如，一个"数据分析MCP App"可以聚合PostgreSQL MCP Server（数据查询）、ClickHouse MCP Server（实时分析）、S3 MCP Server（结果存储）的能力。

**编排（Orchestration）**：MCP App可以定义Tool之间的调用顺序和数据流转。例如，先调用数据库查询Tool获取原始数据，再调用数据分析Tool处理数据，最后调用文件存储Tool保存结果。编排逻辑在App层面实现，对Client透明。

**隔离（Isolation）**：每个MCP App在独立的安全沙箱中运行。App可以限制某些Tool的访问权限，或者对参数进行转换/过滤后再转发。这种隔离机制使得不同用户或不同场景可以使用同一个底层MCP Server，但具有不同的权限和限制。

**分发（Distribution）**：MCP App可以打包为一个独立的分发单元，包含所有依赖的MCP Server配置、编排逻辑和安全策略。开发者可以像发布npm包或Docker镜像一样发布MCP App。

### 5.3 当前状态

MCP App目前仍处于早期规范制定阶段，官方的Java SDK对MCP App的直接支持尚不完善。在实际项目中，可以通过以下方式实现类似MCP App的效果：使用MCP Server作为代理层，手持多个MCP Client连接到不同的后端Server，在代理层实现Tool的聚合和编排逻辑。这种模式虽然不如原生MCP App优雅，但已经在多个生产项目中得到验证。

### 5.4 典型使用场景

**场景一：企业数据门户**。一个MCP App聚合了多个内部数据源的MCP Server——MySQL（业务数据）、Elasticsearch（日志搜索）、Redis（缓存查询），对外暴露统一的查询接口。AI应用无需关心数据来自哪个底层系统。

**场景二：智能运维助手**。MCP App聚合了Kubernetes MCP Server（容器管理）、Prometheus MCP Server（监控查询）、PagerDuty MCP Server（告警管理），提供统一的运维操作和查询能力。运维人员通过自然语言即可执行复杂的运维任务。

**场景三：研发效能平台**。MCP App聚合了Jira MCP Server（项目管理）、GitHub MCP Server（代码仓库）、Jenkins MCP Server（CI/CD），为开发团队提供一站式研发协作能力。

## 六、完整示例：Database MCP Server

以下是完整的Database MCP Server实现，包含Tools和Resources：

```java
// DatabaseMcpServer.java - 完整可运行的Database MCP Server
package com.example.mcp.server;

import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.transport.StdioServerTransport;
import io.modelcontextprotocol.spec.McpSchema;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.*;

/**
 * 完整Database MCP Server实现
 * Tools: query_table, describe_table, list_tables, db_stats
 * Resources: schema://tables/{name}, schema://status
 * 
 * 运行方式: java -jar database-mcp-server.jar
 * MCP Client通过stdio子进程通信连接此Server
 */
public class DatabaseMcpServer {

    // 模拟数据库连接池
    private static final DataSource dataSource = HikariDataSourceFactory.create();

    public static void main(String[] args) {
        var server = buildServer();
        
        // 注册优雅关闭
        Runtime.getRuntime().addShutdownHook(
            Thread.ofVirtual().unstarted(() -> {
                System.out.println("Shutting down Database MCP Server...");
                server.closeGracefully();
            })
        );

        // 通过stdio启动
        var transport = new StdioServerTransport();
        server.connect(transport).join();
        
        System.err.println("Database MCP Server v2.3.0 started (stdio)");
    }

    private static McpServer buildServer() {
        var server = McpServer.sync(
            McpServer.ServerInfo.create("database-mcp-server", "2.3.0")
        )
        .capabilities(McpSchema.ServerCapabilities.builder()
            .tools(true)
            .resources(true, true)
            .build())
        .build();

        // ===== Tools 注册 =====

        // Tool 1: query_table - 执行SELECT查询
        server.addTool(McpServerFeatures.SyncToolSpecification.builder()
            .name("query_table")
            .description("在数据库表中执行只读SELECT查询。仅支持SELECT语句。支持参数化查询防止SQL注入。")
            .inputSchema(McpSchema.JsonSchema.builder()
                .type("object")
                .property("sql", McpSchema.JsonSchema.builder()
                    .type("string")
                    .description("SELECT查询语句，可使用?占位符")
                    .build())
                .property("params", McpSchema.JsonSchema.builder()
                    .type("array")
                    .description("查询参数，按顺序替换SQL中的?占位符")
                    .items(McpSchema.JsonSchema.builder().type("string").build())
                    .build())
                .property("limit", McpSchema.JsonSchema.builder()
                    .type("integer")
                    .description("返回最大行数，默认100，最大1000")
                    .defaultValue(100)
                    .build())
                .required(List.of("sql"))
                .build())
            .handler((exchange, request) -> {
                var sql = (String) request.arguments().get("sql");
                @SuppressWarnings("unchecked")
                var params = (List<String>) request.arguments().getOrDefault("params", List.of());
                var limit = ((Number) request.arguments().getOrDefault("limit", 100)).intValue();
                
                // 安全校验
                ParameterValidator.validateSql(sql);
                ParameterValidator.validateParamCount(params, 20);
                limit = Math.min(limit, 1000);
                
                // 自动追加LIMIT
                if (!sql.toUpperCase().contains("LIMIT")) {
                    sql = sql + " LIMIT " + limit;
                }
                
                // 执行查询
                var result = executeQuery(sql, params);
                
                // 审计
                AuditLogger.log("query_table", request.arguments(), 
                    exchange.getClientId(), true, null);
                
                return McpSchema.CallToolResult.builder()
                    .content(List.of(
                        McpSchema.TextContent.builder()
                            .text(formatQueryResult(result))
                            .build()
                    ))
                    .build();
            })
            .build());

        // Tool 2: describe_table - 查看表结构
        server.addTool(McpServerFeatures.SyncToolSpecification.builder()
            .name("describe_table")
            .description("获取指定数据库表的结构信息，包括列名、数据类型、是否可空、默认值、注释等。")
            .inputSchema(McpSchema.JsonSchema.builder()
                .type("object")
                .property("tableName", McpSchema.JsonSchema.builder()
                    .type("string")
                    .description("要查看的表名")
                    .build())
                .required(List.of("tableName"))
                .build())
            .handler((exchange, request) -> {
                var tableName = (String) request.arguments().get("tableName");
                ParameterValidator.validateTableName(tableName);
                
                var schema = getTableSchema(tableName);
                AuditLogger.log("describe_table", request.arguments(),
                    exchange.getClientId(), true, null);
                
                return McpSchema.CallToolResult.builder()
                    .content(List.of(
                        McpSchema.TextContent.builder()
                            .text(JacksonUtils.toJson(schema))
                            .build()
                    ))
                    .build();
            })
            .build());

        // Tool 3: list_tables - 列出所有表
        server.addTool(McpServerFeatures.SyncToolSpecification.builder()
            .name("list_tables")
            .description("列出数据库中所有的表名及简要描述")
            .inputSchema(McpSchema.JsonSchema.builder()
                .type("object")
                .property("schema", McpSchema.JsonSchema.builder()
                    .type("string")
                    .description("数据库schema名，默认为public")
                    .defaultValue("public")
                    .build())
                .build())
            .handler((exchange, request) -> {
                var schemaName = (String) request.arguments()
                    .getOrDefault("schema", "public");
                var tables = listAllTables(schemaName);
                
                return McpSchema.CallToolResult.builder()
                    .content(List.of(
                        McpSchema.TextContent.builder()
                            .text(JacksonUtils.toJson(tables))
                            .build()
                    ))
                    .build();
            })
            .build());

        // Tool 4: db_stats - 数据库统计信息
        server.addTool(McpServerFeatures.SyncToolSpecification.builder()
            .name("db_stats")
            .description("获取数据库整体统计信息：总表数、总行数估算、连接数等")
            .inputSchema(McpSchema.JsonSchema.builder()
                .type("object")
                .properties(Map.of())
                .build())
            .handler((exchange, request) -> {
                var stats = Map.of(
                    "totalTables", 42,
                    "estimatedTotalRows", 1_250_000L,
                    "activeConnections", 8,
                    "uptime", "72h 15m",
                    "version", "PostgreSQL 17.2",
                    "timestamp", Instant.now().toString()
                );
                
                return McpSchema.CallToolResult.builder()
                    .content(List.of(
                        McpSchema.TextContent.builder()
                            .text(JacksonUtils.toJson(stats))
                            .build()
                    ))
                    .build();
            })
            .build());

        // ===== Resources 注册 =====

        // Resource 1: 服务器状态
        server.addResource(McpServerFeatures.SyncResourceSpecification.builder()
            .uri("schema://status")
            .name("数据库连接状态")
            .description("返回MCP Server当前的数据库连接状态和健康信息")
            .mimeType("application/json")
            .handler(exchange -> {
                var status = Map.of(
                    "connected", true,
                    "serverVersion", "2.3.0",
                    "databaseVersion", "PostgreSQL 17.2",
                    "poolSize", 10,
                    "activeConnections", 3,
                    "uptime", "72h 15m"
                );
                return McpSchema.ReadResourceResult.builder()
                    .contents(List.of(
                        McpSchema.TextResourceContents.builder()
                            .uri("schema://status")
                            .mimeType("application/json")
                            .text(JacksonUtils.toJson(status))
                            .build()
                    ))
                    .build();
            })
            .build());

        // Resource Template: 动态表结构
        server.addResourceTemplate(
            McpServerFeatures.SyncResourceTemplateSpecification.builder()
                .uriTemplate("schema://tables/{tableName}")
                .name("表结构详情")
                .description("获取指定表(tableName)的完整结构定义，包括所有列信息、索引、约束")
                .mimeType("application/json")
                .handler((exchange, request) -> {
                    var tableName = request.pathVariables().get("tableName");
                    ParameterValidator.validateTableName(tableName);
                    
                    var tableInfo = getTableFullInfo(tableName);
                    
                    return McpSchema.ReadResourceResult.builder()
                        .contents(List.of(
                            McpSchema.TextResourceContents.builder()
                                .uri("schema://tables/" + tableName)
                                .mimeType("application/json")
                                .text(JacksonUtils.toJson(tableInfo))
                                .build()
                        ))
                        .build();
                })
                .build());

        return server;
    }

    // ===== 模拟数据库操作 =====

    record ColumnInfo(String name, String type, boolean nullable, 
                      String defaultValue, String comment) {}

    record TableInfo(String name, List<ColumnInfo> columns, 
                     List<String> indexes, List<String> constraints) {}

    static QueryResult executeQuery(String sql, List<String> params) {
        // 模拟查询：实际应使用JDBC PreparedStatement
        var columns = List.of("id", "name", "email", "created_at");
        var rows = new ArrayList<List<Object>>();
        for (int i = 1; i <= 5; i++) {
            rows.add(List.of(i, "User " + i, "user" + i + "@example.com",
                Instant.now().minus(java.time.Duration.ofDays(i)).toString()));
        }
        return new QueryResult(columns, rows, rows.size(), sql);
    }

    record QueryResult(List<String> columns, List<List<Object>> rows, 
                       int rowCount, String executedSql) {}

    static String formatQueryResult(QueryResult result) {
        var sb = new StringBuilder();
        sb.append("SQL: ").append(result.executedSql()).append("\n");
        sb.append("Rows: ").append(result.rowCount()).append("\n");
        sb.append("Columns: ").append(String.join(", ", result.columns())).append("\n");
        sb.append("---\n");
        for (var row : result.rows()) {
            sb.append(String.join(" | ", 
                row.stream().map(Object::toString).toList())).append("\n");
        }
        return sb.toString();
    }

    static List<Map<String, String>> listAllTables(String schema) {
        return List.of(
            Map.of("name", "users", "description", "用户信息表", "rows", "10,230"),
            Map.of("name", "orders", "description", "订单记录表", "rows", "52,481"),
            Map.of("name", "products", "description", "产品目录表", "rows", "1,024")
        );
    }

    static List<ColumnInfo> getTableSchema(String tableName) {
        return switch (tableName) {
            case "users" -> List.of(
                new ColumnInfo("id", "BIGINT", false, "auto_increment", "主键"),
                new ColumnInfo("name", "VARCHAR(100)", false, null, "用户名"),
                new ColumnInfo("email", "VARCHAR(255)", false, null, "邮箱地址"),
                new ColumnInfo("status", "VARCHAR(20)", true, "'active'", "状态"),
                new ColumnInfo("created_at", "TIMESTAMP", false, "CURRENT_TIMESTAMP", "创建时间")
            );
            case "orders" -> List.of(
                new ColumnInfo("id", "BIGINT", false, "auto_increment", "主键"),
                new ColumnInfo("user_id", "BIGINT", false, null, "用户ID外键"),
                new ColumnInfo("total", "DECIMAL(10,2)", false, null, "订单总额"),
                new ColumnInfo("status", "VARCHAR(20)", false, "'pending'", "订单状态")
            );
            default -> throw new IllegalArgumentException("Unknown table: " + tableName);
        };
    }

    static Map<String, Object> getTableFullInfo(String tableName) {
        return Map.of(
            "name", tableName,
            "columns", getTableSchema(tableName),
            "indexes", List.of("idx_" + tableName + "_status", "idx_" + tableName + "_created_at"),
            "constraints", List.of("pk_" + tableName, "fk_" + tableName + "_user_id")
        );
    }
}

// ===== 辅助工厂类 =====
class HikariDataSourceFactory {
    static DataSource create() {
        // 返回模拟DataSource，实际应配置HikariCP
        return null; // 示例中不实现真实连接
    }
}

// ===== JSON工具类 =====
class JacksonUtils {
    private static final com.fasterxml.jackson.databind.ObjectMapper mapper =
        new com.fasterxml.jackson.databind.ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    static String toJson(Object obj) {
        try {
            return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(obj);
        } catch (Exception e) {
            return "{\"error\": \"" + e.getMessage() + "\"}";
        }
    }
}
```

## 七、常见问题与最佳实践

### 7.1 架构设计类

**Q1: stdio Transport中如何处理Server崩溃？**

使用进程监控机制，Client检测到子进程退出后自动重启。配合指数退避策略防止频繁重启：

```java
var retryCount = 0;
var maxRetries = 5;
while (retryCount < maxRetries) {
    try {
        var transport = new StdioClientTransport(params);
        var client = McpClient.sync(transport).build();
        client.initialize();
        // 使用client...
        break;
    } catch (Exception e) {
        retryCount++;
        var backoff = (long) Math.pow(2, retryCount) * 1000;
        Thread.sleep(backoff);
    }
}
```

**Q2: 如何处理大结果集？**

MCP协议建议对大数据集使用分页。Tool应支持limit/offset参数，或使用Resource的流式读取。避免单次返回超过1000行数据。对于超大结果集的场景（如导出全表数据），建议采用异步模式：Tool接受任务后立即返回taskId，Client通过轮询获取处理进度。

**Q3: Server端状态管理？**

MCP Server的设计原则是Stateless——每个请求应独立处理，不依赖之前的请求状态。对于需要持久状态的场景（如数据库连接池、配置缓存），使用单例模式或依赖注入在Server生命周期内管理。连接级别的状态（如用户认证信息）可以通过Transport层的元数据传递，但不建议在Server内部维护复杂的会话状态。

**Q4: 多个MCP Client如何共享一个MCP Server？**

在HTTP Transport模式下，Server天然支持多Client连接。每个HTTP请求是独立的，Server可以通过连接池管理并发。需要注意的问题是资源隔离：一个Client的大查询可能影响其他Client的响应时间。建议配置请求超时、设置并发限制、使用独立的数据库连接。

在stdio模式下，一个Server进程只能与一个Client通信。如果需要多Client共享，可以引入一个代理进程：代理通过stdio连接Server，再通过HTTP暴露给多个Client。

### 7.2 性能优化类

**Q5: 如何使用Virtual Threads优化MCP Server吞吐量？**

JDK 25的Virtual Threads是MCP Server的理想并发模型。每个Tool调用可以在独立的Virtual Thread中执行，无需担心线程池耗尽。典型的配置方式：

```java
// 在MCP Server中使用Virtual Threads
var server = McpServer.async(serverInfo)  // 使用async模式
    .executor(Executors.newVirtualThreadPerTaskExecutor())
    .build();
```

Virtual Threads的优势在IO密集型场景中尤为明显——例如数据库查询MCP Server，大部分时间在等待数据库响应，使用Virtual Threads可以用极少的内存开销支持数千个并发Tool调用。

**Q6: MCP Tool的响应时间优化？**

- 对于查询类Tool，确保底层查询有合适的索引
- 对于计算类Tool，考虑缓存热点查询结果（带有合理的TTL）
- 对于大数据量Tool，使用流式返回或分页
- 监控每个Tool的P99响应时间，针对性优化

### 7.3 安全类

**Q7: 如何防止LLM通过MCP执行危险操作？**

这是一个多层次的安全问题。第一层是Server端的权限控制——Tool应拒绝执行危险操作（如SQL DROP TABLE）。第二层是Host端的用户确认——在Claude Desktop等Host中，用户可以配置哪些Tool需要每次确认。第三层是LLM的指令约束——在System Prompt中明确禁止生成危险操作。

最佳实践是"默认拒绝"原则：Tool默认只提供只读操作，任何写操作都需要在Server端和Host端双重授权。

**Q8: MCP Server如何防止数据泄露？**

- 资源访问使用最小权限原则：Server连接数据库时使用的账号只授予必要的表/列权限
- 参数校验防止注入攻击：SQL查询使用参数化查询，文件路径防止目录遍历
- 敏感数据脱敏：在Tool返回结果中自动脱敏手机号、邮箱、身份证号等
- 审计日志记录所有数据访问操作，支持事后追溯

### 7.4 部署运维类

**Q9: 生产环境部署建议？**

- 使用HTTP Transport替代stdio，便于负载均衡和监控
- 为每个MCP Server设置资源限制（内存、CPU），使用Docker/Kubernetes部署
- 实现健康检查端点（`/health`、`/ready`）
- 配置请求超时（推荐30秒）和重试策略（最多3次）
- 启用审计日志和Prometheus监控指标
- 使用API Gateway统一管理MCP Server的认证、限流、路由

**Q10: MCP版本升级的兼容性策略？**

MCP协议版本通过`protocolVersion`协商。Server应支持多个版本的Client（或在初始化时拒绝不兼容的Client）。Tool的inputSchema变更应向后兼容——新增字段设置为可选，删除字段前保留一个过渡期。建议在Agent Card中同时运行新旧版本的Server，使用灰度发布策略逐步迁移Client。

### 7.5 调试与测试类

**Q11: 如何调试MCP Server？**

在stdio模式下，Server的`System.out`被用于JSON-RPC通信，因此调试日志必须写到`System.err`。常用的调试技巧：使用环境变量控制日志级别；在开发阶段使用HTTP Transport（可以用curl直接测试）；使用MCP Inspector工具可视化测试Tool和Resource。

**Q12: MCP Tool的单元测试怎么写？**

由于MCP Tool本质上是普通Java方法（接受参数Map、返回CallToolResult），它们可以直接进行单元测试，无需启动完整的MCP Server。集成测试可以使用MCP SDK提供的TestUtilities启动内存中的Server和Client。

---

## 基础协议：JSON Schema与OpenAPI

在深入理解 MCP 协议细节之前，有必要掌握其底层依赖的两个基础规范：JSON Schema 和 OpenAPI。MCP 的 Tool 参数定义、Structured Output 输出格式均基于 JSON Schema；MCP 的整体设计理念与 OpenAPI 高度相通。

**JSON Schema** 是一种用于描述 JSON 数据结构的声明式规范（IETF draft）。在 MCP 中，每个 Tool 的 `inputSchema` 字段就是一个 JSON Schema 对象，定义了该工具接受的参数名称、类型、是否必填、默认值等约束。

JSON Schema 的核心关键字：
- `type`：数据类型（string, number, integer, boolean, array, object, null）
- `properties`：对象的属性定义，每个属性的值本身也是一个 JSON Schema
- `required`：必填字段数组
- `enum`：枚举值约束
- `oneOf` / `anyOf` / `allOf`：逻辑组合（如参数可以是字符串或数字）
- `$ref`：引用复用，避免重复定义（如 `"$ref": "#/definitions/address"`）
- `description`：字段说明，供 LLM 理解参数语义

**OpenAPI 规范**（原 Swagger）是 RESTful API 的描述标准，定义了 API 端点、请求/响应格式、认证方式等。虽然 MCP 不是 RESTful 协议，但其概念模型与 OpenAPI 惊人地相似：MCP 的 `tools/list` 方法返回 Tool 列表，相当于 OpenAPI 的 `GET /openapi.json` 返回所有 API 操作；MCP 的 `tools/call` 执行具体工具，相当于 OpenAPI 的 API 端点调用。

理解这种对应关系有助于快速上手 MCP——如果你熟悉 OpenAPI，就可以将 MCP Server 理解为"为 AI 优化的 API 网关"，将 MCP Tool 理解为"带 AI 级别语义描述的 API 端点"。

```java
// JDK 25 + Spring Boot 4.x — JSON Schema / OpenAPI 定义示例

// === 示例1：JSON Schema 定义一个数据库查询 Tool 的参数 ===
public class DatabaseQueryToolSchema {
    public static String getInputSchema() {
        return """
        {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "要执行的SQL查询语句（仅支持SELECT）"
            },
            "params": {
              "type": "array",
              "items": { "type": "string" },
              "description": "查询参数数组，按 ? 占位符顺序"
            },
            "maxRows": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1000,
              "default": 100,
              "description": "返回的最大行数"
            },
            "database": {
              "type": "string",
              "enum": ["production_replica", "analytics", "archive"],
              "default": "analytics",
              "description": "目标数据库"
            }
          },
          "required": ["query"]
        }
        """;
    }
}

// === 示例2：OpenAPI 规范定义一个 Agent API 端点 ===
// 文件：agent-api-openapi.yaml（Spring Boot 4.x 中通过 OpenAPI bean 暴露）
import io.swagger.v3.oas.models.*;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.*;
import io.swagger.v3.oas.models.parameters.*;
import io.swagger.v3.oas.models.responses.*;
import io.swagger.v3.oas.models.security.*;
import io.swagger.v3.oas.models.PathItem.*;
import io.swagger.v3.oas.models.Paths;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AgentOpenApiConfig {

    @Bean
    public OpenAPI agentOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("Agent Platform API")
                .version("2.0.0")
                .description("多Agent平台的HTTP API，同时暴露为MCP Server"))
            .addSecurityItem(new SecurityRequirement()
                .addList("bearerAuth"))
            .paths(new Paths()
                .addPathItem("/agents/{agentId}/tasks", new PathItem()
                    .post(new Operation()
                        .operationId("createAgentTask")
                        .summary("向指定Agent提交任务")
                        .requestBody(new RequestBody()
                            .required(true)
                            .content(new Content()
                                .addMediaType("application/json",
                                    new MediaType()
                                        .schema(new Schema<>()
                                            .addProperty("prompt",
                                                new StringSchema()
                                                    .description("任务描述"))
                                            .addProperty("maxSteps",
                                                new IntegerSchema()
                                                    .defaultValue(10))))))
                        .responses(new ApiResponses()
                            .addApiResponse("200", new ApiResponse()
                                .description("任务提交成功")
                                .content(new Content()
                                    .addMediaType("application/json",
                                        new MediaType()
                                            .schema(new Schema<>()
                                                .addProperty("taskId",
                                                    new StringSchema())
                                                .addProperty("status",
                                                    new StringSchema()
                                                        ._enum(List.of(
                                                            "pending", "running",
                                                            "completed", "failed"))))))))
                        .addParametersItem(new Parameter()
                            .name("agentId")
                            .in("path")
                            .required(true)
                            .schema(new StringSchema()))))));
    }
}

// === 示例3：JSON Schema → MCP Tool 注册 ===
// 将 JSON Schema 参数定义注册为 MCP Tool
public class McpToolRegistrationDemo {
    public static void main(String[] args) {
        var server = McpServer.builder()
            .serverInfo("db-query-server", "1.0.0")
            .transport(new HttpServletTransport(8080))
            .capabilities(ToolCapabilities.of(true, false))
            .build();

        server.addTool(new Tool(
            "database_query",
            "在指定数据库中执行只读SQL查询",
            DatabaseQueryToolSchema.getInputSchema()
        ), params -> {
            var query = (String) params.get("query");
            var maxRows = params.getOrDefault("maxRows", 100);
            System.out.println("执行查询: " + query + " (maxRows=" + maxRows + ")");
            return new CallToolResult("查询结果: [{id:1, name:'Alice'}]", false);
        });

        System.out.println("MCP Server 已启动，支持 1 个 Tool");
    }

    record Tool(String name, String description, String inputSchema) {}
    record CallToolResult(String content, boolean isError) {}
    record ToolCapabilities(boolean listChanged, boolean supportsStreaming) {
        static ToolCapabilities of(boolean lc, boolean ss) {
            return new ToolCapabilities(lc, ss);
        }
    }

    static class McpServer {
        static Builder builder() { return new Builder(); }
        static class Builder {
            Builder serverInfo(String n, String v) { return this; }
            Builder transport(Object t) { return this; }
            Builder capabilities(ToolCapabilities c) { return this; }
            McpServer build() { return new McpServer(); }
        }
        void addTool(Tool t, java.util.function.Function<Map<String, Object>, CallToolResult> h) {}
    }

    static class HttpServletTransport {
        HttpServletTransport(int port) {}
    }
}
```

掌握 JSON Schema 和 OpenAPI 之后，MCP 就不再是"全新的协议"，而是"为 AI 交互场景精心设计的 JSON-RPC 协议，底层借用了成熟的模式定义和 API 描述标准"。这种连续性使得团队可以快速将现有 OpenAPI 服务包装为 MCP Server，实现从传统 API 到 AI Agent 的无缝升级。

---

**关键要点**：
- MCP的Host/Client/Server三层模型实现了关注点分离
- stdio适合本地场景，HTTP适合远程生产部署
- Tools/Resources/Prompts三种原语覆盖了AI应用的主要交互模式
- Java SDK提供了完善的Sync/Async API，配合Virtual Threads可获得极佳并发性能
- 安全性是生产部署的首要考虑：白名单、参数校验、审计缺一不可
