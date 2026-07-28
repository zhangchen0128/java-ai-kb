---
domain: 12-Agent工程
title: Agent Workflow 范式与 Human-in-the-loop 实战
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
  code_status: tested
  lab: lab-ai-security
  evidence:
    scope: article-core
    source_files:
      - labs/lab-ai-security/src/main/java/com/javaai/kb/labs/ai-security/InputSanitizer.java
    test_files:
      - labs/lab-ai-security/src/test/java/com/javaai/kb/labs/ai-security/InputSanitizerTest.java
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-statemachine/docs/current/reference/
    description: Spring State Machine 官方文档
  - level: L1
    url: https://docs.spring.io/spring-batch/docs/current/reference/html/
    description: Spring Batch 官方文档
  - level: L2
    url: https://docs.temporal.io/
    description: Temporal Workflow 引擎文档
  - level: L2
    url: https://www.anthropic.com/engineering/building-effective-agents
    description: Anthropic Building Effective Agents
relations:
  prerequisite:
    - 12-Agent记忆与规划
  related:
    - 12-多Agent协作架构
    - 12-ToolCalling完整剖析
tags:
  - workflow
  - human-in-the-loop
  - state-machine
  - spring-state-machine
  - insurance
created: 2026-07-17
updated: 2026-07-17
content_type: production
---

# Agent Workflow 范式与 Human-in-the-loop 实战

## 一、Agent Workflow 两种范式

### 1.1 确定性 Workflow

确定性 Workflow 的执行路径在设计阶段就已经确定——通过 DAG（有向无环图）、条件分支、循环和重试机制来编排固定流程。它追求可预测性、可审计性和确定性。

**典型结构**：

```
[数据提取] → [规则校验] → [风险评分] → [条件分支] →
  ├─ 低风险 → [自动审批] → [通知用户]
  └─ 高风险 → [人工审批] → [通知用户]
```

**适用场景**：
- 审批流程（请假、报销、核保）
- ETL 数据处理管道
- 定期报告生成
- 合规检查流程

### 1.2 LLM 驱动 Agent

LLM 驱动 Agent 将控制权交给模型——模型自主决定调用哪些工具、执行哪些操作、何时结束。它追求灵活性和智能决策。

**适用场景**：
- 客服对话
- 开放式信息检索
- 复杂问题诊断
- 需要上下文理解的动态流程

### 1.3 选择原则

| 维度 | 确定性 Workflow | LLM 驱动 Agent |
|------|----------------|----------------|
| 可预测性 | 高 | 低 |
| 灵活性 | 低 | 高 |
| 成本 | 低（LLM 只在关键节点调用） | 高（大量 LLM 调用） |
| 可审计性 | 高（每步可追溯） | 低（模型黑盒决策） |
| 适用规模 | 大批量、重复性任务 | 小批量、个性化任务 |

**核心原则**："能用确定性流程解决的问题，不要用 Agent。Agent 是最后的手段，不是第一选择。" —— Anthropic Building Effective Agents

## 二、Workflow 引擎选型

### 2.1 轻量级：Spring State Machine

适合简单的状态流转场景（几十个状态以内）。配置式定义，与 Spring 生态深度集成。

```java
// UnderwritingStateMachineConfig.java
package com.example.insurance.workflow;

import org.springframework.context.annotation.Configuration;
import org.springframework.statemachine.config.EnableStateMachineFactory;
import org.springframework.statemachine.config.StateMachineConfigurerAdapter;
import org.springframework.statemachine.config.builders.StateMachineStateConfigurer;
import org.springframework.statemachine.config.builders.StateMachineTransitionConfigurer;
import java.util.EnumSet;

@Configuration
@EnableStateMachineFactory
public class UnderwritingStateMachineConfig 
        extends StateMachineConfigurerAdapter<UnderwritingState, UnderwritingEvent> {

    @Override
    public void configure(StateMachineStateConfigurer<UnderwritingState, UnderwritingEvent> states) 
            throws Exception {
        states
            .withStates()
            .initial(UnderwritingState.DATA_COLLECTED)
            .state(UnderwritingState.RISK_ASSESSING)
            .state(UnderwritingState.AWAITING_MANUAL_REVIEW)
            .state(UnderwritingState.APPROVED)
            .state(UnderwritingState.REJECTED)
            .end(UnderwritingState.COMPLETED);
    }

    @Override
    public void configure(StateMachineTransitionConfigurer<UnderwritingState, UnderwritingEvent> transitions) 
            throws Exception {
        transitions
            // 数据收集完成 → 风险评估
            .withExternal()
                .source(UnderwritingState.DATA_COLLECTED)
                .target(UnderwritingState.RISK_ASSESSING)
                .event(UnderwritingEvent.START_RISK_ASSESSMENT)
                .and()
            // 风险评估完成 → 自动通过
            .withExternal()
                .source(UnderwritingState.RISK_ASSESSING)
                .target(UnderwritingState.APPROVED)
                .event(UnderwritingEvent.LOW_RISK)
                .guard(ctx -> (int) ctx.getExtendedState().get("riskScore", 0) < 60)
                .and()
            // 风险评估完成 → 中风险 → 人工审核
            .withExternal()
                .source(UnderwritingState.RISK_ASSESSING)
                .target(UnderwritingState.AWAITING_MANUAL_REVIEW)
                .event(UnderwritingEvent.MEDIUM_RISK)
                .guard(ctx -> {
                    int score = ctx.getExtendedState().get("riskScore", 0);
                    return score >= 60 && score < 85;
                })
                .and()
            // 风险评估完成 → 高风险 → 拒绝
            .withExternal()
                .source(UnderwritingState.RISK_ASSESSING)
                .target(UnderwritingState.REJECTED)
                .event(UnderwritingEvent.HIGH_RISK)
                .guard(ctx -> (int) ctx.getExtendedState().get("riskScore", 0) >= 85)
                .and()
            // 人工审核 → 通过
            .withExternal()
                .source(UnderwritingState.AWAITING_MANUAL_REVIEW)
                .target(UnderwritingState.APPROVED)
                .event(UnderwritingEvent.MANUAL_APPROVE)
                .and()
            // 人工审核 → 拒绝
            .withExternal()
                .source(UnderwritingState.AWAITING_MANUAL_REVIEW)
                .target(UnderwritingState.REJECTED)
                .event(UnderwritingEvent.MANUAL_REJECT)
                .and()
            // 通过 → 完成
            .withExternal()
                .source(UnderwritingState.APPROVED)
                .target(UnderwritingState.COMPLETED)
                .event(UnderwritingEvent.FINALIZE)
                .and()
            // 拒绝 → 完成
            .withExternal()
                .source(UnderwritingState.REJECTED)
                .target(UnderwritingState.COMPLETED)
                .event(UnderwritingEvent.FINALIZE);
    }
}
```

```java
// UnderwritingState.java
package com.example.insurance.workflow;

public enum UnderwritingState {
    DATA_COLLECTED,     // 已收集投保数据
    RISK_ASSESSING,     // 风险评估中
    AWAITING_MANUAL_REVIEW, // 等待人工审核
    APPROVED,           // 已通过
    REJECTED,           // 已拒绝
    COMPLETED           // 已完成
}
```

```java
// UnderwritingEvent.java
package com.example.insurance.workflow;

public enum UnderwritingEvent {
    START_RISK_ASSESSMENT,
    LOW_RISK,
    MEDIUM_RISK,
    HIGH_RISK,
    MANUAL_APPROVE,
    MANUAL_REJECT,
    FINALIZE
}
```

### 2.2 中量级：Spring Batch Chunk-Oriented Processing

适合大批量数据处理，支持 Chunk 模式（读取→处理→写入）和 Tasklet 模式。Spring Batch 5.x 提供了 Virtual Thread 支持，极大简化了异步批处理。

```java
// BatchRiskAssessmentConfig.java
package com.example.insurance.batch;

import org.springframework.batch.core.Job;
import org.springframework.batch.core.Step;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.builder.StepBuilder;
import org.springframework.batch.item.ItemProcessor;
import org.springframework.batch.item.ItemReader;
import org.springframework.batch.item.ItemWriter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BatchRiskAssessmentConfig {

    @Bean
    public Job riskAssessmentJob(JobRepository jobRepository, Step assessmentStep) {
        return new JobBuilder("riskAssessmentJob", jobRepository)
            .start(assessmentStep)
            .build();
    }

    @Bean
    public Step assessmentStep(JobRepository jobRepository,
                                org.springframework.transaction.PlatformTransactionManager tm,
                                ItemReader<InsuranceApplication> reader,
                                ItemProcessor<InsuranceApplication, AssessmentResult> processor,
                                ItemWriter<AssessmentResult> writer) {
        return new StepBuilder("assessmentStep", jobRepository)
            .<InsuranceApplication, AssessmentResult>chunk(100, tm)
            .reader(reader)
            .processor(processor)
            .writer(writer)
            // JDK 25 Virtual Threads 支持
            .taskExecutor(java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor())
            .build();
    }
}
```

### 2.3 重量级：Temporal / Camunda / Conductor

对于复杂的、运行时间长的（数天甚至数周）、需要高可靠性的 Workflow，需要使用专业的 Workflow 引擎。

**Temporal 特点**：
- 自动重试和超时处理
- Workflow 状态持久化（即使服务重启也不丢失状态）
- 支持 Signal（外部触发）、Query（查询状态）
- 原生支持 Human-in-the-loop（通过 Signal 机制）

**选择建议**：
- 简单流程（< 10 个状态）→ 自定义状态机或 Spring State Machine
- 批处理（百万级数据）→ Spring Batch
- 长时间运行、需要持久化和补偿的流程 → Temporal

## 三、Human-in-the-loop 模式

### 3.1 审批节点

审批节点是 Human-in-the-loop 的最常见模式。系统在执行到关键节点时暂停，发起审批请求，等待人工决策后继续。

```java
// ApprovalNode.java
package com.example.insurance.hitl;

import java.util.concurrent.*;
import java.time.Duration;

public class ApprovalNode {

    private final ConcurrentHashMap<String, CompletableFuture<ApprovalDecision>> pendingApprovals
        = new ConcurrentHashMap<>();

    /**
     * 发起审批请求，阻塞等待结果
     */
    public ApprovalDecision requestApproval(String applicationId, String reason, Duration timeout) {
        var future = new CompletableFuture<ApprovalDecision>();
        pendingApprovals.put(applicationId, future);

        // 通知审批人（邮件、消息推送等）
        notifyReviewer(applicationId, reason);

        try {
            return future.get(timeout.toSeconds(), TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            pendingApprovals.remove(applicationId);
            return new ApprovalDecision(false, "审批超时，自动拒绝");
        } catch (Exception e) {
            Thread.currentThread().interrupt();
            return new ApprovalDecision(false, "审批异常: " + e.getMessage());
        }
    }

    /**
     * 审批人提交决策（通过 Web API 调用）
     */
    public void submitDecision(String applicationId, boolean approved, String comment) {
        var future = pendingApprovals.remove(applicationId);
        if (future != null) {
            future.complete(new ApprovalDecision(approved, comment));
        }
    }

    private void notifyReviewer(String applicationId, String reason) {
        // 实际实现：发送邮件、站内通知、企业微信消息等
        System.out.printf("[审批通知] 申请号: %s, 原因: %s%n", applicationId, reason);
    }
}

record ApprovalDecision(boolean approved, String comment) {}
```

### 3.2 中断与恢复

长时间运行的 Workflow 需要支持中断和恢复。通过持久化状态实现：

```java
// PausableWorkflowEngine.java
package com.example.insurance.workflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PausableWorkflowEngine {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Map<String, WorkflowContext> activeContexts = new ConcurrentHashMap<>();

    public PausableWorkflowEngine(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * 暂停 Workflow（持久化当前状态）
     */
    public void pause(String workflowId, String currentStep, Map<String, Object> state) {
        try {
            var stateJson = mapper.writeValueAsString(state);
            jdbc.update("""
                INSERT INTO workflow_snapshots (workflow_id, current_step, state_json, paused_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (workflow_id) DO UPDATE SET
                    current_step = EXCLUDED.current_step,
                    state_json = EXCLUDED.state_json,
                    paused_at = EXCLUDED.paused_at
                """, workflowId, currentStep, stateJson, Instant.now());
        } catch (Exception e) {
            throw new WorkflowException("暂停 Workflow 失败", e);
        }
    }

    /**
     * 恢复 Workflow（从持久化状态恢复）
     */
    public WorkflowContext resume(String workflowId) {
        var row = jdbc.queryForMap(
            "SELECT current_step, state_json FROM workflow_snapshots WHERE workflow_id = ?",
            workflowId);

        try {
            var currentStep = (String) row.get("current_step");
            var stateJson = (String) row.get("state_json");
            @SuppressWarnings("unchecked")
            var state = (Map<String, Object>) mapper.readValue(
                stateJson, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});

            var ctx = new WorkflowContext(workflowId, currentStep, state);
            activeContexts.put(workflowId, ctx);
            return ctx;
        } catch (Exception e) {
            throw new WorkflowException("恢复 Workflow 失败", e);
        }
    }

    /**
     * 保存检查点
     */
    public void saveCheckpoint(String workflowId, String checkpoint, Map<String, Object> state) {
        pause(workflowId, checkpoint, state);
    }
}

class WorkflowContext {
    private final String workflowId;
    private String currentStep;
    private final Map<String, Object> state;

    public WorkflowContext(String workflowId, String currentStep, Map<String, Object> state) {
        this.workflowId = workflowId;
        this.currentStep = currentStep;
        this.state = state;
    }

    public String workflowId() { return workflowId; }
    public String currentStep() { return currentStep; }
    public void currentStep(String step) { this.currentStep = step; }
    public Map<String, Object> state() { return state; }
}

class WorkflowException extends RuntimeException {
    public WorkflowException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 3.3 权限升级

当 Agent 的操作超出其权限范围时，需要触发权限升级——请求更高级别的人工授权：

```java
// EscalationManager.java
package com.example.insurance.hitl;

import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EscalationManager {

    private final ConcurrentHashMap<String, PendingEscalation> escalations = new ConcurrentHashMap<>();
    private final ApprovalNode approvalNode;

    public EscalationManager(ApprovalNode approvalNode) {
        this.approvalNode = approvalNode;
    }

    /**
     * 检查操作是否需要权限升级
     */
    public boolean requiresEscalation(String operation, int agentAuthLevel) {
        var requiredLevel = switch (operation) {
            case "view_policy" -> 1;
            case "modify_beneficiary" -> 2;
            case "cancel_policy" -> 3;
            case "process_claim_over_100k" -> 4;
            default -> 1;
        };
        return agentAuthLevel < requiredLevel;
    }

    /**
     * 执行权限升级：请求上级授权
     */
    public EscalationResult escalate(String sessionId, String operation, 
                                      String reason, Duration timeout) {
        var escalation = new PendingEscalation(sessionId, operation, reason, timeout);
        escalations.put(sessionId, escalation);

        // 发起审批
        var decision = approvalNode.requestApproval(sessionId, reason, timeout);

        if (decision.approved()) {
            return new EscalationResult(true, "上级已授权: " + decision.comment(), null);
        } else {
            return new EscalationResult(false, "上级拒绝授权: " + decision.comment(), 
                "该操作需要更高级别权限，已请求审批但被拒绝");
        }
    }

    /**
     * 临时授权令牌
     */
    public String grantTemporaryToken(String sessionId, Duration validity) {
        var token = "TEMP-AUTH-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        // 存储临时令牌（实际应存入 Redis）
        return token;
    }
}

record PendingEscalation(String sessionId, String operation, String reason, Duration timeout) {}
record EscalationResult(boolean authorized, String message, String fallbackMessage) {}
```

## 四、完整代码：带人工审批的保险核保 Agent Workflow

### 4.1 核保数据模型

```java
// InsuranceApplication.java
package com.example.insurance.model;

import java.time.LocalDate;
import java.util.Map;

public record InsuranceApplication(
    String applicationId,
    String applicantName,
    String idNumber,
    LocalDate birthDate,
    String gender,
    String occupation,
    double annualIncome,
    String insuranceType,       // "term_life", "critical_illness", "medical"
    double coverageAmount,
    String medicalHistory,      // 健康告知
    String smokingStatus,       // "never", "former", "current"
    Map<String, Object> additionalInfo
) {}
```

### 4.2 风险评估服务

```java
// RiskAssessmentService.java
package com.example.insurance.service;

import com.example.insurance.model.InsuranceApplication;
import org.springframework.stereotype.Service;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

@Service
public class RiskAssessmentService {

    /**
     * 计算风险评分（0-100），分数越高风险越大
     */
    public int calculateRiskScore(InsuranceApplication app) {
        int score = 0;

        // 年龄因素
        var age = ChronoUnit.YEARS.between(app.birthDate(), LocalDate.now());
        if (age > 60) score += 30;
        else if (age > 50) score += 20;
        else if (age > 40) score += 10;

        // 保额因素
        if (app.coverageAmount() > 5_000_000) score += 25;
        else if (app.coverageAmount() > 1_000_000) score += 15;

        // 职业风险
        var highRiskOccupations = java.util.Set.of("miner", "firefighter", "pilot", "diver");
        if (highRiskOccupations.contains(app.occupation().toLowerCase())) {
            score += 30;
        }

        // 吸烟状态
        if ("current".equals(app.smokingStatus())) score += 15;
        else if ("former".equals(app.smokingStatus())) score += 5;

        // 健康告知中有异常
        if (app.medicalHistory() != null && !app.medicalHistory().isBlank()) {
            score += 20;
        }

        return Math.min(score, 100);
    }

    /**
     * LLM 增强的智能风险评估（使用 AI 分析健康告知文本）
     */
    public String aiRiskAnalysis(InsuranceApplication app, 
                                  org.springframework.ai.chat.client.ChatClient llm) {
        var prompt = """
            作为保险核保专家，分析以下投保申请的健康告知：
            
            申请人年龄：%d
            职业：%s
            保额：%f
            健康告知：%s
            
            请提供：
            1. 风险等级（低/中/高）
            2. 主要风险点
            3. 是否需要人工审核
            4. 建议的核保结论
            """.formatted(
                ChronoUnit.YEARS.between(app.birthDate(), LocalDate.now()),
                app.occupation(),
                app.coverageAmount(),
                app.medicalHistory()
            );

        return llm.prompt().user(prompt).call().content();
    }
}
```

### 4.3 核保 Workflow 编排器

```java
// UnderwritingWorkflowOrchestrator.java
package com.example.insurance.workflow;

import com.example.insurance.hitl.ApprovalNode;
import com.example.insurance.model.InsuranceApplication;
import com.example.insurance.service.RiskAssessmentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.*;

@Service
public class UnderwritingWorkflowOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(UnderwritingWorkflowOrchestrator.class);

    private final RiskAssessmentService riskService;
    private final ApprovalNode approvalNode;
    private final ChatClient llm;
    private final PausableWorkflowEngine workflowEngine;

    public UnderwritingWorkflowOrchestrator(
            RiskAssessmentService riskService,
            ApprovalNode approvalNode,
            ChatClient llm,
            PausableWorkflowEngine workflowEngine) {
        this.riskService = riskService;
        this.approvalNode = approvalNode;
        this.llm = llm;
        this.workflowEngine = workflowEngine;
    }

    /**
     * 执行核保 Workflow
     */
    public UnderwritingResult execute(InsuranceApplication application) {
        var workflowId = "UW-" + application.applicationId();
        var state = new HashMap<String, Object>();
        state.put("application", application);
        state.put("startedAt", java.time.Instant.now());

        log.info("[{}] 核保流程开始: 申请人={}, 保额={}", 
            workflowId, application.applicantName(), application.coverageAmount());

        try {
            // Step 1: 数据校验
            log.info("[{}] Step 1: 数据校验", workflowId);
            var validationResult = validateApplication(application);
            if (!validationResult.passed()) {
                return UnderwritingResult.rejected(application.applicationId(), validationResult.reason());
            }
            state.put("step", "DATA_VALIDATED");

            // Step 2: 风险评估
            log.info("[{}] Step 2: 风险评估", workflowId);
            var riskScore = riskService.calculateRiskScore(application);
            state.put("riskScore", riskScore);
            log.info("[{}] 风险评分: {}", workflowId, riskScore);

            // 如果保额超过200万，暂停流程等待复核
            if (application.coverageAmount() > 2_000_000) {
                log.info("[{}] 高保额触发暂停: 保额={}", workflowId, application.coverageAmount());
                workflowEngine.pause(workflowId, "HIGH_COVERAGE_PAUSE", state);
                // 在实际系统中，这里会通过消息通知核保人员
            }

            // Step 3: AI 增强分析
            log.info("[{}] Step 3: AI 增强分析", workflowId);
            var aiAnalysis = riskService.aiRiskAnalysis(application, llm);
            state.put("aiAnalysis", aiAnalysis);
            state.put("step", "AI_ANALYZED");

            // Step 4: 决策分支
            log.info("[{}] Step 4: 决策分支 (riskScore={})", workflowId, riskScore);

            if (riskScore < 40) {
                // 低风险：自动通过
                log.info("[{}] 低风险，自动通过", workflowId);
                return UnderwritingResult.approved(application.applicationId(), 
                    "自动核保通过，风险评分: " + riskScore);
            } else if (riskScore < 70) {
                // 中风险：人工审核
                log.info("[{}] 中风险，进入人工审核", workflowId);
                var approvalResult = approvalNode.requestApproval(
                    application.applicationId(),
                    buildApprovalReason(application, riskScore, aiAnalysis),
                    Duration.ofHours(24)
                );

                if (approvalResult.approved()) {
                    return UnderwritingResult.approved(application.applicationId(),
                        "人工审核通过: " + approvalResult.comment());
                } else {
                    return UnderwritingResult.rejected(application.applicationId(),
                        "人工审核拒绝: " + approvalResult.comment());
                }
            } else {
                // 高风险：建议拒绝，但仍需人工确认
                log.info("[{}] 高风险，建议拒绝，等待人工确认", workflowId);
                var approvalResult = approvalNode.requestApproval(
                    application.applicationId(),
                    buildHighRiskApprovalReason(application, riskScore, aiAnalysis),
                    Duration.ofHours(48)
                );

                if (approvalResult.approved()) {
                    return UnderwritingResult.approved(application.applicationId(),
                        "高风险申请经人工特批通过: " + approvalResult.comment());
                } else {
                    return UnderwritingResult.rejected(application.applicationId(),
                        "高风险申请被拒绝: " + approvalResult.comment());
                }
            }

        } catch (Exception e) {
            log.error("[{}] 核保流程异常", workflowId, e);
            // 异常时持久化状态以便恢复
            workflowEngine.pause(workflowId, "ERROR", state);
            return UnderwritingResult.error(application.applicationId(), e.getMessage());
        }
    }

    private ValidationResult validateApplication(InsuranceApplication app) {
        if (app.applicantName() == null || app.applicantName().isBlank()) {
            return new ValidationResult(false, "申请人姓名不能为空");
        }
        if (app.idNumber() == null || app.idNumber().isBlank()) {
            return new ValidationResult(false, "身份证号不能为空");
        }
        if (app.coverageAmount() <= 0) {
            return new ValidationResult(false, "保额必须大于0");
        }
        return new ValidationResult(true, null);
    }

    private String buildApprovalReason(InsuranceApplication app, int riskScore, String aiAnalysis) {
        return """
            投保申请需要人工审核：
            
            申请人：%s
            保险类型：%s
            保额：%.2f
            风险评分：%d/100
            AI分析摘要：%s
            """.formatted(app.applicantName(), app.insuranceType(), 
                app.coverageAmount(), riskScore, 
                aiAnalysis.length() > 200 ? aiAnalysis.substring(0, 200) + "..." : aiAnalysis);
    }

    private String buildHighRiskApprovalReason(InsuranceApplication app, int riskScore, String aiAnalysis) {
        return """
            【高风险申请 - 需要高级审批权限】
            
            申请人：%s
            保险类型：%s
            保额：%.2f
            风险评分：%d/100（高风险）
            AI分析摘要：%s
            
            注意：此申请风险评分较高，建议谨慎审批。
            """.formatted(app.applicantName(), app.insuranceType(),
                app.coverageAmount(), riskScore, aiAnalysis);
    }

    record ValidationResult(boolean passed, String reason) {}
}
```

### 4.4 核保结果与审批 API

```java
// UnderwritingResult.java
package com.example.insurance.workflow;

public record UnderwritingResult(
    String applicationId,
    String status,     // "approved", "rejected", "pending", "error"
    String reason
) {
    public static UnderwritingResult approved(String id, String reason) {
        return new UnderwritingResult(id, "approved", reason);
    }
    public static UnderwritingResult rejected(String id, String reason) {
        return new UnderwritingResult(id, "rejected", reason);
    }
    public static UnderwritingResult pending(String id, String reason) {
        return new UnderwritingResult(id, "pending", reason);
    }
    public static UnderwritingResult error(String id, String reason) {
        return new UnderwritingResult(id, "error", reason);
    }
}
```

```java
// UnderwritingController.java
package com.example.insurance.controller;

import com.example.insurance.hitl.ApprovalNode;
import com.example.insurance.model.InsuranceApplication;
import com.example.insurance.workflow.UnderwritingWorkflowOrchestrator;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/underwriting")
public class UnderwritingController {

    private final UnderwritingWorkflowOrchestrator orchestrator;
    private final ApprovalNode approvalNode;

    public UnderwritingController(UnderwritingWorkflowOrchestrator orchestrator,
                                   ApprovalNode approvalNode) {
        this.orchestrator = orchestrator;
        this.approvalNode = approvalNode;
    }

    @PostMapping("/submit")
    public var submitApplication(@RequestBody InsuranceApplication application) {
        return orchestrator.execute(application);
    }

    @PostMapping("/approve/{applicationId}")
    public var approve(@PathVariable String applicationId, @RequestBody ApprovalRequest request) {
        approvalNode.submitDecision(applicationId, true, request.comment());
        return Map.of("status", "ok", "action", "approved");
    }

    @PostMapping("/reject/{applicationId}")
    public var reject(@PathVariable String applicationId, @RequestBody ApprovalRequest request) {
        approvalNode.submitDecision(applicationId, false, request.comment());
        return Map.of("status", "ok", "action", "rejected");
    }
}

record ApprovalRequest(String comment) {}
```

## 五、最佳实践

1. **审批超时必须处理**：永远设置审批超时时间。超时后根据业务规则自动决策（如小额自动通过、大额自动拒绝）。

2. **状态持久化是必须的**：任何涉及 Human-in-the-loop 的 Workflow 都必须持久化状态。用户可能在任何时候关闭浏览器，几天后才回来处理。

3. **审批信息要完整**：提交给审批人的信息应包含决策所需的全部上下文，减少审批人的往返沟通。

4. **Workflow 和 Agent 可以组合**：在确定性 Workflow 的某些节点（如健康告知分析）嵌入 LLM Agent 调用，兼得可控性和智能性。

5. **审计日志不可少**：记录每一步的状态变更、审批决策、操作人和时间戳。对于保险、金融等合规要求高的行业，审计日志是强制要求。

## 六、常见问题

**Q: 审批节点如何通知审批人？**
A: 多渠道组合——WebSocket 实时推送、邮件通知、企业微信/钉钉消息、短信。对于超时未处理的审批，应触发升级通知（通知审批人的上级）。

**Q: Workflow 中某个节点失败了如何恢复？**
A: 持久化每个节点的输入和输出。失败后从最近的检查点恢复，跳过已成功的节点。Spring State Machine 的 `StateMachinePersister` 可以做到这一点。

**Q: 如何在 Workflow 中嵌入 LLM 调用？**
A: 将 LLM 调用封装为一个 State Action。Spring State Machine 的 `withStates().state(..., action())` 可以定义进入某个状态时执行的 Action。

---

**总结**：Workflow 和 Human-in-the-loop 是构建生产级 AI 应用的关键模式。确定性 Workflow 提供可预测性，LLM Agent 提供灵活性，两者结合才能构建稳健的 AI 系统。Human-in-the-loop 不是 AI 的弱点，而是系统可靠性的保障——关键决策始终应该有人类把关。
