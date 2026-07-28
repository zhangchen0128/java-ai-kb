---
domain: 03-Java应用平台
title: WebSocket与gRPC通信
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
    url: https://docs.spring.io/spring-framework/reference/web/websocket.html
    description: Spring WebSocket Reference — WebSocketHandler, STOMP, SockJS
  - level: L1
    url: https://grpc.io/docs/languages/java/
    description: gRPC Java Official Documentation — proto definition, stubs, streaming modes
  - level: L0
    url: https://datatracker.ietf.org/doc/html/rfc6455
    description: WebSocket Protocol (RFC 6455)
  - level: L2
    url: https://github.com/grpc/grpc-java
    description: gRPC Java source code and examples
relations:
  prerequisite:
    - 03-Spring核心IoC-AOP-事务
    - 01-计算机网络
  related:
    - 03-SpringMVC与SSE流式输出
    - 13-MCP协议与JavaSDK
tags:
  - websocket
  - grpc
  - protobuf
  - stomp
  - sockjs
  - streaming
  - bidirectional
  - ai-agent
created: 2026-07-20
updated: 2026-07-20
content_type: practice
---

# WebSocket 与 gRPC 通信

## 概述

HTTP 请求-响应模型已无法满足现代应用对实时双向通信的需求。AI Agent 需要持续的流式响应、实时状态推送、多模态数据传输，传统的轮询和长轮询方案在延迟和资源消耗上都捉襟见肘。

本文覆盖两大实时通信技术——**WebSocket**（基于 HTTP 升级的全双工协议，适合浏览器和轻量级场景）和 **gRPC**（基于 HTTP/2 和 Protocol Buffers 的高性能 RPC 框架，适合微服务间通信），以及它们在 AI 场景中的典型应用，并给出明确的选型决策树。

---

## 一、WebSocket

### 1.1 协议升级：HTTP to WebSocket

WebSocket 连接建立过程：

```
Client                                    Server
  |                                          |
  |--- HTTP GET /chat                        |
  |    Upgrade: websocket                    |
  |    Connection: Upgrade                   |
  |    Sec-WebSocket-Key: dGhlIHNhbXBsZQ==   |
  |    Sec-WebSocket-Version: 13 ----------->|
  |                                          |
  |<-- HTTP/1.1 101 Switching Protocols -----|
  |    Upgrade: websocket                    |
  |    Connection: Upgrade                   |
  |    Sec-WebSocket-Accept: s3pPLMBiTx...   |
  |                                          |
  |<========== WebSocket 全双工通道 ========>|
```

连接一旦建立，双方可以随时发送消息，无需重建连接或携带 HTTP 头。

### 1.2 Spring WebSocket：基础版

```java
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        System.out.println("Client connected: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message)
            throws Exception {
        var payload = message.getPayload();
        System.out.printf("Received from %s: %s%n", session.getId(), payload);

        // 回复消息给发送方
        session.sendMessage(new TextMessage("Echo: " + payload));

        // 广播消息给所有连接
        for (var s : sessions.values()) {
            if (s.isOpen() && !s.getId().equals(session.getId())) {
                s.sendMessage(new TextMessage("Broadcast: " + payload));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        System.out.println("Client disconnected: " + session.getId());
    }
}

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new ChatWebSocketHandler(), "/ws/chat")
                .setAllowedOrigins("*");
    }
}
```

### 1.3 Spring STOMP：消息代理模式

STOMP（Simple Text Oriented Messaging Protocol）是 WebSocket 之上的子协议，提供发布-订阅和点对点消息模型：

```java
// 配置 STOMP 消息代理
@Configuration
@EnableWebSocketMessageBroker
public class StompConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // 客户端订阅 /topic 开头的目标（广播）
        registry.enableSimpleBroker("/topic", "/queue");
        // 客户端发送消息到 /app 开头的目标
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/stomp-chat")
                .setAllowedOrigins("*")
                .withSockJS(); // SockJS 降级支持
    }
}

// 控制器：处理 STOMP 消息
@Controller
public class StompChatController {

    // 处理客户端发送到 /app/chat 的消息
    @MessageMapping("/chat")
    @SendTo("/topic/messages") // 广播到所有订阅 /topic/messages 的客户端
    public ChatMessage handleChat(ChatMessage message, Principal principal) {
        message.setSender(principal.getName());
        message.setTimestamp(LocalDateTime.now());
        return message;
    }

    // 点对点消息
    @MessageMapping("/private")
    public void handlePrivate(ChatMessage message, SimpMessageHeaderAccessor accessor) {
        var destination = "/queue/private-" + message.getRecipient();
        messagingTemplate.convertAndSendToUser(
            message.getRecipient(), "/queue/private", message);
    }
}
```

### 1.4 心跳机制

```java
// 服务端心跳配置
@Configuration
@EnableWebSocketMessageBroker
public class StompConfig implements WebSocketMessageBrokerConfigurer {
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic")
                .setHeartbeatValue(new long[]{10000, 10000}); // 客户端→服务端，服务端→客户端（ms）
    }
}
```

**心跳作用：**
- 保持连接活跃（防止代理/负载均衡关闭空闲连接）
- 检测死连接（及时清理失效的 WebSocket Session）
- 对用户透明（STOMP 客户端自动管理心跳）

### 1.5 SockJS 降级

当浏览器或网络代理不支持 WebSocket 时，SockJS 自动降级为以下方案：

```
优先级（从高到低）：
1. WebSocket（原生）
2. XHR Streaming（HTTP 流）
3. XHR Polling（HTTP 长轮询）
4. JSONP Polling
```

客户端使用 SockJS 库即可自动适配。

---

## 二、WebSocket 在 AI 场景中的应用

### 2.1 流式对话（替代 SSE 的长连接方案）

```java
@Controller
public class AiChatController {

    private final ChatModelPort chatModel;

    // WebSocket 版流式对话
    @MessageMapping("/ai/chat")
    public void handleAiChat(ChatRequest request, SimpMessageHeaderAccessor accessor) {
        var sessionId = accessor.getSessionId();
        var userDestination = "/queue/ai-response-" + sessionId;

        // 通过 Virtual Thread 处理长期运行的流式调用
        Thread.ofVirtual().start(() -> {
            try (var stream = chatModel.stream(request.message())) {
                stream.forEach(chunk -> {
                    messagingTemplate.convertAndSendToUser(
                        sessionId, "/queue/ai-response", chunk);
                });
                // 发送结束标记
                messagingTemplate.convertAndSendToUser(
                    sessionId, "/queue/ai-response",
                    ChatChunk.endOfStream());
            }
        });
    }
}
```

### 2.2 实时 Agent 状态推送

```java
@Service
public class AgentStatusService {

    private final SimpMessagingTemplate messagingTemplate;

    // Agent 执行过程中实时推送状态更新
    public void notifyAgentState(String agentId, AgentState state) {
        // state 可以是：thinking, calling_tool, tool_completed, generating_response
        messagingTemplate.convertAndSend(
            "/topic/agent/" + agentId + "/state",
            new AgentStateUpdate(agentId, state, LocalDateTime.now())
        );
    }

    public void notifyToolExecution(String agentId, String toolName, Map<String, Object> params) {
        messagingTemplate.convertAndSend(
            "/topic/agent/" + agentId + "/tool",
            new ToolExecutionEvent(agentId, toolName, params)
        );
    }
}
```

---

## 三、gRPC

### 3.1 Protocol Buffers 定义

```protobuf
// chat.proto
syntax = "proto3";

package com.example.chat;

option java_multiple_files = true;
option java_package = "com.example.chat.grpc";

// 消息定义
message ChatRequest {
    string user_id = 1;
    string message = 2;
    string model = 3;
}

message ChatResponse {
    string content = 1;
    bool is_final = 2;
    string finish_reason = 3;
    int32 token_count = 4;
}

// 服务定义
service ChatService {
    // 一元调用：发送消息，获取完整响应
    rpc Chat(ChatRequest) returns (ChatResponse);

    // 服务端流：发送消息，获取流式响应
    rpc StreamChat(ChatRequest) returns (stream ChatResponse);

    // 客户端流：上传多个文件，获取处理结果
    rpc UploadFiles(stream FileChunk) returns (UploadResult);

    // 双向流：实时对话
    rpc BidiChat(stream ChatRequest) returns (stream ChatResponse);
}
```

### 3.2 四种通信模式

| 模式 | 客户端 | 服务端 | 典型场景 |
|------|--------|--------|----------|
| **Unary** | 发送1条 | 返回1条 | 普通 API 调用 |
| **Server Streaming** | 发送1条 | 返回多条 | AI 流式响应、文件下载 |
| **Client Streaming** | 发送多条 | 返回1条 | 文件上传、批量数据处理 |
| **Bidirectional** | 发送多条 | 返回多条 | 实时对话、音视频通话 |

### 3.3 Spring gRPC 集成

```java
// 服务端实现
@GrpcService
public class ChatServiceImpl extends ChatServiceGrpc.ChatServiceImplBase {

    @Override
    public void streamChat(ChatRequest request,
                           StreamObserver<ChatResponse> responseObserver) {
        try {
            // 调用 AI 模型流式接口
            var stream = chatModel.stream(request.getMessage());
            stream.forEach(chunk -> {
                var response = ChatResponse.newBuilder()
                    .setContent(chunk.content())
                    .setIsFinal(chunk.isFinal())
                    .setFinishReason(chunk.finishReason())
                    .build();
                responseObserver.onNext(response);
            });
            responseObserver.onCompleted();
        } catch (Exception e) {
            responseObserver.onError(Status.INTERNAL
                .withDescription("AI service error: " + e.getMessage())
                .asRuntimeException());
        }
    }
}

// 客户端调用
@GrpcClient("chat-service")
private ChatServiceGrpc.ChatServiceStub asyncStub;

public void streamChat(String message) {
    var request = ChatRequest.newBuilder()
        .setUserId("user-123")
        .setMessage(message)
        .build();

    asyncStub.streamChat(request, new StreamObserver<>() {
        @Override
        public void onNext(ChatResponse response) {
            System.out.print(response.getContent());
            if (response.getIsFinal()) {
                System.out.println("\n[Finished: " + response.getFinishReason() + "]");
            }
        }

        @Override
        public void onError(Throwable t) {
            System.err.println("RPC failed: " + t.getMessage());
        }

        @Override
        public void onCompleted() {
            System.out.println("\nStream completed");
        }
    });
}
```

### 3.4 gRPC 拦截器

```java
// 认证拦截器
public class AuthInterceptor implements ServerInterceptor {
    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        var token = headers.get(Metadata.Key.of("Authorization",
            Metadata.ASCII_STRING_MARSHALLER));
        if (token == null || !validateToken(token)) {
            call.close(Status.UNAUTHENTICATED
                .withDescription("Invalid or missing token"), new Metadata());
            return new ServerCall.Listener<>() {};
        }
        return next.startCall(call, headers);
    }
}

// 日志/监控拦截器
public class MetricsInterceptor implements ServerInterceptor {
    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        var startTime = System.nanoTime();
        var listener = next.startCall(call, headers);
        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(listener) {
            @Override
            public void onComplete() {
                var elapsed = (System.nanoTime() - startTime) / 1_000_000;
                System.out.printf("[gRPC] %s completed in %dms%n",
                    call.getMethodDescriptor().getFullMethodName(), elapsed);
                super.onComplete();
            }
        };
    }
}
```

### 3.5 gRPC Gateway：HTTP 代理

gRPC 不适合浏览器直接调用（浏览器不支持 HTTP/2 Trailers），使用 gRPC Gateway 提供 RESTful JSON API 作为代理：

```yaml
# grpc-gateway 配置（将 gRPC 方法映射为 HTTP 端点）
# POST /v1/chat → ChatService.Chat
# GET /v1/chat/stream → ChatService.StreamChat (SSE)
```

---

## 四、WebSocket vs SSE vs gRPC vs 轮询 选型决策树

```
通信需求分析：

需要服务端主动推送？
├── 否 → 传统 HTTP REST 即可
└── 是 → 通信方向？
    ├── 仅服务端→客户端（单向流）
    │   ├── 浏览器端？ → SSE（简单、自动重连、HTTP/2 友好）
    │   └── 微服务间？ → gRPC Server Streaming
    ├── 双向通信
    │   ├── 浏览器端？
    │   │   ├── 需要二进制数据？ → WebSocket
    │   │   ├── 需要 pub/sub 消息模式？ → WebSocket + STOMP
    │   │   └── 仅文本 JSON → SSE + POST 组合（简单场景）
    │   └── 微服务间？
    │       ├── 需要强类型契约？ → gRPC Bidirectional Streaming
    │       ├── 需要高性能低延迟？ → gRPC（基于 HTTP/2）
    │       └── 需要代理/负载均衡友好？ → gRPC 或 WebSocket
    └── 仅客户端→服务端（上传流）→ gRPC Client Streaming

特殊场景：
├── 需要浏览器兼容性（无法升级 WebSocket）？ → SockJS（自动降级）
├── 需要多语言互操作？ → gRPC（.proto 生成多语言代码）
├── 需要穿透防火墙/代理？ → SSE（纯 HTTP），gRPC（需 HTTP/2 支持）
└── AI 流式对话？ → SSE（简单）或 WebSocket（需要双向）
```

**AI 场景推荐：**
- 模型流式响应 → SSE（最简方案）
- Agent 实时状态推送 → WebSocket + STOMP
- 模型推理服务间通信 → gRPC
- 知识库文件上传进度 → WebSocket
- MCP Streamable HTTP Transport → SSE

---

## 常见问题

**Q: Spring WebSocket 如何处理横向扩展？**
A: 使用外部消息代理（RabbitMQ/Redis）替代 SimpleBroker。Spring Session 管理用户会话。所有实例订阅同一个消息代理，消息广播到所有实例。

```java
// 使用 RabbitMQ 作为 STOMP 外部代理
registry.enableStompBrokerRelay("/topic", "/queue")
    .setRelayHost("localhost")
    .setRelayPort(61613);
```

**Q: gRPC 的负载均衡如何实现？**
A: gRPC 基于 HTTP/2 长连接，传统 L4 负载均衡器无法按请求分发。解决方案：1) 客户端负载均衡（推荐，如 gRPC Name Resolver + LoadBalancer）；2) L7 代理（Envoy/Linkerd）；3) Kubernetes Headless Service。

**Q: WebSocket 的连接数上限是多少？**
A: 受操作系统文件描述符限制。单机通常支持数万到数十万连接（Linux 默认 1024 / 进程，需调大 `ulimit -n`）。Java NIO（Netty/Tomcat）使用 select/epoll 可支持百万级连接。

**Q: SSE 和 WebSocket 在 AI 流式场景如何选择？**
A: 优先 SSE：更简单的实现、自动重连、浏览器原生 EventSource API。WebSocket 仅在需要双向通信时使用（如用户中途打断生成、上传文件同时获取流式回复）。

---

## 相关条目

- [[03-SpringMVC与SSE流式输出]]：SSE 流式输出的实现
- [[13-MCP协议与JavaSDK]]：MCP 的 Streamable HTTP Transport
- [[08-OpenAI兼容协议详解]]：OpenAI 兼容协议的流式事件模型
- [[01-计算机网络]]：HTTP/2、TLS 基础
