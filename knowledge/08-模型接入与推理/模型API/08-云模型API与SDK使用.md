---
domain: "08-模型接入与推理"
title: "Cloud Model APIs"
status: "draft"
level: "intermediate"
sources:
  - level: "L1"
    url: "https://platform.openai.com/docs/api-reference"
    description: "OpenAI API Reference"
  - level: "L1"
    url: "https://docs.anthropic.com/en/api"
    description: "Anthropic API Reference"
  - level: "L1"
    url: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html"
    description: "AWS Bedrock Converse API"
  - level: "L1"
    url: "https://ai.google.dev/gemini-api/docs"
    description: "Google GenAI API Reference"
  - level: "L1"
    url: "https://learn.microsoft.com/en-us/azure/ai-services/openai/"
    description: "Azure OpenAI Documentation"
relations:
  prerequisite: ["08-OpenAI兼容协议详解"]
  related: ["08-本地推理与Ollama", "08-模型能力矩阵与路由策略", "09-架构抽象层设计"]
tags: ["openai", "anthropic", "bedrock", "gemini", "azure", "java-sdk", "provider"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Cloud Model APIs

## 概述

本条目提供各主流云模型提供的 Java SDK 使用指南，包含完整可运行的代码示例。重点是：OpenAI Java SDK、Anthropic Java SDK、AWS Bedrock、Google GenAI、Azure AI。每个 SDK 覆盖客户端构建、Chat Completion、Tool Calling、流式响应、异常处理、超时配置。

## 多 Provider 的统一抽象模式

在深入各 SDK 之前，先理解为什么要抽象：

```
                    ┌──────────────────────────┐
                    │     业务代码层            │
                    │   (不依赖任何SDK)          │
                    └────────────┬─────────────┘
                                 │ 依赖
                    ┌────────────▼─────────────┐
                    │   ChatModelPort (接口)    │
                    └──────┬──────┬──────┬─────┘
                           │      │      │
              ┌────────────▼┐ ┌──▼───┐ ┌▼──────────┐
              │ OpenAI Adapter│ │Anthr │ │Bedrock    │
              │              │ │Adapt │ │Adapter    │
              └──────────────┘ └──────┘ └───────────┘

优势：
  1. 框架锁定保护：切换 Provider 只需换 Adapter
  2. 测试简单：mock Port 接口即可
  3. 团队协作：不同团队负责不同 Adapter
```

> 详细抽象层设计参考 [[09-架构抽象层设计]]

## OpenAI Java SDK

### 依赖配置

```xml
<dependency>
    <groupId>com.openai</groupId>
    <artifactId>openai-java</artifactId>
    <version>0.20.0</version>  <!-- 检查最新版本 -->
</dependency>
```

### 基本 Chat Completion

```java
import com.openai.client.OpenAiClient;
import com.openai.client.okhttp.OpenAiOkHttpClient;
import com.openai.models.chat.completions.*;
import java.util.List;

public class OpenAiSdkExample {

    public static OpenAiClient createClient() {
        return OpenAiOkHttpClient.builder()
            .apiKey(System.getenv("OPENAI_API_KEY"))
            .build();
    }

    /**
     * 基本对话调用
     */
    public static String basicChat(OpenAiClient client) {
        var params = ChatCompletionCreateParams.builder()
            .model("gpt-4o-mini")
            .messages(List.of(
                ChatCompletionMessageParam.ofSystem(
                    "你是一个Java技术顾问"),
                ChatCompletionMessageParam.ofUser(
                    "用一句话解释Virtual Threads")
            ))
            .temperature(0.7d)
            .maxTokens(200)
            .build();

        var response = client.chat().completions().create(params);

        return response.choices().get(0).message().content().orElse("");
    }

    public static void main(String[] args) {
        var client = createClient();
        try {
            System.out.println(basicChat(client));
        } finally {
            client.close();
        }
    }
}
```

### Tool Calling

```java
import com.openai.core.JsonObject;
import com.openai.models.chat.completions.*;
import java.util.Map;

public class OpenAiToolCalling {

    record WeatherInfo(String city, double temperature, String condition) {}

    /**
     * 天气查询工具示例
     */
    public static void toolCallingExample(OpenAiClient client) {
        var weatherTool = ChatCompletionTool.builder()
            .function(FunctionDefinition.builder()
                .name("get_weather")
                .description("获取指定城市的天气")
                .parameters(SchemaDefinition.of(
                    JsonObject.from(Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "city", Map.of(
                                "type", "string",
                                "description", "城市名称"
                            ),
                            "unit", Map.of(
                                "type", "string",
                                "enum", List.of("celsius", "fahrenheit")
                            )
                        ),
                        "required", List.of("city")
                    ))
                ))
                .build())
            .build();

        var messages = new java.util.ArrayList<>(List.of(
            ChatCompletionMessageParam.ofSystem("你是一个天气助手"),
            ChatCompletionMessageParam.ofUser("北京今天天气怎么样？")
        ));

        int maxRounds = 5;
        for (int round = 0; round < maxRounds; round++) {
            var params = ChatCompletionCreateParams.builder()
                .model("gpt-4o")
                .messages(messages)
                .tools(List.of(weatherTool))
                .toolChoice(ToolChoice.AUTO)
                .build();

            var response = client.chat().completions().create(params);
            var choice = response.choices().get(0);

            if (choice.finishReason() == ChatCompletionChoicesItem.FinishReason.TOOL_CALLS) {
                // 处理工具调用
                var toolCalls = choice.message().toolCalls().orElse(List.of());
                messages.add(ChatCompletionMessageParam.ofAssistant(choice.message()));

                for (var tc : toolCalls) {
                    String funcResult = executeWeatherFunction(
                        tc.function().name(),
                        tc.function().arguments());
                    messages.add(ChatCompletionMessageParam.ofTool(
                        funcResult, tc.id()));
                }
            } else {
                // 正常文本回复
                System.out.println("AI: " +
                    choice.message().content().orElse(""));
                break;
            }
        }
    }

    private static String executeWeatherFunction(
            String name, String arguments) {
        // 解析 arguments JSON，调用实际 API
        System.out.println("调用工具: " + name + "(" + arguments + ")");
        return """
            {"city": "北京", "temperature": 25, "condition": "晴"}
            """;
    }
}
```

### 流式响应

```java
public class OpenAiStreamExample {

    /**
     * 流式对话
     */
    public static void streamChat(OpenAiClient client) {
        var params = ChatCompletionCreateParams.builder()
            .model("gpt-4o-mini")
            .messages(List.of(
                ChatCompletionMessageParam.ofUser(
                    "用3段话介绍Java的演进历史")
            ))
            .stream(true)  // 开启流式
            .build();

        var stream = client.chat().completions().createStream(params);

        stream.forEach(chunk -> {
            var choices = chunk.choices();
            if (!choices.isEmpty()) {
                var delta = choices.get(0).delta();
                System.out.print(delta.content().orElse(""));
            }
        });

        System.out.println();  // 完成后换行
        client.close();
    }
}
```

### Structured Output

```java
import com.openai.core.JsonValue;
import java.util.Map;

public class OpenAiStructuredOutput {

    record BookRec(String title, String author, int year, List<String> reasons) {}

    /**
     * 使用 Structured Outputs 提取结构化数据
     */
    public static BookRec extractBookInfo(OpenAiClient client, String query) {
        var jsonSchema = JsonObject.from(Map.of(
            "type", "object",
            "properties", Map.of(
                "title", Map.of("type", "string"),
                "author", Map.of("type", "string"),
                "year", Map.of("type", "integer"),
                "reasons", Map.of(
                    "type", "array",
                    "items", Map.of("type", "string")
                )
            ),
            "required", List.of("title", "author", "year", "reasons"),
            "additionalProperties", false
        ));

        var params = ChatCompletionCreateParams.builder()
            .model("gpt-4o")
            .messages(List.of(
                ChatCompletionMessageParam.ofSystem(
                    "你是一个专业的书籍推荐助手。根据用户需求推荐最合适的Java书籍。"),
                ChatCompletionMessageParam.ofUser(query)
            ))
            .responseFormat(ResponseFormat.ofJsonSchema(
                JsonSchemaResponseFormat.builder()
                    .jsonSchema(JsonSchemaResponseFormat.JsonSchema.builder()
                        .name("book_recommendation")
                        .strict(true)
                        .schema(jsonSchema)
                        .build())
                    .build()
            ))
            .build();

        var response = client.chat().completions().create(params);
        var content = response.choices().get(0).message().content().orElse("{}");

        // 解析为 Java Record
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(content, BookRec.class);
        } catch (Exception e) {
            throw new RuntimeException("解析Structured Output失败", e);
        }
    }
}
```

### 异常处理与超时

```java
import java.time.Duration;
import java.util.concurrent.TimeoutException;

public class OpenAiErrorHandling {

    public static OpenAiClient createClientWithConfig() {
        return OpenAiOkHttpClient.builder()
            .apiKey(System.getenv("OPENAI_API_KEY"))
            .timeout(Duration.ofSeconds(30))      // 全局超时
            .maxRetries(3)                         // 自动重试
            .build();
    }

    /**
     * 带自定义超时和错误处理的调用
     */
    public static String chatWithErrorHandling(
            OpenAiClient client, String prompt) {
        try {
            var params = ChatCompletionCreateParams.builder()
                .model("gpt-4o")
                .messages(List.of(
                    ChatCompletionMessageParam.ofUser(prompt)
                ))
                .maxTokens(500)
                .build();

            var response = client.chat().completions().create(params);
            return response.choices().get(0).message().content().orElse("");

        } catch (com.openai.errors.OpenAiException e) {
            return switch (e.statusCode()) {
                case 401 -> "认证失败，请检查API Key";
                case 429 -> "请求频率过高，请稍后重试";
                case 500, 502, 503 -> "服务器临时错误，已自动重试";
                default -> "API错误(" + e.statusCode() + "): " + e.getMessage();
            };
        } catch (Exception e) {
            return "未知错误: " + e.getMessage();
        }
    }
}
```

## Anthropic Java SDK

### 依赖配置

```xml
<dependency>
    <groupId>com.anthropic</groupId>
    <artifactId>anthropic-java</artifactId>
    <version>0.12.0</version>
</dependency>
```

### 基本 Messages API

```java
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.*;
import java.util.List;

public class AnthropicSdkExample {

    public static AnthropicClient createClient() {
        return AnthropicOkHttpClient.builder()
            .apiKey(System.getenv("ANTHROPIC_API_KEY"))
            .build();
    }

    /**
     * 基本消息创建
     */
    public static String basicMessage(AnthropicClient client) {
        var params = MessageCreateParams.builder()
            .model("claude-sonnet-4-20250514")
            .maxTokens(1024)
            .system("你是一个专业的Java架构师，回答要简洁准确。")
            .messages(List.of(
                Message.builder()
                    .role(MessageRole.USER)
                    .content("解释Java中的Virtual Threads和平台线程的区别")
                    .build()
            ))
            .temperature(0.7d)
            .build();

        var response = client.messages().create(params);

        // 提取文本内容
        return response.content().stream()
            .filter(c -> c instanceof TextBlock)
            .map(c -> ((TextBlock) c).text())
            .reduce("", String::concat);
    }

    public static void main(String[] args) {
        var client = createClient();
        try {
            System.out.println(basicMessage(client));
        } finally {
            client.close();
        }
    }
}
```

### cache_control 使用

```java
public class AnthropicCacheControl {

    /**
     * 使用 Prompt Cache 优化长 system prompt
     */
    public static String withCacheControl(AnthropicClient client, String userInput) {
        // 将长 system prompt 标记为可缓存
        var systemBlocks = List.of(
            TextBlockParam.builder()
                .text("""
                    你是一个保险领域的AI助手。你精通以下保险产品知识：
                    
                    ## 团体意外险
                    - 投保年龄：16-65周岁
                    - 保障期限：1年
                    - 保额范围：10-100万元
                    - 职业类别：1-4类
                    - 等待期：无
                    - 保费计算：按职业类别和保额
                    
                    ## 团体健康险
                    - 投保年龄：18-60周岁
                    - 保障期限：1年
                    - 住院医疗：最高50万
                    - 门诊医疗：最高5万
                    - 等待期：30天(意外无等待期)
                    
                    ## 团体寿险
                    ...（更多产品知识）
                    """)
                .cacheControl(CacheControlEphemeral.builder().build())
                .build()
        );

        var params = MessageCreateParams.builder()
            .model("claude-sonnet-4-20250514")
            .maxTokens(1024)
            .system(systemBlocks)  // 使用数组形式支持 cache_control
            .messages(List.of(
                Message.builder()
                    .role(MessageRole.USER)
                    .content(userInput)
                    .build()
            ))
            .build();

        var response = client.messages().create(params);

        // 检查缓存使用情况
        var usage = response.usage();
        System.out.println("Input tokens: " + usage.inputTokens());
        System.out.println("Cache read tokens: " +
            usage.cacheReadInputTokens().orElse(0L));
        System.out.println("Cache creation tokens: " +
            usage.cacheCreationInputTokens().orElse(0L));

        // 提取文本
        return response.content().stream()
            .filter(c -> c instanceof TextBlock)
            .map(c -> ((TextBlock) c).text())
            .reduce("", String::concat);
    }
}
```

### Extended Thinking

```java
public class AnthropicExtendedThinking {

    /**
     * 使用 Extended Thinking 进行复杂推理
     */
    public static String deepAnalysis(AnthropicClient client, String complexQuestion) {
        var params = MessageCreateParams.builder()
            .model("claude-sonnet-4-20250514")
            .maxTokens(4096)
            .thinking(ThinkingConfigParam.builder()
                .type(ThinkingConfigParam.Type.ENABLED)
                .budgetTokens(16000)  // thinking 专用 token 预算
                .build())
            .messages(List.of(
                Message.builder()
                    .role(MessageRole.USER)
                    .content(complexQuestion)
                    .build()
            ))
            .build();

        var response = client.messages().create(params);

        // thinking 内容在 ThinkingBlock 中
        var thinking = response.content().stream()
            .filter(c -> c instanceof ThinkingBlock)
            .map(c -> ((ThinkingBlock) c).thinking())
            .reduce("", String::concat);

        // 最终回答
        var answer = response.content().stream()
            .filter(c -> c instanceof TextBlock)
            .map(c -> ((TextBlock) c).text())
            .reduce("", String::concat);

        System.out.println("=== 思考过程 ===\n" + thinking);
        System.out.println("\n=== 最终回答 ===\n" + answer);

        return answer;
    }
}
```

### Tool Use (Anthropic 原生)

```java
import com.anthropic.models.messages.*;

public class AnthropicToolUse {

    record WeatherData(String city, double temp, String condition) {}

    public static void toolUseExample(AnthropicClient client) {
        // 工具定义
        var weatherTool = Tool.builder()
            .name("get_weather")
            .description("查询指定城市的天气")
            .inputSchema(Tool.InputSchema.builder()
                .type(InputSchemaType.OBJECT)
                .properties(Map.of(
                    "city", PropertyDetail.builder()
                        .type(PropertyDetailType.STRING)
                        .description("城市名称")
                        .build()
                ))
                .required(List.of("city"))
                .build())
            .build();

        var messages = new java.util.ArrayList<Message>();

        // 用户消息
        var userMessage = Message.builder()
            .role(MessageRole.USER)
            .content("查询北京和上海的天气")
            .build();
        messages.add(userMessage);

        int maxRounds = 5;
        for (int round = 0; round < maxRounds; round++) {
            var params = MessageCreateParams.builder()
                .model("claude-sonnet-4-20250514")
                .maxTokens(1024)
                .tools(List.of(weatherTool))
                .messages(messages)
                .build();

            var response = client.messages().create(params);

            // 检查是否需要工具调用
            var toolUseBlocks = response.content().stream()
                .filter(c -> c instanceof ToolUseBlock)
                .map(c -> (ToolUseBlock) c)
                .toList();

            if (toolUseBlocks.isEmpty()) {
                // 无工具调用，返回文本
                System.out.println("最终回答: " + response.content().stream()
                    .filter(c -> c instanceof TextBlock)
                    .map(c -> ((TextBlock) c).text())
                    .reduce("", String::concat));
                break;
            }

            // 添加 assistant 消息
            messages.add(Message.builder()
                .role(MessageRole.ASSISTANT)
                .content(new java.util.ArrayList<>(response.content()))
                .build());

            // 执行每个工具
            var toolResults = new java.util.ArrayList<ContentBlock>();
            for (var toolUse : toolUseBlocks) {
                String city = toolUse.input().get("city").asText();
                String result = executeWeatherTool(city);
                toolResults.add(ToolResultBlock.builder()
                    .toolUseId(toolUse.id())
                    .content(result)
                    .build());
            }

            // 添加 tool_result 消息
            messages.add(Message.builder()
                .role(MessageRole.USER)
                .content(toolResults)
                .build());
        }
    }

    private static String executeWeatherTool(String city) {
        // 模拟天气查询
        return "{\"city\": \"" + city +
               "\", \"temp\": 22, \"condition\": \"晴\"}";
    }
}
```

## AWS Bedrock

### 依赖配置

```xml
<dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>bedrock-runtime</artifactId>
    <version>2.30.0</version>
</dependency>
```

### Converse API (统一多模型)

```java
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.*;
import java.util.List;

public class BedrockSdkExample {

    public static BedrockRuntimeClient createClient() {
        return BedrockRuntimeClient.builder()
            .region(Region.US_EAST_1)
            .credentialsProvider(DefaultCredentialsProvider.create())
            .build();
    }

    /**
     * 使用 Converse API 调用 Claude 模型
     */
    public static String converseClaude(BedrockRuntimeClient client) {
        // Bedrock 模型 ID
        String modelId = "us.anthropic.claude-sonnet-4-20250514-v1:0";

        var params = ConverseRequest.builder()
            .modelId(modelId)
            .system(List.of(
                SystemContentBlock.builder()
                    .text("你是一个Java技术专家")
                    .build()
            ))
            .messages(List.of(
                Message.builder()
                    .role(ConversationRole.USER)
                    .content(List.of(
                        ContentBlock.builder()
                            .text("用一句话介绍Spring AI")
                            .build()
                    ))
                    .build()
            ))
            .inferenceConfig(InferenceConfiguration.builder()
                .maxTokens(200)
                .temperature(0.7f)
                .build())
            .build();

        var response = client.converse(params);

        return response.output().message().content().stream()
            .filter(c -> c.text() != null)
            .map(ContentBlock::text)
            .reduce("", String::concat);
    }
}
```

### 流式调用

```java
public class BedrockStreamExample {

    public static void streamConverse(BedrockRuntimeClient client) {
        String modelId = "us.anthropic.claude-sonnet-4-20250514-v1:0";

        var params = ConverseStreamRequest.builder()
            .modelId(modelId)
            .messages(List.of(
                Message.builder()
                    .role(ConversationRole.USER)
                    .content(List.of(
                        ContentBlock.builder()
                            .text("用3段话介绍Kubernetes")
                            .build()
                    ))
                    .build()
            ))
            .inferenceConfig(InferenceConfiguration.builder()
                .maxTokens(500)
                .temperature(0.7f)
                .build())
            .build();

        var responseStream = client.converseStream(params).stream();

        responseStream.subscribe(event -> {
            if (event instanceof ConverseStreamResponseEvent.ContentBlockDeltaEvent delta) {
                System.out.print(delta.delta().text());
            }
        }).join();  // 等待流完成

        System.out.println();
    }
}
```

### Bedrock 常用模型 ID

```java
public class BedrockModelIds {

    // Anthropic 系列
    public static final String CLAUDE_SONNET_4 =
        "us.anthropic.claude-sonnet-4-20250514-v1:0";
    public static final String CLAUDE_OPUS_4 =
        "us.anthropic.claude-opus-4-20250514-v1:0";
    public static final String CLAUDE_HAIKU_4_5 =
        "us.anthropic.claude-haiku-4-5-20251001-v1:0";

    // Meta 系列
    public static final String LLAMA_3_1_70B =
        "us.meta.llama3-1-70b-instruct-v1:0";
    public static final String LLAMA_3_2_90B =
        "us.meta.llama3-2-90b-instruct-v1:0";

    // Mistral 系列
    public static final String MISTRAL_LARGE =
        "mistral.mistral-large-2407-v1:0";

    // Amazon Nova 系列
    public static final String NOVA_PRO =
        "amazon.nova-pro-v1:0";

    /**
     * Bedrock 模型 ID 格式：
     * {provider}.{model-name}-{variant}
     * 注意：AWS 区域不同，可用模型不同
     */
}
```

## Google GenAI Java SDK

### 依赖配置

```xml
<dependency>
    <groupId>com.google.genai</groupId>
    <artifactId>google-genai</artifactId>
    <version>1.0.0</version>
</dependency>
```

### Gemini API 调用

```java
import com.google.genai.Client;
import com.google.genai.types.*;

public class GoogleGenAiExample {

    public static Client createClient() {
        return Client.builder()
            .apiKey(System.getenv("GOOGLE_API_KEY"))
            .build();
    }

    /**
     * 基本文本生成
     */
    public static String basicGenerate(Client client) {
        var config = GenerateContentConfig.builder()
            .systemInstruction(Content.builder()
                .parts(List.of(Part.builder()
                    .text("你是一个Java技术顾问")
                    .build()))
                .build())
            .temperature(0.7f)
            .maxOutputTokens(500)
            .build();

        var response = client.models.generateContent(
            "gemini-2.5-flash",
            List.of(Content.builder()
                .parts(List.of(Part.builder()
                    .text("用一句话解释什么是Virtual Threads")
                    .build()))
                .role("user")
                .build()),
            config
        );

        return response.candidates().get(0)
            .content().parts().get(0).text();
    }

    /**
     * 流式生成
     */
    public static void streamGenerate(Client client) {
        var config = GenerateContentConfig.builder()
            .temperature(0.7f)
            .maxOutputTokens(500)
            .build();

        var stream = client.models.generateContentStream(
            "gemini-2.5-flash",
            List.of(Content.builder()
                .parts(List.of(Part.builder()
                    .text("写一首关于Java的短诗")
                    .build()))
                .role("user")
                .build()),
            config
        );

        stream.forEach(chunk -> {
            if (chunk.candidates() != null && !chunk.candidates().isEmpty()) {
                var candidate = chunk.candidates().get(0);
                if (candidate.content() != null && candidate.content().parts() != null) {
                    candidate.content().parts().forEach(part ->
                        System.out.print(part.text()));
                }
            }
        });
        System.out.println();
    }
}
```

### Safety Settings

```java
public class GeminiSafetySettings {

    public static String generateWithSafety(Client client) {
        var safetySettings = List.of(
            SafetySetting.builder()
                .category(HarmCategory.HARM_CATEGORY_HATE_SPEECH)
                .threshold(SafetySettingThreshold.BLOCK_LOW_AND_ABOVE)
                .build(),
            SafetySetting.builder()
                .category(HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT)
                .threshold(SafetySettingThreshold.BLOCK_MEDIUM_AND_ABOVE)
                .build(),
            SafetySetting.builder()
                .category(HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT)
                .threshold(SafetySettingThreshold.BLOCK_LOW_AND_ABOVE)
                .build(),
            SafetySetting.builder()
                .category(HarmCategory.HARM_CATEGORY_HARASSMENT)
                .threshold(SafetySettingThreshold.BLOCK_MEDIUM_AND_ABOVE)
                .build()
        );

        var config = GenerateContentConfig.builder()
            .temperature(0.7f)
            .maxOutputTokens(500)
            .safetySettings(safetySettings)
            .build();

        var response = client.models.generateContent(
            "gemini-2.5-flash",
            List.of(Content.builder()
                .parts(List.of(Part.builder()
                    .text("请介绍Java的基本特点")
                    .build()))
                .role("user")
                .build()),
            config
        );

        // 检查是否有安全过滤
        if (response.candidates().get(0).finishReason()
                == FinishReason.SAFETY) {
            return "内容被安全设置过滤";
        }

        return response.candidates().get(0)
            .content().parts().get(0).text();
    }
}
```

## Azure AI SDK

### 依赖配置

```xml
<dependency>
    <groupId>com.azure</groupId>
    <artifactId>azure-ai-openai</artifactId>
    <version>1.0.0-beta.12</version>
</dependency>
```

### Azure OpenAI 调用

```java
import com.azure.ai.openai.OpenAiClient;
import com.azure.ai.openai.OpenAiClientBuilder;
import com.azure.ai.openai.models.*;
import com.azure.core.credential.AzureKeyCredential;
import java.util.List;

public class AzureAiSdkExample {

    public static OpenAiClient createClient() {
        String endpoint = System.getenv("AZURE_OPENAI_ENDPOINT");
        String apiKey = System.getenv("AZURE_OPENAI_API_KEY");

        return new OpenAiClientBuilder()
            .endpoint(endpoint)  // https://{resource}.openai.azure.com/
            .credential(new AzureKeyCredential(apiKey))
            .buildClient();
    }

    /**
     * Azure OpenAI 对话
     * 注意：部署名（deploymentOrModelName）可能与模型名不同
     */
    public static String azureChat(OpenAiClient client) {
        // deploymentOrModelName = 部署名（非模型名）
        String deploymentName = "gpt-4o";

        var options = new ChatCompletionsOptions(
            List.of(
                new ChatRequestSystemMessage("你是Java专家"),
                new ChatRequestUserMessage("介绍Virtual Threads")
            )
        );
        options.setTemperature(0.7d);
        options.setMaxTokens(300);

        var response = client.getChatCompletions(
            deploymentName, options);

        var content = response.getChoices().get(0)
            .getMessage().getContent();

        // 获取 token 用量
        var usage = response.getUsage();
        System.out.printf("Token用量 - 输入:%d 输出:%d 总计:%d%n",
            usage.getPromptTokens(),
            usage.getCompletionTokens(),
            usage.getTotalTokens());

        return content;
    }

    /**
     * 带内容过滤的 Azure 调用
     */
    public static String azureChatWithFilter(OpenAiClient client) {
        String deploymentName = "gpt-4o";

        var options = new ChatCompletionsOptions(
            List.of(new ChatRequestUserMessage("请正常回答问题"))
        );

        // Azure 可配置内容过滤
        // 在 Azure Portal 中配置：
        // - 严重性阈值（low/medium/high）
        // - 内容类别（hate/sexual/violence/self-harm）
        // - 过滤行为（block/annotate/disabled）

        var response = client.getChatCompletions(deploymentName, options);

        // 检查内容过滤结果
        var promptFilterResults = response.getPromptFilterResults();
        for (var filter : promptFilterResults) {
            if (filter.getContentFilterResults() != null) {
                System.out.println("Prompt过滤: " +
                    filter.getContentFilterResults());
            }
        }

        return response.getChoices().get(0).getMessage().getContent();
    }
}
```

## 多 Provider 统一抽象示例

```java
/**
 * 统一聊天接口
 * 业务代码只依赖这个接口，不依赖任何具体 SDK
 */
public interface ChatModelPort {
    ChatResponse chat(ChatRequest request);
    Flux<ChatChunk> chatStream(ChatRequest request);

    record ChatRequest(
        List<ChatMessage> messages,
        String requestId,
        double temperature,
        int maxTokens,
        List<ToolDefinition> tools,
        String toolChoice,
        String responseFormat
    ) {}

    record ChatResponse(
        String content,
        List<ToolCall> toolCalls,
        String finishReason,
        TokenUsage usage,
        String modelId
    ) {}

    record ChatChunk(String delta, String finishReason) {}

    record ChatMessage(String role, String content,
        String toolCallId, List<ToolCall> toolCalls) {}

    record ToolDefinition(String name, String description,
        Map<String, Object> jsonSchema) {}

    record ToolCall(String id, String name, String arguments) {}

    record TokenUsage(int input, int output, int total) {}
}

/**
 * OpenAI 适配器
 */
public class OpenAiChatAdapter implements ChatModelPort {
    private final OpenAiClient client;
    private final String modelId;

    public OpenAiChatAdapter(OpenAiClient client, String modelId) {
        this.client = client;
        this.modelId = modelId;
    }

    @Override
    public ChatResponse chat(ChatRequest request) {
        // 将 ChatRequest 转换为 OpenAI SDK 的请求参数...
        // 调用 client.chat().completions().create(...)
        // 将响应转换为 ChatResponse...
        throw new UnsupportedOperationException("完整实现见adapters包");
    }

    @Override
    public Flux<ChatChunk> chatStream(ChatRequest request) {
        // 流式适配...
        throw new UnsupportedOperationException("完整实现见adapters包");
    }
}

/**
 * Anthropic 适配器
 */
public class AnthropicChatAdapter implements ChatModelPort {
    private final AnthropicClient client;
    private final String modelId;

    public AnthropicChatAdapter(AnthropicClient client, String modelId) {
        this.client = client;
        this.modelId = modelId;
    }

    @Override
    public ChatResponse chat(ChatRequest request) {
        // 将 ChatRequest 转换为 Anthropic SDK 的请求参数...
        throw new UnsupportedOperationException("完整实现见adapters包");
    }

    @Override
    public Flux<ChatChunk> chatStream(ChatRequest request) {
        throw new UnsupportedOperationException("完整实现见adapters包");
    }
}
```

## Provider 选择决策树

```
你的运行环境？
├── AWS 生态内
│   └── AWS Bedrock (Claude/LLaMA/Mistral 等通过统一 API)
├── GCP 生态内
│   └── Google GenAI SDK (Gemini 系列)
├── Azure 生态内
│   └── Azure AI SDK (Azure OpenAI)
└── 通用 / 多云
    ├── 需要 Spring 深度集成？
    │   └── Spring AI (底层可切换 Provider)
    ├── 需要非 Spring 集成？
    │   ├── 主用 OpenAI/兼容 → OpenAI Java SDK
    │   └── 主用 Anthropic → Anthropic Java SDK
    └── 所有场景
        └── 用 ChatModelPort 抽象，随时切换
```

## 最佳实践

1. **永远不要将 API Key 硬编码**：使用环境变量、Vault/KMS、或 Spring Boot 的外部化配置。`System.getenv("API_KEY")` 是最低要求
2. **每个 SDK 调用都配备超时配置**：LLM API 延迟可能从 200ms 到 30s+ 不等，默认的超时可能不适用
3. **始终读取 usage 信息进行监控**：`usage.prompt_tokens` 和 `usage.completion_tokens` 不仅要用于计费，更要建立运维监控（异常激增的 token 消耗可能是 prompt 注入的标志）
4. **工具调用的工具输出不应超过必要长度**：过长的工具输出会挤占模型的上下文窗口，输出前做截断或摘要
5. **生产代码不要直接依赖 SDK 类**：业务代码只依赖 `ChatModelPort` 接口，实际 SDK 调用封装在 Adapter 中
6. **使用 Virtual Threads 处理并发调用**：多个 SDK 调用可以并发执行而不会阻塞平台线程

## 常见问题

**Q: Spring AI 和直接使用 SDK 有什么区别？应该用哪个？**

A: Spring AI 提供了更高层的抽象（ChatClient、Advisors、Tool Calling 自动管理、Chat Memory），而 SDK 是最底层的 HTTP 封装。推荐：业务代码用 Spring AI；当 Spring AI 暂不支持某个 Provider 的新特性时，降级到 SDK 作为短期方案。

**Q: AWS Bedrock Converse API 和直接调用 Bedrock 的模型特定 API 有什么区别？**

A: Converse API 是 Bedrock 的统一抽象层，一套代码调所有模型。模型特定 API（如 InvokeModel）参数因模型而异。新项目应优先使用 Converse API。

**Q: 如何在 Provider 之间做故障切换？**

A: 使用 ChatModelPort 接口 + 路由器模式：配置主 Provider 和 fallback Provider 的优先级列表，当主 Provider 返回 429/5xx 时自动切换到下一个。详见 [[08-模型能力矩阵与路由策略]]

## 相关条目

- [[08-OpenAI兼容协议详解]] — API 协议的详细规范
- [[08-本地推理与Ollama]] — 本地推理与 Ollama
- [[08-模型能力矩阵与路由策略]] — 模型能力与路由
- [[09-SpringAI2深度解析]] — Spring AI 框架
- [[09-架构抽象层设计]] — 抽象层设计
