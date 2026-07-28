---
domain: 16-AI原生研发
title: 上下文工程与 ADR：可审计的 AI 原生研发
status: verified
level: intermediate
content_type: production
sources:
  - level: L1
    url: https://docs.anthropic.com/en/docs/claude-code/overview
    description: Claude Code official overview
  - level: L1
    url: https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html
    description: AWS Prescriptive Guidance for architectural decision records
  - level: L1
    url: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
    description: GitHub repository custom instructions documentation
relations:
  prerequisite:
    - 16-ClaudeCode与上下文工程
  related:
    - 03-Java测试最佳实践
    - 14-AI评估与可观测性
tags:
  - context-engineering
  - adr
  - ai-native-development
  - auditability
created: 2026-07-27
updated: 2026-07-27
verification:
  reviewed_at: 2026-07-27
  version_anchor: Claude Code instructions / ADR process reviewed 2026-07-27
  code_status: not-applicable
---

# 上下文工程与 ADR

## 上下文不是越多越好

面向编码 Agent 的上下文应分层管理：

| 层级 | 内容 | 更新频率 |
|---|---|---|
| 仓库规则 | 构建、测试、目录和安全约束 | 低 |
| 架构决策 | 已接受的选择和权衡 | 中 |
| 当前任务 | 目标、边界、验收标准 | 高 |
| 运行证据 | 测试输出、日志、Diff | 每轮 |

大段复制历史对话会引入过期约束和冲突。优先提供稳定规则、当前目标和可验证证据。

## ADR 最小模板

```text
标题与状态
上下文和约束
候选方案
决定及理由
后果和风险
验证方式
复审触发条件
```

ADR 记录的是“为什么”，代码和测试记录“怎么做”。AI 生成 ADR 时，候选方案与权衡必须由负责人复核，不能把模型推断写成既定事实。

## 可审计交付循环

1. 从任务验收标准生成检查清单。
2. 只加载与当前模块相关的规则和 ADR。
3. 实施小步改动并运行最接近的测试。
4. 保存失败输出和修复依据。
5. 执行仓库级门禁。
6. 在交付说明中列出验证结果与尚未覆盖的风险。

## 反模式

- 用一个超长指令文件承载所有项目知识。
- 允许 Agent 静默修改架构边界或数据契约。
- 只保留成功结果，丢失失败证据。
- 用“AI 生成”替代代码评审、测试和威胁分析。
- 在上下文中直接放置生产密钥、个人信息或客户数据。
