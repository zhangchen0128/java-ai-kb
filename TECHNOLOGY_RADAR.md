# 技术雷达 (Technology Radar)

> 版本：v1.0.0 | 创建：2026-07-17 | 复核周期：每季度
>
> 本文件定义知识库覆盖范围内的技术选型立场。所有知识条目的编写和代码示例应优先使用 Adopt 象限的技术栈。

---

## 一、四象限定义

| 象限 | 含义 | 行动指南 |
|------|------|----------|
| **🟢 Adopt（采用）** | 成熟可靠，作为主栈使用 | 知识库重点覆盖，代码示例默认技术栈 |
| **🔵 Trial（实验）** | 有潜力，在非核心场景试用 | 编写评估笔记，记录适用场景和限制 |
| **🟡 Assess（观察）** | 值得关注，但尚未成熟 | 简要条目，标注为"观察中"，定期复审 |
| **🔴 Hold（暂缓）** | 当前不推荐作为主栈 | 记录不推荐原因和可能的替代方案 |

---

## 二、技术雷达矩阵

### Java 基础设施

| 技术 | 象限 | 说明 |
|------|------|------|
| JDK 25 LTS | 🟢 Adopt | 主栈版本，Virtual Threads + Scoped Values + Pattern Matching 已成熟 |
| JDK 21 LTS | 🟢 Adopt | 保留兼容知识，为尚未升级的项目提供参考 |
| Maven 4.x | 🟢 Adopt | 主构建工具，多模块、wrapper、enforcer |
| Gradle 8.x | 🔵 Trial | 作为对比了解，不深入维护 |
| GraalVM (AOT) | 🔵 Trial | Spring Boot AOT 编译场景，评估启动时间和内存优势 |
| Java Module System (JPMS) | 🟡 Assess | 持续观察生态支持度，不强求模块化 |

### Java 并发与IO

| 技术 | 象限 | 说明 |
|------|------|------|
| Virtual Threads (JEP 444) | 🟢 Adopt | 替代大部分 Reactor/协程场景 |
| CompletableFuture | 🟢 Adopt | 异步编排主力 |
| Structured Concurrency (JEP 480) | 🟢 Adopt | 结构化并发，与 Virtual Threads 配合 |
| Scoped Values (JEP 481) | 🟢 Adopt | 替代 ThreadLocal 的现代方案 |
| Reactor / WebFlux | 🔵 Trial | 保留知识但在 Virtual Threads 时代降级为特定场景 |
| Kotlin Coroutines | 🟡 Assess | 持续观察，不作为主栈 |

### Java 诊断与质量

| 技术 | 象限 | 说明 |
|------|------|------|
| JFR + JMC | 🟢 Adopt | JVM 性能诊断首选 |
| async-profiler | 🟢 Adopt | CPU/Allocation/Wall-clock profiling |
| JMH | 🟢 Adopt | 微基准测试标准工具 |
| JUnit 5 | 🟢 Adopt | 测试框架主栈 |
| Mockito | 🟢 Adopt | Mock 框架主栈 |
| Testcontainers | 🟢 Adopt | 集成测试容器化 |
| WireMock | 🔵 Trial | HTTP服务模拟 |
| REST Assured | 🔵 Trial | REST API 测试 |
| ArchUnit | 🔵 Trial | 架构测试 |
| PIT (Mutation Testing) | 🔵 Trial | 变异测试，评估测试质量 |
| SpotBugs + Checkstyle + PMD | 🟢 Adopt | 静态分析与代码风格 |
| SonarQube | 🟢 Adopt | 代码质量平台 |
| Error Prone | 🟡 Assess | Google 的编译时检查，观察社区采纳 |
| Arthas | 🔵 Trial | 在线诊断（非生产环境首选） |

### Spring 生态

| 技术 | 象限 | 说明 |
|------|------|------|
| Spring Framework (IoC/AOP/Tx) | 🟢 Adopt | Java 企业开发基础 |
| Spring Boot 4.x | 🟢 Adopt | 应用框架主栈 |
| Spring MVC + SSE | 🟢 Adopt | Web API 和流式输出主栈 |
| Spring WebFlux | 🔵 Trial | 响应式场景，非默认选择 |
| Spring Security (OAuth2/OIDC/JWT) | 🟢 Adopt | 安全框架主栈 |
| Spring Data JPA | 🟢 Adopt | ORM 主栈（简单CRUD） |
| MyBatis / MyBatis-Plus | 🟢 Adopt | SQL 主栈（复杂查询和动态SQL） |
| Spring Cloud Gateway | 🟢 Adopt | API 网关 |
| Spring Cloud Circuit Breaker | 🟢 Adopt | 熔断抽象层 |
| Resilience4j | 🟢 Adopt | 弹性设计（超时/重试/限流/熔断/隔离） |
| Spring Batch | 🟢 Adopt | 批处理主栈 |
| Quartz / XXL-JOB | 🟢 Adopt | 定时任务调度 |
| Spring AI 2.x | 🟢 Adopt | AI 框架主栈 |
| MapStruct | 🟢 Adopt | Bean 映射 |
| Jackson | 🟢 Adopt | JSON 处理 |
| Hibernate Validator | 🟢 Adopt | Bean Validation |

### 数据与中间件

| 技术 | 象限 | 说明 |
|------|------|------|
| PostgreSQL + pgvector | 🟢 Adopt | 默认数据库 + 向量检索首选 |
| MySQL | 🟢 Adopt | 传统项目兼容，知识保留 |
| Redis (Redisson) | 🟢 Adopt | 缓存、分布式锁 |
| Redis Vector Search | 🔵 Trial | 实时上下文/语义缓存/低延迟向量检索 |
| Kafka | 🟢 Adopt | 消息队列主栈 |
| RabbitMQ | 🟢 Adopt | 轻量消息场景 |
| Elasticsearch / OpenSearch | 🟢 Adopt | 全文检索 + 语义重排 |
| MinIO / S3 | 🟢 Adopt | 对象存储 |
| Qdrant | 🔵 Trial | 大规模独立向量平台 |
| Milvus | 🔵 Trial | 大规模独立向量平台 |
| Neo4j | 🔵 Trial | 知识图谱 / GraphRAG |
| HikariCP | 🟢 Adopt | 默认连接池 |

### 分布式架构

| 技术 | 象限 | 说明 |
|------|------|------|
| Saga Pattern | 🟢 Adopt | 分布式事务首选 |
| Outbox Pattern | 🟢 Adopt | 可靠消息发送 |
| Resilience4j | 🟢 Adopt | 弹性设计 |
| Sentinel | 🟡 Assess | 阿里限流方案，观察替代Resilience4j的收益 |
| Seata | 🟡 Assess | 分布式事务，评估与Saga的互补性 |

### 云原生与SRE

| 技术 | 象限 | 说明 |
|------|------|------|
| Docker | 🟢 Adopt | 容器化标准 |
| Docker Compose | 🟢 Adopt | 本地开发编排 |
| Kubernetes | 🟢 Adopt | 生产编排标准 |
| Helm | 🟢 Adopt | K8s 包管理 |
| GitHub Actions | 🟢 Adopt | CI/CD 主栈 |
| OpenTelemetry | 🟢 Adopt | 可观测性标准（含GenAI语义约定） |
| Prometheus + Grafana | 🟢 Adopt | 监控与可视化 |
| Tempo / Jaeger | 🟢 Adopt | 分布式追踪 |
| Loki | 🟢 Adopt | 日志聚合 |
| Terraform | 🔵 Trial | IaC，评估团队采纳成本 |
| Ansible | 🟡 Assess | 配置管理，观察 |

### AI 基础

| 技术 | 象限 | 说明 |
|------|------|------|
| Transformer 架构理解 | 🟢 Adopt | 基础必修知识 |
| Embedding 模型（BGE/GTE/E5） | 🟢 Adopt | 中文首选 BGE，英文参考 E5 |
| Matryoshka Embedding | 🔵 Trial | 维度自适应，评估在不同规模知识库的收益 |

### 模型接入与推理

| 技术 | 象限 | 说明 |
|------|------|------|
| OpenAI 兼容协议 | 🟢 Adopt | 模型接入的统一协议标准 |
| OpenAI Java SDK | 🟢 Adopt | 框架不支持时降级使用 |
| Anthropic Java SDK | 🟢 Adopt | 框架不支持时降级使用 |
| AWS Bedrock Converse API | 🟢 Adopt | AWS生态下多模型统一接口 |
| Google GenAI Java SDK | 🔵 Trial | GCP生态时使用 |
| Azure AI SDK | 🔵 Trial | Azure生态时使用 |
| Ollama | 🟢 Adopt | 本地开发和测试首选 |
| Docker Model Runner | 🔵 Trial | Docker生态本地推理替代方案 |
| vLLM | 🟢 Adopt | 生产推理服务首选 |
| TensorRT-LLM | 🔵 Trial | NVIDIA GPU 优化推理 |
| Hugging Face TGI | 🔵 Trial | HuggingFace 模型生产推理 |
| KServe | 🟡 Assess | 云原生模型推理平台 |
| DJL (Deep Java Library) | 🔵 Trial | JVM内嵌推理，小型模型 |
| ONNX Runtime Java | 🔵 Trial | JVM内嵌推理，跨框架模型 |

### Java AI 框架

| 技术 | 象限 | 说明 |
|------|------|------|
| Spring AI 2.x | 🟢 Adopt | Java AI 框架主栈 |
| LangChain4j | 🔵 Trial | 对比框架，评估特定场景优势 |
| 自定义 Port 接口层 | 🟢 Adopt | 架构最佳实践，隔离框架依赖 |

### AI 数据工程

| 技术 | 象限 | 说明 |
|------|------|------|
| Apache Tika | 🟢 Adopt | 通用文档解析 |
| PDFBox | 🟢 Adopt | PDF 解析主栈 |
| Apache POI | 🟢 Adopt | Office 文件解析 |
| Jsoup | 🟢 Adopt | HTML 解析 |
| Jackson | 🟢 Adopt | JSON/XML 处理 |
| Tesseract / PaddleOCR | 🔵 Trial | OCR，中文场景 PaddleOCR 优先 |
| FFmpeg | 🔵 Trial | 音视频预处理 |
| Spring Batch | 🟢 Adopt | 批处理管道 |
| Debezium + Kafka Connect | 🔵 Trial | CDC 增量同步 |

### RAG 技术

| 技术 | 象限 | 说明 |
|------|------|------|
| pgvector (HNSW + IVFFlat) | 🟢 Adopt | 默认向量存储 |
| Elasticsearch BM25 + 向量 | 🟢 Adopt | 混合检索主栈 |
| Cross-Encoder Reranker | 🟢 Adopt | 重排主栈 |
| Redis Vector Search | 🔵 Trial | 低延迟检索和语义缓存 |
| Qdrant / Milvus | 🔵 Trial | 大规模独立向量平台 |
| Neo4j (GraphRAG) | 🔵 Trial | 知识图谱增强检索 |
| Contextual Retrieval | 🔵 Trial | 上下文感知切片，评估效果 |
| Late Chunking / ColBERT | 🔵 Trial | 晚切片策略 |
| HyDE | 🟢 Adopt | Query 改写有效技术 |
| Multi-Query Retrieval | 🟢 Adopt | 多角度检索融合 |
| Corrective RAG (CRAG) | 🔵 Trial | 检索质量自校正 |
| Adaptive RAG | 🔵 Trial | 自适应检索策略 |
| Agentic RAG | 🔵 Trial | Agent驱动的检索 |
| Multimodal RAG | 🟡 Assess | 多模态检索，观察成熟度 |

### Agent 工程

| 技术 | 象限 | 说明 |
|------|------|------|
| ReAct Pattern | 🟢 Adopt | Agent 推理标准范式 |
| Tool Calling (JSON Schema) | 🟢 Adopt | 工具调用标准方式 |
| MCP Java SDK | 🟢 Adopt | 工具集成标准协议 |
| A2A Java SDK | 🔵 Trial | Agent间协作协议 |
| Temporal | 🔵 Trial | 持久化Agent工作流 |
| Camunda | 🔵 Trial | Java原生工作流引擎 |
| Spring Batch (Agent持久化) | 🔵 Trial | 利用Spring生态实现Agent状态机 |
| Kafka + Outbox (Agent持久化) | 🔵 Trial | 事件驱动的Agent持久化 |

### AI 平台

| 技术 | 象限 | 说明 |
|------|------|------|
| Micrometer + OpenTelemetry | 🟢 Adopt | AI 可观测性基础 |
| Langfuse | 🔵 Trial | AI专用追踪平台 |
| Arize Phoenix | 🔵 Trial | AI可观测性 |
| OpenLLMetry | 🟡 Assess | OpenTelemetry AI 扩展 |
| LLM-as-a-Judge | 🟢 Adopt | AI 评估基础方法 |
| Golden Dataset 回归测试 | 🟢 Adopt | 评估集管理 |
| Semantic Cache | 🔵 Trial | 语义缓存，评估收益与成本 |

### AI 安全

| 技术 | 象限 | 说明 |
|------|------|------|
| Spring Security | 🟢 Adopt | 传统安全基座 |
| Keycloak | 🟢 Adopt | 认证授权服务 |
| Vault / KMS | 🟢 Adopt | 密钥管理 |
| OPA / Rego | 🔵 Trial | 策略即代码 |
| OWASP LLM Top 10 | 🟢 Adopt | AI 安全风险框架 |
| Input/Output Guardrails | 🟢 Adopt | 输入输出安全护栏 |
| JSON Schema 校验 | 🟢 Adopt | Tool 参数和输出校验 |
| 沙箱执行 | 🔵 Trial | 不可信代码/工具执行 |

### AI 原生研发

| 技术 | 象限 | 说明 |
|------|------|------|
| Claude Code | 🟢 Adopt | AI 研发工具主栈 |
| CLAUDE.md 规范 | 🟢 Adopt | 上下文工程基础 |
| Specification-Driven Development | 🟢 Adopt | AI 时代的开发方法 |
| AI 代码审查 | 🟢 Adopt | 辅助代码审查流程 |
| AI 测试生成 | 🟢 Adopt | 辅助测试编写 |

### 行业领域

| 技术 | 象限 | 说明 |
|------|------|------|
| 保险业务模型 | 🟢 Adopt | 行业基础必修 |
| 监管合规知识 | 🟢 Adopt | 保险合规必修 |
| AI 核保/理赔场景 | 🔵 Trial | 持续探索和验证 |

---

## 三、明确 Hold 的实践

| 实践 | 原因 | 替代方案 |
|------|------|----------|
| 同时深度维护 Spring AI + LangChain4j | 精力分散，选一个为主 | Spring AI 2.x 为主，LangChain4j 作为对比参考 |
| 无评估体系的全自动Agent | 无法衡量质量和迭代 | 建立 Golden Dataset 和 LLM-as-a-Judge |
| 直接让模型执行数据库写操作 | 安全隐患，无法审计 | Human-in-the-loop + 持久化工作流 |
| 为了向量检索立即引入 Qdrant/Milvus 独立集群 | 过早优化 | 从 pgvector 起步，按需迁移 |
| 把所有业务都改造成多Agent | 过度设计，增加复杂性 | 确定性工作流优先，Agent 只在不确定场景使用 |
| 未经验证批量生成知识文章 | 质量无法保证 | 逐篇验证 + 人工审核 |
| JVM 本地运行大模型 (7B+) | 资源/性能不合理 | 使用推理服务(Ollama/vLLM)，JVM仅运行小型模型 |
| 生产环境直接使用 Ollama | 不适合生产负载 | 开发用Ollama，生产用 vLLM/TensorRT-LLM |
| 多Agent自治系统（无监督） | 不可控风险高 | Human-in-the-loop + 审批节点 |
| AI生成式UI（动态生成前端） | 一致性和可测试性差 | 传统UI + AI增强（推荐/智能填充） |

---

## 四、技术生命周期管理

### 升级路径

```
JDK 21 ──────────► JDK 25 LTS (当前主栈)
Spring Boot 3.x ─► Spring Boot 4.x (当前主栈)
Spring AI 1.x ───► Spring AI 2.x (当前主栈)
```

### 关注列表（未来6-12个月可能升入 Trial 或 Adopt）

| 技术 | 当前象限 | 升级条件 |
|------|----------|----------|
| A2A | Trial → Adopt | 协议稳定，生态成熟，多Agent协作成为刚需 |
| Temporal | Trial → Adopt | Agent持久化需求增长，团队接受度提高 |
| GraphRAG | Trial → Adopt | 知识图谱构建成本降低，效果验证充分 |
| Semantic Cache | Trial → Adopt | 成本节约 > 缓存基础设施成本 |
| Structured Concurrency | Adopt | 正式GA，生态工具完善 |
| LangChain4j | Trial → Assess | 如Spring AI持续领先，降级观察 |

### 降级风险（可能从 Adopt 降为 Trial 或 Assess）

| 技术 | 风险 |
|------|------|
| WebFlux/Reactor | Virtual Threads 可能使其降为特殊场景工具 |
| XXL-JOB | 如社区活跃度下降，可能转向更活跃的替代品 |
| Sentinel | 如Resilience4j生态增长，评估区分度不足 |

---

## 五、决策树

### 向量存储选择

```
是否需要全文检索？
├── 是 → PostgreSQL + pgvector + Elasticsearch
└── 否 → 数据量 < 1000万向量？
         ├── 是 → PostgreSQL + pgvector
         └── 否 → 延迟 < 10ms 要求？
                  ├── 是 → Qdrant / Milvus
                  └── 否 → PostgreSQL + pgvector + 分区
```

### AI 框架选择

```
团队是否已有 Spring 生态？
├── 是 → Spring AI 2.x
└── 否 → 是否强依赖 LangChain 生态（Python协同）？
         ├── 是 → LangChain4j
         └── 否 → Spring AI 2.x（默认推荐）
```

### Agent 持久化方案

```
Agent 流程复杂度？
├── 简单（< 5步骤，无分支）→ Spring @Service + 数据库状态字段
├── 中等（分支/重试/人工审批）→ Spring Batch + Outbox
└── 复杂（Saga/补偿/超长执行）→ Temporal / Camunda
```

---

## 六、维护日志

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-07-17 | v1.0.0 | 初始版本，覆盖Java到AI全栈技术雷达 |
