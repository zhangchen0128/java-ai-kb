---
domain: 12-Agent工程
title: 多 Agent 协作架构模式与实战
status: draft
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/api/effective-agents.html
    description: Spring AI Multi-Agent 相关文档
  - level: L2
    url: https://arxiv.org/abs/2308.08155
    description: "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation"
  - level: L2
    url: https://github.com/google/A2A
    description: Google Agent-to-Agent (A2A) 协议
relations:
  prerequisite:
    - 12-ToolCalling完整剖析
    - 12-Agent记忆与规划
  related:
    - 12-Agent工作流与人机协作
tags:
  - multi-agent
  - collaboration
  - code-review
  - a2a
  - swarm
created: 2026-07-17
updated: 2026-07-28
content_type: production
---

# 多 Agent 协作架构模式与实战

## 一、多 Agent 架构模式

单 Agent 适合处理定义清晰、范围有限的简单任务。但当任务复杂度上升——需要多种专业能力、需要多角度验证、或者需要并行处理多个子任务时，单 Agent 就显得力不从心。多 Agent 协作通过将任务拆分给具备不同专长的 Agent，实现更强大、更可靠的 AI 系统。

### 1.1 Sequential（流水线模式）

```
Agent A（解析）→ Agent B（处理）→ Agent C（验证）→ 最终输出
```

每个 Agent 处理自己的阶段，输出作为下一个 Agent 的输入。这是最简单的多 Agent 模式，适合有明确处理流程的任务。

**典型场景**：
- 文档翻译：源语言解析 → 翻译 → 校对润色
- 代码生成：需求分析 → 代码编写 → 测试生成 → 文档生成
- 数据处理：数据清洗 → 数据分析 → 报告生成

```java
// SequentialPipeline.java
package com.example.multiagent.pipeline;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public class SequentialPipeline {

    private final List<Agent> agents;

    public SequentialPipeline(List<Agent> agents) {
        this.agents = agents;
    }

    public String execute(String input) {
        var current = input;
        for (var agent : agents) {
            current = agent.process(current);
        }
        return current;
    }

    @FunctionalInterface
    public interface Agent {
        String process(String input);
    }
}
```

### 1.2 Hierarchical（层级模式）

```
           Master Agent
          /      |      \
    Worker A  Worker B  Worker C
          \      |      /
           Master 汇总
```

Master Agent 负责任务分解和结果汇总，Worker Agent 负责执行具体子任务。这是最常用的多 Agent 模式，适合需要任务分解的复杂场景。

### 1.3 Debate / Discussion（辩论模式）

```
Agent A（正方） → Agent B（反方） → Agent C（裁判）→ 最终结论
```

多个 Agent 从不同角度分析同一问题，通过辩论、互相质疑和修正，最终达成共识或由裁判 Agent 做出最终判断。这种模式能有效减少单一模型的偏见和错误。

### 1.4 Swarm / Orchestra（动态分配模式）

```
          Orchestrator
         /     |     \
    [动态决定哪个 Agent 处理哪个子任务]
```

Orchestrator 根据任务内容动态决定分配策略，Agent 池中的 Agent 可以按需加入或退出。这是最灵活但也最复杂的模式。

### 1.5 Agent as Tool

将 Agent 封装为 Tool，由主 Agent 通过 Tool Calling 机制调用。这是最简单的多 Agent 集成方式：

```java
@Component
public class CodeReviewAgentTool implements ToolCallback {

    private final ChatClient reviewerAgent;

    public CodeReviewAgentTool(ChatClient.Builder builder) {
        this.reviewerAgent = builder
            .defaultSystem("""
                你是一个资深代码审查专家。审查代码时关注：
                1. 安全漏洞（SQL注入、XSS、敏感信息泄露）
                2. 性能问题（N+1查询、内存泄漏、不必要的对象创建）
                3. 代码规范（命名、注释、异常处理）
                4. 架构问题（循环依赖、职责不清）
                
                输出格式：问题列表（带严重级别和建议修复方案）
                """)
            .build();
    }

    @Override
    public ToolDefinition getToolDefinition() {
        return ToolDefinition.builder()
            .name("review_code")
            .description("审查指定代码文件或代码片段，返回审查意见")
            .inputSchema("""
                {
                  "type": "object",
                  "properties": {
                    "code": {"type": "string", "description": "待审查的代码内容"},
                    "language": {"type": "string", "description": "编程语言", "enum": ["java", "python", "javascript", "go"]}
                  },
                  "required": ["code"]
                }
                """)
            .build();
    }

    @Override
    public ToolMetadata getToolMetadata() {
        return ToolMetadata.builder().returnDirect(false).build();
    }

    @Override
    public String call(String toolInput) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var node = mapper.readTree(toolInput);
            var code = node.get("code").asText();
            return reviewerAgent.prompt()
                .user("请审查以下代码：\n\n```\n" + code + "\n```")
                .call()
                .content();
        } catch (Exception e) {
            return "代码审查失败: " + e.getMessage();
        }
    }
}
```

## 二、消息传递模式

### 2.1 Direct Messaging

Agent 之间通过直接发送消息通信。简单直接，但耦合度高：

```java
// DirectMessageBroker.java
package com.example.multiagent.messaging;

import java.util.concurrent.*;
import java.util.function.Function;

public class DirectMessageBroker {

    private final ConcurrentHashMap<String, Function<String, String>> agentRegistry 
        = new ConcurrentHashMap<>();

    public void register(String agentName, Function<String, String> handler) {
        agentRegistry.put(agentName, handler);
    }

    public String send(String targetAgent, String message) {
        var handler = agentRegistry.get(targetAgent);
        if (handler == null) {
            return "错误：Agent '%s' 未注册".formatted(targetAgent);
        }
        return handler.apply(message);
    }

    /**
     * 广播给所有 Agent
     */
    public Map<String, String> broadcast(String message) {
        var results = new ConcurrentHashMap<String, String>();
        agentRegistry.forEach((name, handler) -> {
            results.put(name, handler.apply(message));
        });
        return results;
    }
}
```

### 2.2 Pub/Sub Topic 模式

Agent 通过订阅 Topic 实现松耦合。适合事件驱动的协作场景：

```java
// TopicBasedMessageBus.java
package com.example.multiagent.messaging;

import java.util.*;
import java.util.concurrent.*;

public class TopicBasedMessageBus {

    private final ConcurrentHashMap<String, List<Subscriber>> topics = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public record Subscriber(String agentName, java.util.function.Consumer<Message> handler) {}

    public record Message(String topic, String sender, String content, Map<String, Object> metadata) {}

    /**
     * 订阅 Topic
     */
    public void subscribe(String topic, String agentName, 
                           java.util.function.Consumer<Message> handler) {
        topics.computeIfAbsent(topic, k -> new CopyOnWriteArrayList<>())
              .add(new Subscriber(agentName, handler));
    }

    /**
     * 发布消息到 Topic（异步）
     */
    public void publish(Message message) {
        var subscribers = topics.getOrDefault(message.topic(), List.of());
        subscribers.forEach(sub -> {
            executor.submit(() -> {
                try {
                    sub.handler().accept(message);
                } catch (Exception e) {
                    System.err.printf("Agent %s 处理消息失败: %s%n", 
                        sub.agentName(), e.getMessage());
                }
            });
        });
    }
}
```

### 2.3 Shared Blackboard（共享黑板）

Agent 共享一个"黑板"（共享数据结构），各自读取和写入信息。适合需要多个 Agent 协作完成一个共同任务（如联合诊断）：

```java
// Blackboard.java
package com.example.multiagent.messaging;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class Blackboard {

    private final ConcurrentHashMap<String, Object> data = new ConcurrentHashMap<>();
    private final List<BlackboardEntry> history = new ArrayList<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    public record BlackboardEntry(String key, Object value, String agentName, long timestamp) {}

    /**
     * 写入黑板（带锁保护）
     */
    public void write(String key, Object value, String agentName) {
        lock.writeLock().lock();
        try {
            data.put(key, value);
            history.add(new BlackboardEntry(key, value, agentName, System.currentTimeMillis()));
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * 读取黑板
     */
    @SuppressWarnings("unchecked")
    public <T> Optional<T> read(String key) {
        lock.readLock().lock();
        try {
            return Optional.ofNullable((T) data.get(key));
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * 获取黑板的完整快照
     */
    public Map<String, Object> snapshot() {
        lock.readLock().lock();
        try {
            return new HashMap<>(data);
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * 获取最近的变更历史
     */
    public List<BlackboardEntry> recentHistory(int limit) {
        lock.readLock().lock();
        try {
            int from = Math.max(0, history.size() - limit);
            return new ArrayList<>(history.subList(from, history.size()));
        } finally {
            lock.readLock().unlock();
        }
    }
}
```

## 三、A2A 协议简要介绍

Google 推出的 Agent-to-Agent (A2A) 协议定义了 Agent 之间通信的标准方式。核心概念：

- **Agent Card**：描述 Agent 能力的 JSON 清单（类似 OpenAPI 的 Spec）。
- **Task**：Agent 之间传递的工作单元，有唯一 ID 和状态。
- **Message**：Agent 间的通信消息，支持文本、文件、结构化数据。
- **Streaming**：支持流式传输长任务的中间结果。

A2A 的核心价值在于标准化——就像 HTTP 让不同服务器能互相通信一样，A2A 让不同厂商的 Agent 能互操作。

```json
// Agent Card 示例
{
  "name": "CodeReviewAgent",
  "description": "代码审查 Agent，支持 Java/Python/JavaScript 代码审查",
  "url": "https://agents.example.com/code-review",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "security_review",
      "name": "安全审查",
      "description": "检测常见安全漏洞",
      "tags": ["security", "owasp", "vulnerability"]
    }
  ],
  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "json"]
}
```

## 四、多 Agent 挑战

### 4.1 一致性问题

多个 Agent 可能对同一事实给出矛盾的回答。例如 Reviewer A 说"代码有安全问题"，Security Auditor B 说"没有安全风险"——用户该信谁？

**解决方案**：
- 设置仲裁 Agent（Judge）负责最终裁决。
- 要求每个 Agent 提供置信度评分。
- 使用投票机制（多数 Agent 的意见胜出）。

### 4.2 死循环

两个 Agent 互相调用形成死循环：
```
Agent A → 调用 Agent B → Agent B 需要更多信息 → 调用 Agent A → ...
```

**解决方案**：
- 设置最大调用深度。
- 检测循环模式（相同参数重复调用）。
- 设置总 Token 消耗上限。

### 4.3 Token 消耗爆炸

多 Agent 系统中，每个 Agent 都有独立的上下文窗口。3个 Agent 各消耗 5000 Token → 总共 15000 Token。

**解决方案**：
- 共享上下文压缩（摘要传递而非完整对话）。
- 按需加载 Agent（非活跃 Agent 释放上下文）。
- 设置全局 Token 预算。

### 4.4 错误传播

Agent A 的错误输出被 Agent B 当作正确输入使用，导致错误放大。

**解决方案**：
- 每个 Agent 验证输入的合法性。
- 关键节点设置"哨兵 Agent"专门做质量检查。
- 实现熔断机制（连续错误超过阈值时中断流程）。

```java
// CircuitBreakerAgent.java
package com.example.multiagent.safety;

import java.util.concurrent.atomic.AtomicInteger;
import java.time.Instant;

public class CircuitBreakerAgent {

    private final int failureThreshold;
    private final long resetTimeoutMs;
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private volatile Instant lastFailureTime;
    private volatile boolean isOpen = false;

    public CircuitBreakerAgent(int failureThreshold, long resetTimeoutMs) {
        this.failureThreshold = failureThreshold;
        this.resetTimeoutMs = resetTimeoutMs;
    }

    public boolean allowRequest() {
        if (!isOpen) return true;
        // 检查是否可以尝试重置
        if (lastFailureTime != null &&
            Instant.now().toEpochMilli() - lastFailureTime.toEpochMilli() > resetTimeoutMs) {
            isOpen = false;
            failureCount.set(0);
            return true;
        }
        return false;
    }

    public void recordSuccess() {
        failureCount.set(0);
        isOpen = false;
    }

    public void recordFailure() {
        lastFailureTime = Instant.now();
        if (failureCount.incrementAndGet() >= failureThreshold) {
            isOpen = true;
        }
    }
}
```

## 五、完整代码：代码审查多 Agent 系统

以下是一个完整的代码审查多 Agent 系统，包含三个专业 Agent：

- **Reviewer Agent**：代码质量和最佳实践审查
- **Security Auditor Agent**：安全漏洞检测
- **Optimizer Agent**：性能优化建议

### 5.1 审查结果数据模型

```java
// ReviewReport.java
package com.example.multiagent.model;

import java.util.List;

public record ReviewReport(
    String codeSnippet,
    String language,
    List<Finding> qualityFindings,
    List<Finding> securityFindings,
    List<Finding> performanceFindings,
    Summary summary
) {
    public record Finding(
        String id,
        String category,    // "quality", "security", "performance"
        String severity,    // "critical", "high", "medium", "low", "info"
        int line,
        String title,
        String description,
        String suggestion,
        String codeExample  // 修复代码示例
    ) {}

    public record Summary(
        int totalIssues,
        int criticalIssues,
        int highIssues,
        int mediumIssues,
        double overallScore,  // 0-100
        String recommendation  // "approve", "approve_with_comments", "request_changes"
    ) {}
}
```

### 5.2 Agent 定义

```java
// CodeReviewAgents.java
package com.example.multiagent.agents;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class CodeReviewAgents {

    private final ChatClient reviewerAgent;
    private final ChatClient securityAgent;
    private final ChatClient optimizerAgent;
    private final ChatClient orchestratorAgent;

    public CodeReviewAgents(ChatClient.Builder builder) {
        this.reviewerAgent = builder
            .defaultSystem("""
                你是一个资深代码审查专家（Code Reviewer）。
                
                审查重点：
                1. 代码可读性和命名规范
                2. 异常处理是否完善
                3. 是否有明显的逻辑错误
                4. 是否遵循 SOLID 原则
                5. 单元测试覆盖是否充分
                6. 是否有不必要的复杂度
                
                输出JSON格式：
                {
                  "findings": [
                    {
                      "line": 行号,
                      "severity": "critical|high|medium|low|info",
                      "title": "问题标题",
                      "description": "问题描述",
                      "suggestion": "修复建议",
                      "codeExample": "修复代码示例"
                    }
                  ],
                  "score": 0-100,
                  "summary": "一句话总结"
                }
                """)
            .build();

        this.securityAgent = builder
            .defaultSystem("""
                你是一个应用安全专家（Security Auditor）。
                
                审查重点（OWASP Top 10相关）：
                1. SQL注入、命令注入
                2. XSS（跨站脚本攻击）
                3. 敏感信息泄露（日志、异常堆栈、响应体）
                4. 不安全的反序列化
                5. 权限校验缺失
                6. CSRF漏洞
                7. 不安全的加密算法使用
                8. 硬编码密钥/密码
                9. SSRF（服务端请求伪造）
                10. 路径遍历漏洞
                
                输出JSON格式，同 Reviewer。
                """)
            .build();

        this.optimizerAgent = builder
            .defaultSystem("""
                你是一个性能优化专家（Performance Optimizer）。
                
                审查重点：
                1. N+1查询问题
                2. 不必要的对象创建
                3. 锁竞争和并发问题
                4. 大数据量下的算法复杂度
                5. 缓存策略缺失
                6. 数据库索引使用不当
                7. 连接池/线程池配置问题
                8. 内存泄漏风险
                9. 不必要的同步阻塞
                10. 批处理优化机会
                
                输出JSON格式，同 Reviewer。
                """)
            .build();

        this.orchestratorAgent = builder
            .defaultSystem("""
                你是一个代码审查协调者（Orchestrator）。
                
                你的职责：
                1. 综合三个专家的审查意见
                2. 去重（同一行代码的同一问题只报告一次）
                3. 按严重性排序
                4. 生成最终的综合报告和建议
                5. 计算加权总分（安全权重50%，质量30%，性能20%）
                
                输出JSON格式：
                {
                  "findings": [...去重合并后的所有发现...],
                  "summary": {
                    "totalIssues": 总数,
                    "criticalIssues": 严重问题数,
                    "highIssues": 高优先级问题数,
                    "mediumIssues": 中优先级问题数,
                    "overallScore": 综合评分,
                    "recommendation": "approve|approve_with_comments|request_changes"
                  },
                  "executiveSummary": "给管理层的简要总结"
                }
                """)
            .build();
    }

    public ChatClient reviewer() { return reviewerAgent; }
    public ChatClient security() { return securityAgent; }
    public ChatClient optimizer() { return optimizerAgent; }
    public ChatClient orchestrator() { return orchestratorAgent; }
}
```

### 5.3 多 Agent 协调器

```java
// CodeReviewOrchestrator.java
package com.example.multiagent.orchestrator;

import com.example.multiagent.agents.CodeReviewAgents;
import com.example.multiagent.model.ReviewReport;
import com.example.multiagent.safety.CircuitBreakerAgent;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.*;

@Service
public class CodeReviewOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(CodeReviewOrchestrator.class);

    private final CodeReviewAgents agents;
    private final ObjectMapper mapper;
    private final CircuitBreakerAgent circuitBreaker;

    public CodeReviewOrchestrator(CodeReviewAgents agents) {
        this.agents = agents;
        this.mapper = new ObjectMapper();
        this.circuitBreaker = new CircuitBreakerAgent(5, 30_000); // 5次失败/30秒熔断
    }

    /**
     * 执行完整的代码审查流程
     * 使用 Virtual Threads 并行运行三个 Agent
     */
    @SuppressWarnings("unchecked")
    public ReviewReport review(String code, String language) {
        if (!circuitBreaker.allowRequest()) {
            throw new IllegalStateException("代码审查服务暂时不可用（熔断器已打开）");
        }

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {

            // 并行执行三个 Agent
            var qualityFuture = executor.submit(() -> 
                runAgent(agents.reviewer(), code, "quality"));
            var securityFuture = executor.submit(() -> 
                runAgent(agents.security(), code, "security"));
            var performanceFuture = executor.submit(() -> 
                runAgent(agents.optimizer(), code, "performance"));

            // 等待所有 Agent 完成（带超时）
            Map<String, Object> qualityResult;
            Map<String, Object> securityResult;
            Map<String, Object> performanceResult;

            try {
                qualityResult = qualityFuture.get(60, TimeUnit.SECONDS);
                securityResult = securityFuture.get(60, TimeUnit.SECONDS);
                performanceResult = performanceFuture.get(60, TimeUnit.SECONDS);
                circuitBreaker.recordSuccess();
            } catch (TimeoutException e) {
                circuitBreaker.recordFailure();
                throw new RuntimeException("代码审查超时，部分 Agent 未能在60秒内完成", e);
            } catch (ExecutionException e) {
                circuitBreaker.recordFailure();
                throw new RuntimeException("代码审查执行失败", e.getCause());
            }

            // 协调者综合分析
            var orchestrationInput = buildOrchestrationInput(
                code, qualityResult, securityResult, performanceResult);
            var finalReport = agents.orchestrator()
                .prompt()
                .user(orchestrationInput)
                .call()
                .content();

            return parseFinalReport(finalReport, code, language);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("代码审查被中断", e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> runAgent(ChatClient agent, String code, String agentType) {
        try {
            var response = agent.prompt()
                .user("请审查以下%s代码：\n\n```%s\n%s\n```".formatted(
                    agentType.equals("quality") ? "代码质量和最佳实践" :
                    agentType.equals("security") ? "代码安全性（OWASP Top 10）" :
                    "代码性能",
                    "java", code))
                .call()
                .content();

            // 提取 JSON
            var jsonStart = response.indexOf('{');
            var jsonEnd = response.lastIndexOf('}');
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                var json = response.substring(jsonStart, jsonEnd + 1);
                return mapper.readValue(json, 
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            }
            return Map.of("findings", List.of(), "score", 100, "summary", "无法解析结果");
        } catch (Exception e) {
            log.error("{} Agent 执行失败", agentType, e);
            return Map.of(
                "findings", List.of(),
                "score", 100,
                "summary", "Agent 执行异常: " + e.getMessage()
            );
        }
    }

    private String buildOrchestrationInput(String code,
                                            Map<String, Object> quality,
                                            Map<String, Object> security,
                                            Map<String, Object> performance) {
        try {
            return """
                请综合分析以下三个专家的代码审查结果，给出最终报告。
                
                ## 原始代码
                ```java
                %s
                ```
                
                ## 质量审查结果
                ```json
                %s
                ```
                
                ## 安全审查结果
                ```json
                %s
                ```
                
                ## 性能审查结果
                ```json
                %s
                ```
                
                请去重、合并、排序后输出最终综合报告。
                """.formatted(
                    code,
                    mapper.writerWithDefaultPrettyPrinter().writeValueAsString(quality),
                    mapper.writerWithDefaultPrettyPrinter().writeValueAsString(security),
                    mapper.writerWithDefaultPrettyPrinter().writeValueAsString(performance)
                );
        } catch (Exception e) {
            throw new RuntimeException("构建编排输入失败", e);
        }
    }

    @SuppressWarnings("unchecked")
    private ReviewReport parseFinalReport(String json, String code, String language) {
        try {
            var jsonStart = json.indexOf('{');
            var jsonEnd = json.lastIndexOf('}');
            if (jsonStart < 0 || jsonEnd <= jsonStart) {
                return emptyReport(code, language);
            }
            var reportJson = json.substring(jsonStart, jsonEnd + 1);
            var map = mapper.readValue(reportJson, 
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});

            var findings = parseFindings(map);
            var summaryMap = (Map<String, Object>) map.get("summary");

            return new ReviewReport(
                code,
                language,
                findings.stream().filter(f -> "quality".equals(f.category())).toList(),
                findings.stream().filter(f -> "security".equals(f.category())).toList(),
                findings.stream().filter(f -> "performance".equals(f.category())).toList(),
                new ReviewReport.Summary(
                    ((Number) summaryMap.get("totalIssues")).intValue(),
                    ((Number) summaryMap.get("criticalIssues")).intValue(),
                    ((Number) summaryMap.get("highIssues")).intValue(),
                    ((Number) summaryMap.get("mediumIssues")).intValue(),
                    ((Number) summaryMap.get("overallScore")).doubleValue(),
                    (String) summaryMap.get("recommendation")
                )
            );
        } catch (Exception e) {
            log.error("解析审查报告失败", e);
            return emptyReport(code, language);
        }
    }

    @SuppressWarnings("unchecked")
    private List<ReviewReport.Finding> parseFindings(Map<String, Object> map) {
        var findingsList = (List<Map<String, Object>>) map.get("findings");
        if (findingsList == null) return List.of();

        return findingsList.stream()
            .map(f -> new ReviewReport.Finding(
                "F-" + UUID.randomUUID().toString().substring(0, 8),
                (String) f.getOrDefault("category", "quality"),
                (String) f.getOrDefault("severity", "info"),
                ((Number) f.getOrDefault("line", 0)).intValue(),
                (String) f.getOrDefault("title", ""),
                (String) f.getOrDefault("description", ""),
                (String) f.getOrDefault("suggestion", ""),
                (String) f.getOrDefault("codeExample", "")
            ))
            .toList();
    }

    private ReviewReport emptyReport(String code, String language) {
        return new ReviewReport(code, language, List.of(), List.of(), List.of(),
            new ReviewReport.Summary(0, 0, 0, 0, 100.0, "approve"));
    }
}
```

### 5.4 Spring Boot 应用与 API

```java
// CodeReviewController.java
package com.example.multiagent.controller;

import com.example.multiagent.model.ReviewReport;
import com.example.multiagent.orchestrator.CodeReviewOrchestrator;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/review")
public class CodeReviewController {

    private final CodeReviewOrchestrator orchestrator;

    public CodeReviewController(CodeReviewOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    @PostMapping("/code")
    public ReviewReport reviewCode(@RequestBody CodeReviewRequest request) {
        return orchestrator.review(request.code(), request.language());
    }
}

record CodeReviewRequest(String code, String language) {}
```

```java
// MultiAgentApplication.java
package com.example.multiagent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MultiAgentApplication {
    public static void main(String[] args) {
        SpringApplication.run(MultiAgentApplication.class, args);
    }
}
```

## 六、最佳实践

1. **Agent 专一化**：每个 Agent 只负责一个明确的领域。不要试图让一个 Agent 既做安全审查又做性能优化。

2. **并行优先**：多个 Agent 之间没有依赖时，使用 Virtual Threads 并行执行，显著提升响应速度。

3. **设置熔断器**：多 Agent 系统复杂度高，故障概率也更高。为每个 Agent 调用设置超时和熔断保护。

4. **去重与仲裁**：多个 Agent 可能发现相同的问题。Orchestrator 必须负责去重和优先级排序。

5. **结构化输出**：要求每个 Agent 输出 JSON，便于程序化处理和合并。

6. **成本控制**：多 Agent 意味着多倍 Token 消耗。只为高价值任务使用多 Agent（如代码审查、安全审计），简单问答用单 Agent。

## 七、常见问题

**Q: 多少 Agent 合适？**
A: 以 3-5 个为宜。超过 5 个 Agent 后协调成本急剧上升，边际收益递减。如果一个任务需要更多 Agent，考虑拆分为多个子流程。

**Q: Agent 之间如何共享上下文？**
A: 短上下文用消息直接传递；长上下文用 Blackboard 模式；跨会话的记忆用向量数据库。

**Q: 如何避免"群体思维"？**
A: 使用 Debate 模式让 Agent 互相质疑；设置"魔鬼代言人"Agent 专门提出反对意见；要求每个 Agent 独立输出后再汇总。

---

## 委托模式（Delegation）

委托模式是多 Agent 协作中最基础也最常用的模式。在一个 Agent（委托方）执行任务过程中，识别出需要专业技能的子任务，将其委托给另一个 Agent（被委托方），等待结果后继续自身流程。这与人类组织中"经理给专家分配任务"的工作方式一致。

委托模式的核心要素：（1）**清晰的任务描述**——被委托方需要明确知道要做什么、输入是什么、期望产出什么；（2）**结构化的输出格式**——通常要求 JSON 格式，便于委托方解析和处理；（3）**超时与降级**——被委托 Agent 可能失败或超时，委托方必须有兜底策略。

与 Orchestrator 模式的区别：委托是"临时起意"的，在 Agent 执行流程中动态决定；而 Orchestrator 是预先设计的中央调度。委托更灵活但管理难度更高——委托方需要自己处理超时、重试和结果校验。

```java
// JDK 25 + Spring Boot 4.x — DelegationManager with CompletableFuture
import java.util.*;
import java.util.concurrent.*;
import java.time.Duration;

public class DelegationManager {

    private final ExecutorService executor =
            Executors.newVirtualThreadPerTaskExecutor();

    record DelegationTask(String taskId, String description,
                          String delegateAgent, Map<String, Object> input) {}

    record DelegationResult(String taskId, String agentName,
                            Object output, boolean success, String error) {}

    /**
     * 委托一个子任务给指定 Agent，异步等待结果
     */
    public CompletableFuture<DelegationResult> delegate(
            String delegateAgent, String taskDescription,
            Map<String, Object> input, Duration timeout) {

        var task = new DelegationTask(
                UUID.randomUUID().toString(),
                taskDescription, delegateAgent, input);

        return CompletableFuture.supplyAsync(() -> {
            try {
                var response = sendToAgent(delegateAgent,
                    buildPrompt(taskDescription, input));

                return new DelegationResult(
                    task.taskId(), delegateAgent,
                    parseResponse(response), true, null);
            } catch (Exception e) {
                return new DelegationResult(
                    task.taskId(), delegateAgent,
                    null, false, e.getMessage());
            }
        }, executor)
        .orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
        .exceptionally(ex -> new DelegationResult(
            task.taskId(), delegateAgent, null, false,
            "Timeout or error: " + ex.getMessage()));
    }

    /**
     * 带降级策略的委托：主Agent失败时尝试备用Agent
     */
    public CompletableFuture<DelegationResult> delegateWithFallback(
            String primaryAgent, String fallbackAgent,
            String taskDescription, Map<String, Object> input) {

        return delegate(primaryAgent, taskDescription, input, Duration.ofSeconds(30))
            .thenCompose(result -> {
                if (result.success()) {
                    return CompletableFuture.completedFuture(result);
                }
                System.out.println("主Agent [" + primaryAgent +
                    "] 委托失败，降级到备用Agent [" + fallbackAgent + "]");
                return delegate(fallbackAgent, taskDescription,
                    input, Duration.ofSeconds(30));
            });
    }

    private String buildPrompt(String description, Map<String, Object> input) {
        return """
            你需要完成以下任务：
            %s

            输入数据：
            %s

            请以JSON格式返回结果：{"status":"success","data":...}
            """.formatted(description, input);
    }

    private String sendToAgent(String agentName, String prompt) {
        // 实际实现通过 AgentRegistry 查找Agent并发送消息
        return "{\"status\":\"success\",\"data\":{}}";
    }

    private Object parseResponse(String response) {
        // JSON 解析逻辑
        return response;
    }

    // 使用示例
    public static void main(String[] args) throws Exception {
        var manager = new DelegationManager();

        var future = manager.delegateWithFallback(
            "code-reviewer", "backup-reviewer",
            "审查以下代码片段的安全漏洞",
            Map.of("code", "public void process(String sql) {...}"));

        var result = future.get();
        System.out.println("委托结果：" + (result.success() ? "成功" : "失败: " + result.error()));
    }
}
```

---

## 持久化工作流（Saga+Outbox在Agent中的应用）

当 Agent 执行多步骤业务流程时（如保险理赔：查询保单 → 验证事故 → 计算赔付 → 执行支付），中间任何一步失败都需要回滚已执行的步骤。这正是微服务领域 Saga 模式要解决的问题，其思想同样适用于 Agent 工作流。

**Saga 模式在 Agent 中的应用**：将 Agent 的多步骤任务建模为一个 Saga——每步有正向操作（execute）和补偿操作（compensate）。当某步失败时，逆序执行已成功步骤的补偿操作，保证最终一致性。例如：理赔 Agent 成功"创建赔案"但"执行支付"失败，则补偿"标记赔案为已取消"。

**Outbox 模式的作用**：在 Saga 执行过程中，每一步的执行事件必须可靠发布（不能被静默丢失）。Outbox 模式将领域事件和业务操作在同一事务中写入 outbox 表，然后由独立的消息中继（Message Relay）异步投递，保证 at-least-once 语义。

**与 Agent 的天然结合**：Agent 的 Tool 调用本质上是"执行操作并返回结果"。将每个 Tool 包装为 Saga Step，赋予补偿逻辑；Tool 执行后将事件写入 Outbox；Agent 根据执行结果决定继续下一步或触发补偿链。

```java
// JDK 25 + Spring Boot 4.x — SagaOrchestratorAgent with compensation chain
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.time.Duration;

public class SagaOrchestratorAgent {

    record SagaStep(String name,
                    Runnable execute,
                    Runnable compensate,
                    Duration timeout) {}

    private final List<SagaStep> steps = new ArrayList<>();
    private final List<String> executedSteps = new CopyOnWriteArrayList<>();
    private final OutboxPublisher outboxPublisher;

    public SagaOrchestratorAgent(OutboxPublisher outboxPublisher) {
        this.outboxPublisher = outboxPublisher;
    }

    public SagaOrchestratorAgent addStep(SagaStep step) {
        steps.add(step);
        return this;
    }

    /**
     * 执行 Saga，自动补偿失败步骤
     */
    public SagaResult execute() {
        for (int i = 0; i < steps.size(); i++) {
            var step = steps.get(i);
            try {
                step.execute().run();

                var event = new OutboxEvent(
                    "SAGA_STEP_COMPLETED",
                    Map.of("step", step.name(), "index", i, "total", steps.size()),
                    OutboxEvent.Status.PENDING);
                outboxPublisher.publish(event);

                executedSteps.add(step.name());
                System.out.println("[✓] 步骤完成：" + step.name());

            } catch (Exception e) {
                System.err.println("[✗] 步骤失败：" + step.name() + " — " + e.getMessage());

                outboxPublisher.publish(new OutboxEvent(
                    "SAGA_STEP_FAILED",
                    Map.of("step", step.name(), "error", e.getMessage()),
                    OutboxEvent.Status.PENDING));

                compensateExecuted();
                return new SagaResult(false,
                    "步骤 [" + step.name() + "] 失败，已执行补偿", e.getMessage());
            }
        }

        return new SagaResult(true, "Saga 全部完成", null);
    }

    /**
     * 逆序执行所有已完成步骤的补偿操作
     */
    private void compensateExecuted() {
        var reversed = new ArrayList<>(executedSteps);
        Collections.reverse(reversed);

        for (var stepName : reversed) {
            var step = steps.stream()
                    .filter(s -> s.name().equals(stepName))
                    .findFirst().orElseThrow();
            try {
                step.compensate().run();
                var event = new OutboxEvent("SAGA_STEP_COMPENSATED",
                    Map.of("step", stepName), OutboxEvent.Status.PENDING);
                outboxPublisher.publish(event);
                System.out.println("[↩] 补偿完成：" + stepName);
            } catch (Exception compEx) {
                System.err.println("[!!] 补偿失败（需人工介入）：" + stepName);
            }
        }
    }

    // 保险理赔 Saga 示例
    public static void main(String[] args) {
        var outbox = new OutboxPublisher(/* DataSource */);

        var claimSaga = new SagaOrchestratorAgent(outbox)
            .addStep(new SagaStep("查询保单",
                () -> System.out.println("查询保单 #POL-001"),
                () -> System.out.println("（无需补偿）"),
                Duration.ofSeconds(5)))
            .addStep(new SagaStep("验证事故",
                () -> { System.out.println("验证事故报告"); },
                () -> System.out.println("标记事故验证为待重新审核"),
                Duration.ofSeconds(10)))
            .addStep(new SagaStep("计算赔付",
                () -> System.out.println("计算赔付金额 ￥12,000"),
                () -> System.out.println("撤销赔付计算"),
                Duration.ofSeconds(5)))
            .addStep(new SagaStep("执行支付",
                () -> System.out.println("支付 ￥12,000 → 客户账户"),
                () -> System.out.println("发起退款 ￥12,000"),
                Duration.ofSeconds(15)));

        var result = claimSaga.execute();
        System.out.println("Saga 结果：" + result);
    }

    record SagaResult(boolean success, String message, String error) {}

    record OutboxEvent(String type, Map<String, Object> payload,
                       Status status) {
        enum Status { PENDING, PUBLISHED, FAILED }
    }

    static class OutboxPublisher {
        OutboxPublisher(Object ds) {}
        void publish(OutboxEvent event) {
            // 写入 outbox 表，异步投递到 Kafka/RabbitMQ
        }
    }
}
```

Saga+Outbox 模式让 Agent 工作流获得了企业级事务保障：每个步骤有明确的补偿路径，事件不会丢失，即使 Agent 进程崩溃，恢复后可以从 Outbox 中未投递的事件继续。对于金融、保险、电商等对数据一致性要求高的 Agent 应用，这是必不可少的基础设施。

---

**总结**：多 Agent 协作是提升 AI 系统能力的有效手段——通过专业分工和交叉验证，可以显著提高输出质量和可靠性。但复杂性也随之增加。遵循"够用就好"原则：能用单 Agent 解决的不要上多 Agent，必须用多 Agent 时选择合适的协作模式，做好故障隔离和成本控制。
