# Java AI 工程师知识库

> 一个覆盖 Java 企业开发到 AI 应用工程的完整知识体系。

## 快速导航

| 文件 | 用途 |
|------|------|
| [`KNOWLEDGE_TAXONOMY.md`](./KNOWLEDGE_TAXONOMY.md) | 知识分类体系 — 18个知识域的定义和元数据规范 |
| [`TECHNOLOGY_RADAR.md`](./TECHNOLOGY_RADAR.md) | 技术雷达 — Adopt/Trial/Assess/Hold 四象限选型 |
| [`CLAUDE.md`](./CLAUDE.md) | 操作规则 — Claude 和用户的操作指南 |

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

### 维护
所有操作通过 Claude 进行，Claude 自动遵守三份总控文件的约束。

## 许可

个人知识库，保留所有权利。
