# 知识分类体系 (Knowledge Taxonomy)

> 版本：v1.0.0 | 创建：2026-07-17 | 维护：按需更新
>
> 本文件是知识库的总控分类体系。所有知识条目（笔记、代码、图表）必须归属于某个知识域，并遵循本文定义的元数据规范。

---

## 一、知识域总览

| 编号 | 知识域 | 英文名 | 定位 |
|------|--------|--------|------|
| 00 | 知识工程 | Knowledge Engineering | 知识库自身的分类、模板、元数据和维护规则 |
| 01 | 计算机基础 | Computer Science | 数据结构、算法、操作系统、网络、数据库原理、密码学、分布式理论 |
| 02 | Java 平台 | Java Platform | 现代Java、集合、泛型、反射、模块化、JVM、JMM、并发、IO、性能诊断 |
| 03 | Java 应用平台 | Java Application Platform | Spring、Web、ORM、Security、任务调度、测试、工程规范 |
| 04 | 数据与中间件 | Data & Middleware | MySQL、PostgreSQL、Redis、Kafka、RabbitMQ、Elasticsearch、对象存储 |
| 05 | 分布式架构 | Distributed Architecture | 一致性、幂等、锁、事务、缓存、限流、熔断、降级、高可用、微服务 |
| 06 | 云原生与SRE | Cloud Native & SRE | Linux、Docker、Kubernetes、CI/CD、IaC、可观测性、容量与故障治理 |
| 07 | AI基础 | AI Foundations | 机器学习、神经网络、Transformer、Token、Embedding、推理与评估 |
| 08 | 模型接入与推理 | Model Integration & Inference | 云模型API、本地模型、模型能力、流式响应、模型路由、推理服务 |
| 09 | Java AI框架 | Java AI Frameworks | Spring AI、LangChain4j、官方Java SDK、框架抽象与适配层 |
| 10 | AI数据工程 | AI Data Engineering | 文档解析、OCR、清洗、切片、元数据、权限、血缘、增量更新 |
| 11 | 检索与RAG | Retrieval & RAG | 向量检索、关键词检索、混合检索、重排、引用、高级RAG、GraphRAG |
| 12 | Agent工程 | Agent Engineering | Tool Calling、Memory、Planning、Workflow、Human-in-the-loop、多Agent |
| 13 | AI协议 | AI Protocols | MCP、A2A、JSON Schema、OpenAPI、OAuth、Agent Card、长任务协议 |
| 14 | AI平台与LLMOps | AI Platform & LLMOps | 模型网关、Prompt管理、评估集、灰度、成本、追踪、配额、多租户 |
| 15 | AI安全与治理 | AI Security & Governance | Prompt注入、越权工具调用、数据泄露、供应链、审计、内容安全 |
| 16 | AI原生研发 | AI-Native SE | Claude Code、上下文工程、规格驱动、代码审查、测试、调试和自动化 |
| 17 | 系统设计 | System Design | 企业RAG、模型网关、Agent平台、AI知识库、多租户AI SaaS |
| 18 | 行业领域 | Insurance Domain | 保险业务模型、保单/批单/报价/核保、行业术语、规则与AI场景 |

---

## 二、知识域详细定义

### 00 — 知识工程 (Knowledge Engineering)

**核心内容：** 分类体系设计、知识条目模板、元数据规范、知识关系类型（前置/相关/派生）、来源等级标准（官方文档 > 源码 > 书籍 > 博客 > AI生成）、版本矩阵维护、技术雷达更新流程。

**关键文件：**
- `KNOWLEDGE_TAXONOMY.md` — 本文件
- `TECHNOLOGY_RADAR.md` — 技术选型雷达
- `CLAUDE.md` — 知识库操作规则

**与其他域的关系：** 00 是所有其他域的"元域"，定义了知识如何被组织、评估和维护。

---

### 01 — 计算机基础 (Computer Science)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 数据结构 | 数组、链表、树、图、哈希表、堆、跳表、布隆过滤器、时间/空间复杂度 |
| 算法 | 排序、搜索、递归、动态规划、贪心、回溯、分治、字符串匹配 |
| 操作系统 | 进程/线程、虚拟内存、文件系统、IO模型、调度、同步、死锁 |
| 网络 | TCP/IP、HTTP/2/3、DNS、TLS、负载均衡、CDN、Socket |
| 数据库原理 | 关系模型、索引(B+Tree/LSM)、事务(ACID)、MVCC、查询优化、范式 |
| 密码学 | 对称/非对称加密、哈希、数字签名、PKI、TLS握手 |
| 分布式理论 | CAP、PACELC、BASE、一致性模型、共识算法(Raft/Paxos)、时钟与顺序 |

**前置依赖：** 无（基础域）

**学习路径：** 数据结构 → 算法 → 操作系统 → 网络 → 数据库原理 → 密码学 → 分布式理论

---

### 02 — Java 平台 (Java Platform)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 现代Java | JDK 25 LTS 新特性、Record、Sealed Class、Pattern Matching、Virtual Threads、Scoped Values、String Templates |
| 集合与泛型 | List/Map/Set/Queue 实现与选型、类型擦除、通配符、协变/逆变 |
| 反射与模块化 | 反射API、MethodHandle、JPMS模块系统、类加载机制 |
| JVM | 内存模型(G1/ZGC/Shenandoah)、类加载、字节码、JIT(C1/C2/Graal)、AOT |
| JMM | happens-before、volatile、synchronized、final、原子类、VarHandle |
| 并发 | Virtual Threads、Structured Concurrency、CompletableFuture、StampedLock、ForkJoinPool |
| IO | NIO、零拷贝、mmap、DirectByteBuffer、FileChannel、SocketChannel |
| 性能诊断 | JFR、JMC、async-profiler、JMH、Heap Dump 分析、GC 日志解读、Arthas |

**前置依赖：** 01-计算机基础（OS、数据结构）

**版本锚点：**
- JDK 25 LTS（主）| JDK 21 LTS（兼容参考）
- 关键JEP：JEP 444 (Virtual Threads)、JEP 480 (Scoped Values)、JEP 482 (Flexible Constructor Bodies)

---

### 03 — Java 应用平台 (Java Application Platform)

**核心内容：**

| 子域 | 主栈 | 关键知识点 |
|------|------|-----------|
| Spring 核心 | Spring Framework | IoC容器、AOP、事务管理、事件机制、资源抽象、Bean生命周期 |
| Spring Boot | Spring Boot 4.x | 自动配置原理、Starter机制、配置体系、Actuator、AOT编译 |
| Web | Spring MVC、SSE | 控制器、拦截器、异常处理、SSE流式输出、CORS、内容协商 |
| 响应式 | WebFlux（扩展） | Reactor、Mono/Flux、WebSocket、gRPC（扩展） |
| 安全 | Spring Security | OAuth2、OIDC、JWT、方法权限、资源服务器、CSRF/CORS |
| 数据访问 | Spring Data JPA、MyBatis | Repository模式、JPQL、Criteria、MyBatis动态SQL、分页 |
| 任务 | Quartz、XXL-JOB、Spring Batch | Cron调度、分布式任务、批处理模式(Reader/Processor/Writer) |
| 序列化 | Jackson、MapStruct | JSON映射、Bean转换、Validation(Hibernate Validator) |
| 测试 | JUnit 5、Mockito、Testcontainers | 单元测试、集成测试、容器化测试、WireMock、REST Assured、ArchUnit |
| 工程规范 | Maven | 多模块、依赖管理、插件、SpotBugs、Checkstyle、PMD |

**前置依赖：** 02-Java平台

---

### 04 — 数据与中间件 (Data & Middleware)

**核心内容：**

| 子域 | 技术 | 关键知识点 |
|------|------|-----------|
| 关系数据库 | PostgreSQL、MySQL | SQL优化、索引策略、分区、复制、连接池(HikariCP)、pgvector |
| 缓存 | Redis | 数据结构、持久化(RDB/AOF)、哨兵/集群、Pipeline、Lua、Redisson、向量检索 |
| 消息队列 | Kafka、RabbitMQ | 分区/消费者组、事务消息、死信、延迟队列、流处理(Kafka Streams) |
| 搜索 | Elasticsearch/OpenSearch | 倒排索引、BM25、聚合、向量检索、语义重排、索引生命周期 |
| 对象存储 | MinIO、S3 | 预签名URL、生命周期、事件通知、版本控制 |

**前置依赖：** 01-计算机基础（数据库原理）、02-Java平台

**选型参考：**
- 默认知识库：PostgreSQL + pgvector
- 全文/混合检索：Elasticsearch
- 实时上下文/缓存：Redis
- 大规模独立向量：Qdrant / Milvus
- 知识图谱：Neo4j

---

### 05 — 分布式架构 (Distributed Architecture)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 一致性 | 强一致/最终一致、分布式事务(Seata/Saga)、TCC、本地消息表、Outbox |
| 幂等 | 唯一索引、Token、状态机、去重表 |
| 分布式锁 | Redis(Redisson)、ZooKeeper、数据库乐观/悲观锁 |
| 缓存策略 | Cache-Aside、Read/Write Through、Write Behind、热点发现、多级缓存 |
| 限流熔断 | Resilience4j(超时/重试/限流/熔断/隔离)、Sentinel、Spring Cloud Circuit Breaker |
| 高可用 | 健康检查、故障转移、优雅关闭、多活/灾备 |
| 微服务 | Spring Cloud Gateway、服务发现、配置中心、负载均衡、链路追踪 |

**前置依赖：** 03-Java应用平台、04-数据与中间件

---

### 06 — 云原生与SRE (Cloud Native & SRE)

**核心内容：**

| 子域 | 技术 | 关键知识点 |
|------|------|-----------|
| Linux | - | 常用命令、Shell脚本、进程管理、网络诊断、systemd、cgroup |
| 容器 | Docker | Dockerfile、多阶段构建、Compose、镜像优化、安全最佳实践 |
| 编排 | Kubernetes | Pod/Deployment/Service/Ingress、ConfigMap/Secret、HPA、Helm |
| CI/CD | GitHub Actions、Jenkins | Pipeline as Code、制品管理、回滚策略 |
| IaC | Terraform、Ansible | 基础设施即代码、声明式配置 |
| 可观测性 | OpenTelemetry、Prometheus、Grafana、Tempo、Loki | Metrics/Tracing/Logging 三支柱、GenAI语义约定 |
| 容量与故障 | - | 容量规划、混沌工程、故障演练、SLO/SLI/SLA |

**前置依赖：** 05-分布式架构

---

### 07 — AI基础 (AI Foundations)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 机器学习基础 | 监督/无监督学习、过拟合、正则化、交叉验证、特征工程 |
| 神经网络 | 前馈网络、反向传播、激活函数、损失函数、优化器、Batch/Layer Normalization |
| Transformer | Self-Attention、Multi-Head Attention、Positional Encoding、Encoder-Decoder、GPT/Decoder-only |
| Token | Tokenization(BPE/WordPiece/SentencePiece)、Token计数、Special Tokens、Context Window |
| Embedding | Word2Vec、Sentence Embedding、对比学习、Matryoshka Embedding、多模态Embedding |
| 推理与评估 | Greedy/Top-k/Top-p/Beam Search、Temperature、Perplexity、BLEU/ROUGE、LLM-as-a-Judge |
| 训练基础概念 | Pre-training、SFT(指令微调)、RLHF/DPO、LoRA/QLoRA、量化(GGUF/GPTQ/AWQ) |

**前置依赖：** 01-计算机基础（数学基础：线性代数、概率论）

**注意：** 07 聚焦理解模型工作的原理，不涉及具体 API 调用或框架使用。

---

### 08 — 模型接入与推理 (Model Integration & Inference)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 云模型API | OpenAI Chat Completions/Responses API、Anthropic Messages API、AWS Bedrock Converse、Google GenAI、Azure AI |
| OpenAI兼容协议 | Chat/Responses协议差异、流式事件模型(SSE)、Tool Calling消息结构、Structured Output与JSON Schema、Token Usage、Reasoning Token、Prompt Cache、Provider兼容性差异、错误码/重试/幂等 |
| 本地模型 | Ollama、Docker Model Runner、OpenAI兼容本地服务 |
| 模型能力矩阵 | 各模型能力对比（推理/代码/多模态/函数调用/上下文窗口/多语言）、模型选择决策树 |
| 模型路由 | 能力路由、成本路由、故障转移、灰度发布、A/B路由 |
| 推理服务 | vLLM、TensorRT-LLM、Hugging Face TGI、KServe |
| JVM内嵌推理 | DJL(Deep Java Library)、ONNX Runtime Java、DJL Serving、小型Embedding/分类/排序模型 |
| 多模态 | Vision理解、图片生成、语音识别/合成(TTS/STT)、视频理解 |

**前置依赖：** 07-AI基础

**架构原则：** 业务代码不应直接依赖任何模型厂商的API或SDK。应通过核心接口（ChatModelPort、EmbeddingModelPort等）抽象。

---

### 09 — Java AI框架 (Java AI Frameworks)

**核心内容：**

| 子域 | 技术 | 关键知识点 |
|------|------|-----------|
| Spring AI | Spring AI 2.x | ChatClient、ChatModel、EmbeddingModel、Advisors、Structured Output、Tool Calling、Chat Memory、Vector Store、RAG、MCP、Evaluation、Observability |
| 框架对比 | LangChain4j | 与Spring AI的架构对比、选型参考 |
| 厂商SDK | OpenAI Java SDK、Anthropic Java SDK、AWS Bedrock SDK、Google GenAI Java SDK、Azure AI SDK | 当框架不支持最新能力时的降级方案 |
| 架构抽象 | 自定义核心接口 | ChatModelPort、EmbeddingModelPort、RerankModelPort、RetrievalPort、ConversationMemoryPort、ToolRegistryPort、PromptRepositoryPort、EvaluationPort、ModelRouterPort、AiTracePort |

**前置依赖：** 03-Java应用平台、08-模型接入与推理

**核心架构原则：**
```
业务层 → ChatModelPort(接口) → Spring AI适配器 / 厂商SDK适配器 → 模型
```
直接依赖Spring AI或厂商SDK的业务代码视为技术债。

---

### 10 — AI数据工程 (AI Data Engineering)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 数据来源 | 本地文件、网页、数据库、S3/MinIO/OSS、Confluence/Notion/SharePoint、Kafka/CDC、API/MCP Resources、扫描件/图片/音视频 |
| Java解析技术 | Apache Tika(通用)、PDFBox(PDF)、Apache POI(Office)、Jsoup(HTML)、Jackson/XPath(JSON/XML)、Tesseract/PaddleOCR(OCR)、FFmpeg+语音模型(音视频) |
| 文档预处理 | Markdown标准化、表格提取、代码块识别、图片处理、公式识别 |
| 切片策略 | 固定大小、语义切片(按段落/章节/语义边界)、递归切片、代码感知切片、多模态切片、Late Chunking |
| 元数据管理 | Metadata Schema设计、来源追溯、ACL权限继承、文档版本控制、时间有效性 |
| 数据治理 | 内容指纹与去重(SimHash/MinHash)、PII识别与脱敏、删除传播(Cascade)、Embedding版本迁移、增量更新(CDC)、多租户隔离 |
| 批处理 | Spring Batch 模式：Reader → Processor → Writer，分区与并行 |
| 血缘 | 数据链路：源文件 → 解析 → 切片 → Embedding → 索引 → 检索命中，每一步的可追溯性 |

**前置依赖：** 03-Java应用平台、04-数据与中间件

---

### 11 — 检索与RAG (Retrieval & RAG)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| Query理解 | 意图识别、实体抽取、查询分类、敏感词过滤 |
| Query改写 | 拼写纠正、同义词扩展、Query拆分/合并、HyDE(假设文档嵌入) |
| 稀疏检索 | BM25、关键词高亮、Elasticsearch/OpenSearch |
| 稠密检索 | Embedding相似度、pgvector/Redis/Qdrant/Milvus、HNSW/IVFFlat索引 |
| 混合检索 | 融合策略(RRF/加权分数)、元数据过滤、Self-Query Retrieval |
| 重排 | Cross-Encoder Reranker、Cohere Rerank、BGE Reranker、ColBERT(Late Interaction) |
| Context处理 | 上下文压缩、引用提取、相关性阈值过滤、去重 |
| 高级RAG模式 | Parent-Child Retrieval、Multi-Query Retrieval、Corrective RAG、Adaptive RAG、Agentic RAG、Multi-hop RAG、Multimodal RAG |
| GraphRAG | 知识图谱构建(实体/关系抽取)、图遍历检索、社区摘要、Neo4j集成 |
| Contextual Retrieval | 上下文增强的Chunking、Late Chunking/ColBERT |
| 质量评估 | 检索召回率/精确率、MRR、NDCG、答案忠实度、引用准确性 |

**前置依赖：** 07-AI基础、10-AI数据工程

**RAG完整流水线：**
```
文档加载 → 清洗标准化 → 语义切片 → 元数据与ACL → Embedding → 向量索引
                                                                ↓
Query理解 → Query改写 → Metadata过滤 → 稀疏/稠密检索 → 混合融合 → Rerank → Context压缩 → Prompt组装 → 答案生成 → 原文引用 → 质量评估
```

---

### 12 — Agent工程 (Agent Engineering)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| Tool Calling | 工具定义(JSON Schema)、工具选择策略、参数填充、结果处理、并行/串行调用 |
| Memory | Short-term（对话上下文窗口管理）、Long-term（向量记忆/摘要记忆/关键事件）、Working Memory（Scratchpad） |
| Planning | ReAct、Plan-and-Execute、Tree-of-Thought、Reflection、Self-Critique |
| Workflow | 确定性工作流 vs 模型驱动Agent、DAG编排、条件分支、循环、错误恢复 |
| Human-in-the-loop | 审批节点、人工确认、中断与恢复、权限升级 |
| 多Agent | 角色分工、消息传递、任务委托、Agent发现、群组对话、A2A协议 |
| 持久化执行 | Temporal/Camunda 工作流引擎、Saga模式、补偿事务、Outbox Pattern、Kafka状态事件 |
| 状态管理 | Agent状态机、会话持久化、断点续传、幂等操作 |
| 工具生态 | 工具发现、动态加载、版本管理、权限控制、速率限制 |

**前置依赖：** 11-检索与RAG、13-AI协议

---

### 13 — AI协议 (AI Protocols)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| MCP (Model Context Protocol) | Client/Server/Host 架构、Tools/Resources/Prompts、stdio/Streamable HTTP Transport、Schema校验、Sampling、Elicitation、Authorization、Tool权限与审计、MCP Apps、Java MCP SDK |
| A2A (Agent-to-Agent) | Agent Card、Message/Task/Artifact、长任务状态、Agent发现、身份认证(OAuth2/OIDC)、Agent间权限、流式事件、任务取消与恢复、Java A2A SDK |
| 基础协议 | JSON Schema(工具定义/结构化输出)、OpenAPI(REST API描述)、OAuth2/OIDC(认证授权) |

**架构关系：**
- MCP：解决"Agent如何调用工具和数据"
- A2A：解决"Agent如何与其他Agent协作"
- JSON Schema + OpenAPI：MCP Tool定义和REST API描述的基础

**前置依赖：** 12-Agent工程

---

### 14 — AI平台与LLMOps (AI Platform & LLMOps)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 模型网关 | 多模型统一协议、模型路由与降级、API Key管理、租户/用户配额、Token预算、限流与并发控制 |
| 缓存体系 | 请求缓存(exact match)、语义缓存(embedding相似度)、Prompt Cache(Antarctic/Claude)、分层策略 |
| Prompt管理 | 模板化、版本控制、环境变量、模型参数绑定、依赖关系、A/B测试、灰度发布、回滚 |
| 评估体系 | 离线评估(正确性/相关性/忠实度/引用准确性/检索召回率)、在线评估(点赞/转人工/完成率/延迟/成本/失败率)、Agent评估(工具选择/参数正确性/步骤/越权/结果)、回归评估(模型/Prompt/Embedding/检索策略升级) |
| 成本管理 | Token计数与预估、成本归集(按用户/租户/应用)、预算告警、成本优化策略 |
| 可观测性 | 请求量/成功率、TTFT、总时延、Input/Output/Reasoning Token、Prompt Cache命中、模型/Provider、工具调用次数与耗时、RAG检索耗时与结果数量、文档检索分数、Agent步骤数、单请求成本、降级/重试次数、用户反馈 |
| 多租户 | 数据隔离(DB Schema/Row Level/Database Level)、配额隔离、模型路由隔离 |

**前置依赖：** 05-分布式架构、08-模型接入与推理

---

### 15 — AI安全与治理 (AI Security & Governance)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 传统安全 | OAuth2/OIDC/JWT、RBAC/ABAC、TLS/mTLS、Secret/Vault/KMS、数据库/对象存储权限、审计日志、供应链安全(依赖扫描/SBOM/镜像签名) |
| Prompt注入 | Direct Prompt Injection(用户输入直接注入)、Indirect Prompt Injection(通过检索文档/Tool输出间接注入)、防御策略(输入清洗/分隔符/权限隔离/沙箱) |
| 工具安全 | Tool越权调用、Excessive Agency、工具Allowlist、参数Schema校验、Human Approval机制、沙箱执行 |
| 数据安全 | 敏感信息泄露(模型响应/Tool参数/日志)、PII脱敏、Embedding反推攻击、RAG知识污染、数据删除权 |
| 协议安全 | 不可信MCP Server、Agent身份伪造、OAuth Scope最小化、Token劫持 |
| 供应链风险 | 模型来源验证、Prompt模板注入、第三方Tool审计、MCP Server扫描 |
| 内容安全 | 输入/输出内容审核、有害内容检测、合规检查 |
| 治理框架 | OWASP LLM Top 10、审计与重放、策略即代码(OPA/Rego)、合规报告 |

**OWASP LLM Top 10 对应：**
1. Prompt Injection → Direct/Indirect Prompt Injection
2. Insecure Output Handling → 输出审核
3. Training Data Poisoning → RAG知识污染
4. Model Denial of Service → 速率限制/Token预算
5. Supply Chain Vulnerabilities → 供应链风险
6. Sensitive Information Disclosure → 数据安全
7. Insecure Plugin Design → 工具安全
8. Excessive Agency → Excessive Agency
9. Overreliance → 人工审核
10. Model Theft → API Key管理

**前置依赖：** 14-AI平台与LLMOps

---

### 16 — AI原生研发 (AI-Native Software Engineering)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| Claude Code | CLI使用、/命令体系、Permissions/Hooks/Skills/Agents、MCP集成、IDE插件 |
| 上下文工程 | CLAUDE.md设计、目录级规则、Repository Context、Memory管理、Context压缩与会话恢复 |
| 规格驱动开发 | Specification-Driven Development、Plan模式、任务拆分、ADR(Architecture Decision Records) |
| AI辅助编码 | 代码生成、多文件重构、测试生成(单元/集成/E2E)、代码审查、注释与文档生成 |
| 质量保证 | AI生成代码可信度评估、Hallucination检测、安全代码审查、Git Diff审查 |
| 调试与运维 | 故障日志分析、性能诊断辅助、数据库/API迁移、CI/CD集成 |
| 安全 | Prompt Injection与仓库安全(.claude目录保护)、敏感信息泄露、第三方Skill/MCP审计 |

**前置依赖：** 02-Java平台、03-Java应用平台

---

### 17 — 系统设计 (System Design)

**核心内容：**

| 子域 | 关键设计要点 |
|------|-------------|
| 企业RAG系统 | 多租户知识库架构、大规模文档处理流水线、检索质量与延迟平衡、权限感知检索、引用与溯源 |
| 模型网关 | 统一协议适配层、多模型路由与降级、Token预算与计费、租户配额、审计日志 |
| Agent平台 | Agent生命周期管理、Tool市场与权限、工作流编排引擎、会话持久化、监控与告警 |
| AI知识库 | 知识生命周期(创建/审核/更新/归档)、协作编辑、版本控制、搜索与发现 |
| 多租户AI SaaS | 租户隔离策略、自定义模型/Prompt、用量计费、白标能力 |

**前置依赖：** 05-分布式架构、06-云原生与SRE、14-AI平台与LLMOps

---

### 18 — 行业领域：保险 (Insurance Domain)

**核心内容：**

| 子域 | 关键知识点 |
|------|-----------|
| 保险业务模型 | 保险原理、险种分类(寿险/健康险/意外险/财产险/责任险)、团体保险vs个险 |
| 核心业务对象 | 保单(Policy)、批单(Endorsement)、报价(Quotation)、核保(Underwriting)、理赔(Claim)、再保(Reinsurance) |
| 业务流程 | 投保流程、核保规则、保费计算、续保、退保、批改 |
| 行业术语 | 投保人/被保人/受益人、等待期/犹豫期/宽限期、免赔额/赔付比例/保额、职业类别、费率表 |
| 监管与合规 | 偿付能力、准备金、个人信息保护、保险合同法 |
| AI应用场景 | 智能核保、产品推荐、条款解读、理赔定损、反欺诈、客服Agent |

**前置依赖：** 无（可并行学习）

---

## 三、知识关系类型

每个知识条目应标注其与其他条目的关系：

| 关系类型 | 说明 | 示例 |
|----------|------|------|
| `prerequisite` | 前置依赖，必须先掌握 | 02 → 03（先学Java再学Spring） |
| `related` | 相关知识，建议并行或交叉学习 | 04-数据与中间件 ↔ 05-分布式架构 |
| `derived` | 派生关系，后者是前者的应用 | 07-AI基础 → 08-模型接入与推理 |
| `contrast` | 对比关系，不同方案选型对比 | Spring AI vs LangChain4j |
| `version-of` | 版本关系，同一技术的不同版本 | JDK 21 → JDK 25 |
| `replaces` | 替代关系，新技术替代旧技术 | Virtual Threads 简化 Reactor 场景 |

---

## 四、来源等级标准

所有知识条目必须标注来源等级（按可信度从高到低）：

| 等级 | 来源类型 | 示例 |
|------|----------|------|
| **L0** | 官方规范/标准 | JEP、RFC、JLS(Java Language Specification)、OWASP标准 |
| **L1** | 官方文档 | OpenJDK官方文档、Spring官方参考手册、OpenAI API Reference |
| **L2** | 源码 | GitHub仓库源码分析、关键实现解读 |
| **L3** | 权威书籍 | 《Java并发编程实战》、《Designing Data-Intensive Applications》 |
| **L4** | 技术博客/论文 | 官方团队博客、学术论文、知名技术博客 |
| **L5** | 社区/经验 | Stack Overflow、技术论坛、个人实践经验 |
| **L6** | AI生成 | Claude/GPT等生成的总结，需标注"AI生成，未经人工验证" |

**规则：**
- 同一知识点有多级来源时，优先采信高等级来源
- L6来源的知识条目必须标注 `status: draft`，待人工验证后升级为 `verified`
- 知识条目至少应有一个 L3 及以上来源

---

## 五、版本矩阵

记录关键技术的当前版本和未来关注点：

| 技术 | 当前版本(2026-07) | 备注 |
|------|-------------------|------|
| JDK | 25 LTS | 主栈版本；JDK 21 作为兼容参考 |
| Spring Boot | 4.x | 主线 |
| Spring AI | 2.x | 稳定主线 |
| Spring Security | 6.x | 与Spring Boot 4.x配套 |
| Spring Cloud | 2025.x | — |
| Maven | 4.x | 构建工具主栈 |
| Gradle | 8.x | 对比参考 |
| JUnit | 5.11+ | 测试主栈 |
| PostgreSQL | 17+ | pgvector 0.8+ |
| Redis | 7.4+ | — |
| Kafka | 4.x | — |
| Elasticsearch | 9.x | — |
| Docker | 28.x | — |
| Kubernetes | 1.33+ | — |
| OpenTelemetry | 1.40+ | GenAI语义约定 |
| MCP Java SDK | 最新 | 查看 Maven Central |
| A2A Java SDK | 最新 | 查看官方发布 |
| Ollama | 最新 | 本地开发 |
| Claude Code | 最新 | AI研发工具 |

版本更新频率：**每季度复核一次**，重大版本发布(如JDK新LTS、Spring大版本)一周内更新。

---

## 六、知识条目模板

新建知识条目时，复制以下模板：

```markdown
---
domain: "00-knowledge-engineering"
title: "标题"
status: "draft"          # draft | verified | outdated
level: "intermediate"    # beginner | intermediate | advanced | reference
sources:
  - level: "L1"
    url: "https://..."
    description: "来源描述"
relations:
  prerequisite: ["01-xxx"]
  related: ["02-xxx"]
tags: ["tag1", "tag2"]
created: "2026-07-17"
updated: "2026-07-17"
---

# 标题

## 概述
简要描述本知识条目的内容。

## 核心内容
...

## 代码示例（如适用）
...

## 常见问题
...

## 相关条目
- [[other-entry]]
```

---

## 七、知识条目命名规范

文件命名：`{domain-number}-{中文标题}.md`

示例：
- `02-现代Java25深度解析.md`
- `08-OpenAI兼容协议详解.md`
- `11-向量检索与混合检索.md`
- `12-MCP协议与JavaSDK.md`

---

## 八、维护日志

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-07-17 | v1.0.0 | 初始版本，定义18个知识域及元数据规范 |
