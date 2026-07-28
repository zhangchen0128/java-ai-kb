# Java AI Knowledge 质量报告

生成日期：2026-07-28

## 发布结论

仓库已建立可执行质量基线。`verified` 条目全部通过当前自动门禁，19 个
领域均有 verified 锚点；A2A 等仍包含大量架构伪代码的文章保留为 draft，
不以批量元数据冒充完成代码验证。

| 指标 | 结果 |
|---|---:|
| 知识条目 | 86 |
| 领域 | 19 |
| verified / draft | 35 / 51 |
| verified 深审通过率 | 100% |
| 来源引用 / 唯一 URL | 373 / 324 |
| 确认失效链接 | 0 |
| 受限或超时链接 | 54 |
| Java 代码块 | 956 |
| 关联 Lab 的 verified | 29 |
| 有文章核心源码/测试证据的 verified | 29 |
| 精确到代码块、源码符号和测试方法的映射 | 3 |
| verified Java 显式占位符 | 0 |
| 关系错误 / 重复关系 / 孤立 verified | 0 / 0 / 0 |
| stale verified | 0 |
| Node 质量与构建器回归测试 | 66 |

外链全量审核耗时 151 秒，低于五分钟目标。本次警告包括 18 个 403 和
36 个超时/连接重置；401、403、429、5xx 和网络瞬态失败单独保留为警告，
不会被误报为确认失效。

## 领域覆盖

| 领域 | 条目 | verified | 已覆盖内容类型 |
|---|---:|---:|---|
| 00-知识工程 | 2 | 2 | concept, reference |
| 01-计算机基础 | 6 | 5 | concept, practice |
| 02-Java平台 | 7 | 3 | concept, overview, practice, production |
| 03-Java应用平台 | 11 | 1 | concept, overview, practice, production |
| 04-数据与中间件 | 6 | 5 | concept, practice, production |
| 05-分布式架构 | 6 | 4 | concept, overview, practice, production |
| 06-云原生与SRE | 5 | 3 | concept, overview, practice, production |
| 07-AI基础 | 5 | 1 | concept, overview, practice |
| 08-模型接入与推理 | 6 | 1 | concept, overview, practice, production |
| 09-Java AI框架 | 3 | 1 | concept, practice, production |
| 10-AI数据工程 | 4 | 1 | concept, overview, practice, production |
| 11-检索与RAG | 4 | 1 | concept, practice, production |
| 12-Agent工程 | 5 | 1 | concept, overview, practice, production |
| 13-AI协议 | 3 | 1 | overview, practice, production |
| 14-AI平台与LLMOps | 3 | 1 | overview, practice, production |
| 15-AI安全与治理 | 3 | 1 | overview, practice, production |
| 16-AI原生研发 | 2 | 1 | overview, production |
| 17-系统设计 | 2 | 1 | concept, production |
| 18-保险行业 | 3 | 1 | overview, case-study |

## 实验覆盖

普通 CI 不需要 API Key、外部数据库或公网。JDK 25.0.4 冷启动构建已执行
46 个测试，其中包含 Scoped Values 与 Structured Concurrency 的 2 个
preview 测试；JDK 21 兼容回退执行其余 44 个测试。

| Lab | 默认测试覆盖 |
|---|---|
| `lab-java25-concurrency` | Virtual Threads；滑动窗口限流；热点 Key 窗口与并发提升；JDK 25 profile 覆盖 Scoped Values、Structured Concurrency、异常与取消 |
| `lab-spring-ai-chat` | 真实 ChatClient + 确定性 ChatModel、system/user Prompt、结构化返回，以及 provider-neutral 端口的同步/流式适配 |
| `lab-spring-ai-tools` | 真实两轮 Tool Calling、参数校验、权限拒绝与异常 |
| `lab-mcp-server` | 官方 SDK + STDIO 子进程，2025-11-25 初始化、发现与调用 |
| `lab-a2a-agent` | 官方 Java SDK TaskStore、Agent Card、SendMessage、GetTask、版本头 |
| `lab-rag-pipeline` | 切分、确定性 Embedding、租户过滤、RRF、排序与引用 |
| `lab-ai-security` | OWASP 2025 风险、注入、结构化输出校验、权限与脱敏审计 |
| `lab-ai-observability` | Micrometer + OpenTelemetry Span，模型、Token、耗时和错误且不记录 Prompt |

`code_status: tested` 当前采用 `scope: article-core`：每篇文章明确列出承载核心
示例的生产源码和测试文件，网站可直接展开查看。这证明的是文章核心路径已经
进入 Lab，不把 956 个 Java 代码块都误报为逐块测试覆盖。在此基础上，限流、
热点 Key 和 Spring AI 模型端口的 3 个核心代码块已增加稳定 `code-id`，并
精确映射到源码符号和测试方法；ID 重复、正文缺块、文件越界或符号不存在都会
使 verified 审核失败。其余代码块仍不计入精确测试覆盖率。

全库 358 个 verified Java 代码块另行执行静态占位扫描，TODO、FIXME、孤立
省略号、`UnsupportedOperationException` 待实现分支和明确声明未实现的代码
当前均为 0；该扫描用于阻止伪完整示例，但不等同于逐代码块编译测试。

## 事实与版本回归

- JDK 25：JEP 508 为 Tenth Incubator；JEP 513 已正式交付；String
  Templates 只保留为已移除特性的历史说明。
- Spring AI：冻结 2.0.0 BOM，Starter 使用 2.x 正式坐标。
- MCP：规范锚定 2025-11-25。
- MCP Java SDK：使用 2.0 Builder API，STDIO Server 由真实子进程客户端测试，
  Maven 编译开启 deprecation 并设置 `failOnWarning`，废弃 API 回归会直接失败。
- A2A：规范锚定 1.0，HTTP+JSON `/message:send` 与 JSON-RPC
  `SendMessage` 分开验证，Java 来源为 `a2aproject/a2a-java`。
- OWASP：正文使用 GenAI Top 10 2025 正式名称与编号。
- 精确性能数字缺少完整测试环境时，verified 文章必须显示“示意值，不代表
  基准结果”声明。

## 可复现命令

```bash
cd kb-web
npm ci
npm run check
npm run audit:links
npm run smoke

cd ..
mvn -B -f labs/pom.xml test
```

CI 还会从空 `public/` 重建网站、执行 Chromium 冒烟测试、在 PR 审核变更
URL，并在每周一执行一次 324 个唯一 URL 的全量审核。

移动端抽屉使用独立覆盖层，不再改变正文横向位置；390×844 回归会检查抽屉
边界、19 个领域导航、遮罩和关闭状态。Service Worker 使用 `kb-v5`
network-first 策略，并禁用脚本更新缓存，避免旧 HTML、CSS、JavaScript 与
导航索引混用。
