---
domain: "17-系统设计"
title: "Agent Platform Design"
status: "draft"
level: "advanced"
sources:
  - level: "L1"
    url: "https://modelcontextprotocol.io/specification/2025-03-26/"
    description: "MCP Specification"
  - level: "L1"
    url: "https://docs.spring.io/spring-ai/reference/"
    description: "Spring AI 官方文档"
  - level: "L4"
    url: "https://arxiv.org/abs/2308.08155"
    description: "AgentBench: Evaluating LLMs as Agents"
  - level: "L4"
    url: "https://docs.temporal.io/"
    description: "Temporal Workflow Engine 文档"
relations:
  prerequisite: ["12-ToolCalling完整剖析", "14-模型网关与Prompt管理"]
  related: ["17-企业级RAG系统设计", "12-多Agent协作架构", "12-工具生态管理", "15-AI安全全面防护体系"]
tags: ["agent-platform", "workflow", "tool-market", "dag", "session", "monitoring"]
created: "2026-07-20"
updated: "2026-07-20"
---

# Agent平台设计

## 概述

Agent平台是构建、运行、管理和监控AI Agent的基础设施。它不仅承载Agent的运行时执行，还提供Agent生命周期管理、工具市场、工作流编排、会话持久化和监控告警等完整的平台能力。本节从架构全景、核心子系统到REST API设计，全面深入Agent平台的系统设计。

## 一、平台架构全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Platform                                     │
│                                                                              │
│  ┌─────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │  Agent  │───►│ Agent Runtime│───►│ Tool Market  │───►│   Monitor     │   │
│  │ Builder │    │              │    │              │    │               │   │
│  │         │    │ - Workflow   │    │ - Registry   │    │ - Metrics     │   │
│  │ - UI    │    │   Engine     │    │ - Discovery  │    │ - Tracing     │   │
│  │ - API   │    │ - Executor   │    │ - Billing    │    │ - Alerting    │   │
│  │ - DSL   │    │ - Sandbox    │    │ - Audit      │    │ - Cost Track  │   │
│  └─────────┘    └──────┬───────┘    └──────┬───────┘    └──────┬────────┘   │
│                        │                  │                    │            │
│                        ▼                  ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       Infrastructure Layer                            │   │
│  │                                                                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │PostgreSQL │  │  Redis   │  │  Kafka   │  │  MinIO   │             │   │
│  │  │+pgvector  │  │ (Cache)  │  │ (Events)│  │ (Files)  │             │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

用户 (User)
  │
  ▼
Agent Builder (可视化/API/DSL)
  │
  ├─ 创建 Agent 定义 (System Prompt, Tools, Memory配置, 模型选择)
  ├─ 测试 (Sandbox环境, 模拟对话)
  ├─ 审核 (安全扫描, 权限审查, 合规检查)
  ├─ 发布 (灰度 → 全量, 版本管理)
  │
  ▼
Agent Runtime
  │
  ├─ 接收用户请求
  ├─ 加载Agent定义和会话状态
  ├─ 执行工作流 (DAG编排)
  │   ├─ Tool Calling (串行/并行)
  │   ├─ 条件分支 (if/switch)
  │   ├─ 人工审批节点
  │   └─ 错误重试
  ├─ 流式返回结果
  └─ 持久化会话状态
```

## 二、Agent生命周期管理

### 2.1 完整生命周期

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  CREATE  │──►│   TEST   │──►│  REVIEW  │──►│ PUBLISH  │──►│ MONITOR  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └────┬─────┘
     │              │              │              │               │
     │              │              │              │         ┌─────▼─────┐
     │              │              │              │         │  OFFLINE  │
     │              │              │              │         └───────────┘
     │              │              │              │
     │              ▼              ▼              │
     │         ┌──────────┐  ┌──────────┐         │
     └────────►│  DRAFT   │◄─┤  REJECT  │◄────────┘
               └──────────┘  └──────────┘
```

**各阶段详解**：

| 阶段 | 操作 | 说明 |
|------|------|------|
| CREATE | UI/API/DSL | 定义Agent的System Prompt、Tool列表、模型、Memory配置 |
| TEST | Sandbox | 在隔离沙箱中测试Agent，使用模拟工具，避免副作用 |
| REVIEW | 安全+合规 | 内容安全扫描、工具权限审查、合规检查 |
| PUBLISH | 灰度+全量 | 灰度发布(10%→50%→100%)，支持版本回滚 |
| MONITOR | 指标+告警 | 成功率、延迟、Token消耗、用户反馈 |
| OFFLINE | 归档 | 保留历史数据，标记为已下线 |

### 2.2 Agent定义DSL

```java
/**
 * Agent定义模型 — 声明式Agent配置。
 */
public record AgentDefinition(
    String id,
    String name,
    String version,
    String description,
    String systemPrompt,               // System Prompt模板
    List<String> toolNames,            // 绑定的工具列表
    String modelName,                  // 默认模型
    MemoryConfig memory,               // Memory配置
    WorkflowConfig workflow,           // 工作流配置
    Map<String, Object> metadata       // 扩展元数据
) {
    public record MemoryConfig(
        String type,                    // "sliding_window" | "vector" | "summary"
        int maxTokens,
        int maxMessages,
        boolean enableLongTermMemory
    ) {}

    public record WorkflowConfig(
        String engineType,              // "dag" | "temporal" | "camunda"
        Object dagDefinition,           // DAG DSL定义
        boolean humanInTheLoop,
        int maxRetries,
        Duration stepTimeout
    ) {}
}
```

### 2.3 Sandbox测试环境

```java
/**
 * Agent沙箱执行环境。
 * 在隔离环境中测试Agent，使用Mock工具和Mock模型响应。
 */
@Service
public class AgentSandbox {

    private final MockToolExecutor mockTools;
    private final MockModelClient mockModel;

    /**
     * 在沙箱中运行Agent测试用例。
     */
    public SandboxTestResult runTest(AgentDefinition agent,
            List<TestCase> testCases) {
        var results = new ArrayList<TestCaseResult>();

        for (var testCase : testCases) {
            var start = Instant.now();
            var agent = buildAgentForSandbox(agent);

            try {
                var response = agent.run(testCase.userInput());
                var passed = evaluateResponse(
                    response, testCase.expectedBehaviors());
                results.add(new TestCaseResult(
                    testCase.name(), passed,
                    response, null,
                    Duration.between(start, Instant.now()).toMillis()
                ));
            } catch (Exception e) {
                results.add(new TestCaseResult(
                    testCase.name(), false,
                    null, e.getMessage(),
                    Duration.between(start, Instant.now()).toMillis()
                ));
            }
        }

        return new SandboxTestResult(
            results,
            results.stream().filter(TestCaseResult::passed).count(),
            results.size()
        );
    }

    public record TestCase(
        String name,
        String userInput,
        List<String> expectedBehaviors  // 如: ["调用tool:search", "未调用tool:delete"]
    ) {}

    public record TestCaseResult(
        String name, boolean passed,
        String response, String error, long durationMs
    ) {}

    public record SandboxTestResult(
        List<TestCaseResult> results,
        long passed, long total
    ) {
        public boolean allPassed() { return passed == total; }
    }
}
```

## 三、Tool市场

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Market                               │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Tool Registry │   │ Tool Audit   │   │ Tool Billing │        │
│  │              │   │              │   │              │        │
│  │ - 注册/发现   │   │ - 安全扫描   │   │ - 按调用计费 │        │
│  │ - 版本管理   │   │ - 权限审查   │   │ - 按Token计费│        │
│  │ - 搜索/分类  │   │ - 合规检查   │   │ - 免费/付费  │        │
│  │ - 评分/评价  │   │ - 沙箱测试   │   │ - 租户配额   │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                  │
│  开发者 ───────► 上传Tool (JAR/JSON Schema)                       │
│                    │                                             │
│                    ▼                                             │
│              审核管道 → 通过 → 发布到市场                           │
│                         │                                        │
│                         ▼                                        │
│              Agent构建者 → 搜索/浏览 → 安装Tool                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Tool注册与定义

```java
/**
 * Tool市场注册模型。
 */
@Entity
@Table(name = "tool_registry")
public class ToolMarketEntry {

    @Id
    private String id;

    @Column(unique = true, nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(columnDefinition = "JSONB")
    private String jsonSchema;          // Tool参数JSON Schema

    @Column(columnDefinition = "JSONB")
    private String outputSchema;        // Tool输出JSON Schema

    private String version;

    @ElementCollection
    private List<String> tags;

    @Enumerated(EnumType.STRING)
    private ToolCategory category;

    @Enumerated(EnumType.STRING)
    private PricingModel pricingModel;  // FREE, PER_CALL, PER_TOKEN, SUBSCRIPTION

    private double pricePerCall;        // 分/每次调用
    private double pricePerThousandToken;

    private String authorId;
    private String authorName;

    @Enumerated(EnumType.STRING)
    private ReviewStatus reviewStatus;  // PENDING, APPROVED, REJECTED

    private int downloads;
    private double avgRating;           // 1-5
    private int ratingCount;

    private Instant createdAt;
    private Instant updatedAt;

    public enum ToolCategory {
        DATA_QUERY, FILE_OPERATION, COMMUNICATION,
        CODE_EXECUTION, AI_MODEL, EXTERNAL_API,
        UTILITY, CUSTOM
    }

    public enum PricingModel {
        FREE, PER_CALL, PER_TOKEN, SUBSCRIPTION
    }

    public enum ReviewStatus {
        PENDING, APPROVED, REJECTED
    }
}
```

### 3.3 Tool搜索与发现

```java
/**
 * Tool搜索引擎。
 * 支持关键词搜索、标签过滤、分类浏览、评分排序。
 */
@Service
public class ToolSearchService {

    private final ToolMarketRepository repository;
    private final PgVectorStore vectorStore;

    /**
     * 全文搜索 + 语义搜索 + 过滤条件。
     */
    public Page<ToolMarketEntry> search(ToolSearchRequest request) {
        return repository.search(
            request.keyword(),
            request.tags(),
            request.category(),
            request.pricingModel(),
            request.minRating(),
            request.sortBy(),
            PageRequest.of(request.page(), request.size())
        );
    }

    /**
     * 语义搜索：用自然语言描述找到最匹配的Tool。
     */
    public List<ToolMarketEntry> semanticSearch(
            String description, int topK) {
        // 对Tool描述做Embedding，与Query Embedding做相似度检索
        return vectorStore.similaritySearch(
            SearchRequest.query(embed(description))
                .withTopK(topK)
                .withSimilarityThreshold(0.7)
        ).stream()
        .map(doc -> repository.findById(
            UUID.fromString(doc.getId())).orElse(null))
        .filter(Objects::nonNull)
        .toList();
    }

    public record ToolSearchRequest(
        String keyword,
        List<String> tags,
        ToolMarketEntry.ToolCategory category,
        ToolMarketEntry.PricingModel pricingModel,
        double minRating,
        SortBy sortBy,
        int page, int size
    ) {}

    public enum SortBy { RELEVANCE, DOWNLOADS, RATING, NEWEST, PRICE }
}
```

### 3.4 Tool计费

```java
/**
 * Tool按量计费服务。
 */
@Service
public class ToolBillingService {

    /**
     * 记录工具调用并扣费。
     */
    @Transactional
    public BillingResult charge(String tenantId, String toolName,
            int callCount, int tokensUsed) {
        var tool = toolRepo.findByName(toolName).orElseThrow();

        var cost = switch (tool.getPricingModel()) {
            case FREE -> 0.0;
            case PER_CALL -> callCount * tool.getPricePerCall();
            case PER_TOKEN -> (tokensUsed / 1000.0)
                * tool.getPricePerThousandToken();
            case SUBSCRIPTION -> 0.0;  // 订阅制，不计单次调用
        };

        // 更新租户账单
        tenantBillingRepo.addCharge(tenantId, toolName, cost,
            BillingPeriod.current());

        return new BillingResult(cost, tool.getPricingModel());
    }
}
```

## 四、工作流编排引擎

### 4.1 DAG设计器

Agent平台提供两种DAG定义方式：可视化拖拽和DSL声明。

**DSL定义示例**：

```json
{
  "name": "insurance_claim_agent",
  "nodes": [
    {
      "id": "start",
      "type": "input",
      "description": "接收用户理赔请求"
    },
    {
      "id": "verify_policy",
      "type": "tool_call",
      "tool": "query_policy",
      "description": "验证保单有效性",
      "config": { "timeout": "10s" }
    },
    {
      "id": "check_claim",
      "type": "condition",
      "description": "检查保单状态是否可理赔",
      "condition": "result.status == 'IN_FORCE'",
      "true_branch": "collect_docs",
      "false_branch": "respond_invalid"
    },
    {
      "id": "collect_docs",
      "type": "tool_call",
      "tool": "ask_for_documents",
      "description": "引导用户提交理赔材料"
    },
    {
      "id": "review_docs",
      "type": "human_approval",
      "description": "人工审核理赔材料",
      "config": { "approver_role": "claim_adjuster" }
    },
    {
      "id": "calculate_amount",
      "type": "tool_call",
      "tool": "calculate_claim_amount",
      "description": "计算赔付金额"
    },
    {
      "id": "process_payment",
      "type": "tool_call",
      "tool": "initiate_payment",
      "description": "发起赔付"
    },
    {
      "id": "end",
      "type": "output",
      "description": "返回理赔结果"
    }
  ],
  "edges": [
    {"from": "start", "to": "verify_policy"},
    {"from": "verify_policy", "to": "check_claim"},
    {"from": "collect_docs", "to": "review_docs"},
    {"from": "review_docs", "to": "calculate_amount"},
    {"from": "calculate_amount", "to": "process_payment"},
    {"from": "process_payment", "to": "end"}
  ],
  "error_handler": {
    "retry": {"max_attempts": 3, "backoff": "exponential"},
    "fallback_node": "respond_error"
  }
}
```

### 4.2 DAG执行引擎

```java
/**
 * DAG工作流执行引擎。
 * 支持条件分支、并行节点、人工审批、错误重试。
 */
@Service
public class DagExecutionEngine {

    private final Map<String, NodeExecutor> nodeExecutors = new HashMap<>();

    public DagExecutionEngine() {
        // 注册内置节点执行器
        nodeExecutors.put("input", new InputNodeExecutor());
        nodeExecutors.put("output", new OutputNodeExecutor());
        nodeExecutors.put("tool_call", new ToolCallNodeExecutor());
        nodeExecutors.put("condition", new ConditionNodeExecutor());
        nodeExecutors.put("human_approval", new HumanApprovalNodeExecutor());
        nodeExecutors.put("parallel", new ParallelNodeExecutor());
        nodeExecutors.put("llm_call", new LlmCallNodeExecutor());
    }

    /**
     * 执行DAG工作流。
     */
    public WorkflowResult execute(WorkflowDefinition dag,
            WorkflowContext context) {
        var state = new ExecutionState(dag, context);
        var startNode = dag.getStartNode();

        // 从起始节点开始，按拓扑序执行
        executeNode(startNode, state);

        return new WorkflowResult(
            state.getFinalOutput(),
            state.getExecutionPath(),
            state.getDuration());
    }

    private void executeNode(Node node, ExecutionState state) {
        var executor = nodeExecutors.get(node.type());
        if (executor == null) {
            throw new IllegalArgumentException(
                "Unknown node type: " + node.type());
        }

        var startTime = Instant.now();

        // 带重试的执行
        for (int attempt = 0; attempt <= node.maxRetries(); attempt++) {
            try {
                var result = executor.execute(node.config(),
                    state.getContext());

                state.recordNodeExecution(node.id(), result,
                    Duration.between(startTime, Instant.now()));

                // 确定下一个节点
                var nextNode = determineNextNode(node, result);
                if (nextNode != null) {
                    executeNode(nextNode, state);  // 递归执行
                }
                return;

            } catch (RetryableException e) {
                if (attempt < node.maxRetries()) {
                    var backoff = Math.pow(2, attempt) * 1000;
                    Thread.sleep((long) backoff);
                } else {
                    // 达到最大重试，进入错误处理
                    var fallbackNode = state.getDag()
                        .getFallbackNode(node.id());
                    if (fallbackNode != null) {
                        executeNode(fallbackNode, state);
                    } else {
                        throw e;
                    }
                }
            }
        }
    }

    private Node determineNextNode(Node currentNode,
            NodeResult result) {
        return switch (currentNode.type()) {
            case "condition" -> {
                var condition = (String) currentNode.config()
                    .get("condition");
                var trueNodeId = (String) currentNode.config()
                    .get("true_branch");
                var falseNodeId = (String) currentNode.config()
                    .get("false_branch");
                yield evaluateCondition(condition, result)
                    ? getNode(trueNodeId)
                    : getNode(falseNodeId);
            }
            case "parallel" -> {
                // 并行节点的所有子节点都执行完成后才继续
                yield awaitParallelCompletion(currentNode);
            }
            default -> getNode(currentNode.nextNodeId());
        };
    }
}
```

### 4.3 Temporal/Camunda执行后端

```java
/**
 * Temporal工作流适配器 — 支持长时间运行的Agent工作流。
 * 适用于需要数小时甚至数天才能完成的复杂Agent任务。
 */
public class TemporalWorkflowAdapter {

    /**
     * Temporal Workflow定义。
     * @Workflow 注解标记为Temporal工作流
     */
    @WorkflowInterface
    public interface AgentWorkflow {

        @WorkflowMethod
        WorkflowResult execute(AgentDefinition agent,
                               String sessionId, String userInput);

        @SignalMethod
        void humanApproval(String nodeId, boolean approved,
                           String comment);

        @QueryMethod
        WorkflowStatus getStatus();
    }

    /**
     * Temporal Workflow实现。
     * 利用Temporal的特性：
     * - 自动重试和错误处理
     * - 持久化执行状态（即使服务重启也能继续）
     * - Saga模式的补偿事务
     * - 超长执行时间（数天甚至数月）
     */
    public static class AgentWorkflowImpl implements AgentWorkflow {

        private WorkflowStatus status = WorkflowStatus.RUNNING;
        private final Map<String, CompletableFuture<Boolean>>
            approvalFutures = new HashMap<>();

        @Override
        public WorkflowResult execute(AgentDefinition agent,
                String sessionId, String userInput) {

            // Step 1: 分析用户输入
            var analysis = ActivityStub.analyze(userInput);

            // Step 2: 执行DAG中的每个节点
            for (var node : agent.workflow().nodes()) {
                ActivityStub.executeNode(node);

                if (node.type().equals("human_approval")) {
                    // 等待人工审批（可能等待数小时）
                    var approved = Workflow.await(
                        () -> approvalFutures.get(node.id()),
                        Duration.ofHours(24)  // 最多等待24小时
                    );
                    if (!approved) {
                        return WorkflowResult.rejected(node.id());
                    }
                }
            }

            // Step 3: 生成最终结果
            status = WorkflowStatus.COMPLETED;
            return ActivityStub.generateResult(sessionId);
        }

        @Override
        public void humanApproval(String nodeId, boolean approved,
                String comment) {
            var future = approvalFutures.get(nodeId);
            if (future != null) {
                future.complete(approved);
            }
        }

        @Override
        public WorkflowStatus getStatus() {
            return status;
        }
    }
}
```

## 五、会话持久化

### 5.1 会话状态模型

```java
/**
 * Agent会话持久化。
 * 支持断点续传和会话回放。
 */
@Entity
@Table(name = "agent_sessions")
public class AgentSession {

    @Id
    private String id;

    private String agentId;
    private String userId;
    private String tenantId;

    @Enumerated(EnumType.STRING)
    private SessionStatus status;  // ACTIVE, PAUSED, COMPLETED, ERROR

    @Column(columnDefinition = "JSONB")
    private String messages;       // 完整对话消息列表

    @Column(columnDefinition = "JSONB")
    private String workflowState;  // 工作流执行状态快照

    @Column(columnDefinition = "JSONB")
    private String scratchpad;     // Agent Working Memory

    private int totalTokens;
    private double totalCost;

    private String lastCheckpointId; // 最近的检查点ID

    private Instant createdAt;
    private Instant updatedAt;

    public enum SessionStatus {
        ACTIVE, PAUSED, COMPLETED, ERROR
    }
}
```

### 5.2 断点续传

```java
/**
 * 会话检查点管理 — 实现断点续传。
 */
@Service
public class SessionCheckpointService {

    private final AgentSessionRepository sessionRepo;
    private final RedisTemplate<String, byte[]> checkpointCache;

    /**
     * 创建检查点。
     */
    public void createCheckpoint(String sessionId,
            CheckpointData data) {
        // 1. 异步持久化到数据库
        sessionRepo.updateCheckpoint(sessionId,
            data.toJson(), Instant.now());

        // 2. 热存到Redis（用于快速恢复）
        checkpointCache.opsForValue().set(
            "checkpoint:" + sessionId,
            data.toJson().getBytes(),
            Duration.ofHours(24)
        );
    }

    /**
     * 从最近的检查点恢复会话。
     */
    public Optional<CheckpointData> restoreFromCheckpoint(
            String sessionId) {
        // 1. 先从Redis热存中恢复
        var cached = checkpointCache.opsForValue()
            .get("checkpoint:" + sessionId);
        if (cached != null) {
            return Optional.of(CheckpointData.fromJson(
                new String(cached)));
        }

        // 2. 从数据库恢复
        var session = sessionRepo.findById(sessionId).orElse(null);
        if (session != null && session.lastCheckpointId != null) {
            return Optional.of(CheckpointData.fromJson(
                session.workflowState));
        }

        return Optional.empty();
    }

    public record CheckpointData(
        String currentNodeId,
        Map<String, Object> variables,
        List<String> completedSteps,
        int currentRetryCount,
        Instant timestamp
    ) {
        public String toJson() {
            try {
                return new ObjectMapper().writeValueAsString(this);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        public static CheckpointData fromJson(String json) {
            try {
                return new ObjectMapper()
                    .readValue(json, CheckpointData.class);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }
}
```

### 5.3 会话回放

```java
/**
 * 会话回放服务 — 用于调试和审计。
 */
@Service
public class SessionReplayService {

    /**
     * 按时间线回放会话的所有步骤。
     */
    public ReplayTimeline replay(String sessionId) {
        var session = sessionRepo.findById(sessionId)
            .orElseThrow();

        var events = new ArrayList<ReplayEvent>();
        var messages = parseMessages(session.messages);

        for (int i = 0; i < messages.size(); i++) {
            var msg = messages.get(i);
            events.add(new ReplayEvent(
                i,
                msg.role(),
                msg.content(),
                msg.toolCalls(),
                msg.timestamp()
            ));
        }

        return new ReplayTimeline(
            session.id(),
            session.agentId(),
            session.userId(),
            events,
            session.totalTokens(),
            session.totalCost(),
            session.createdAt()
        );
    }

    public record ReplayTimeline(
        String sessionId,
        String agentId,
        String userId,
        List<ReplayEvent> events,
        int totalTokens,
        double totalCost,
        Instant startedAt
    ) {}

    public record ReplayEvent(
        int sequence,
        String role,
        String content,
        List<ToolCall> toolCalls,
        Instant timestamp
    ) {}

    public record ToolCall(
        String toolName,
        Map<String, Object> arguments,
        String result,
        long durationMs
    ) {}
}
```

## 六、监控告警

### 6.1 Agent执行步骤可视化

```java
/**
 * Agent执行步骤追踪 — 生成Graph可视化数据。
 */
@Service
public class AgentExecutionTracer {

    private final Tracer tracer;

    /**
     * 为每个Agent步骤创建独立的Span。
     */
    public TraceSpan traceExecution(String agentId, String sessionId,
            String stepName) {
        var span = tracer.spanBuilder("agent.step")
            .setAttribute("agent.id", agentId)
            .setAttribute("session.id", sessionId)
            .setAttribute("step.name", stepName)
            .startSpan();
        return new TraceSpan(span);
    }

    /**
     * 生成Agent执行图数据（用于前端可视化）。
     */
    public ExecutionGraph generateExecutionGraph(String sessionId) {
        var spans = querySpans(sessionId);

        var nodes = new ArrayList<GraphNode>();
        var edges = new ArrayList<GraphEdge>();

        // 将Span转换为图节点和边
        for (var span : spans) {
            nodes.add(new GraphNode(
                span.getSpanId(),
                span.getAttribute("step.name"),
                span.getAttribute("step.type"),
                span.getAttribute("step.status"),
                span.getEndTime() - span.getStartTime()
            ));

            var parentId = span.getParentSpanId();
            if (parentId != null) {
                edges.add(new GraphEdge(
                    parentId, span.getSpanId()));
            }
        }

        return new ExecutionGraph(sessionId, nodes, edges);
    }
}
```

### 6.2 异常检测与SLA监控

```java
/**
 * Agent异常检测和SLA监控。
 */
@Service
public class AgentMonitoringService {

    private final MeterRegistry meterRegistry;

    /**
     * 监控指标定义。
     */
    public void recordMetrics(String agentId, String sessionId,
            ExecutionMetrics metrics) {
        // 成功率
        meterRegistry.counter("agent.execution",
            "agent_id", agentId,
            "status", metrics.success() ? "success" : "failure"
        ).increment();

        // 响应延迟
        meterRegistry.timer("agent.latency",
            "agent_id", agentId
        ).record(metrics.durationMs(), TimeUnit.MILLISECONDS);

        // Token消耗
        meterRegistry.counter("agent.tokens",
            "agent_id", agentId,
            "type", "input"
        ).increment(metrics.inputTokens());
        meterRegistry.counter("agent.tokens",
            "agent_id", agentId,
            "type", "output"
        ).increment(metrics.outputTokens());

        // 工具调用次数
        meterRegistry.counter("agent.tool_calls",
            "agent_id", agentId
        ).increment(metrics.toolCallCount());

        // 成本
        meterRegistry.counter("agent.cost",
            "agent_id", agentId
        ).increment(metrics.cost());
    }

    /**
     * SLA检查。
     */
    public void checkSla(String agentId) {
        var p95Latency = meterRegistry.timer("agent.latency",
            "agent_id", agentId).takeSnapshot().percentileValue(0.95);
        var successRate = getSuccessRate(agentId, Duration.ofHours(1));

        // P95延迟告警
        if (p95Latency > Duration.ofSeconds(30).toNanos()) {
            alertService.sendAlert(agentId,
                STR."P95 latency \{p95Latency / 1_000_000}ms exceeds SLA (30s)");
        }

        // 成功率告警
        if (successRate < 0.95) {
            alertService.sendAlert(agentId,
                STR."Success rate \{successRate} below SLA (95%)");
        }
    }
}
```

## 七、完整REST API设计

### 7.1 Agent管理API

```
POST   /api/v1/agents                    — 创建Agent
GET    /api/v1/agents                    — Agent列表（分页+搜索）
GET    /api/v1/agents/{id}               — Agent详情
PUT    /api/v1/agents/{id}               — 更新Agent
DELETE /api/v1/agents/{id}               — 删除Agent
POST   /api/v1/agents/{id}/test          — 沙箱测试
POST   /api/v1/agents/{id}/publish       — 发布Agent
POST   /api/v1/agents/{id}/rollback      — 回滚Agent
GET    /api/v1/agents/{id}/versions      — 版本历史
POST   /api/v1/agents/{id}/offline       — 下线Agent
```

### 7.2 会话管理API

```
POST   /api/v1/sessions                  — 创建会话
POST   /api/v1/sessions/{id}/chat        — 发送消息（非流式）
POST   /api/v1/sessions/{id}/chat/stream — 发送消息（SSE流式）
GET    /api/v1/sessions/{id}/history     — 会话历史
GET    /api/v1/sessions/{id}/replay      — 会话回放
DELETE /api/v1/sessions/{id}             — 删除会话
POST   /api/v1/sessions/{id}/pause       — 暂停会话
POST   /api/v1/sessions/{id}/resume      — 恢复会话（断点续传）
```

### 7.3 Tool市场API

```
GET    /api/v1/tools/market              — 工具市场列表
GET    /api/v1/tools/market/search       — 搜索工具
GET    /api/v1/tools/market/{id}         — 工具详情
POST   /api/v1/tools/market              — 上传/注册工具
POST   /api/v1/tools/market/{id}/review  — 审核工具
GET    /api/v1/tools/market/{id}/ratings — 工具评分/评价
POST   /api/v1/tools/market/{id}/install — 安装工具到Agent
```

### 7.4 Spring Boot Controller实现骨架

```java
@RestController
@RequestMapping("/api/v1/agents")
public class AgentManagementController {

    private final AgentService agentService;

    @PostMapping
    public ResponseEntity<ApiResponse<AgentVO>> create(
            @Valid @RequestBody CreateAgentRequest request) {
        var agent = agentService.create(request);
        return ResponseEntity.status(CREATED)
            .body(ApiResponse.success(AgentVO.from(agent)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<AgentVO>> get(
            @PathVariable String id) {
        return ResponseEntity.ok(
            ApiResponse.success(AgentVO.from(
                agentService.findById(id))));
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<ApiResponse<SandboxTestResult>> test(
            @PathVariable String id,
            @RequestBody TestAgentRequest request) {
        return ResponseEntity.ok(
            ApiResponse.success(agentService.test(id, request)));
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<ApiResponse<PublishResult>> publish(
            @PathVariable String id,
            @RequestBody PublishRequest request) {
        return ResponseEntity.ok(
            ApiResponse.success(agentService.publish(
                id, request.grayPercentage())));
    }
}

@RestController
@RequestMapping("/api/v1/sessions")
public class SessionController {

    private final SessionService sessionService;

    @PostMapping("/{id}/chat/stream")
    public Flux<ServerSentEvent<String>> chatStream(
            @PathVariable String id,
            @RequestBody ChatRequest request) {
        return sessionService.chatStream(id, request.message())
            .map(chunk -> ServerSentEvent.<String>builder()
                .data(chunk)
                .event("chunk")
                .build())
            .concatWith(Mono.just(
                ServerSentEvent.<String>builder()
                    .event("done")
                    .build()));
    }
}
```

## 八、最佳实践

1. **Agent Sandbox隔离**：每次测试创建独立的沙箱环境，测试完成后自动销毁，防止数据污染
2. **灰度发布策略**：Agent发布采用10%→50%→100%灰度，每阶段观察15分钟，发现异常自动回滚
3. **Tool市场评分机制**：使用加权评分（近期评分权重更高），防止刷分
4. **会话TTL**：默认24小时无活动自动归档，企业版可配置更长
5. **工作流幂等**：所有Tool执行必须支持幂等调用，通过idempotency key保证

## 九、常见问题

**Q: Agent平台和RAG系统有什么关系？**
A: Agent平台通常依赖RAG系统作为其知识检索能力的基础。Agent平台的Tool市场中经常包含RAG检索工具。两者可以作为独立的微服务部署，通过MCP协议集成。

**Q: Temporal vs Camunda如何选择？**
A: Temporal适合需要超长时间运行（数天到数月）、Saga补偿事务、多语言SDK支持的场景。Camunda适合Java原生环境、BPMN标准流程、轻量级嵌入式部署。对于大多数Agent工作流，建议从Spring Batch + Outbox模式起步。

**Q: 工具市场如何处理工具的向后兼容？**
A: 工具注册时声明支持的API版本范围。Agent可绑定工具的特定版本。工具发布新版本时，旧版本保留至少6个月过渡期。

## 相关条目

- [[17-企业级RAG系统设计]] — 企业级RAG系统架构
- [[12-工具生态管理]] — 工具发现、注册、版本管理
- [[12-多Agent协作架构]] — 多Agent协作模式
- [[12-Agent工作流与人机协作]] — Human-in-the-loop设计
- [[14-模型网关与Prompt管理]] — 模型网关与路由策略
- [[13-MCP协议与JavaSDK]] — MCP工具集成标准
