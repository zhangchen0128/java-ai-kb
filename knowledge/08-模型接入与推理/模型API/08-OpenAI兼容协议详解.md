---
domain: 08-模型接入与推理
title: OpenAI Compatible Protocol
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
  code_status: tested
  lab: lab-rag-pipeline
  evidence:
    scope: article-core
    source_files:
      - labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag-pipeline/ChunkerDemo.java
    test_files:
      - labs/lab-rag-pipeline/src/test/java/com/javaai/kb/labs/rag-pipeline/ChunkerDemoTest.java
level: intermediate
sources:
  - level: L1
    url: https://platform.openai.com/docs/api-reference/chat
    description: OpenAI Chat Completions API Reference
  - level: L1
    url: https://docs.anthropic.com/en/api/messages
    description: Anthropic Messages API Reference
  - level: L1
    url: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_Operations_Amazon_Bedrock_Runtime.html
    description: AWS Bedrock Converse API Reference
  - level: L1
    url: https://ai.google.dev/gemini-api/docs
    description: Google Gemini API Reference
relations:
  prerequisite:
    - 07-推理策略与评估方法
  related:
    - 08-云模型API与SDK使用
    - 08-本地推理与Ollama
    - 08-模型能力矩阵与路由策略
tags:
  - openai
  - api
  - chat-completions
  - tool-calling
  - streaming
  - sse
  - structured-output
created: 2026-07-17
updated: 2026-07-17
content_type: concept
---

# OpenAI Compatible Protocol

## 概述

OpenAI 的 Chat Completions API 已成为 LLM 接入的事实标准协议。几乎所有的模型提供商（从 Anthropic 到 Ollama 到 vLLM）都支持这一协议或其变体。掌握这一协议，就等于掌握了与任何 LLM 交互的通用语言。本条目从请求结构、流式事件、Tool Calling、Structured Output 到多 Provider 差异，全面深入剖析。

## Chat Completions API 详解

### 请求结构

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [...],
  "stream": false,
  "tools": [...],
  "tool_choice": "auto",
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 4096,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "stop": ["\n\n\n"],
  "seed": 42,
  "response_format": { "type": "json_object" }
}
```

**各参数详解：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| model | string | 是 | 模型标识符 (gpt-4o, gpt-4o-mini) |
| messages | array | 是 | 对话消息列表，按时间顺序排列 |
| stream | boolean | 否 | 是否流式返回 (SSE) |
| tools | array | 否 | 可用函数/工具定义列表 |
| tool_choice | string/object | 否 | 工具选择策略 (auto/none/required/指定) |
| temperature | float | 否 | 采样温度 (0-2)，默认 1 |
| top_p | float | 否 | Nucleus 采样阈值 (0-1)，默认 1 |
| max_tokens | int | 否 | 最大输出 token 数 |
| max_completion_tokens | int | 否 | (新) 最大完成 token 数，取代 max_tokens |
| frequency_penalty | float | 否 | 频率惩罚 (-2~2) |
| presence_penalty | float | 否 | 存在惩罚 (-2~2) |
| stop | string/array | 否 | 停止序列 |
| seed | int | 否 | 尽力保证确定性输出 |
| response_format | object | 否 | 输出格式控制 |
| n | int | 否 | 返回几个候选完成 (默认1) |
| logprobs | boolean | 否 | 是否返回对数概率 |
| top_logprobs | int | 否 | 每个位置返回前N个token的概率 |

### 消息角色

```
消息类型与角色：

┌──────────────┬───────────────────────────────────────────────────────┐
│ 角色         │ 含义和用法                                             │
├──────────────┼───────────────────────────────────────────────────────┤
│ system       │ 系统级指令，定义AI的整体行为、边界、语气               │
│              │ 位置：消息列表的第一条                                │
│              │ 示例："你是一个专业的Java技术顾问，只回答..."          │
├──────────────┼───────────────────────────────────────────────────────┤
│ user         │ 用户输入，代表人类的消息                               │
│              │ 可包含文本、图片（多模态）内容                        │
├──────────────┼───────────────────────────────────────────────────────┤
│ assistant    │ AI的历史回复                                          │
│              │ 可包含普通文本或 tool_calls                            │
│              │ 用于提供对话上下文                                     │
├──────────────┼───────────────────────────────────────────────────────┤
│ tool         │ 工具执行的结果，必须对应之前的 tool_calls              │
│              │ 每个 tool 消息必须携带 tool_call_id                    │
└──────────────┴───────────────────────────────────────────────────────┘
```

**完整对话示例的 JSON 结构：**

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "你是Java智能助手。使用工具查询数据。"},
    {"role": "user", "content": "查询用户123的订单"},
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {"name": "query_orders", "arguments": "{\"userId\": \"123\"}"}
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"orders\": [{\"id\": 1, \"amount\": 99.9}]}"
    },
    {"role": "assistant", "content": "用户123有1笔订单，金额99.9元。"}
  ]
}
```

### 响应结构

```java
public record ChatCompletionResponse(
    String id,                           // 唯一请求ID
    String object,                       // "chat.completion"
    long created,                        // Unix时间戳
    String model,                        // 实际使用的模型
    List<Choice> choices,                // 候选回复列表
    CompletionUsage usage                // Token使用量
) {
    public record Choice(
        int index,                       // 候选序号
        ChatMessage message,             // 完整消息 (非流式)
        MessageDelta delta,              // 增量消息 (流式)
        String finishReason              // 结束原因
    ) {}

    public record ChatMessage(
        String role,                     // "assistant"
        String content,                  // 文本内容
        List<ToolCall> toolCalls,        // 工具调用
        String refusal                   // 安全拒绝原因 (如有)
    ) {}

    public record ToolCall(
        String id,                       // 工具调用ID
        String type,                     // "function"
        FunctionCall function            // 函数名和参数
    ) {}

    public record FunctionCall(
        String name,                     // 函数名
        String arguments                 // JSON字符串参数
    ) {}

    public record CompletionUsage(
        int promptTokens,                // 输入token数
        int completionTokens,            // 输出token数
        int totalTokens,                 // 总token数
        CompletionTokensDetails completionTokensDetails  // (新)细分
    ) {}

    public record CompletionTokensDetails(
        int reasoningTokens,             // 推理token (如o1系列)
        int acceptedPredictionTokens,
        int rejectedPredictionTokens
    ) {}

    public record MessageDelta(
        String role,
        String content,                  // 增量文本
        List<ToolCall> toolCalls         // 增量工具调用
    ) {}

    /** Finish Reason 含义 */
    public enum FinishReason {
        STOP,           // 正常结束（遇到停止条件或EOS）
        LENGTH,         // 达到 max_tokens 限制
        TOOL_CALLS,     // 模型决定调用工具
        CONTENT_FILTER,  // 内容被过滤（安全策略）
        FUNCTION_CALL   // 旧版函数调用
    }
}
```

### 流式响应（SSE）

流式响应使用 Server-Sent Events (SSE) 格式。这是实时输出、改善用户体验的关键机制。

**请求：** 将 `stream: true`

**SSE 事件格式：**

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Java"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"虚拟"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"线程"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**关键规则：**
- 每条 `data:` 行是一个 JSON 事件
- 最后一条是 `data: [DONE]`（特殊标记，不是 JSON）
- `delta` 是增量内容，`message` 是完整内容（两者互斥）
- 第一个 chunk 可能包含 `delta.role: "assistant"`（角色声明）
- 最后一个 chunk 的 `finish_reason` 非 null

**Java SSE 解析器：**

```java
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.Flow;
import java.util.function.Consumer;

/**
 * 流式 Chat Completion 的 SSE 解析
 */
public class ChatCompletionSSEParser {

    /**
     * 发起流式请求并逐块处理
     */
    public static void streamChatCompletion(
            String apiKey,
            String model,
            List<Map<String, Object>> messages,
            Consumer<String> onToken,          // 每收到一个文本增量
            Consumer<String> onComplete,       // 流结束
            Consumer<Throwable> onError) {

        var requestBody = Map.of(
            "model", model,
            "messages", messages,
            "stream", true,
            "temperature", 0.7d
        );

        // 使用 Virtual Threads 处理
        Thread.ofVirtual().start(() -> {
            try {
                var client = HttpClient.newHttpClient();
                var request = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.openai.com/v1/chat/completions"))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                        new com.fasterxml.jackson.databind.ObjectMapper()
                            .writeValueAsString(requestBody)))
                    .build();

                var response = client.send(request,
                    HttpResponse.BodyHandlers.ofLines());

                response.body().forEach(line -> {
                    if (line.startsWith("data: ") && !line.equals("data: [DONE]")) {
                        var data = line.substring(6);
                        try {
                            // 解析 delta content
                            var node = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readTree(data);
                            var choices = node.get("choices");
                            if (choices != null && choices.size() > 0) {
                                var delta = choices.get(0).get("delta");
                                if (delta != null && delta.has("content")) {
                                    onToken.accept(delta.get("content").asText());
                                }
                            }
                        } catch (Exception e) {
                            // 忽略解析失败的行
                        }
                    } else if (line.equals("data: [DONE]")) {
                        onComplete.accept("DONE");
                    }
                });

            } catch (Exception e) {
                onError.accept(e);
            }
        });
    }

    /**
     * 使用示例
     */
    public static void main(String[] args) throws InterruptedException {
        var sb = new StringBuilder();
        streamChatCompletion(
            System.getenv("OPENAI_API_KEY"),
            "gpt-4o-mini",
            List.of(Map.of("role", "user", "content", "用Java写一个Hello World")),
            token -> {
                System.out.print(token);
                sb.append(token);
            },
            done -> System.out.println("\n--- 流结束 ---\n完整内容: " + sb),
            error -> error.printStackTrace()
        );

        Thread.sleep(30000); // 等待 Virtual Thread 完成
    }
}
```

## Tool Calling 协议

Tool Calling（旧称 Function Calling）是 LLM API 最重要的能力之一。它让模型可以"调用"外部函数来获取信息或执行操作。

### 工具定义

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_current_weather",
        "description": "获取指定城市的当前天气",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称，如 'Beijing'"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "温度单位"
            }
          },
          "required": ["city"]
        }
      }
    }
  ]
}
```

### tool_choice 策略

| 值 | 含义 | 使用场景 |
|----|------|----------|
| "auto" (默认) | 模型自主决定是否调用工具 | 常规对话+工具 |
| "none" | 强制不调用工具 | 纯文本对话 |
| "required" | 必须调用工具 | 有明确工具需求时 |
| {"type":"function","function":{"name":"x"}} | 强制调用指定函数 | 确定的路由场景 |

### 工具调用状态机

```
多轮工具调用对话的状态转换：

          user消息
            │
            ▼
     ┌─────────────┐
     │ AI 处理     │
     └──────┬──────┘
            │
    ┌───────┴────────┐
    ▼                ▼
 text回复          tool_calls
  (完成)              │
                      ▼
              ┌──────────────┐
              │ 执行工具      │
              │ 获得结果      │
              └──────┬───────┘
                     │
                     ▼
              role: "tool"  消息
              (附带 tool_call_id)
                     │
                     ▼
              ┌──────────────┐
              │ AI 处理结果   │
              └──────┬───────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
         下一轮tool_calls   text回复
            │              (完成)
            │
            ▼
          (递归)
```

**Java 工具调用处理：**

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class ToolCallingOrchestrator {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, java.util.function.Function<Map<String, Object>, String>>
        toolRegistry = new ConcurrentHashMap<>();

    /**
     * 注册工具
     */
    public void registerTool(String name,
            String description,
            Map<String, Object> jsonSchema,
            java.util.function.Function<Map<String, Object>, String> handler) {
        toolRegistry.put(name, handler);
    }

    /**
     * 处理多轮对话直到不需要工具调用
     */
    public String processConversation(
            List<Map<String, Object>> messages,
            java.util.function.Function<List<Map<String, Object>>,
                Map<String, Object>> modelCall) {

        int maxRounds = 10;  // 防止无限循环

        for (int round = 0; round < maxRounds; round++) {
            var response = modelCall.apply(messages);
            var choices = (List<Map<String, Object>>) response.get("choices");
            var message = (Map<String, Object>) choices.get(0).get("message");

            // 检查是否有 tool_calls
            var toolCalls = (List<Map<String, Object>>) message.get("tool_calls");

            if (toolCalls == null || toolCalls.isEmpty()) {
                // 正常文本回复
                return (String) message.get("content");
            }

            // 添加 assistant 消息（含 tool_calls）
            messages.add(Map.of(
                "role", "assistant",
                "content", message.getOrDefault("content", null),
                "tool_calls", toolCalls
            ));

            // 执行每个工具调用
            for (var toolCall : toolCalls) {
                String callId = (String) toolCall.get("id");
                var function = (Map<String, Object>) toolCall.get("function");
                String funcName = (String) function.get("name");
                String argsJson = (String) function.get("arguments");

                // 执行工具
                String result;
                try {
                    var args = mapper.readValue(argsJson, Map.class);
                    var handler = toolRegistry.get(funcName);
                    result = handler != null
                        ? handler.apply(args)
                        : "{\"error\": \"Unknown function: " + funcName + "\"}";
                } catch (Exception e) {
                    result = "{\"error\": \"" + e.getMessage() + "\"}";
                }

                // 添加 tool 消息
                messages.add(Map.of(
                    "role", "tool",
                    "tool_call_id", callId,
                    "content", result
                ));
            }
        }

        throw new RuntimeException("达到最大工具调用轮数 " + maxRounds);
    }
}
```

## Structured Output

### JSON Mode

早期的输出格式控制：`response_format: { type: "json_object" }`

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "列出3本Java书籍，返回JSON"}],
  "response_format": {"type": "json_object"}
}
```

**限制：** 只保证输出是有效 JSON，不保证 JSON 结构符合特定 Schema。需要在 system prompt 中描述期望的结构。

### Structured Outputs (strict mode)

OpenAI 的 Structured Outputs 是更强约束的输出控制：

```json
{
  "model": "gpt-4o",
  "messages": [...],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "java_book_list",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "books": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "title": {"type": "string"},
                "author": {"type": "string"},
                "year": {"type": "integer"},
                "topics": {
                  "type": "array",
                  "items": {"type": "string"}
                }
              },
              "required": ["title", "author", "year", "topics"],
              "additionalProperties": false
            }
          }
        },
        "required": ["books"],
        "additionalProperties": false
      }
    }
  }
}
```

**Structured Outputs 保证：**
- 100% 符合给定的 JSON Schema
- 支持 `additionalProperties: false`（不允许额外字段）
- 支持所有 JSON Schema 类型（object, array, string, number, integer, boolean, null, enum, anyOf, allOf）

### Function Calling vs Structured Outputs 差异

```
┌──────────────────────┬─────────────────────┬──────────────────────────┐
│ 特性                 │ Function Calling    │ Structured Outputs       │
├──────────────────────┼─────────────────────┼──────────────────────────┤
│ Schema 遵从性         │ 尽力而为 (best-effort) │ 严格100%保证 (strict)  │
│ 输出的 JSON Schema   │ 自动从函数参数生成   │ 手动提供完整 Schema     │
│ tool_calls 数组       │ 使用 tool_calls     │ 不使用，content 中是JSON  │
│ 适用场景              │ 工具调用 / 函数路由 │ 结构化数据提取           │
│ 多轮对话              │ 原生支持             │ 需手动管理               │
│ 响应中的 content      │ null (工具调用时)   │ 即JSON字符串             │
└──────────────────────┴─────────────────────┴──────────────────────────┘
```

## Token 相关

### Input / Output / Reasoning Token

```
Token 分类：
  prompt_tokens:        输入消息的全部 token
  completion_tokens:    模型生成的 token
  total_tokens:         上述两项之和

新增细分 (o1 系列)：
  reasoning_tokens:     模型内部推理消耗的 token
                        （不可见，但计费）
  cached_tokens:        被 Prompt Cache 命中的输入 token
                        （通常半价或免费）
```

### Prompt Cache

**OpenAI：自动缓存**
- 自动对长 prompt 的前缀进行缓存
- 缓存命中的 token 享受 50% 折扣
- 不需要开发者做任何配置

**Anthropic：显式缓存 (cache_control)**
```json
{
  "model": "claude-sonnet-4-20250514",
  "system": [
    {
      "type": "text",
      "text": "你是一个Java专家... (一长段固定内容)",
      "cache_control": {"type": "ephemeral"}
    }
  ],
  "messages": [...]
}
```
- 在 system prompt 中标记 `cache_control: {type: "ephemeral"}`
- 缓存存活时间：5 分钟（每次使用续期）
- 缓存命中的 token 享受 90% 折扣

### Token 计数和预估

```java
public class TokenCounter {

    /**
     * 基于启发式规则的 token 预估
     * 精确计数需要专门的 tokenizer 库（如 JTokkit）
     */
    public record TokenEstimate(
        int systemTokens,
        int messagesTokens,
        int expectedOutputTokens,
        int totalInputTokens,
        int cacheableTokens
    ) {
        public int totalChargedTokens() {
            // 假设缓存命中率 80%，cache tokens 享受 50% 折扣
            int cachedCharged = (int) (cacheableTokens * 0.5 * 0.8);
            int uncached = totalInputTokens - (int) (cacheableTokens * 0.8);
            return cachedCharged + uncached + expectedOutputTokens;
        }
    }

    /**
     * 预估对话的 Token 使用量
     */
    public static TokenEstimate estimate(List<Map<String, Object>> messages,
            int expectedOutputLen) {
        int total = 0;
        int systemTokens = 0;
        int cacheableTokens = 0;

        for (var msg : messages) {
            var content = (String) msg.getOrDefault("content", "");
            int tokens = content.length() / 4;  // 粗估: 4字符≈1token

            if ("system".equals(msg.get("role"))) {
                systemTokens = tokens;
                // system prompt 通常是 cacheable 的
                cacheableTokens = tokens;
            }
            total += tokens;
        }

        int expectedOutput = expectedOutputLen / 4;

        return new TokenEstimate(
            systemTokens, total - systemTokens,
            expectedOutput, total, cacheableTokens);
    }
}
```

## Provider 差异对照表

### 认证方式

| Provider | 认证方式 | Header/参数 |
|----------|----------|-------------|
| OpenAI | API Key | `Authorization: Bearer sk-...` 或 `api-key: ...` |
| Anthropic | API Key | `x-api-key: sk-ant-...` + `anthropic-version: 2023-06-01` |
| AWS Bedrock | AWS SigV4 | AWS Access Key + Secret Key + Session Token |
| Google GenAI | API Key / OAuth2 | `x-goog-api-key: ...` 或 OAuth2 Bearer Token |
| Azure OpenAI | API Key + Resource | `api-key: ...` + URL 中包含 resource name |
| Ollama (本地) | 无 | 本地 HTTP，无需认证 |
| vLLM (本地) | 可选 | 支持 API Key 但本地常不启用 |

### 模型命名规范

| Provider | 命名示例 | 命名规范 |
|----------|----------|----------|
| OpenAI | gpt-4o, gpt-4o-mini, o1, o1-mini | 品牌-版本-变体 |
| Anthropic | claude-sonnet-4-20250514 | 品牌-层次-版本-日期 |
| AWS Bedrock | us.anthropic.claude-sonnet-4-20250514-v1:0 | 供应商.品牌.模型:版本 |
| Google | gemini-2.5-flash, gemini-2.5-pro | 模型-版本-层次 |
| Azure | gpt-4o (deployment name) | 用户自定义部署名 |
| Ollama | llama3.1:8b, qwen2:7b | 模型:参数量(:tag) |
| vLLM | "/models/llama-3-8b" | 路径映射到模型文件 |

### 速率限制策略

| Provider | 限速维度 | 典型免费/初级配额 |
|----------|----------|-------------------|
| OpenAI | RPM + TPM | 500 RPM / 200K TPM (Tier 1) |
| Anthropic | RPM + TPM | 50 RPM / 50K TPM (Tier 1) |
| AWS Bedrock | 按模型 + 区域 | 每个模型独立配额（可提升） |
| Google | RPM + TPM + RPD | 1500 RPM (免费层) |
| Azure | TPM (按部署) | 可配置 |
| Ollama | 自行控制 | 无（本地硬件限制） |

### 错误码映射

| 错误类型 | OpenAI | Anthropic | AWS Bedrock | 通用含义 |
|----------|--------|-----------|-------------|----------|
| 认证失败 | 401 | 401 | 403 | API Key 无效或过期 |
| 速率限制 | 429 | 429 | 429 / ThrottlingException | 请求过多 |
| 服务器错误 | 500/502/503 | 500/529 | 500/503 | 临时故障，可重试 |
| 上下文过长 | 400 | 400 | 400/ValidationException | 超过 context window |
| 内容过滤 | 400 (content_filter) | 400 (invalid_request) | 400 | 安全策略拒绝 |
| 模型不可用 | 404 | 404 | ResourceNotFoundException | 模型名错误或未部署 |

### 特殊参数支持

| 特性 | OpenAI | Anthropic | Google | AWS Bedrock |
|------|--------|-----------|--------|-------------|
| cache_control | 自动 | 显式标记 | context caching | 不支持 |
| reasoning_effort | o1系列支持 | extended thinking | thinking_level | 不支持 |
| logprobs | 支持 | 不支持 | 不支持 | 不支持 |
| seed | 支持 | 不支持 | 不支持 | 不支持 |
| stop_sequences | 支持 | 必须 | 支持 | 支持 |
| image (多模态) | content数组 | content数组 | content数组 | content数组 |
| thinking（推理过程可见） | o1 reasoning_tokens | extended thinking | thinking | 不支持 |

## 错误处理与重试策略

### 指数退避 + 抖动

```java
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

public class ApiRetryStrategy {

    private final int maxRetries;
    private final Duration initialBackoff;
    private final Duration maxBackoff;
    private final double jitterFactor;
    private final Set<Integer> retryableStatuses = Set.of(429, 500, 502, 503, 504);

    public ApiRetryStrategy(int maxRetries, Duration initialBackoff,
            Duration maxBackoff, double jitterFactor) {
        this.maxRetries = maxRetries;
        this.initialBackoff = initialBackoff;
        this.maxBackoff = maxBackoff;
        this.jitterFactor = jitterFactor;
    }

    /**
     * 计算第 n 次重试的等待时间
     * backoff = min(initial * 2^n, maxBackoff)
     * 加随机抖动避免惊群效应
     */
    public Duration getBackoff(int retryNumber) {
        long baseMs = initialBackoff.toMillis() * (1L << retryNumber);
        long cappedMs = Math.min(baseMs, maxBackoff.toMillis());

        // 抖动：在 [1-jitter, 1+jitter] 范围内随机
        double jitter = 1.0 + (ThreadLocalRandom.current().nextDouble() * 2 - 1) * jitterFactor;
        return Duration.ofMillis((long) (cappedMs * jitter));
    }

    /**
     * 判断状态码是否可重试
     */
    public boolean isRetryable(int httpStatus) {
        return retryableStatuses.contains(httpStatus);
    }

    /**
     * 带重试的 API 调用模板
     */
    public <T> T executeWithRetry(
            java.util.function.Supplier<T> apiCall,
            java.util.function.BiConsumer<Integer, String> errorConsumer)
            throws Exception {

        Exception lastException = null;

        for (int retry = 0; retry <= maxRetries; retry++) {
            try {
                return apiCall.get();
            } catch (ApiException e) {
                lastException = e;
                if (!isRetryable(e.getHttpStatus()) || retry == maxRetries) {
                    throw e;
                }
                var backoff = getBackoff(retry);
                errorConsumer.accept(retry + 1,
                    "Retry after " + backoff.toMillis() + "ms");
                Thread.sleep(backoff.toMillis());
            }
        }
        throw lastException;
    }

    static class ApiException extends Exception {
        private final int httpStatus;
        public ApiException(int httpStatus, String message) {
            super(message);
            this.httpStatus = httpStatus;
        }
        public int getHttpStatus() { return httpStatus; }
    }
}
```

### 幂等键

对于非幂等的工具调用（如创建订单、扣款），应使用幂等键防止重复：

```java
public class IdempotentApiCall {

    /**
     * 生成幂等键
     * 格式：{operation}-{business_id}-{timestamp_hash}
     */
    public static String generateIdempotencyKey(
            String operation, String businessId) {
        var hash = Long.toHexString(System.nanoTime());
        return STR."\{operation}-\{businessId}-\{hash.substring(hash.length() - 8)}";
    }

    /**
     * 带幂等键的 API 调用
     * 建议：使用数据库唯一约束防止重复执行业务操作
     */
    public static void executeIdempotently(
            String idempotencyKey,
            java.util.function.Consumer<String> businessLogic) {
        // 1. 检查是否已执行过
        if (isAlreadyExecuted(idempotencyKey)) {
            return;
        }
        // 2. 执行业务逻辑
        businessLogic.accept(idempotencyKey);
        // 3. 记录已执行
        markAsExecuted(idempotencyKey);
    }

    private static boolean isAlreadyExecuted(String key) {
        // 查数据库唯一索引
        return false;  // 简化
    }

    private static void markAsExecuted(String key) {
        // 写入数据库（唯一索引防止并发重复）
    }
}
```

## 最佳实践

1. **始终使用 stream=true**：除非是简单的单次调用且输出很短，否则流式返回能大幅改善用户体验（降低 TTFB 体感）
2. **system prompt 放缓存标记**：如果使用 Anthropic，长 system prompt 一定要加 `cache_control`；如果是 OpenAI，利用其自动缓存特性
3. **工具参数验证**：不要在收到 tool_calls 后直接执行——先验证参数完整性，因为模型可能产生不合法的参数
4. **优雅处理 finish_reason: "length"**：当检测到达到 max_tokens 时，考虑增加 max_tokens 或拆分请求
5. **避免混合使用不同 Provider 的特殊参数**：这些参数在跨 Provider 时不兼容，需要在适配层做转换

## 常见问题

**Q: OpenAI 兼容 = 可以用 OpenAI SDK 调用其他模型吗？**

A: 大部分可以。Ollama、vLLM、Groq、DeepSeek 都支持 `/v1/chat/completions` 端点。但特殊参数（如 o1 的 reasoning_effort、Anthropic 的 cache_control）只在原生端点可用。

**Q: 流式和非流式的 finish_reason 有什么区别？**

A: 非流式中 finish_reason 在 choices[0].finish_reason 中；流式中每个 chunk 都有 finish_reason，但只有最后一个 chunk 的值非 null。

**Q: tool_choice: "required" 和 "auto" 区别？**

A: "auto" 下模型可能选择不调用工具而直接文本回复。"required" 强制调用工具——但如果工具定义与用户输入不匹配，模型可能"编造"工具调用。

## Responses API

OpenAI Responses API 是较新的有状态 API，与经典的 Chat Completions API 在架构理念上有本质区别。Chat Completions API 是无状态的：每次请求都需要客户端手动拼接完整的消息历史，工具调用（Function Calling / Tools）的结果也需要客户端自行管理循环。Responses API 则将对话状态管理内置在服务端，开发者只需传入 `previous_response_id` 即可延续之前的对话上下文。

Responses API 的核心优势在于内置工具（Built-in Tools）的原生集成：

- **web_search**：模型可自动发起互联网搜索，返回带引用的结构化结果。适合需要实时信息的问题。
- **file_search**：基于 Vector Store 的文件检索，适用于 RAG 场景。需要预先创建 Vector Store 并上传文件。
- **code_interpreter**：Python 沙箱执行环境，支持数据处理、图表生成。适合数据分析类任务。

两者的关键区别总结：

| 维度 | Chat Completions API | Responses API |
|------|---------------------|---------------|
| 状态管理 | 无状态，客户端维护消息列表 | 有状态，服务端管理对话 |
| 工具调用 | 客户端循环管理 tool_calls | 服务端自动循环完成工具调用 |
| 多轮对话 | 每次提交完整 messages 数组 | 传入 previous_response_id 即可 |
| 内置工具 | 无，需客户端实现 | web_search / file_search / code_interpreter |
| 适用场景 | 简单对话、兼容性优先 | 工具密集型 Agent、复杂多步骤任务 |

选型建议：简单对话和需要完全控制消息流的场景使用 Chat Completions API；涉及多步工具调用、需要内置搜索或代码执行的 Agent 场景使用 Responses API。注意部分第三方模型 Provider 尚未支持 Responses API，仅 OpenAI 官方端点可用。

```java
// JDK 25 + Spring Boot 4.x: Responses API 调用示例
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;

public class ResponsesApiExample {
    private static final String API_KEY = System.getenv("OPENAI_API_KEY");
    private static final HttpClient http = HttpClient.newHttpClient();
    private static final ObjectMapper mapper = new ObjectMapper();

    public String searchAndAnswer(String question) throws Exception {
        // Responses API with web_search built-in tool
        var body = mapper.writeValueAsString(Map.of(
            "model", "gpt-4o",
            "tools", List.of(Map.of(
                "type", "web_search",
                "search_context_size", "medium"
            )),
            "input", question
        ));

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/responses"))
            .header("Authorization", "Bearer " + API_KEY)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        var json = mapper.readTree(response.body());
        // 提取模型输出和搜索引用
        var answer = json.get("output").get(0).get("content").get(0).get("text").asText();
        return answer;
    }

    // 有状态多轮：通过 previous_response_id 延续对话
    public String continueConversation(String previousResponseId, String followUp) throws Exception {
        var body = mapper.writeValueAsString(Map.of(
            "model", "gpt-4o",
            "previous_response_id", previousResponseId,
            "input", followUp
        ));
        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/responses"))
            .header("Authorization", "Bearer " + API_KEY)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        return mapper.readTree(response.body()).get("id").asText();
    }
}
```

## 相关条目

- [[08-云模型API与SDK使用]] — 各 Provider 的 Java SDK 使用
- [[08-本地推理与Ollama]] — Ollama 的 OpenAI 兼容端点
- [[08-模型能力矩阵与路由策略]] — 模型选型和路由策略
- [[09-架构抽象层设计]] — 如何抽象多 Provider 差异
