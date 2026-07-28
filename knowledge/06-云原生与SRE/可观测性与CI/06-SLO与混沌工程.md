---
domain: 06-云原生与SRE
title: SLO与混沌工程
status: draft
level: advanced
sources:
  - level: L3
    url: https://sre.google/books/
    description: Google SRE Book — 第2-6章 SLO/SLI/Error Budget 方法论源头
  - level: L3
    url: https://learning.oreilly.com/library/view/chaos-engineering/9781492043867/
    description: 《混沌工程：通过实验构建系统信心》— 混沌工程理论基础与实战
  - level: L1
    url: https://chaos-mesh.org/docs/
    description: Chaos Mesh 官方文档 — Kubernetes 原生混沌工程平台
  - level: L1
    url: https://chaosblade.io/docs/
    description: ChaosBlade 官方文档 — 阿里开源多平台混沌实验工具
  - level: L1
    url: https://prometheus.io/docs/alerting/latest/alertmanager/
    description: Prometheus Alertmanager 官方文档 — 多窗口燃尽告警配置
  - level: L4
    url: https://sre.google/workbook/alerting-on-slos/
    description: Google SRE Workbook — 基于 SLO 的告警设计章节
relations:
  prerequisite:
    - 05-分布式一致性与事务方案
    - 06-Docker与Kubernetes云原生部署
  related:
    - 06-OpenTelemetry可观测性体系
    - 05-熔断限流与弹性设计
tags:
  - slo
  - sli
  - sla
  - error-budget
  - burn-rate
  - chaos-engineering
  - chaos-mesh
  - chaosblade
  - reliability
  - capacity-planning
  - prometheus
  - grafana
  - resilience4j
  - hpa
  - keda
created: 2026-07-20
updated: 2026-07-20
content_type: concept
---

# SLO与混沌工程

## 概述

从 Google SRE 实践中提炼 SLO/SLI/SLA 方法论，结合混沌工程的主动验证，构建完整的系统可靠性治理体系。面向 Java 后端服务的可靠性设计。

可靠性不是通过"避免所有故障"实现的（这不可能），而是通过三个层次的闭环：
1. **定义可靠性目标（SLO）** — 明确什么是"足够好"
2. **量化当前状态（SLI 度量）** — 用数据衡量是否达标
3. **主动验证（混沌工程）** — 通过受控实验暴露盲区，在故障发生前修复脆弱点

本文覆盖从概念到落地的完整链路，包括错误预算策略、多窗口燃尽告警、混沌实验设计、容量规划以及 Java 代码示例。

---

## 一、SLO/SLI/SLA 核心概念

### 1.1 SLI（Service Level Indicator — 服务等级指标）

SLI 是衡量服务质量的具体量化指标。Google SRE 建议每个服务选择 3-5 个关键 SLI。

| 类别 | 指标 | 度量方式 | Java 采集手段 |
|------|------|----------|--------------|
| **延迟** | P50/P90/P95/P99 延迟 | 从 Gateway 收到请求到返回响应的时间 | Micrometer Timer + Histogram |
| **可用性** | 成功率 | 成功请求数 / 总请求数（区分 HTTP 5xx 和业务失败） | Micrometer Counter（success/error 标签） |
| **错误率** | 按类型细分 | 超时错误、业务异常、依赖故障分别统计 | Counter + tag（error_type） |
| **吞吐量** | QPS / TPS | 每秒请求数/事务数，区分峰值和均值 | Micrometer Counter + rate() |
| **饱和度** | 资源使用率 | 连接池使用率、线程池队列长度、CPU/内存水位 | Micrometer Gauge + JMX 指标 |

**SLI 设计原则：**
- 从用户视角出发，而非系统内部指标。"用户请求成功率"比"CPU 使用率"更有意义
- 区分关键路径和非关键路径：支付链路的 SLI 应比日志查询接口更严格
- 避免过度聚合：按接口、按租户、按错误类型拆分，暴露长尾问题

### 1.2 SLO（Service Level Objective — 服务等级目标）

SLO 是 SLI 的目标值 + 时间窗口的组合，定义了"可接受的可靠水平"。

**定义公式：**
```
SLO = 在 <时间窗口> 内，<SLI> 的 <指标> 达到 <目标值>
```

**定义示例：**
- 99.9% 的用户请求在 300ms 内返回成功响应（30 天滚动窗口）
- 99.95% 的支付接口调用在 1s 内完成（28 天滚动窗口）
- 99.5% 的搜索请求返回非空结果（7 天滚动窗口）

**SLO 与业务目标的对齐：**

| 接口级别 | SLO 目标 | 适用范围 | 原因 |
|----------|----------|----------|------|
| 核心交易链路 | 99.95% | 支付、下单、核保 | 业务直接受损，容忍度极低 |
| 关键查询 | 99.9% | 商品详情、保单查询 | 影响用户体验但不直接造成损失 |
| 非关键查询 | 99.5% | 历史记录、报表 | 可接受偶尔降级 |
| 后台管理 | 99.0% | 运营后台 | 内部使用，容忍度较高 |

**SLO 松紧度权衡：**
- SLO 太松（如 99%）：无实际约束力，用户已经不满意但预算仍有剩余
- SLO 太紧（如 99.999%）：团队疲劳、发布冻结频繁、创新停滞
- 经验法则：SLO 应比用户开始抱怨的阈值略严格一点

### 1.3 SLA（Service Level Agreement — 服务等级协议）

SLA 是 SLO 的商业化版本，包含违约后果。

```
SLO → 内部目标（不达标 → 团队优先处理可靠性工作）
SLA → 外部承诺（不达标 → 违约赔偿 / 服务信用）
```

**关键区别：**
- SLA 通常比 SLO 更宽松（留 buffer），例如：SLO = 99.9%，SLA = 99.5%
- SLA 的测量窗口通常更长（月度/季度 vs SLO 的 7-30 天）
- SLA 违约有财务影响（退款、服务信用），SLO 违约触发内部流程

### 1.4 错误预算（Error Budget）

错误预算是 SLO 的核心管理工具：允许系统在一定范围内"犯错"。

```
Error Budget = 1 - SLO = 允许的错误比例

月度错误预算（绝对值）= 总请求数 × (1 - SLO)
```

**计算示例：**

| 场景 | 月请求量 | SLO | 错误预算 | 含义 |
|------|----------|-----|----------|------|
| 高 QPS 服务 | 1 亿次 | 99.9% | 100,000 次 | 每月允许 10 万次错误 |
| 中等 QPS 服务 | 1000 万次 | 99.9% | 10,000 次 | 每月允许 1 万次错误 |
| 低 QPS 服务 | 10 万次 | 99.9% | 100 次 | 每月允许 100 次错误 |
| 支付核心 | 5000 万次 | 99.99% | 5,000 次 | 每月允许 5000 次错误 |

**错误预算的哲学意义：** 100% 可靠性是不可达的目标（也是不经济的）。错误预算让可靠性成为一个可管理的资源——团队可以"花费"预算来换取更快的发布速度，当预算不足时则减速保稳。

---

## 二、错误预算策略

### 2.1 燃尽率（Burn Rate）

燃尽率衡量错误预算消耗的速度，是告警设计的核心依据。

```
燃尽率 = 实际错误消耗速度 / 计划消耗速度

燃尽率 = 1  → 按计划线性消耗（正常）
燃尽率 = 2  → 2 倍速度消耗（值得关注）
燃尽率 = 10 → 10 倍速度消耗（严重，需立即响应）
```

**多窗口燃尽告警阈值表：**

| 检测窗口 | 燃尽率阈值 | 已消耗月度预算 | 告警级别 | 响应时间 | 场景说明 |
|----------|-----------|---------------|----------|----------|----------|
| 1 小时 | > 14.4 | 2% | P1-Critical | 5 分钟 | 突发故障，如部署引发的连锁错误 |
| 6 小时 | > 6.0 | 5% | P1-Critical | 5 分钟 | 持续恶化，如依赖服务降级 |
| 6 小时 | > 3.0 | 2.5% | P2-Warning | 30 分钟 | 中期趋势恶化预警 |
| 3 天 | > 2.0 | 8.2% | P2-Warning | 60 分钟 | 长期退化趋势 |
| 30 天 | > 1.0 | 100% | P3-Info | 下一工作日 | 预算耗尽提醒 |

**燃尽率计算公式推导：**
```
设 SLO = 99.9%，则月度错误预算 = 0.1% × 总请求

1h 错误预算 = 月度预算 / (30 × 24) = 0.1% / 720 ≈ 0.000139%

燃尽率 14.4 意味着：
  1h 实际消耗 = 14.4 × 0.000139% ≈ 0.002% = 月度预算的 2%
```

### 2.2 错误预算策略矩阵

| 预算剩余 | 策略 | 发布策略 | 研发重点 |
|----------|------|----------|----------|
| > 70% | Green — 健康 | 正常发布，鼓励快速迭代 | 功能开发 + 适度可靠性改进 |
| 30%-70% | Yellow — 关注 | 谨慎发布，增加灰度比例和观察时间 | 50% 可靠性工作，增加测试覆盖 |
| 10%-30% | Orange — 警告 | 仅发布 hotfix 和紧急安全补丁 | 80% 可靠性工作，修复监控盲区 |
| < 10% | Red — 冻结 | 冻结所有非紧急发布 | 全团队投入可靠性：自动化测试、架构优化、容量扩充 |

### 2.3 多窗口策略的设计意图

```
短期窗口（1h）：快速检测突发故障，触发即时响应
中期窗口（6h）：防止持续恶化，在预算耗尽前介入
长期窗口（3d）：识别缓慢退化趋势（如内存泄漏导致的渐进式性能下降）
```

三种窗口协同工作的例子：某服务因连接池配置不当，P99 延迟从 200ms 缓慢上升到 500ms（3 天窗口告警），但错误率尚未明显上升（1h 窗口正常）。团队在业务受影响前即识别并修复了问题。

---

## 三、SLO 仪表盘设计

### 3.1 Grafana SLI 核心面板

SLO Dashboard 应包含三个核心面板，一眼可知服务健康状态：

```
┌──────────────────────────────────────────────────────────────────┐
│  Service: payment-service     SLO: 99.9% (latency ≤ 300ms)      │
│  Window: 30 days  |  Remaining Budget: 67.4%  |  73,200 errors  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [Panel 1] SLI 达标率趋势图（30 天）                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  100% │                                    ████  ████████    │ │
│  │       │                     ████████████████    ██    ████   │ │
│  │ 99.9% │- - - - - - - - - - - - - - - - - - - - - - - - - -│ │
│  │       │              ██████                                   │ │
│  │  99%  │        ██████                                         │ │
│  │       └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────   │ │
│  │        D-30   D-25   D-20   D-15   D-10    D-5   Today       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│   绿色=达标 | 黄色=接近超标(99.9%-99.95%) | 红色=超标(<99.9%)      │
│                                                                   │
│  [Panel 2] 错误预算剩余（Gauge）                                   │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │       67.4%              │  │  本月消耗: 32,800 / 100,000   │  │
│  │   ████████████░░░░░░░░   │  │  日均消耗: 1,093              │  │
│  │   Green Zone (>70%)      │  │  燃尽率(24h): 1.2x (normal)  │  │
│  └──────────────────────────┘  └──────────────────────────────┘  │
│                                                                   │
│  [Panel 3] 燃尽率趋势（折线图 + 阈值线）                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │Burn│                              ╭──╮                      │ │
│  │ 14x│- - - P1 threshold - - - - -/- -\- - - - - - - - - - -│ │
│  │ 10x│                          ╭──╯   ╰──╮                   │ │
│  │  6x│- - - P2 threshold - - - /          \ - - - - - - - - │ │
│  │  3x│                     ╭───╯            ╰─────╮            │ │
│  │  1x│═══════ normal ═══════════════════════════════════════  │ │
│  │    └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────     │ │
│  │    00:00  04:00  08:00  12:00  16:00  20:00  00:00         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 多租户 SLO 拆分

在 SaaS 场景中，全局 SLO 达标不等于所有租户都满意。"吵闹邻居"问题必须通过按租户维度的 SLO 拆分来发现：

```promql
# 按租户拆分的 SLI 达标率
(
  sum by (tenant_id) (rate(http_requests_total{status="success"}[30d]))
  /
  sum by (tenant_id) (rate(http_requests_total[30d]))
) * 100

# 识别"吵闹邻居"——SLO 不达标的租户
(
  sum by (tenant_id) (rate(http_requests_total{status="success"}[30d]))
  /
  sum by (tenant_id) (rate(http_requests_total[30d]))
) < 0.999
```

### 3.3 告警阈值建议

**反模式：** 基于固定阈值告警（如 "CPU > 80% 告警"）

**推荐模式：** 基于 SLO 燃尽告警——更精准、更少误报

| 方式 | 优点 | 缺点 |
|------|------|------|
| 固定阈值（CPU > 80%） | 简单直观 | CPU 高≠用户体验差；阈值需要持续调整；产生噪声告警 |
| SLO 燃尽告警 | 直接关联用户体验；自我校准（无需手动设阈值）；告警量可控 | 需要先建立 SLO 体系 |

---

## 四、告警设计

### 4.1 多窗口燃尽告警（Prometheus Rule）

```yaml
# prometheus-rules/slo-burn-rate-alerts.yml
groups:
  - name: slo-burn-rate-alerts
    interval: 60s
    rules:
      # ===== 短期窗口：1h 内消耗 2% 月度预算 → P1 =====
      - alert: SLOBurnRateCritical-1h
        expr: |
          (
            # 1h 错误率
            rate(http_requests_total{status="error"}[1h])
            /
            rate(http_requests_total[1h])
          )
          >
          (
            # SLO 允许的错误率的 14.4 倍
            14.4 * (1 - 0.999)
          )
        for: 5m
        labels:
          severity: P1
          team: sre
        annotations:
          summary: "{{ $labels.service }} 1h 燃尽率超过 14.4x"
          description: >
            服务 {{ $labels.service }} 在 1 小时内消耗了
            约 {{ $value | humanizePercentage }} 的错误预算
            （相当于月度预算的 2%），需立即响应。
          runbook_url: "https://wiki.internal/runbooks/slo-burn-rate"

      # ===== 中期窗口：6h 内消耗 5% 月度预算 → P1 =====
      - alert: SLOBurnRateCritical-6h
        expr: |
          (
            rate(http_requests_total{status="error"}[6h])
            /
            rate(http_requests_total[6h])
          )
          >
          (
            6.0 * (1 - 0.999)
          )
        for: 15m
        labels:
          severity: P1
          team: sre
        annotations:
          summary: "{{ $labels.service }} 6h 燃尽率超过 6x"
          description: >
            服务 {{ $labels.service }} 在 6 小时内消耗了
            约月度预算的 5%，请立即排查。

      # ===== 长期窗口：3d 内持续 2 倍燃尽 → P2 =====
      - alert: SLOBurnRateWarning-3d
        expr: |
          (
            rate(http_requests_total{status="error"}[3d])
            /
            rate(http_requests_total[3d])
          )
          >
          (
            2.0 * (1 - 0.999)
          )
        for: 1h
        labels:
          severity: P2
          team: sre
        annotations:
          summary: "{{ $labels.service }} 3d 燃尽率持续超过 2x"
          description: >
            服务 {{ $labels.service }} 过去 3 天的错误率
            持续高于 SLO 的 2 倍，可能存在退化趋势。
```

### 4.2 Alertmanager 告警收敛配置

```yaml
# alertmanager/config.yml
route:
  receiver: "sre-team-default"
  group_by: ["alertname", "cluster", "service"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    - match:
        severity: P1
      receiver: "sre-pagerduty"
      group_wait: 10s
      group_interval: 1m
      repeat_interval: 30m

    - match:
        severity: P2
      receiver: "sre-slack-warning"

    - match:
        severity: P3
      receiver: "sre-slack-info"

# 抑制规则：节点宕机 → 抑制该节点上服务的告警
inhibit_rules:
  - source_match:
      alertname: NodeDown
    target_match_re:
      alertname: "SLOBurnRate.*"
    equal: ["cluster", "node"]

receivers:
  - name: "sre-pagerduty"
    pagerduty_configs:
      - routing_key: "<pagerduty-key>"
        severity: critical

  - name: "sre-slack-warning"
    slack_configs:
      - channel: "#sre-alerts-warning"
        api_url: "<slack-webhook>"

  - name: "sre-slack-info"
    slack_configs:
      - channel: "#sre-alerts-info"
        api_url: "<slack-webhook>"
```

**告警收敛策略说明：**

| 机制 | 作用 | 配置示例 |
|------|------|----------|
| **分组（group_by）** | 按 alertname/cluster/service 聚合，同一组告警合并发送 | `group_by: ["alertname", "cluster"]` |
| **抑制（inhibition）** | 根源告警触发时抑制下游告警，避免告警风暴 | 节点宕机 → 抑制该节点上所有 SLO 告警 |
| **静默（silence）** | 计划维护期间手动屏蔽已知告警 | 通过 Alertmanager UI 或 API 创建 silence |

### 4.3 On-Call 轮值与升级路径

```
告警触发
  │
  ▼
P1: 5min 无响应 → 升级到 Team Lead
        15min 无响应 → 升级到 Manager
        30min 无响应 → 升级到 VP/总监
  
P2: 30min 无响应 → 升级到 Team Lead
  
P3: 下一工作日处理

排班策略：
  - Follow the Sun：全球 3 个时区各 8 小时（APAC → EMEA → AMER）
  - 每人每次值班不超过 1 周
  - 值班期间非值班工程师有责任 Code Review 但可不响应告警
```

**告警响应流程：**
```
确认(Acknowledge) → 诊断(Triage) → 修复(Mitigate) → 复盘(Postmortem)
    5min 内            15min 内         按紧急度         24-72h 内
```

- **Acknowledge：** 确认收到告警，停止升级计时器
- **Triage：** 评估影响范围和严重程度，判断是否需要 rollback 或切换流量
- **Mitigate：** 优先恢复服务（rollback/切换/扩容），而非根因分析
- **Postmortem：** 无指责文化（blameless），记录时间线、根因、改进措施

---

## 五、混沌工程

### 5.1 核心概念

混沌工程是"通过在分布式系统上进行实验来建立对系统能力的信心"的学科。它不是随机破坏，而是有假设、有设计、有观测的科学实验。

```
传统测试：验证"已知条件下系统是否正确"
混沌工程：探索"未知条件下系统是否会出问题"

传统测试流程：输入 → 预期输出
混沌实验流程：稳态假说 → 注入故障 → 观测偏差 → 验证假说
```

### 5.2 稳态假说（Steady State Hypothesis）

稳态假说是混沌实验的"对照组"——定义了系统的正常行为基线。

**稳态假说定义模板：**
```yaml
steady_state:
  service: payment-service
  metrics:
    - name: qps
      expected: [100, 500]          # QPS 在 100-500 范围
    - name: p99_latency_ms
      expected: [0, 300]            # P99 延迟 < 300ms
    - name: error_rate
      expected: [0, 0.001]          # 错误率 < 0.1%
    - name: circuit_breaker_open
      expected: false               # 熔断器未打开
  duration: 5m                      # 稳态需持续观测 5 分钟
  window: 30d                       # 历史基线来自 30 天数据
```

**实验设计流程：**
```
1. 定义稳态假说 → "支付服务在正常状态下 QPS 100-500, P99 < 300ms"
2. 设计故障注入 → "杀死 redis-cache Pod"（模拟缓存不可用）
3. 启动实验，持续观测
4. 对比假说：
   情况 A: 稳态假说成立（P99 略有上升但仍在 300ms 内）
           → 系统对 Redis 故障有容错能力 ✓
   情况 B: 稳态假说破裂（错误率飙升到 5%）
           → 发现脆弱点：缓存降级逻辑未生效 ✗
5. 记录结果 → 驱动改进
```

### 5.3 故障注入类型

| 类别 | 故障类型 | 注入工具/命令 | 验证目标 |
|------|----------|--------------|----------|
| **网络** | 延迟增加 | `tc netem delay 200ms`、Chaos Mesh NetworkChaos | 超时配置是否合理、重试是否有效 |
| **网络** | 丢包 | `tc netem loss 10%` | 重试机制、幂等性 |
| **网络** | DNS 故障 | 返回错误 IP、DNS 不可达 | DNS 缓存、fallback 策略 |
| **网络** | 连接重置 | TCP RST 注入 | 连接池恢复能力 |
| **计算** | CPU 压力 | `stress-ng --cpu 4`、Chaos Mesh StressChaos | 限流是否生效、调度是否公平 |
| **计算** | 内存压力 | `stress-ng --vm 2 --vm-bytes 1G`、Chaos Mesh StressChaos | OOM 处理、GC 行为 |
| **计算** | 磁盘 IO 压力 | `stress-ng --hdd 2`、Chaos Mesh IOChaos | IO 超时、日志写入降级 |
| **进程** | Pod Kill | `kubectl delete pod`、Chaos Mesh PodChaos | Pod 重启速度、优雅关闭、连接排空 |
| **进程** | 进程 Hang | `kill -STOP <pid>` | 健康检查探活、超时检测 |
| **进程** | 时钟偏移 | `chronyc` 手动调整 | 分布式时钟同步、证书有效期 |
| **依赖** | 数据库慢查询 | 注入长事务、大表扫描 | 连接池保护、慢查询熔断 |
| **依赖** | Redis 超时 | 延迟注入或连接拒绝 | 缓存降级、穿透保护 |
| **依赖** | Kafka Broker 宕机 | 关闭 Broker | 生产者重试、消费者 Rebalance |

### 5.4 爆炸半径（Blast Radius）

混沌实验的安全性是第一优先级。爆炸半径控制确保即使实验失败，影响也是可控的。

```
爆炸半径递进策略：

第 1 级：单个 Pod                     ← 初始实验
   ↓ 实验成功，扩大半径
第 2 级：单个节点上的所有 Pod
   ↓ 实验成功，扩大半径
第 3 级：单个可用区（AZ）
   ↓ 实验成功，扩大半径
第 4 级：跨 AZ 验证（Region 级）
```

**用户隔离策略：**

| 策略 | 适用场景 | 实现方式 |
|------|----------|----------|
| 测试用户 | 生产环境实验 | 路由层按 user_id 将测试用户流量导向实验区域 |
| 影子流量 | 压测 + 混沌同时进行 | 复制生产流量到实验集群，不影响真实用户 |
| 流量镜像 | 生产环境旁路测试 | 镜像一份流量到实验 Pod，对比正常 Pod 和实验 Pod 的响应 |
| 灰度用户 | 逐步扩大 | 1% → 5% → 25% → 100% 用户逐步纳入实验 |

**实验自动终止条件（熔断机制）：**
```
实验立即终止如果：
  - 错误预算消耗速度 > 10x（短窗口燃尽阈值）
  - 触发 P1 告警
  - 人工干预（手动终止按钮）
  - 实验超过计划时长（maxDuration）
```

### 5.5 Chaos Mesh 实践

Chaos Mesh 是 CNCF 沙箱项目，通过 Kubernetes CRD 定义混沌实验。

```yaml
# chaos-mesh/network-delay-experiment.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: payment-redis-delay
  namespace: chaos-testing
spec:
  action: delay
  mode: fixed-percent
  value: "50"                          # 50% 的 Pod 受影响
  selector:
    namespaces:
      - production
    labelSelectors:
      app: payment-service
  delay:
    latency: "200ms"
    jitter: "50ms"
    correlation: "50"
  duration: "5m"                       # 实验持续 5 分钟
  scheduler:                           # 可选的定时执行
    cron: "0 3 * * 1"                 # 每周一凌晨 3 点执行
---
# Pod Kill 实验
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: payment-pod-kill
  namespace: chaos-testing
spec:
  action: pod-kill
  mode: one                            # 只杀一个 Pod
  selector:
    namespaces:
      - production
    labelSelectors:
      app: payment-service
  duration: "30s"
---
# CPU 压力实验
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: payment-cpu-stress
  namespace: chaos-testing
spec:
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: payment-service
  stressors:
    cpu:
      workers: 2
      load: 80                        # CPU 负载 80%
  duration: "10m"
```

### 5.6 ChaosBlade 实践

ChaosBlade 是阿里巴巴开源的混沌实验工具，支持物理机、Kubernetes、Docker 等多平台。

```bash
# === 物理机 / VM 环境 ===

# 1. 网络延迟注入（eth0 网卡增加 200ms 延迟，影响 80 端口）
blade create network delay \
  --time 200 \
  --offset 50 \
  --interface eth0 \
  --local-port 80

# 2. CPU 满载注入（2 个核心跑满 80%）
blade create cpu fullload --cpu-percent 80 --cpu-count 2

# 3. 磁盘 IO 故障注入（/data 目录读延迟 100ms）
blade create disk burn --path /data --read

# 4. Java 应用故障注入（直接针对 JVM 进程）
# 指定 Java 进程的方法延迟
blade create jvm delay \
  --process payment-service \
  --classname com.example.PaymentService \
  --methodname processPayment \
  --time 2000

# 5. 销毁实验
blade destroy <实验UID>

# 6. 查询实验状态
blade status <实验UID>
```

**ChaosBlade 与 Chaos Mesh 对比：**

| 维度 | Chaos Mesh | ChaosBlade |
|------|-----------|------------|
| 定位 | Kubernetes 原生 | 多平台通用（物理机/K8s/Docker） |
| 部署 | K8s CRD，声明式 | CLI + Agent，命令式 |
| 故障类型 | Network/Pod/Stress/IO/DNS/HTTP/AWS/GC | CPU/Disk/Network/Process/JVM/Servlet |
| JVM 级注入 | 不直接支持 | 支持（方法延迟、返回值篡改、异常注入） |
| 生态 | CNCF Sandbox，社区活跃 | 阿里云商业支持，中文文档友好 |

---

## 六、容量规划

### 6.1 QPS 估算模型

**容量规划三步法：**

```
第 1 步：历史数据分析
  - 过去 30 天 QPS 趋势（Prometheus: rate(http_requests_total[30d])）
  - 识别峰值时段（如每日 10:00-12:00、每周一）
  - 计算环比增长率（本周峰值 / 上周峰值）

第 2 步：增长因子建模
  - 业务自然增长：基于过去 3 个月的月环比增长率均值
  - 营销活动峰值：大促/活动期峰值 = 日常峰值 × 3 ~ 10 倍
  - 新功能上线预估：与产品确认预期流量

第 3 步：目标容量计算
  目标容量 = 峰值 QPS × (1 + 增长预期%) × 安全系数(1.5x~2x)
```

**示例计算：**
```
当前峰值 QPS:  2,000
QoQ 增长率:    +15%（季度增长）
营销峰值倍率:  ×3（大促预期）
安全系数:      ×1.5

目标容量 = 2,000 × 1.15 × 3 × 1.5 = 10,350 QPS
```

### 6.2 资源水位线

| 资源 | 安全水位 | 告警水位 | 危险水位 | 说明 |
|------|----------|----------|----------|------|
| CPU | < 60%（峰值） | > 70% | > 85% | 留余量应对突发流量和 Pod 调度波动 |
| 内存 | < 70% | > 80% | > 90% | JVM 堆外内存 + OS Cache 需额外考虑 |
| 磁盘 | < 80% | > 85% | > 92% | 日志轮转、临时文件清理 |
| 连接池（DB/Redis） | < 70% | > 80% | > 90% | 连接泄漏会导致雪崩 |

**单节点容量推算：**
```
1. 压测得出单实例在 SLO 内的最大 QPS（如 500 QPS/实例）
2. 节点数 = 目标 QPS / 单实例 QPS
   节点数 = 10,350 / 500 ≈ 21 个实例
3. 加上冗余（N-1 容灾）：
   实际部署 = 21 × 1.25 ≈ 27 个实例（允许 1 个 AZ 故障后仍满足容量）
```

### 6.3 弹性扩容缩容

#### HPA（Horizontal Pod Autoscaler）— 资源指标驱动

```yaml
# k8s/hpa-payment-service.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-service-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-service
  minReplicas: 3
  maxReplicas: 30
  metrics:
    # CPU 指标
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    # 内存指标
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60     # 扩容冷静期：1 分钟
      policies:
        - type: Percent
          value: 100                     # 每次最多翻倍
          periodSeconds: 60
        - type: Pods
          value: 4                       # 或每次最多加 4 个
          periodSeconds: 60
      selectPolicy: Max                  # 取两者中的最大值
    scaleDown:
      stabilizationWindowSeconds: 300    # 缩容冷静期：5 分钟
      policies:
        - type: Pods
          value: 1                       # 每次最多减 1 个
          periodSeconds: 120
```

#### KEDA（Kubernetes Event-Driven Autoscaling）— 事件驱动

```yaml
# keda/scaledobject-payment.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: payment-service-keda
  namespace: production
spec:
  scaleTargetRef:
    name: payment-service
  minReplicaCount: 1                     # 可缩容到 0
  maxReplicaCount: 30
  cooldownPeriod: 300                    # 缩容冷却：5 分钟
  triggers:
    # Kafka 消费延迟驱动
    - type: kafka
      metadata:
        bootstrapServers: kafka-broker:9092
        consumerGroup: payment-consumer
        topic: payment-events
        lagThreshold: "1000"            # lag > 1000 时扩容
    # Prometheus 自定义指标（QPS）驱动
    - type: prometheus
      metadata:
        serverAddress: http://prometheus:9090
        metricName: http_requests_per_second
        threshold: "500"                # 每 Pod QPS > 500 时扩容
        query: |
          sum(rate(http_requests_total{service="payment"}[2m]))
```

**HPA vs KEDA 选型：**

| 维度 | HPA | KEDA |
|------|-----|------|
| 驱动方式 | CPU/内存等资源指标 | Kafka Lag、Redis Queue、Prometheus 等事件指标 |
| 缩容到零 | 不支持 | 支持（minReplicas=0） |
| 复杂度 | K8s 原生，配置简单 | 需要安装 KEDA Operator |
| 适用场景 | Web 服务（稳态流量） | 事件驱动/批处理服务 |

### 6.4 成本模型

```
资源成本 = 节点数 × 单节点成本 × 运行时间

基础成本（按需）:
  = 27 节点 × ¥2.5/h × 24h × 30d = ¥48,600/月

弹性节省:
  - 使用 Spot 实例（70% 折扣）非核心 Pod
  - 非高峰时段缩容（00:00-06:00 从 27 缩到 15）
  - 节省约 30-40%

优化后估算: ¥48,600 × 0.65 ≈ ¥31,590/月
```

---

## 七、代码示例

### 7.1 Spring Boot + Micrometer + Prometheus SLI 指标定义

```java
package com.example.sre.slo;

import io.micrometer.core.instrument.*;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * SLI 指标采集组件
 * 定义 SLO 计算所需的全部服务等级指标
 */
@Component
public class SliMetricsCollector {

    private final MeterRegistry registry;

    // ===== Counter：请求计数（按状态和接口拆分）=====
    private final Counter totalRequests;
    private final Counter successRequests;
    private final Counter errorRequests;

    // ===== Timer：延迟分布（用于计算 P50/P90/P95/P99）=====
    private final Timer requestLatency;

    // ===== Gauge：饱和度指标 =====
    private final Gauge dbConnectionPoolUsage;
    private final Gauge threadPoolQueueSize;

    public SliMetricsCollector(MeterRegistry registry) {
        this.registry = registry;

        // 请求计数器 — 通过 tag 区分状态
        this.totalRequests = Counter.builder("sli.requests.total")
                .description("总请求数（用于 SLI 可用性计算）")
                .tag("service", "payment-service")
                .register(registry);

        this.successRequests = Counter.builder("sli.requests.success")
                .description("成功请求数")
                .tag("service", "payment-service")
                .register(registry);

        this.errorRequests = Counter.builder("sli.requests.error")
                .description("失败请求数")
                .tag("service", "payment-service")
                .register(registry);

        // 延迟 Histogram — 自定义 bucket 对齐 SLO 目标
        this.requestLatency = Timer.builder("sli.request.latency")
                .description("请求延迟分布")
                .tag("service", "payment-service")
                // Bucket 设计技巧：
                //   - 在 SLO 目标值（300ms）附近设置更密集的 bucket
                //   - 有助于精确计算达标率
                .serviceLevelObjectives(
                        Duration.ofMillis(10),
                        Duration.ofMillis(50),
                        Duration.ofMillis(100),
                        Duration.ofMillis(200),
                        Duration.ofMillis(300),    // ← SLO 目标
                        Duration.ofMillis(500),
                        Duration.ofMillis(1000),
                        Duration.ofMillis(2000)
                )
                .publishPercentiles(0.5, 0.90, 0.95, 0.99)
                .register(registry);

        // 饱和度采集 — 从 HikariCP 连接池获取
        this.dbConnectionPoolUsage = Gauge.builder(
                        "sli.saturation.db.connection_pool",
                        () -> getHikariPoolUsage())
                .tag("service", "payment-service")
                .register(registry);

        this.threadPoolQueueSize = Gauge.builder(
                        "sli.saturation.threadpool.queue_size",
                        () -> getThreadPoolQueueSize())
                .tag("service", "payment-service")
                .register(registry);
    }

    /**
     * 记录一次完整的请求 SLI
     * 在 Filter 或 AOP 中调用
     */
    public void recordRequest(String endpoint, int httpStatus,
                              long latencyMs, boolean isBusinessSuccess) {
        totalRequests.increment();

        if (httpStatus < 500 && isBusinessSuccess) {
            successRequests.increment();
        } else {
            errorRequests.increment();
        }

        requestLatency.record(latencyMs, TimeUnit.MILLISECONDS);
    }

    private double getHikariPoolUsage() {
        // 从 HikariCP MBean 或 HikariDataSource 获取活跃连接数/最大连接数
        return 0.45; // 示例值：45% 使用率
    }

    private double getThreadPoolQueueSize() {
        return ThreadPoolExecutor.class.cast(
                        Executors.newFixedThreadPool(1))
                .getQueue().size();
    }
}
```

**对应的 PromQL 查询：**

```promql
# SLI 可用性（30 天滚动窗口）
sum(rate(sli_requests_success_total[30d]))
  /
sum(rate(sli_requests_total_total[30d]))

# P99 延迟
histogram_quantile(0.99,
  rate(sli_request_latency_seconds_bucket[30d]))

# SLO 达标率：延迟 ≤ 300ms 的请求占比
# 使用 le="0.3" 的 bucket（300ms）
sum(rate(sli_request_latency_seconds_bucket{le="0.3"}[30d]))
  /
sum(rate(sli_request_latency_seconds_count[30d]))

# 错误预算剩余百分比
1 - (
  (1 - (
    sum(rate(sli_request_latency_seconds_bucket{le="0.3"}[30d]))
    /
    sum(rate(sli_request_latency_seconds_count[30d]))
  ))
  /
  (1 - 0.999)   # SLO = 99.9%
)

# 1 小时燃尽率
(
  rate(sli_requests_error_total[1h])
  /
  rate(sli_requests_total_total[1h])
)
/
(1 - 0.999)
```

### 7.2 Resilience4j + ChaosBlade 自动化混沌实验

```java
package com.example.sre.chaos;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 混沌实验执行器
 * 自动注入故障 → 观测 Resilience4j 反应 → 验证系统韧性
 */
@Service
public class ChaosExperimentRunner {

    private static final Logger log = LoggerFactory.getLogger(
            ChaosExperimentRunner.class);

    private final CircuitBreakerRegistry cbRegistry;
    private final RetryRegistry retryRegistry;
    private final MeterRegistry meterRegistry;
    private final ScheduledExecutorService scheduler =
            Executors.newScheduledThreadPool(2);

    // 实验状态
    private final AtomicReference<ExperimentState> state =
            new AtomicReference<>(ExperimentState.IDLE);

    public enum ExperimentState { IDLE, RUNNING, OBSERVING, COMPLETED, ABORTED }

    public ChaosExperimentRunner(CircuitBreakerRegistry cbRegistry,
                                  RetryRegistry retryRegistry,
                                  MeterRegistry meterRegistry) {
        this.cbRegistry = cbRegistry;
        this.retryRegistry = retryRegistry;
        this.meterRegistry = meterRegistry;
    }

    /**
     * 执行网络延迟混沌实验
     *
     * 稳态假说：
     *   注入 200ms Redis 延迟后，系统仍能通过降级策略
     *   保持 99% 请求成功率，P99 < 500ms
     */
    public ExperimentResult runNetworkDelayExperiment() {
        log.info("=== 开始混沌实验：Redis 网络延迟注入 ===");

        // 1. 记录实验前基线
        var baseline = captureSteadyState();

        // 2. 注入故障
        String experimentId = injectNetworkDelay("eth0", 200, 50);
        state.set(ExperimentState.RUNNING);

        // 3. 等待系统反应并持续观测（60 秒）
        try {
            TimeUnit.SECONDS.sleep(30);
            state.set(ExperimentState.OBSERVING);

            // 4. 观测 — 每 5 秒采样一次
            var observations = new ConcurrentLinkedQueue<Observation>();
            for (int i = 0; i < 6; i++) {
                observations.add(captureObservation());
                TimeUnit.SECONDS.sleep(5);

                // 安全检查：熔断器打开则终止实验
                if (isCircuitBreakerOpen()) {
                    log.warn("熔断器已打开，自动终止实验");
                    return abort(experimentId, "CircuitBreaker OPEN");
                }
            }

            // 5. 销毁实验
            destroyExperiment(experimentId);
            state.set(ExperimentState.COMPLETED);

            // 6. 验证稳态假说
            return evaluateHypothesis(baseline, observations);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return abort(experimentId, "Interrupted");
        }
    }

    /**
     * 注入网络延迟（通过 ChaosBlade CLI）
     */
    private String injectNetworkDelay(String interface_, int delayMs, int offsetMs) {
        try {
            var cmd = String.format(
                    "blade create network delay --time %d --offset %d " +
                    "--interface %s --local-port 6379",
                    delayMs, offsetMs, interface_);

            var process = Runtime.getRuntime().exec(
                    new String[]{"/bin/sh", "-c", cmd});
            var reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()));

            String line;
            String uid = null;
            while ((line = reader.readLine()) != null) {
                log.info("ChaosBlade output: {}", line);
                // 解析返回的 UID
                if (line.contains("\"result\":")) {
                    uid = extractUid(line);
                }
            }
            process.waitFor(10, TimeUnit.SECONDS);

            log.info("故障注入成功，实验 ID: {}", uid);
            return uid;

        } catch (Exception e) {
            throw new RuntimeException("ChaosBlade 注入失败", e);
        }
    }

    /**
     * 销毁实验
     */
    private void destroyExperiment(String uid) {
        try {
            var cmd = "blade destroy " + uid;
            Runtime.getRuntime().exec(new String[]{"/bin/sh", "-c", cmd});
            log.info("混沌实验 {} 已销毁", uid);
        } catch (Exception e) {
            log.error("销毁实验失败", e);
        }
    }

    /**
     * 采集稳态基线数据
     */
    private SteadyState captureSteadyState() {
        // 在实际实现中，从 Micrometer/Prometheus 拉取当前指标快照
        return new SteadyState(250.0, 0.998, 0);
    }

    /**
     * 单次观测采样
     */
    private Observation captureObservation() {
        return new Observation(
                getCircuitBreakerState(),
                getCurrentErrorRate(),
                getP99Latency()
        );
    }

    private boolean isCircuitBreakerOpen() {
        var cb = cbRegistry.circuitBreaker("paymentService");
        return cb.getState() == CircuitBreaker.State.OPEN;
    }

    private String getCircuitBreakerState() {
        var cb = cbRegistry.circuitBreaker("paymentService");
        return cb.getState().name();
    }

    private double getCurrentErrorRate() {
        // 从 MeterRegistry 读取最近的错误率
        return 0.005;
    }

    private double getP99Latency() {
        return 280.0;
    }

    /**
     * 评估稳态假说是否成立
     */
    private ExperimentResult evaluateHypothesis(
            SteadyState baseline,
            ConcurrentLinkedQueue<Observation> observations) {

        var avgErrorRate = observations.stream()
                .mapToDouble(Observation::errorRate)
                .average()
                .orElse(1.0);

        var maxP99 = observations.stream()
                .mapToDouble(Observation::p99Latency)
                .max()
                .orElse(Double.MAX_VALUE);

        boolean hypothesisHolds = avgErrorRate < 0.01 && maxP99 < 500;

        return new ExperimentResult(
                hypothesisHolds,
                baseline,
                observations.stream().toList(),
                hypothesisHolds
                        ? "稳态假说成立：系统成功抵御 Redis 延迟故障"
                        : "稳态假说不成立：需要优化缓存降级逻辑");
    }

    private ExperimentResult abort(String experimentId, String reason) {
        destroyExperiment(experimentId);
        state.set(ExperimentState.ABORTED);
        return new ExperimentResult(false, null, null,
                "实验终止: " + reason);
    }

    private String extractUid(String line) {
        // 简化实现：从 ChaosBlade JSON 输出中提取 UID
        return line.replaceAll(".*\"result\":\"([^\"]+)\".*", "$1");
    }

    // ===== 数据类 =====

    record SteadyState(double p99LatencyMs, double successRate,
                       int circuitBreakerOpenCount) {}

    record Observation(String circuitBreakerState, double errorRate,
                       double p99Latency) {}

    record ExperimentResult(boolean hypothesisHolds,
                            SteadyState baseline,
                            java.util.List<Observation> observations,
                            String conclusion) {}
}
```

**配套 Shell 脚本 — 自动化混沌实验编排：**

```bash
#!/bin/bash
# chaos-experiment-pipeline.sh
# 混沌实验编排脚本：注入故障 → 观测 → 评估 → 自动回滚

set -e

SERVICE="payment-service"
NAMESPACE="production"
SLO_TARGET="99.9"
EXPERIMENT_DURATION="${1:-300}"  # 默认 5 分钟

echo "=== 混沌实验流水线 ==="
echo "目标服务: ${SERVICE}"
echo "SLO: ${SLO_TARGET}%"
echo "实验时长: ${EXPERIMENT_DURATION}s"

# ===== 阶段 1：定义稳态 =====
echo "[Phase 1] 采集稳态基线..."
PROM_URL="http://prometheus:9090"

BASELINE_ERROR_RATE=$(curl -s "${PROM_URL}/api/v1/query" \
  --data-urlencode 'query=sum(rate(sli_requests_error_total{service="'${SERVICE}'"}[30m])) / sum(rate(sli_requests_total_total{service="'${SERVICE}'"}[30m]))' \
  | jq -r '.data.result[0].value[1]')

echo "  基线错误率: ${BASELINE_ERROR_RATE}"

# ===== 阶段 2：注入故障 =====
echo "[Phase 2] 注入故障..."

# 只对 1 个 Pod 注入网络丢包（最小爆炸半径）
TARGET_POD=$(kubectl get pods -n ${NAMESPACE} -l app=${SERVICE} \
  -o jsonpath='{.items[0].metadata.name}')

echo "  目标 Pod: ${TARGET_POD}"

# 使用 ChaosBlade 注入
BLADE_UID=$(blade create k8s pod-network loss \
  --percent 30 \
  --names ${TARGET_POD} \
  --namespace ${NAMESPACE} \
  --kubeconfig ~/.kube/config \
  | jq -r '.result')

echo "  实验 UID: ${BLADE_UID}"

# ===== 阶段 3：持续观测 =====
echo "[Phase 3] 观测中（${EXPERIMENT_DURATION}s）..."

for ((i=0; i<${EXPERIMENT_DURATION}; i+=10)); do
  sleep 10

  CURRENT_ERROR_RATE=$(curl -s "${PROM_URL}/api/v1/query" \
    --data-urlencode 'query=sum(rate(sli_requests_error_total{service="'${SERVICE}'"}[2m])) / sum(rate(sli_requests_total_total{service="'${SERVICE}'"}[2m]))' \
    | jq -r '.data.result[0].value[1]')

  echo "  [t+${i}s] 错误率: ${CURRENT_ERROR_RATE}"

  # 安全检查：错误率飙升 → 自动终止
  if (( $(echo "${CURRENT_ERROR_RATE} > 0.05" | bc -l) )); then
    echo "  ⚠️ 错误率超过 5%，自动终止实验！"
    blade destroy ${BLADE_UID}
    exit 1
  fi
done

# ===== 阶段 4：销毁实验 =====
echo "[Phase 4] 销毁实验..."
blade destroy ${BLADE_UID}
echo "  实验已终止"

# ===== 阶段 5：评估结论 =====
echo "[Phase 5] 评估结论..."

FINAL_ERROR_RATE=$(curl -s "${PROM_URL}/api/v1/query" \
  --data-urlencode 'query=sum(rate(sli_requests_error_total{service="'${SERVICE}'"}[30m])) / sum(rate(sli_requests_total_total{service="'${SERVICE}'"}[30m]))' \
  | jq -r '.data.result[0].value[1]')

SLO_THRESHOLD=$(echo "1 - ${SLO_TARGET}/100" | bc -l)

if (( $(echo "${FINAL_ERROR_RATE} < ${SLO_THRESHOLD}" | bc -l) )); then
  echo "  ✅ 稳态假说成立：系统在故障下仍满足 SLO"
else
  echo "  ❌ 稳态假说不成立：需优化系统韧性"
fi

echo "=== 实验完成 ==="
```

### 7.3 Grafana SLO Dashboard JSON 配置

```json
{
  "dashboard": {
    "title": "Payment Service SLO Dashboard",
    "uid": "payment-slo",
    "time": { "from": "now-30d", "to": "now" },
    "templating": {
      "list": [
        {
          "name": "service",
          "type": "query",
          "datasource": { "type": "prometheus", "uid": "prometheus" },
          "query": "label_values(sli_requests_total_total, service)",
          "current": { "value": "payment-service" }
        }
      ]
    },
    "panels": [
      {
        "id": 1,
        "title": "SLI 达标率（30 天滚动）",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(rate(sli_request_latency_seconds_bucket{service=\"$service\",le=\"0.3\"}[30d])) / sum(rate(sli_request_latency_seconds_count{service=\"$service\"}[30d])) * 100",
            "legendFormat": "SLI 达标率"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "color": "red", "value": 0 },
                { "color": "yellow", "value": 99.9 },
                { "color": "green", "value": 99.95 }
              ]
            },
            "unit": "percent"
          }
        }
      },
      {
        "id": 2,
        "title": "错误预算剩余",
        "type": "gauge",
        "targets": [
          {
            "expr": "(1 - (\n  (1 - sum(rate(sli_request_latency_seconds_bucket{service=\"$service\",le=\"0.3\"}[30d])) / sum(rate(sli_request_latency_seconds_count{service=\"$service\"}[30d])))\n  /\n  (1 - 0.999)\n)) * 100",
            "legendFormat": "预算剩余 %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "color": "red", "value": 0 },
                { "color": "orange", "value": 30 },
                { "color": "yellow", "value": 70 },
                { "color": "green", "value": 100 }
              ]
            },
            "unit": "percent",
            "min": 0,
            "max": 100
          }
        }
      },
      {
        "id": 3,
        "title": "燃尽率（1h 窗口）",
        "type": "timeseries",
        "targets": [
          {
            "expr": "(\n  sum(rate(sli_requests_error_total{service=\"$service\"}[1h]))\n  /\n  sum(rate(sli_requests_total_total{service=\"$service\"}[1h]))\n)\n/\n(1 - 0.999)",
            "legendFormat": "1h 燃尽率"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "color": "green", "value": 0 },
                { "color": "yellow", "value": 6 },
                { "color": "red", "value": 14.4 }
              ]
            }
          }
        }
      },
      {
        "id": 4,
        "title": "P99 延迟趋势（按接口）",
        "type": "timeseries",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, sum(rate(sli_request_latency_seconds_bucket{service=\"$service\"}[5m])) by (le, endpoint))",
            "legendFormat": "{{ endpoint }}"
          }
        ]
      }
    ]
  }
}
```

---

## 常见问题

**Q1: SLO 如何从 0 到 1 建立？**

A: 分四步走。
1. **选 SLI**（第 1 周）：选 3-5 个最影响用户体验的指标（可用性、延迟、错误率），从已有的监控数据中提取。
2. **看历史**（第 2 周）：拉取过去 30-90 天 SLI 数据，观察自然波动范围，初步设定 SLO（建议比当前实际值略高一点）。
3. **跑一个周期**（第 3-6 周）：以 draft SLO 运行一个完整窗口期，不做惩罚性约束，仅观察和讨论。
4. **正式上线**（第 7 周起）：基于实际数据调整 SLO 数值，引入错误预算策略，从此 SLO 成为团队决策依据。

关键原则：第一个 SLO 不需要完美，重要的是建立"度量 - 决策 - 改进"的闭环文化。

**Q2: 错误预算耗尽后的处理流程是什么？**

A:
1. **立即冻结发布**（除安全 hotfix 外），确保不再引入新风险。
2. **全团队 war room**：评估当前影响，确定是否已触发用户投诉或 SLA 违约风险。
3. **根因分析**：排查是单次事件（如部署故障）还是系统性问题（如架构缺陷）。
4. **制定改进计划**：系统性改进（增加自动化测试、修复监控盲区、重构脆弱组件）优先于功能开发。
5. **错误预算恢复**：新窗口开始时预算自动重置，但应确保改进措施已到位后再逐步恢复正常发布节奏。

**Q3: 混沌实验的安全保障机制有哪些？**

A:
- **爆炸半径最小化**：从单个 Pod 开始，逐步扩大范围；使用测试用户或灰度用户隔离影响。
- **自动终止条件**：错误预算燃尽率超过阈值、P1 告警触发、超过 maxDuration 时自动销毁实验。
- **实验审批流程**：生产环境实验需至少两人审批；重大实验需团队评审实验方案。
- **可观测性覆盖**：实验前后必须有完整的 SLI 数据采集，确保可第一时间发现异常。
- **随时可手动终止**：提供一键终止按钮，任何团队成员可在任何时刻终止实验。

**Q4: 如何说服业务方接受 SLO（如 99.9%）而非 100% 可用？**

A:
- **成本曲线教育**：展示可靠性成本曲线——从 99.9% 到 99.99% 的成本可能增加 5-10 倍（多活架构、冗余资源、更严格的发布流程），但从 99.99% 到 99.999% 的成本可能再翻倍。
- **速度 vs 稳定性权衡**：解释错误预算的哲学——追求 100% 可靠性意味着几乎无法发布新功能，业务竞争力反而下降。
- **竞品对标**：行业内同类服务的 SLO 通常也在 99.9%-99.95% 区间，100% 是不切实际的承诺。
- **算一笔账**：99.9% 可靠性意味着每月约 43 分钟不可用时间；如果业务能承受这个级别（如通过体验优化让用户感知不到），那么把额外投入用于功能迭代更有价值。

**Q5: 容量规划的常见误区有哪些？**

A:
- **只看均值不看峰值**：日均 QPS 1000 不代表系统能承受峰值 5000。容量规划必须以峰值（通常是 95%-99% 分位值）为基准计算。
- **忽略增长因子**：仅按当前流量规划容量，6 个月后系统就达到瓶颈。至少考虑 3-6 个月的增长预期。
- **安全系数过小**：1.2x 安全系数不足以应对突发流量和部分节点故障。建议 1.5x-2x，并在多 AZ 分布的假设下验证 N-1 容灾。
- **缩容配置不当**：HPA 缩容过快可能导致频繁的 Pod 创建/销毁（抖动），应设置合理的 stabilizationWindowSeconds（建议 300s 以上）。
- **仅依赖 CPU/内存**：对于 IO 密集型或连接池敏感的服务，CPU 指标可能无法反映真实瓶颈。应结合业务指标（QPS 阈值、连接池使用率）设置弹性策略。

**Q6: 燃尽率告警和传统阈值告警如何协同工作？**

A: 两者互补，而非替代。传统阈值告警（如 CPU > 80%、磁盘 > 85%）适用于基础设施层面的快速检测，而燃尽率告警关注的是用户体验层面的服务质量。建议分层设计：
- **基础设施层**：传统阈值告警（Node/Network/Disk），触发 P2/P3
- **服务 SLI 层**：燃尽率告警（错误预算消耗），触发 P1/P2
- **业务层**：业务指标异常（下单量骤降、支付成功率下降），触发 P1

这样当基础设施告警触发时，SLI 层可以验证是否真的影响了用户；当 SLI 告警触发时，基础设施层帮助快速定位问题根因。

---

## 相关条目

- [[06-OpenTelemetry可观测性体系]] — SLI 指标采集的底层基础设施
- [[06-Docker与Kubernetes云原生部署]] — K8s 中的 HPA/KEDA 弹性扩缩容与混沌实验的运行环境
- [[06-CICD与基础设施即代码]] — CI/CD 中的金丝雀发布与自动回滚策略
- [[05-熔断限流与弹性设计]] — Resilience4j 限流、熔断、重试的完整实现
