---
domain: 12-Agent工程
title: Tool Calling 完整剖析与 Spring AI 实战
status: verified
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/api/tools.html
    description: Spring AI Tool Calling 官方文档
  - level: L1
    url: https://platform.openai.com/docs/guides/function-calling
    description: OpenAI Function Calling 官方指南
  - level: L2
    url: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
    description: Anthropic Tool Use 文档
relations:
  prerequisite:
    - 09-SpringAI2深度解析
  related:
    - 12-Agent记忆与规划
tags:
  - tool-calling
  - function-calling
  - spring-ai
  - agent
  - java
created: 2026-07-17
updated: 2026-07-27
content_type: practice
verification:
  reviewed_at: 2026-07-27
  version_anchor: Spring AI 2.0.0 Tool Calling API
  code_status: tested
  lab: lab-spring-ai-tools
  evidence:
    scope: article-core
    source_files:
      - labs/lab-spring-ai-tools/src/main/java/com/javaai/kb/labs/tools/SafeToolRegistry.java
      - labs/lab-spring-ai-tools/src/main/java/com/javaai/kb/labs/tools/ToolCallingDemo.java
    test_files:
      - labs/lab-spring-ai-tools/src/test/java/com/javaai/kb/labs/tools/SafeToolRegistryTest.java
      - labs/lab-spring-ai-tools/src/test/java/com/javaai/kb/labs/tools/ToolCallingDemoTest.java
---

# Tool Calling 完整剖析与 Spring AI 实战

## 一、Tool Calling 核心概念

Tool Calling（也称 Function Calling）是 LLM 与外部世界交互的核心机制。模型不再仅仅生成文本，而是能够"调用"预定义的函数来获取实时数据、执行操作、查询数据库。这一机制将 LLM 从纯粹的文本生成器转变为能够行动的智能 Agent。

### 1.1 工具定义的 JSON Schema 规范

每个 Tool 的定义包含以下核心字段：

- **name**：工具的唯一标识符，模型据此决定调用哪个工具。命名应遵循 `verb_noun` 规范（如 `get_order`、`search_products`）。
- **description**：工具的自然语言描述，模型据此判断何时使用该工具。描述应当精确、场景清晰。
- **parameters**：JSON Schema 格式的参数定义，描述每个参数的类型、是否必填、约束条件。

```json
{
  "name": "search_customer_orders",
  "description": "根据客户手机号或邮箱查询其最近30天内的订单列表。返回订单ID、状态、金额和创建时间。",
  "parameters": {
    "type": "object",
    "properties": {
      "identifier": {
        "type": "string",
        "description": "客户的手机号或邮箱地址"
      },
      "status_filter": {
        "type": "string",
        "enum": ["pending", "shipped", "delivered", "cancelled"],
        "description": "按订单状态筛选，不传则返回所有状态"
      },
      "max_results": {
        "type": "integer",
        "description": "返回的最大订单数量，默认为10",
        "default": 10
      }
    },
    "required": ["identifier"]
  }
}
```

参数类型支持 string、number、integer、boolean、object、array。其中 enum 约束是提高模型输出准确性的关键手段——它能将模型的输出空间从无限自由文本压缩到有限选项，大幅降低 Hallucination 风险。

### 1.2 工具选择策略

Spring AI 支持四种工具选择策略：

- **auto（默认）**：模型自主判断是否需要调用工具、调用哪个工具。适用于大多数场景。
- **required**：强制模型必须调用指定工具。适用于明确知道必须执行某个操作的场景（例如用户说"查一下我的订单"，那么"查订单"工具是必须的）。
- **none**：禁止模型调用任何工具。适用于纯对话场景或需要模型只做推理不做操作的场景。
- **指定 Tool**：通过 `ChatOptions` 指定只允许调用特定名称的工具，缩小选择范围。

```java
// auto 模式：模型自主选择
var autoOptions = AnthropicChatOptions.builder()
    .withToolChoice("auto")
    .build();

// required 模式：强制指定工具
var requiredOptions = AnthropicChatOptions.builder()
    .withToolChoice("required")
    .withToolName("search_customer_orders")
    .build();

// none 模式：禁止工具调用
var noneOptions = AnthropicChatOptions.builder()
    .withToolChoice("none")
    .build();
```

### 1.3 参数填充机制与 Hallucination 风险

当模型决定调用某个工具时，它会从对话上下文中提取参数值并填充。这个过程存在几个关键风险：

1. **Hallucination 参数值**：模型可能编造不存在的参数值（例如用户没提供订单号，模型却生成了一个）。
2. **类型错误**：字符串字段被填充为数字，或必填字段被遗漏。
3. **语义偏差**：模型对参数含义的理解与开发者意图不一致。

**缓解策略**：
- 在 description 中明确说明参数的获取规则（例如"仅使用用户提供的值，如果用户没有提供则不要编造"）。
- 使用 enum 限制枚举字段，减少自由文本空间。
- 在工具执行后验证参数的合法性，将验证失败信息通过 Tool Response 返回给模型，让模型修正后重试。

### 1.4 结果处理：Tool Response 注入对话

工具执行后，结果以 `ToolResponseMessage` 的形式注入到对话历史中：

```
User → Assistant(tool_call: search_orders{phone:"13800138000"}) → Tool(result: {...}) → Assistant(final_response)
```

模型收到 Tool Response 后，将其作为新的上下文进行推理，生成最终的用户回复。这种循环可以持续多轮——模型可以连续调用多个工具，每次基于前一个工具的结果决定下一步。

### 1.5 并行 Tool Calling

当模型判断多个工具调用之间没有依赖关系时，它可以并行发起多个调用。这极大提升了响应速度：

```
User: "帮我查下订单状态和物流信息"
Assistant: [tool_call: get_order_status(order_id="X"), tool_call: query_logistics(tracking_no="Y")]
```

Spring AI 中，并行调用的工具结果会作为一个 `ToolResponseMessage` 列表传递给模型继续推理。

## 二、Spring AI Tool Calling 深度解析

### 2.1 @Tool 注解与 @ToolParam

Spring AI 提供了声明式的工具定义方式：

```java
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
public class OrderTools {

    @Tool(description = "根据客户手机号或邮箱查询其最近订单列表")
    public List<OrderSummary> searchCustomerOrders(
            @ToolParam(description = "客户的手机号或邮箱地址") String identifier,
            @ToolParam(description = "按订单状态筛选") String statusFilter,
            @ToolParam(description = "返回的最大订单数量，默认10") Integer maxResults) {

        if (maxResults == null) maxResults = 10;
        return orderService.findOrders(identifier, statusFilter, maxResults);
    }

    @Tool(description = "对指定订单发起退款申请，退款金额不能超过订单实付金额")
    public RefundResult initiateRefund(
            @ToolParam(description = "要退款的订单ID") String orderId,
            @ToolParam(description = "退款金额（单位：元）") double amount,
            @ToolParam(description = "退款原因") String reason) {

        if (amount <= 0) {
            throw new ToolExecutionException("退款金额必须大于0");
        }
        return refundService.createRefund(orderId, amount, reason);
    }

    @Tool(description = "根据运单号查询物流轨迹信息")
    public LogisticsInfo trackShipment(
            @ToolParam(description = "物流运单号") String trackingNumber) {

        return logisticsService.queryTracking(trackingNumber);
    }

    @Tool(description = "将当前会话转接给人工客服，需提供转接原因和紧急程度")
    public TransferResult transferToHumanAgent(
            @ToolParam(description = "转接原因") String reason,
            @ToolParam(description = "紧急程度：low/medium/high/critical") String urgency) {

        return new TransferResult(humanQueueService.enqueue(reason, urgency));
    }
}
```

### 2.2 ToolCallback 接口与 ToolRegistry

对于需要动态注册工具的场景，可以实现 `ToolCallback` 接口：

```java
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.metadata.ToolMetadata;

@Component
public class DynamicOrderTool implements ToolCallback {

    @Override
    public ToolDefinition getToolDefinition() {
        return ToolDefinition.builder()
            .name("get_order_detail")
            .description("根据订单ID获取订单完整详情，包含商品明细、收货地址、支付信息")
            .inputSchema("""
                {
                  "type": "object",
                  "properties": {
                    "orderId": {
                      "type": "string",
                      "description": "订单唯一标识符"
                    }
                  },
                  "required": ["orderId"]
                }
                """)
            .build();
    }

    @Override
    public ToolMetadata getToolMetadata() {
        return ToolMetadata.builder()
            .returnDirect(true)
            .build();
    }

    @Override
    public String call(String toolInput) {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        try {
            var node = json.readTree(toolInput);
            var orderId = node.get("orderId").asText();
            var order = orderService.getDetail(orderId);
            return json.writeValueAsString(order);
        } catch (Exception e) {
            return "{\"error\": \"查询订单失败: " + e.getMessage() + "\"}";
        }
    }
}
```

### 2.3 自定义 ToolResolver

```java
@Configuration
public class ToolConfiguration {

    @Bean
    public ToolCallbackResolver customToolResolver(
            List<ToolCallback> registeredTools) {

        return new ToolCallbackResolver() {
            @Override
            public ToolCallback resolve(String toolName) {
                return registeredTools.stream()
                    .filter(t -> t.getToolDefinition().name().equals(toolName))
                    .findFirst()
                    .orElseThrow(() -> 
                        new IllegalArgumentException("未找到工具: " + toolName));
            }
        };
    }
}
```

## 三、工具设计最佳实践

### 3.1 命名规范

遵循 `verb_noun` 模式，前缀清晰表达操作类型：

| 前缀 | 含义 | 示例 |
|------|------|------|
| `get_` / `query_` | 只读查询 | `get_order`, `query_customer_info` |
| `search_` | 搜索/查找 | `search_products`, `search_faq` |
| `create_` | 创建资源 | `create_order`, `create_ticket` |
| `update_` | 修改资源 | `update_shipping_address` |
| `delete_` / `cancel_` | 删除/取消 | `cancel_order`, `delete_cart_item` |
| `send_` | 发送通知 | `send_email`, `send_sms_verification` |

### 3.2 描述清晰原则

- 描述中明确工具的使用场景（"当用户询问..."）。
- 说明参数的业务含义，而非技术含义。
- 标注副作用（"该操作将实际扣款"）。
- 标注权限要求（"需要管理员权限"）。

### 3.3 参数设计原则

- **参数尽量少**：参数越多，模型填充出错的概率越大。超过5个参数的工具应拆分。
- **enum 比 string 好**：能用 enum 限制的字段绝对不要用自由 string。
- **提供默认值**：非必填参数应提供合理默认值，减少模型决策负担。
- **幂等性**：写操作应设计为幂等——同一请求重复调用不应产生重复副作用。

```java
@Tool(description = "创建退款单，该操作幂等：同一笔订单多次请求不会重复退款")
public RefundResult createRefund(
        @ToolParam(description = "订单ID") String orderId,
        @ToolParam(description = "退款原因类型") 
            @ToolParamEnum({"quality_issue", "wrong_item", "not_as_described", "customer_request"}) 
            String reasonType,
        @ToolParam(description = "退款备注（可选）") String note) {
    
    // 幂等检查：如果该订单已有进行中的退款，直接返回
    var existingRefund = refundService.findByOrderId(orderId);
    if (existingRefund.isPresent()) {
        return existingRefund.get();
    }
    return refundService.create(orderId, reasonType, note);
}
```

## 四、完整客服 Agent 代码示例

下面构建一个完整的客服 Agent，包含订单查询、退款、物流追踪、人工转接四个工具。

### 4.1 数据模型

```java
// OrderSummary.java
package com.example.agent.model;

import java.time.LocalDateTime;
import java.util.List;

public record OrderSummary(
    String orderId,
    String status,
    double totalAmount,
    String trackingNumber,
    LocalDateTime createdAt,
    List<OrderItem> items
) {}

public record OrderItem(
    String productName,
    int quantity,
    double unitPrice
) {}

public record RefundResult(
    String refundId,
    String orderId,
    double amount,
    String status,
    String message
) {}

public record LogisticsInfo(
    String trackingNumber,
    String carrier,
    String currentLocation,
    String status,
    List<TrackingEvent> events
) {}

public record TrackingEvent(
    LocalDateTime timestamp,
    String location,
    String description
) {}

public record TransferResult(
    String ticketId,
    int queuePosition,
    int estimatedWaitMinutes
) {}
```

### 4.2 工具定义类

```java
// CustomerServiceTools.java
package com.example.agent.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.tool.annotation.ToolParamEnum;
import org.springframework.stereotype.Component;
import com.example.agent.model.*;
import com.example.agent.service.*;
import java.util.List;

@Component
public class CustomerServiceTools {

    private final OrderService orderService;
    private final RefundService refundService;
    private final LogisticsService logisticsService;
    private final HumanQueueService humanQueueService;

    public CustomerServiceTools(OrderService orderService, RefundService refundService,
                                 LogisticsService logisticsService, HumanQueueService humanQueueService) {
        this.orderService = orderService;
        this.refundService = refundService;
        this.logisticsService = logisticsService;
        this.humanQueueService = humanQueueService;
    }

    @Tool(description = """
        查询客户的订单列表。
        使用场景：用户询问"我的订单"、"查订单"、"最近买了什么"时调用。
        注意：identifier 必须由用户明确提供，不要编造。
        """)
    public List<OrderSummary> searchCustomerOrders(
            @ToolParam(description = "客户手机号或邮箱，必须是用户明确提供的") String identifier,
            @ToolParam(description = "订单状态筛选")
            @ToolParamEnum({"pending", "shipped", "delivered", "cancelled"})
            String statusFilter,
            @ToolParam(description = "最大返回数，默认5") Integer maxResults) {

        int limit = maxResults != null ? maxResults : 5;
        return orderService.findByCustomer(identifier, statusFilter, limit);
    }

    @Tool(description = """
        对指定订单发起退款。
        使用场景：用户明确要求退款、退货时调用。
        该操作幂等，重复调用不会产生多次退款。
        """)
    public RefundResult initiateRefund(
            @ToolParam(description = "要退款的订单ID") String orderId,
            @ToolParam(description = "退款金额") double amount,
            @ToolParam(description = "退款原因类型")
            @ToolParamEnum({"quality_issue", "wrong_item", "not_as_described", "customer_request"})
            String reasonType,
            @ToolParam(description = "客户补充说明") String customerNote) {

        return refundService.createRefund(orderId, amount, reasonType, customerNote);
    }

    @Tool(description = """
        查询物流轨迹。
        使用场景：用户询问"到哪了"、"物流状态"、"什么时候到"时调用。
        需要先通过 searchCustomerOrders 获取运单号。
        """)
    public LogisticsInfo trackShipment(
            @ToolParam(description = "物流运单号") String trackingNumber) {

        return logisticsService.queryTracking(trackingNumber);
    }

    @Tool(description = """
        将对话转接给人工客服。
        使用场景：机器人无法解决问题、用户明确要求人工服务、涉及敏感操作时调用。
        """)
    public TransferResult transferToHuman(
            @ToolParam(description = "转接原因：给人工客服看的摘要")
            String reason,
            @ToolParam(description = "紧急程度")
            @ToolParamEnum({"low", "medium", "high", "critical"})
            String urgency) {

        return humanQueueService.enqueue(reason, urgency);
    }
}
```

### 4.3 Agent 配置与聊天控制器

```java
// AgentConfiguration.java
package com.example.agent.config;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.util.List;

@Configuration
public class AgentConfiguration {

    @Bean
    public ChatClient customerServiceAgent(
            ChatClient.Builder chatClientBuilder,
            List<ToolCallback> toolCallbacks) {

        return chatClientBuilder
            .defaultSystem("""
                你是一个专业的电商客服助手。请遵循以下规则：
                1. 使用工具前，先确认获取了必要的用户信息（如手机号/订单号）
                2. 工具返回数据后，用友好的语气总结给用户
                3. 如果工具执行失败，向用户说明原因并尝试替代方案
                4. 涉及退款、取消等敏感操作，必须与用户二次确认
                5. 遇到无法解决的问题，主动转接人工客服
                """)
            .defaultTools(toolCallbacks)
            .defaultAdvisors(new SimpleLoggerAdvisor())
            .build();
    }
}
```

```java
// ChatController.java
package com.example.agent.controller;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

@RestController
@RequestMapping("/api/agent")
public class ChatController {

    private final ChatClient agent;

    public ChatController(ChatClient customerServiceAgent) {
        this.agent = customerServiceAgent;
    }

    @PostMapping("/chat")
    public String chat(@RequestBody ChatRequest request) {
        return agent.prompt()
            .user(request.message())
            .call()
            .content();
    }

    @PostMapping("/chat/stream")
    public Flux<String> chatStream(@RequestBody ChatRequest request) {
        return agent.prompt()
            .user(request.message())
            .stream()
            .content();
    }
}

record ChatRequest(String message, String sessionId) {}
```

### 4.4 服务层实现

```java
// OrderService.java
package com.example.agent.service;

import com.example.agent.model.OrderSummary;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class OrderService {

    // 模拟数据库
    private final Map<String, List<OrderSummary>> customerOrders = new HashMap<>();

    public List<OrderSummary> findByCustomer(String identifier, String statusFilter, int limit) {
        var orders = customerOrders.getOrDefault(identifier, List.of());
        var stream = orders.stream();
        if (statusFilter != null && !statusFilter.isBlank()) {
            stream = stream.filter(o -> o.status().equalsIgnoreCase(statusFilter));
        }
        return stream.limit(limit).toList();
    }
}
```

```java
// HumanQueueService.java
package com.example.agent.service;

import com.example.agent.model.TransferResult;
import org.springframework.stereotype.Service;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class HumanQueueService {

    private final AtomicInteger ticketCounter = new AtomicInteger(1000);
    private final AtomicInteger queueSize = new AtomicInteger(0);

    public TransferResult enqueue(String reason, String urgency) {
        int position = queueSize.incrementAndGet();
        int ticketId = ticketCounter.incrementAndGet();
        int estimatedWait = switch (urgency) {
            case "critical" -> 1;
            case "high" -> 3;
            case "medium" -> 10;
            default -> 20;
        };
        return new TransferResult("TK-" + ticketId, position, estimatedWait);
    }
}
```

### 4.5 错误处理

工具执行异常的处理至关重要。当工具抛出异常时，Spring AI 会捕获并将异常信息返回给模型，模型据此向用户解释或尝试其他方案：

```java
@Component
public class ResilientRefundService {

    @Tool(description = "安全退款：自动处理余额不足等异常情况")
    public RefundResult safeRefund(
            @ToolParam(description = "订单ID") String orderId,
            @ToolParam(description = "退款金额") double amount) {

        try {
            return doRefund(orderId, amount);
        } catch (InsufficientBalanceException e) {
            throw new ToolExecutionException(
                "退款失败：账户余额不足，当前余额" + e.getBalance() + 
                "元。请告知用户并建议联系财务。");
        } catch (OrderAlreadyRefundedException e) {
            throw new ToolExecutionException(
                "该订单已经退款过（退款ID：%s），请告知用户无需重复操作。"
                    .formatted(e.getExistingRefundId()));
        }
    }
}
```

## 五、常见问题

**Q: 模型总是调用错误的工具怎么办？**
A: 检查工具描述是否过于宽泛/相似。两个工具如果描述都包含"查询订单"，模型很难区分。应精确描述差异场景。

**Q: 模型填充的参数值不对怎么办？**
A: 在参数 description 中加约束语句"仅使用用户明确提供的值"，在工具实现中做参数校验并将详细错误信息返回。

**Q: 如何限制 Token 消耗？**
A: 减少工具数量和参数数量。工具太多（超过20个）会显著增加系统提示的 Token 消耗。工具参数控制在5个以内。

**Q: 工具调用超时怎么办？**
A: 设置合理的超时时间（5-10秒），超时后返回简洁的错误信息让模型决定重试还是告知用户。

---

**总结**：Tool Calling 是构建实用 Agent 的核心能力。Spring AI 通过 `@Tool` 注解和 `ToolCallback` 接口提供了灵活的集成方式。掌握工具的定义规范、选择策略和错误处理，就能构建出可靠的 AI Agent 系统。
