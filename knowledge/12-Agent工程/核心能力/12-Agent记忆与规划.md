---
domain: 12-Agent工程
title: Agent Memory 体系与 Planning 策略深度实践
status: draft
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/api/chat-memory.html
    description: Spring AI ChatMemory 官方文档
  - level: L1
    url: https://arxiv.org/abs/2210.03629
    description: "ReAct: Synergizing Reasoning and Acting in Language Models"
  - level: L2
    url: https://langchain-ai.github.io/langgraph/concepts/memory/
    description: LangGraph Memory 概念文档
relations:
  prerequisite:
    - 12-ToolCalling完整剖析
  related:
    - 12-Agent工作流与人机协作
    - 12-多Agent协作架构
tags:
  - agent-memory
  - react
  - planning
  - spring-ai
  - chat-memory
created: 2026-07-17
updated: 2026-07-17
content_type: concept
---

# Agent Memory 体系与 Planning 策略深度实践

## 一、Memory 体系全景

Agent 的记忆系统是其智能行为的基石。缺少记忆的 Agent 如同患了失忆症——每次对话都从零开始，无法积累经验。一个完整的 Agent Memory 体系包含三个层次：

### 1.1 Short-term Memory（短期记忆）

短期记忆是对话上下文的直接窗口。它的核心挑战是 Token 预算管理——LLM 的上下文窗口有限，必须在信息量和成本之间取得平衡。

**窗口管理策略**：

- **滑动窗口**：只保留最近 N 条消息。简单但可能丢失关键早期上下文。
- **消息摘要**：对历史消息进行压缩摘要。保留语义但丢失细节。
- **临界裁剪**：当 Token 数接近上限时，从最早的消息开始逐条删除，但保留 System Prompt 和最近的消息。

**Token 预算感知的智能摘要**：当上下文即将超出限制时，不是简单截断，而是对中间部分的消息生成一个浓缩摘要：

```
[System Prompt] → [关键早期上下文] → [摘要：中间对话的要点...] → [最近3轮对话]
```

### 1.2 Long-term Memory（长期记忆）

长期记忆使 Agent 能够跨会话记住用户偏好、历史交互和领域知识。通常通过向量数据库实现：

```java
// LongTermMemoryService.java
package com.example.agent.memory;

import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class LongTermMemoryService {

    private final VectorStore vectorStore;
    private final EmbeddingModel embeddingModel;

    public LongTermMemoryService(VectorStore vectorStore, EmbeddingModel embeddingModel) {
        this.vectorStore = vectorStore;
        this.embeddingModel = embeddingModel;
    }

    /**
     * 存储一条关键事件到长期记忆
     */
    public void storeMemory(String userId, String event, Map<String, Object> metadata) {
        var doc = Document.builder()
            .id("mem-%s-%d".formatted(userId, Instant.now().toEpochMilli()))
            .text(event)
            .metadata(Map.of(
                "userId", userId,
                "timestamp", Instant.now().toString(),
                "type", metadata.getOrDefault("type", "general")
            ))
            .build();
        vectorStore.add(List.of(doc));
    }

    /**
     * 检索与当前上下文相关的记忆
     */
    public List<String> retrieveRelevantMemories(String userId, String query, int topK) {
        var results = vectorStore.similaritySearch(
            org.springframework.ai.vectorstore.SearchRequest.builder()
                .query(query)
                .topK(topK)
                .filterExpression("userId == '%s'".formatted(userId))
                .build()
        );
        return results.stream()
            .map(Document::text)
            .toList();
    }

    /**
     * 提取关键事件：判断一条对话是否值得存入长期记忆
     */
    public boolean isSignificantEvent(String userMessage) {
        var keywords = List.of("偏好", "地址", "投诉", "重要", "VIP", 
            "过敏", "紧急", "经常", "不要", "永远");
        return keywords.stream().anyMatch(userMessage::contains);
    }
}
```

### 1.3 Working Memory（工作记忆）

工作记忆是 Agent 执行复杂任务时的"草稿纸"。它可以是一个结构化的 JSON 对象，也可以是自然语言的 Notepad：

```java
// WorkingMemory.java
package com.example.agent.memory;

import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class WorkingMemory {

    private final ObjectNode scratchpad;
    private final List<String> completedSteps;
    private final Map<String, Object> intermediateResults;
    private static final ObjectMapper mapper = new ObjectMapper();

    public WorkingMemory() {
        this.scratchpad = mapper.createObjectNode();
        this.completedSteps = new ArrayList<>();
        this.intermediateResults = new LinkedHashMap<>();
    }

    public void noteThought(String thought) {
        completedSteps.add("[Thought] " + thought);
    }

    public void noteAction(String action, Map<String, Object> params) {
        completedSteps.add("[Action] %s(%s)".formatted(action, params));
    }

    public void noteObservation(String observation) {
        completedSteps.add("[Observation] " + observation);
    }

    public void storeResult(String key, Object value) {
        intermediateResults.put(key, value);
    }

    @SuppressWarnings("unchecked")
    public <T> T getResult(String key) {
        return (T) intermediateResults.get(key);
    }

    public void setContext(String key, String value) {
        scratchpad.put(key, value);
    }

    public String summarize() {
        var sb = new StringBuilder();
        sb.append("## 已完成步骤\n");
        completedSteps.forEach(s -> sb.append("- ").append(s).append("\n"));
        sb.append("\n## 中间结果\n");
        intermediateResults.forEach((k, v) -> 
            sb.append("- ").append(k).append(": ").append(v).append("\n"));
        return sb.toString();
    }

    public void clear() {
        scratchpad.removeAll();
        completedSteps.clear();
        intermediateResults.clear();
    }
}
```

## 二、Spring AI ChatMemory 实现

### 2.1 InMemoryChatMemory

最简单的内存实现，适合开发和单机部署：

```java
@Configuration
public class MemoryConfiguration {

    @Bean
    public ChatMemory chatMemory() {
        // 默认每个会话保留最近20条消息
        return new InMemoryChatMemory();
    }

    @Bean
    public ChatClient chatClientWithMemory(
            ChatClient.Builder builder, ChatMemory chatMemory) {

        return builder
            .defaultAdvisors(
                new MessageChatMemoryAdvisor(chatMemory)
            )
            .build();
    }
}
```

### 2.2 JdbcChatMemory 持久化

```java
@Configuration
public class PersistentMemoryConfiguration {

    @Bean
    public ChatMemory jdbcChatMemory(JdbcTemplate jdbcTemplate) {
        return new JdbcChatMemory(jdbcTemplate);
    }
}
```

需要创建对应的数据库表：

```sql
CREATE TABLE chat_memory (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(32) NOT NULL,  -- 'user', 'assistant', 'system', 'tool'
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversation_id ON chat_memory(conversation_id);
CREATE INDEX idx_created_at ON chat_memory(created_at);
```

### 2.3 自定义 Token 预算感知的裁剪策略

```java
// TokenBudgetMemoryAdvisor.java
package com.example.agent.memory;

import org.springframework.ai.chat.client.advisor.api.*;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.model.Content;
import org.springframework.util.StringUtils;

import java.util.*;

public class TokenBudgetMemoryAdvisor implements CallAroundAdvisor {

    private final ChatMemory chatMemory;
    private final int maxTokens;
    private final int estimatedCharsPerToken = 4;

    public TokenBudgetMemoryAdvisor(ChatMemory chatMemory, int maxTokens) {
        this.chatMemory = chatMemory;
        this.maxTokens = maxTokens;
    }

    @Override
    public String getName() {
        return "token_budget_memory";
    }

    @Override
    public int getOrder() {
        return 0;
    }

    @Override
    public AdvisedResponse aroundCall(
            AdvisedRequest advisedRequest,
            CallAroundAdvisorChain chain) {

        var conversationId = advisedRequest.adviseContext()
            .getOrDefault("conversationId", "default").toString();

        // 获取历史消息并裁剪
        var history = chatMemory.get(conversationId, Integer.MAX_VALUE);
        var trimmedHistory = trimByTokenBudget(history, maxTokens);

        // 注入到请求
        var modifiedRequest = AdvisedRequest.from(advisedRequest)
            .messages(trimmedHistory)
            .build();

        var response = chain.nextAroundCall(modifiedRequest);

        // 保存新消息
        var content = advisedRequest.userText();
        if (StringUtils.hasText(content)) {
            chatMemory.add(conversationId, 
                List.of(new org.springframework.ai.chat.messages.UserMessage(content)));
        }

        return response;
    }

    private List<Message> trimByTokenBudget(List<Message> messages, int tokenBudget) {
        int estimatedTokens = 0;
        var result = new ArrayList<Message>();

        // 从最近的消息开始保留
        for (int i = messages.size() - 1; i >= 0; i--) {
            var msg = messages.get(i);
            var content = extractContent(msg);
            int msgTokens = content.length() / estimatedCharsPerToken;

            if (estimatedTokens + msgTokens > tokenBudget) {
                break;
            }

            estimatedTokens += msgTokens;
            result.addFirst(msg);
        }

        return result;
    }

    private String extractContent(Message message) {
        if (message instanceof Content c) {
            return c.getText();
        }
        // Fallback: 转为字符串
        return message.toString();
    }
}
```

## 三、Planning 策略

### 3.1 ReAct：Thought-Action-Observation 循环

ReAct 是最经典的 Agent 推理模式。其核心思想是：模型交替进行"思考"和"行动"，行动的结果作为新的观察注入推理循环。

```
User: "帮我查下订单123的状态，如果有问题就退款"
---
Thought: 用户想查订单123的状态，我需要先调用查询工具
Action: get_order(orderId="123")
Observation: {status: "shipped", amount: 299.00}
---
Thought: 订单状态是"已发货"，没有明显问题。我需要询问用户是否对订单不满意
Answer: 您的订单123已发货，金额为299元。订单看起来正常，请问是对商品不满意需要退款吗？
---
User: "是的，商品有质量问题"
---
Thought: 用户明确表示有质量问题，我需要发起退款
Action: initiate_refund(orderId="123", amount=299.00, reason="quality_issue")
Observation: {refundId: "RF-456", status: "processing"}
---
Answer: 已为您发起退款RF-456，金额299元将原路返回。预计3-5个工作日到账。
```

### 3.2 Plan-and-Execute

Plan-and-Execute 策略是先制定完整计划，再严格按照计划执行：

```java
// PlanAndExecuteAgent.java
package com.example.agent.planning;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.ToolCallback;
import java.util.*;

public class PlanAndExecuteAgent {

    private final ChatClient planner;
    private final ChatClient executor;
    private final Map<String, ToolCallback> toolRegistry;

    public PlanAndExecuteAgent(ChatClient.Builder builder, List<ToolCallback> tools) {
        this.planner = builder
            .defaultSystem("""
                你是一个计划制定者。根据用户的目标，制定一个分步执行计划。
                每个步骤包含：步骤编号、描述、需要的工具名称、预期输出。
                输出格式：JSON数组
                """)
            .build();

        this.executor = builder
            .defaultSystem("你是一个执行者，按照计划步骤调用工具执行。")
            .defaultTools(tools)
            .build();

        this.toolRegistry = new HashMap<>();
        tools.forEach(t -> toolRegistry.put(t.getToolDefinition().name(), t));
    }

    public String execute(String goal) {
        // Step 1: 制定计划
        var planJson = planner.prompt()
            .user("目标：%s".formatted(goal))
            .call()
            .content();

        var plan = parsePlan(planJson);
        var results = new ArrayList<String>();

        // Step 2: 逐步执行
        for (var step : plan) {
            var result = executor.prompt()
                .user("执行第%d步：%s。当前已完成：%s"
                    .formatted(step.number(), step.description(), results))
                .call()
                .content();
            results.add("[Step %d] %s → %s".formatted(step.number(), step.description(), result));
        }

        return String.join("\n\n", results);
    }

    private List<PlanStep> parsePlan(String json) {
        // 解析 JSON 为 PlanStep 列表
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(json, 
                mapper.getTypeFactory().constructCollectionType(List.class, PlanStep.class));
        } catch (Exception e) {
            return List.of();
        }
    }

    record PlanStep(int number, String description, String tool, String expectedOutput) {}
}
```

### 3.3 Reflection（反思）策略

```java
// ReflectionAgent.java
package com.example.agent.planning;

import org.springframework.ai.chat.client.ChatClient;
import java.util.concurrent.atomic.AtomicInteger;

public class ReflectionAgent {

    private final ChatClient actor;
    private final ChatClient reflector;
    private final int maxIterations;

    public ReflectionAgent(ChatClient.Builder builder, int maxIterations) {
        this.actor = builder
            .defaultSystem("你是一个执行者，完成任务并给出回答。")
            .build();
        this.reflector = builder
            .defaultSystem("""
                你是一个反思者，审视执行者的回答。
                指出其中：事实错误、逻辑漏洞、遗漏信息、改进建议。
                如果回答已经足够好，回复"NO_ISSUES"。
                """)
            .build();
        this.maxIterations = maxIterations;
    }

    public String reflectAndRefine(String task) {
        var iteration = new AtomicInteger(0);
        var currentAnswer = actor.prompt().user(task).call().content();

        while (iteration.incrementAndGet() <= maxIterations) {
            var feedback = reflector.prompt()
                .user("任务：%s\n\n回答：%s".formatted(task, currentAnswer))
                .call()
                .content();

            if ("NO_ISSUES".equals(feedback.trim())) {
                break;
            }

            // 基于反馈改进
            currentAnswer = actor.prompt()
                .user("任务：%s\n\n之前的回答：%s\n\n改进建议：%s\n\n请给出改进后的回答。"
                    .formatted(task, currentAnswer, feedback))
                .call()
                .content();
        }

        return currentAnswer;
    }
}
```

## 四、完整 ReAct Agent 实现（含 Tool Calling + Memory）

```java
// ReActAgent.java
package com.example.agent;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.*;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.Executors;

@Service
public class ReActAgent {

    private final ChatClient model;
    private final ChatMemory memory;
    private final Map<String, ToolCallback> tools;
    private final WorkingMemory workingMemory;
    private final int maxSteps;

    public ReActAgent(ChatClient.Builder builder,
                       ChatMemory memory,
                       List<ToolCallback> toolList) {
        this.model = builder
            .defaultSystem("""
                你是一个 ReAct Agent。使用以下格式响应：

                Thought: 分析当前情况，决定下一步做什么
                Action: tool_name
                Action Input: {"param1": "value1", ...}

                当任务完成时：
                Thought: 我已经完成了任务
                Final Answer: 给出最终回答
                """)
            .defaultTools(toolList)
            .build();
        this.memory = memory;
        this.tools = new HashMap<>();
        toolList.forEach(t -> tools.put(t.getToolDefinition().name(), t));
        this.workingMemory = new WorkingMemory();
        this.maxSteps = 10;
    }

    /**
     * ReAct 主循环
     */
    public String run(String conversationId, String userMessage) {
        // 保存用户消息
        memory.add(conversationId, List.of(new UserMessage(userMessage)));
        workingMemory.clear();

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {

            for (int step = 0; step < maxSteps; step++) {
                // 构建上下文
                var history = memory.get(conversationId, 20);
                var prompt = buildPrompt(history, workingMemory.summarize());

                // 调用模型
                var response = model.prompt()
                    .user(prompt)
                    .call()
                    .content();

                // 解析响应
                if (response.contains("Final Answer:")) {
                    var finalAnswer = response.substring(
                        response.indexOf("Final Answer:") + "Final Answer:".length()).trim();
                    memory.add(conversationId, List.of(new AssistantMessage(finalAnswer)));
                    return finalAnswer;
                }

                if (response.contains("Action:") && response.contains("Action Input:")) {
                    var action = extractAction(response);
                    var actionInput = extractActionInput(response);

                    workingMemory.noteAction(action, parseJson(actionInput));

                    // 执行工具
                    var toolResult = executeTool(action, actionInput);
                    workingMemory.noteObservation(toolResult);

                    // 将工具结果注入对话
                    memory.add(conversationId, List.of(
                        new AssistantMessage(response),
                        new ToolResponseMessage(
                            Map.of(action, toolResult),
                            UUID.randomUUID().toString()
                        )
                    ));
                } else {
                    // 没有工具调用，直接返回
                    memory.add(conversationId, List.of(new AssistantMessage(response)));
                    return response;
                }
            }
        }

        return "任务超出最大步骤限制（%d步），请简化需求。".formatted(maxSteps);
    }

    private String buildPrompt(List<Message> history, String workingMemorySummary) {
        var sb = new StringBuilder();
        if (!workingMemorySummary.isBlank()) {
            sb.append("工作记忆：\n").append(workingMemorySummary).append("\n\n");
        }
        sb.append("可用工具：\n");
        tools.forEach((name, tool) -> 
            sb.append("- ").append(name).append(": ")
              .append(tool.getToolDefinition().description()).append("\n"));
        return sb.toString();
    }

    private String executeTool(String toolName, String inputJson) {
        var tool = tools.get(toolName);
        if (tool == null) {
            return "错误：未找到工具 " + toolName;
        }
        try {
            return tool.call(inputJson);
        } catch (Exception e) {
            return "工具执行异常：%s - %s".formatted(e.getClass().getSimpleName(), e.getMessage());
        }
    }

    private String extractAction(String response) {
        return extractBetween(response, "Action:", "Action Input:").trim();
    }

    private String extractActionInput(String response) {
        int idx = response.indexOf("Action Input:");
        if (idx < 0) return "{}";
        return response.substring(idx + "Action Input:".length()).trim();
    }

    private String extractBetween(String text, String start, String end) {
        int si = text.indexOf(start);
        int ei = text.indexOf(end);
        if (si < 0 || ei < 0) return "";
        return text.substring(si + start.length(), ei);
    }

    private Map<String, Object> parseJson(String json) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }
}
```

### 4.1 Spring Boot 应用入口

```java
// AgentMemoryApplication.java
package com.example.agent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemory;

@SpringBootApplication
public class AgentMemoryApplication {

    public static void main(String[] args) {
        SpringApplication.run(AgentMemoryApplication.class, args);
    }

    @Bean
    public ChatMemory chatMemory() {
        return new InMemoryChatMemory();
    }
}
```

## 五、最佳实践

1. **Memory 分级**：不要将所有信息都放进同一层 Memory。短期对话用 ChatMemory，用户偏好用向量存储，任务状态用 WorkingMemory。

2. **Token 预算意识**：每次 LLM 调用前检查 Token 预算。超出预算时优先压缩中间部分而非截断最近对话。

3. **Plan 要有退出条件**：ReAct 循环必须设置 `maxSteps`，防止死循环。Plan-and-Execute 中每步要有超时。

4. **WorkingMemory 结构化**：使用 JSON 而非自然语言存储中间状态，便于程序读取和修改。

5. **Reflection 性价比**：Reflection 会成倍增加 API 调用次数。只在关键任务（如代码生成、数据分析）中使用，简单对话不需要。

## 六、常见问题

**Q: 如何选择 ReAct vs Plan-and-Execute？**
A: 任务步骤不确定、需要根据中间结果动态调整时用 ReAct。任务步骤明确、可预先规划时用 Plan-and-Execute（更高效，因为只需两次 LLM 调用）。

**Q: 如何防止 Memory 膨胀？**
A: 设置每条 Memory 的 TTL（过期时间），定期清理。ChatMemory 设置最大消息数。向量存储设置相似度阈值，相似度低于阈值的记忆不检索。

**Q: ReAct 陷入循环怎么办？**
A: 设置 `maxSteps` 硬限制。监控连续相同的 Action（连续3次相同操作说明陷入循环），注入"请尝试不同的方法"的提示。

---

## Tree of Thought规划

Tree of Thought（ToT）是 Google DeepMind 和普林斯顿大学于 2023 年提出的规划策略，核心思想是将推理过程建模为一棵搜索树——每个节点代表一个中间思维状态，每条边代表一个推理步骤。与传统链式推理不同，ToT 在关键节点"分叉"出多个候选推理路径，通过广度优先（BFS）或深度优先（DFS）搜索策略探索解空间。

**与 ReAct 的关键区别**：ReAct 是线性执行 Thought → Action → Observation 循环，每步只有一个"当前最佳"方向；ToT 则在每个决策点生成 3-5 个候选分支，并行评估后保留高分路径、剪除低分路径。这使得 ToT 在需要探索性推理的任务（数学证明、代码生成、策略规划）中表现显著优于链式推理。

**状态评估机制**：ToT 的核心在于"评估器"——每生成一个中间状态，LLM 对该状态进行打分（1-10 分）。评估维度包括：当前状态有多大可能导向正确答案（potential）、该状态的一致性和逻辑自洽性（coherence）、距离目标还有多远（proximity）。低分状态（如低于 5 分）被剪枝，高分状态进入下一轮扩展。

**BFS vs DFS 策略对比**：BFS 在每层保留 top-k 个状态（如 k=3），逐层扩展所有保留的状态后再进入下一层。优点是探索充分、不易错过最优解；缺点是 Token 消耗大（每层 3-5 个分支，每分支评估一次）。DFS 选择一个最有潜力的分支一路深入，遇到低分或死路时回溯。优点是更快到达叶子节点、Token 消耗少；缺点是可能陷入次优解。生产实践中，对于确信度高的任务用 DFS，探索性任务用 BFS。

```java
// JDK 25 + Spring Boot 4.x — TreeOfThoughtPlanner 实现
import java.util.*;
import java.util.concurrent.*;

public class TreeOfThoughtPlanner {

    public enum SearchStrategy { BFS, DFS }

    private final ChatClient chatClient;
    private final int beamWidth;       // BFS 每层保留节点数
    private final int maxDepth;
    private final double scoreThreshold; // 低于此分剪枝

    public TreeOfThoughtPlanner(ChatClient chatClient,
                                 int beamWidth, int maxDepth, double scoreThreshold) {
        this.chatClient = chatClient;
        this.beamWidth = beamWidth;
        this.maxDepth = maxDepth;
        this.scoreThreshold = scoreThreshold;
    }

    record ThoughtNode(String content, double score,
                       ThoughtNode parent, int depth) {}

    public Optional<ThoughtNode> search(String problem, SearchStrategy strategy) {
        var root = new ThoughtNode(problem, 10.0, null, 0);
        return switch (strategy) {
            case BFS -> bfs(root);
            case DFS -> dfs(root);
        };
    }

    private Optional<ThoughtNode> bfs(ThoughtNode root) {
        var frontier = new PriorityQueue<ThoughtNode>(
                Comparator.comparingDouble(ThoughtNode::score).reversed());
        frontier.add(root);
        int currentDepth = 0;

        while (!frontier.isEmpty() && currentDepth < maxDepth) {
            var batch = new ArrayList<ThoughtNode>();
            while (!frontier.isEmpty() &&
                   frontier.peek().depth() == currentDepth) {
                batch.add(frontier.poll());
            }

            var candidates = new PriorityQueue<ThoughtNode>(
                    Comparator.comparingDouble(ThoughtNode::score).reversed());

            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var futures = batch.stream()
                    .map(node -> executor.submit(() ->
                        expandAndEvaluate(node)))
                    .toList();

                for (var future : futures) {
                    try {
                        candidates.addAll(future.get(30, TimeUnit.SECONDS));
                    } catch (TimeoutException e) {
                        // 超时的分支直接丢弃
                    }
                }
            }

            for (int i = 0; i < beamWidth && !candidates.isEmpty(); i++) {
                frontier.add(candidates.poll());
            }
            currentDepth++;
        }

        return Optional.ofNullable(frontier.peek());
    }

    private Optional<ThoughtNode> dfs(ThoughtNode node) {
        if (node.depth() >= maxDepth || isComplete(node)) {
            return Optional.of(node);
        }
        var children = expandAndEvaluate(node);
        for (var child : children) {
            var result = dfs(child);
            if (result.isPresent()) return result;
        }
        return Optional.empty();
    }

    private List<ThoughtNode> expandAndEvaluate(ThoughtNode node) {
        // 1. 生成 3-5 个候选后续状态
        var branches = chatClient.call(
            "基于当前状态生成3个不同的后续推理步骤，JSON数组格式：\n" + node.content());

        // 2. 对每个候选状态评分
        return branches.stream()
            .map(branch -> {
                var score = evaluateState(node.content(), branch);
                return new ThoughtNode(branch, score, node, node.depth() + 1);
            })
            .filter(n -> n.score() >= scoreThreshold)
            .sorted(Comparator.comparingDouble(ThoughtNode::score).reversed())
            .toList();
    }

    private double evaluateState(String parentState, String childState) {
        var prompt = """
            评估以下推理步骤的质量（1-10分），返回纯数字：
            上一步：%s
            当前步：%s
            评估维度：逻辑连贯性、进展程度、创新性
            """.formatted(parentState, childState);
        var response = chatClient.call(prompt);
        return Double.parseDouble(response.trim());
    }

    private boolean isComplete(ThoughtNode node) {
        return node.content().contains("[FINAL_ANSWER]");
    }

    // 使用示例
    public static void main(String[] args) {
        var planner = new TreeOfThoughtPlanner(
                ChatClient.create("anthropic/claude-sonnet-4-20250514"),
                3,   // beamWidth
                5,   // maxDepth
                5.0  // scoreThreshold
        );

        var result = planner.search(
                "证明：对于任意正整数n，n^3 - n是6的倍数",
                SearchStrategy.BFS);

        result.ifPresentOrElse(
            node -> System.out.println("找到解：" + node.content()),
            () -> System.out.println("未找到满足要求的解"));
    }

    // 简化的 ChatClient stub（实际使用 Spring AI 2.x ChatClient）
    interface ChatClient {
        List<String> call(String prompt);
        static ChatClient create(String model) { return prompt -> List.of(); }
    }
}
```

Tree of Thought 展现了 LLM 作为"世界模型"的潜力——不改变模型本身，仅通过系统2式的深思熟虑（System 2 thinking），就能在复杂推理任务上获得显著提升。代价是 API 调用次数成倍增加，因此仅适用于高价值推理任务。

---

**总结**：Memory 和 Planning 是 Agent 智能的两大支柱。ChatMemory 实现上下文连续性，向量存储实现长期知识积累，WorkingMemory 实现复杂任务的逐步完成。三种 Planning 策略各有适用场景，根据任务特点选择。
