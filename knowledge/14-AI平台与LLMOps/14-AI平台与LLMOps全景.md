---
domain: 14-AI平台与LLMOps
title: AI 平台与 LLMOps 全景
status: draft
level: intermediate
content_type: overview
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/
    description: Spring AI official reference documentation
  - level: L1
    url: https://opentelemetry.io/docs/specs/semconv/gen-ai/
    description: OpenTelemetry GenAI semantic conventions
  - level: L1
    url: https://www.nist.gov/itl/ai-risk-management-framework
    description: NIST AI Risk Management Framework
relations:
  prerequisite:
    - 09-架构抽象层设计
  related:
    - 14-模型网关与Prompt管理
    - 14-AI评估与可观测性
    - 15-AI安全全面防护体系
tags:
  - llmops
  - model-gateway
  - evaluation
  - finops
  - observability
created: 2026-07-27
updated: 2026-07-28
---

# AI 平台与 LLMOps 全景

## 平台职责

AI 平台不是把多个模型 API 包装成一个 HTTP 接口。一个可运营的平台至少覆盖六个控制面：

| 控制面 | 关键能力 | 主要产物 |
|---|---|---|
| 接入 | 模型适配、能力声明、配额 | 模型目录与兼容性矩阵 |
| 路由 | 策略、熔断、回退、灰度 | 可解释的路由决策 |
| Prompt | 模板、版本、审批、回滚 | 不可变 Prompt 版本 |
| 评估 | 离线集、在线反馈、回归 | 发布门禁与失败样本 |
| 观测 | Token、耗时、错误、质量 | 指标、Trace 和告警 |
| 治理 | 身份、权限、审计、数据策略 | 策略决定与审计证据 |

## 请求生命周期

```text
身份与租户解析
  → 数据策略与 Prompt 版本选择
  → 模型候选和预算约束
  → 路由/限流/熔断
  → 模型与工具执行
  → 输出校验
  → 质量、成本和审计事件
```

每一步都要携带同一个关联 ID。系统不得把完整 Prompt、密钥或敏感业务字段放入指标标签；需要排障时，应使用受控日志和短期采样。

## 发布门禁

模型、Prompt 或检索策略变更进入生产前，应同时满足：

- 固定数据集上的质量指标未低于基线。
- 安全回归和越权工具调用测试通过。
- P95/P99 延迟与单请求成本未超过预算。
- 降级路径在无模型、超时和限流场景下可运行。
- Dashboard、告警、值班手册和回滚版本已经就绪。

后续阅读 [[14-模型网关与Prompt管理]] 了解运行时控制面，阅读
[[14-AI评估与可观测性]] 建立可回归的质量与观测体系。
