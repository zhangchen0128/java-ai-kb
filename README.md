# Java AI 工程师知识库

> 面向 Java/AI 工程师的公开知识库：来源可追溯、版本可复核、核心代码可运行。

当前质量快照：86 篇知识条目、19 个领域、35 篇 `verified`，8 个
Maven Lab 默认不需要 API Key。详细结果见
[`QUALITY_REPORT.md`](./QUALITY_REPORT.md)。

## 快速导航

| 文件 | 用途 |
|------|------|
| [`KNOWLEDGE_TAXONOMY.md`](./KNOWLEDGE_TAXONOMY.md) | 知识分类体系 — 19 个领域的定义和元数据规范 |
| [`TECHNOLOGY_RADAR.md`](./TECHNOLOGY_RADAR.md) | 技术雷达 — Adopt/Trial/Assess/Hold 四象限选型 |
| [`versions.lock.yaml`](./versions.lock.yaml) | 六周冻结版本基线 |
| [`labs/`](./labs/) | 8 个无密钥确定性实验 |

## 知识域

| 编号 | 知识域 | 定位 |
|------|--------|------|
| 00 | 知识工程 | 知识库自身的分类、模板和元数据 |
| 01 | 计算机基础 | 数据结构、算法、OS、网络、数据库、密码学、分布式理论 |
| 02 | Java 平台 | 现代Java、JVM、JMM、并发、IO、性能诊断 |
| 03 | Java 应用平台 | Spring、Web、ORM、Security、任务调度、测试、工程规范 |
| 04 | 数据与中间件 | PostgreSQL、Redis、Kafka、Elasticsearch、对象存储 |
| 05 | 分布式架构 | 一致性、幂等、锁、事务、缓存、限流、高可用、微服务 |
| 06 | 云原生与SRE | Docker、K8s、CI/CD、IaC、可观测性、容量治理 |
| 07 | AI基础 | 机器学习、Transformer、Token、Embedding、推理与评估 |
| 08 | 模型接入与推理 | 云API、本地模型、OpenAI兼容协议、推理服务、JVM推理 |
| 09 | Java AI框架 | Spring AI、LangChain4j、厂商SDK、架构抽象层 |
| 10 | AI数据工程 | 文档解析、OCR、切片、元数据、权限、血缘、增量更新 |
| 11 | 检索与RAG | 向量检索、混合检索、重排、高级RAG、GraphRAG |
| 12 | Agent工程 | Tool Calling、Memory、Planning、Workflow、多Agent |
| 13 | AI协议 | MCP、A2A、JSON Schema、OpenAPI、OAuth |
| 14 | AI平台与LLMOps | 模型网关、Prompt管理、评估、灰度、成本、多租户 |
| 15 | AI安全与治理 | Prompt注入、工具安全、数据安全、OWASP LLM Top 10 |
| 16 | AI原生研发 | Claude Code、上下文工程、规格驱动、代码审查 |
| 17 | 系统设计 | 企业RAG、模型网关、Agent平台、多租户AI SaaS |
| 18 | 行业领域 | 保险业务模型、核保、理赔、行业AI场景 |

## 技术栈快照 (2026-07)

```
Java 25 LTS + Spring Boot 4.x + Spring AI 2.x
PostgreSQL + pgvector | Redis | Kafka | Elasticsearch
Docker + Kubernetes | OpenTelemetry | MCP + A2A
JUnit 5 + Testcontainers | Claude Code
```

## 使用方式

### 学习
按学习路径循序渐进：01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17（18 可并行）

### 查阅
- 技术选型？→ `TECHNOLOGY_RADAR.md`
- 某个主题放哪？→ `KNOWLEDGE_TAXONOMY.md`
- 怎么写笔记？→ `CLAUDE.md`

### 验证

```bash
cd kb-web
npm ci
npm run check
npm run audit:links

cd ..
mvn -B -f labs/pom.xml test
```

`npm run check` 固定执行结构验证、Node 测试、深度内容审核和从零网站构建。
网站支持“只看已验证”筛选；草稿和待复核条目会显示醒目标识。
`tested` 文章会展示 `article-core` 粒度的源码与测试文件；这不等同于把每个
Markdown 代码块都声明为已执行。通过 `<!-- code-id: ... -->` 与
`verification.evidence.blocks` 声明的核心代码块会进一步校验源码符号和测试
方法，并在网站显示“已映射”标识。
维护者可运行 `npm run audit:content:fix` 将未通过深审的 verified 条目安全
降为 draft；CI 只报告并失败，不在检出目录中静默改写内容。

## 许可

公开浏览。内容与代码的再分发权利以仓库后续明确的许可证文件为准。
