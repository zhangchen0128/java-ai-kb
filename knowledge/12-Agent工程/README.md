# 12 — Agent工程

> Tool Calling、Memory、Planning、Workflow、Human-in-the-loop、多Agent。

## 子域

| 子域 | 条目 |
|------|------|
| [核心能力](核心能力/) | Tool Calling完整剖析(JSON Schema/Spring AI)、Agent Memory体系与Planning策略(ReAct等) |
| [协作模式](协作模式/) | Agent Workflow与Human-in-the-loop、多Agent协作架构(5种模式) |

## 选型参考

| 复杂度 | 方案 |
|--------|------|
| 简单 (<5步，无分支) | Spring @Service + DB状态字段 |
| 中等 (分支/重试/审批) | Spring Batch + Outbox |
| 复杂 (Saga/补偿/长执行) | Temporal / Camunda |
