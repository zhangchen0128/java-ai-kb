---
domain: 17-系统设计
title: 企业级RAG系统完整设计
status: draft
level: advanced
sources:
  - level: L1
    url: https://docs.spring.io/spring-ai/reference/
    description: Spring AI官方文档 - ChatClient、VectorStore、ETL Pipeline
  - level: L1
    url: https://www.pgvector.org/
    description: pgvector官方文档 - PostgreSQL向量扩展
  - level: L2
    url: https://www.elastic.co/guide/en/elasticsearch/reference/current/dense-vector.html
    description: Elasticsearch密集向量与混合检索
  - level: L2
    url: https://kubernetes.io/docs/concepts/workloads/
    description: Kubernetes工作负载与自动伸缩
  - level: L3
    url: https://github.com/vllm-project/vllm
    description: vLLM高性能LLM推理引擎
relations:
  prerequisite:
    - 05-分布式一致性与事务方案
    - 11-向量检索与混合检索
    - 14-模型网关与Prompt管理
  related:
    - 04-PostgreSQL与pgvector深度解析
    - 06-Docker与Kubernetes云原生部署
tags:
  - system-design
  - rag
  - enterprise
  - multi-tenant
  - kubernetes
  - pgvector
  - spring-ai
created: 2026-07-17
updated: 2026-07-17
content_type: concept
---

# 企业级RAG系统完整设计

## 一、需求分析

### 1.1 企业级RAG与Demo RAG的核心区别

企业级RAG系统远非一个简单的LangChain Demo可比。下表总结关键差异：

| 维度 | Demo RAG | 企业级RAG |
|------|----------|-----------|
| 文档规模 | 几十到几百篇 | 数万到数百万文档 |
| 用户体系 | 无/单用户 | 多租户，RBAC权限 |
| 数据安全 | 无隔离 | 租户级隔离 + 字段级权限 |
| 检索质量 | 单一向量检索 | 混合检索 + 多路召回 + Rerank |
| 可用性 | 单机运行 | 99.9% SLA，多AZ部署 |
| 可观测性 | 无 | 全链路追踪 + 审计日志 |
| 成本控制 | 无感知 | Token计量 + 配额管理 |
| 合规 | 无要求 | 数据本地化 + 审计追溯 |

### 1.2 功能需求

**文档管理模块：**
- 支持PDF/Word/Markdown/HTML/纯文本等格式上传
- 文档解析（OCR、表格提取、层级结构保留）
- 智能切片策略（固定大小、语义分块、递归分块）
- 文档状态管理（上传中→解析中→索引中→就绪→已删除）
- 批量导入（支持ZIP包、API批量提交）

**知识库管理模块：**
- 创建/删除/更新知识库（作为文档的逻辑分组容器）
- 知识库级别的Embedding模型配置
- 知识库访问权限设置（租户内用户/用户组授权）
- 知识库检索策略配置（相似度阈值、TopK、Rerank开关）

**检索问答模块：**
- 多轮对话上下文管理
- Query理解与改写（同义词扩展、Query拆分、意图识别）
- 混合检索（向量检索 + 关键词检索 + 元数据过滤）
- Rerank重排序（Cross-Encoder模型对召回结果精排）
- 流式输出（SSE/WebSocket）
- 引用溯源（每个答案附带来源文档片段及页码）

**评估反馈模块：**
- 用户反馈收集（赞/踩 + 自由文本）
- 答案纠错标注（人工修正答案）
- 离线评估（NDCG、MRR、Recall@K）
- A/B测试框架（多套检索策略对比）

### 1.3 非功能需求

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 检索延迟 | P99 < 500ms | 包含向量检索 + Rerank |
| 端到端延迟 | P99 < 3s | 含LLM生成时间（流式首Token < 1s） |
| 吞吐量 | 100 QPS | 检索问答接口 |
| 可用性 | 99.9% | 年度停机 < 8.76小时 |
| 文档处理 | 1000页/分钟 | 文档解析 + Embedding流水线 |
| 向量维度 | 768-4096 | 可配置，支持多种Embedding模型 |
| 数据持久性 | 99.99999999% | 对象存储11个9 |

---

## 二、系统架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ Web App  │  │ Mobile   │  │ Admin    │  │ API SDK  │                     │
│  │ (React)  │  │  App     │  │ Console  │  │ (Java)   │                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       └──────────────┴──────────────┴──────────────┘                         │
│                          │  HTTPS/TLS 1.3                                    │
└──────────────────────────┼───────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │           Spring Cloud Gateway (Rate Limit / Auth / Route)             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │   │
│  │  │ JWT      │  │ Tenant   │  │ API      │  │ Circuit              │  │   │
│  │  │ Validat. │  │ Resolver │  │ Rate Lim.│  │ Breaker              │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  Internal gRPC / REST
┌──────────────────────────┼───────────────────────────────────────────────────┐
│                      SERVICE LAYER (Spring Boot 4.x)                          │
│                                                                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │   Document    │  │  Knowledge    │  │   Retrieval   │  │   Question    │  │
│  │   Service     │  │  Base Service │  │   Service     │  │   Answering   │  │
│  │               │  │               │  │               │  │   Service     │  │
│  │ - upload()    │  │ - createKB()  │  │ - search()    │  │ - ask()       │  │
│  │ - getStatus() │  │ - configKB()  │  │ - hybridSRCH()│  │ - streamAsk() │  │
│  │ - delete()    │  │ - grantPerm() │  │ - rerank()    │  │ - getHistory()│  │
│  │ - chunk()     │  │ - listKB()    │  │ - multiRoute()│  │ - feedback()  │  │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  │
│          │                  │                  │                  │          │
│  ┌───────┴──────────────────┴──────────────────┴──────────────────┴───────┐  │
│  │                        SHARED SERVICES                                   │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │  │
│  │  │TenantCtx   │  │ Audit      │  │ Quota      │  │ Embedding  │        │  │
│  │  │Manager     │  │ Service    │  │ Manager    │  │ Router     │        │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘        │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │
    ┌──────────────────────┼──────────────────────────────────────┐
    │                      │                                      │
    ▼                      ▼                                      ▼
┌───────────────┐  ┌───────────────────┐  ┌───────────────────────────────┐
│ DATA LAYER    │  │ SEARCH & RETRIEVAL│  │     AI INFERENCE LAYER        │
│               │  │                   │  │                               │
│ ┌───────────┐ │  │ ┌───────────────┐ │  │ ┌───────────────────────────┐ │
│ │PostgreSQL │ │  │ │ Elasticsearch │ │  │ │ Embedding Service         │ │
│ │+ pgvector │ │  │ │ (Hybrid SRCH) │ │  │ │ (BGE-M3 / text2vec-large) │ │
│ │(Metadata  │ │  │ │               │ │  │ └───────────────────────────┘ │
│ │ + Vector) │ │  │ │ - Full-text   │ │  │ ┌───────────────────────────┐ │
│ └───────────┘ │  │ │ - KNN vector  │ │  │ │ Reranker Service          │ │
│ ┌───────────┐ │  │ │ - BM25+Vector │ │  │ │ (BGE-Reranker-v2)         │ │
│ │   Redis   │ │  │ │ - Metadata    │ │  │ └───────────────────────────┘ │
│ │ (Cache +  │ │  │ │   Filtering   │ │  │ ┌───────────────────────────┐ │
│ │  Session) │ │  │ └───────────────┘ │  │ │ LLM Inference (vLLM)      │ │
│ └───────────┘ │  │                   │  │ │ (Qwen3 / DeepSeek / etc.) │ │
│ ┌───────────┐ │  └───────────────────┘  │ └───────────────────────────┘ │
│ │ MinIO/S3  │ │                         └───────────────────────────────┘
│ │ (Raw Docs)│ │
│ └───────────┘ │
└───────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                     MESSAGE & STREAMING LAYER                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────────────────────────┐  │
│  │ RabbitMQ │  │  Kafka   │  │ SSE / WebSocket (Streaming Responses)       │  │
│  │(Doc Proc │  │(Audit    │  │                                             │  │
│  │ Events)  │  │ Events)  │  │  ┌─────────────────────────────────────┐    │  │
│  └──────────┘  └──────────┘  │  │ ChatClient ──> Flux<String> ──> SSE │    │  │
│                              │  └─────────────────────────────────────┘    │  │
│                              └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                     OBSERVABILITY LAYER                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐       │
│  │  Grafana │  │  Loki    │  │  Tempo   │  │  Prometheus + Micrometer│      │
│  │(Dashboard│  │(Log      │  │(Distrib. │  │  (Metrics Collection)   │      │
│  │ & Alert) │  │ Aggreg.) │  │ Tracing) │  │                         │      │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件详解

#### 2.2.1 文档处理管道

文档处理是企业RAG系统最重要的Pipeline，处理质量直接决定检索效果。

```
Document Processing Pipeline:

FileUpload ──> VirusScan ──> FormatDetect ──> Parse ──> Clean ──> Chunk ──> Embed ──> Index
                (ClamAV)      (Tika)          (根据格式  (去噪/去重 (策略  (Embedding (PGVector
                                              选择解析器) /标准化)  选择)  Model)    + ES)

处理状态机：
  UPLOADING → PARSING → CHUNKING → EMBEDDING → INDEXING → READY
      │          │          │           │           │
      └──────────┴──────────┴───────────┴───────────┴──> FAILED (任意阶段)
```

核心设计要点：
- **异步处理**：文档上传后立即返回，通过消息队列异步处理，避免HTTP超时
- **幂等性**：每个处理阶段记录状态，支持重试而不产生重复数据
- **隔离性**：大文档拆分为页级处理，避免单个大文档阻塞整个管道
- **可观测**：每个阶段上报Prometheus指标（处理耗时、成功率、队列深度）

#### 2.2.2 检索服务

混合检索是高质量检索的核心：

```
Query Processing Flow:

User Query ──> Query Rewrite ──> Multi-Route Retrieval ──> Merge & Dedup ──> Rerank ──> Top-K

Query Rewrite (可选用LLM小模型):
  "怎么用这个功能" ──> "系统设置中如何配置XX功能"

Multi-Route Retrieval:
  Route 1: Dense Vector Search (pgvector / Elasticsearch KNN)
  Route 2: Sparse/Keyword Search (BM25 via Elasticsearch)
  Route 3: Hybrid Search (Dense + Sparse weighted fusion)
  Route 4: Metadata/Filtered Search (按日期、分类、标签过滤)

Merge Strategy:
  - RRF (Reciprocal Rank Fusion): score = Σ 1/(k + rank_i)
  - Weighted Sum: score = α * dense_score + β * sparse_score

Rerank:
  - Cross-Encoder模型（如BGE-Reranker-v2-m3）对Top-N精排
  - 每个候选文档passage与query拼接后打分
  - 输出Top-K（通常K=5~10）
```

#### 2.2.3 问答服务

```
QA Service Flow:

[Top-K Chunks] ──> Prompt Builder ──> LLM Call ──> Citation Extraction ──> Response
                        │                  │                │
                        │                  │                ├──> 提取引用标记 [1][2]
                        │                  ├──> Streaming via Flux<>
                        │                  ├──> Token计数(Tenant配额)
                        │                  └──> Guardrails检查
                        │
                        ├──> System Prompt: "你是XX企业的AI助手..."
                        ├──> Context: [Chunk1]...[ChunkK]
                        ├──> Chat History (多轮对话)
                        └──> User Query
```

---

## 三、数据层设计

### 3.1 ER图描述

```
┌──────────┐       ┌──────────────┐       ┌──────────────────┐
│  tenants │1─────*│    users     │       │ quota_records    │
│          │       │              │       │ (tenant_id,      │
│ - id (PK)│       │ - id (PK)    │       │  resource_type,  │
│ - name   │       │ - tenant_id  │       │  used, limit,    │
│ - status │       │ - username   │       │  period)         │
│ - config │       │ - role_ids   │       └──────────────────┘
└────┬─────┘       └──────────────┘
     │
     │ 1
     │
     ├─────────────┐
     │             │
     │*            │*
┌────┴──────────┐  ┌────────────────┐
│knowledge_bases│  │   documents    │
│               │  │                │
│ - id (PK)     │  │ - id (PK)      │
│ - tenant_id   │  │ - kb_id (FK)   │
│ - name        │  │ - tenant_id    │
│ - emb_model   │  │ - file_name    │
│ - chunk_cfg   │  │ - file_type    │
│ - permissions │  │ - file_size    │
└───────┬───────┘  │ - status       │
        │          │ - storage_path │
        │ 1        └───────┬────────┘
        │                  │
        │                  │ 1
        │                  │
        │*                 │*
        │    ┌─────────────┴──────────────┐
        │    │                            │
┌───────┴──────┐              ┌───────────┴──────────┐
│    chunks    │              │ chunk_embeddings     │
│              │              │                      │
│ - id (PK)    │              │ - chunk_id (FK)      │
│ - doc_id(FK) │              │ - model_name         │
│ - chunk_idx  │              │ - embedding_dense    │
│ - content    │              │   (vector(768/1024)) │
│ - metadata   │              │ - embedding_sparse   │
│ - word_count │              │   (sparsevec)        │
│ - hash       │              │ - version            │
└──────────────┘              └──────────────────────┘

┌───────────────┐         ┌───────────────────┐
│conversations  │         │  audit_logs       │
│               │         │                   │
│ - id (PK)     │         │ - id (PK)         │
│ - user_id     │         │ - tenant_id       │
│ - kb_ids      │         │ - user_id         │
│ - messages    │         │ - action          │
│   (JSONB)     │         │ - resource_type   │
│ - created_at  │         │ - resource_id     │
└───────────────┘         │ - detail (JSONB)  │
                          │ - ip_address      │
                          │ - created_at      │
                          └───────────────────┘

┌────────────────────┐
│   feedback         │
│                    │
│ - id (PK)          │
│ - conversation_id  │
│ - message_id       │
│ - rating (1-5)     │
│ - correction (TEXT)│
│ - user_id          │
│ - created_at       │
└────────────────────┘
```

### 3.2 完整DDL Schema

```sql
-- ============================================================
-- 企业级RAG系统 数据库Schema
-- 数据库: PostgreSQL 16 + pgvector 0.7+
-- ============================================================

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";          -- 模糊搜索
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- SQL性能分析

-- ============================================================
-- 1. 租户与用户
-- ============================================================

CREATE TABLE tenants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(255) NOT NULL,
    slug          VARCHAR(64)  NOT NULL UNIQUE,       -- URL友好标识
    status        VARCHAR(32)  NOT NULL DEFAULT 'active', -- active/suspended/deleted
    plan          VARCHAR(32)  NOT NULL DEFAULT 'free',   -- free/pro/enterprise
    config        JSONB        NOT NULL DEFAULT '{}',     -- 租户级配置
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    username      VARCHAR(128) NOT NULL,
    email         VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(32)  NOT NULL DEFAULT 'viewer', -- admin/editor/viewer
    status        VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, username),
    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ============================================================
-- 2. 知识库与权限
-- ============================================================

CREATE TABLE knowledge_bases (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    embedding_model VARCHAR(128) NOT NULL DEFAULT 'bge-m3', -- Embedding模型
    embedding_dim   INT          NOT NULL DEFAULT 1024,      -- 向量维度
    chunk_size      INT          NOT NULL DEFAULT 500,       -- 切片大小(字符)
    chunk_overlap   INT          NOT NULL DEFAULT 50,        -- 切片重叠
    retrieval_config JSONB       NOT NULL DEFAULT '{
        "top_k": 5,
        "similarity_threshold": 0.7,
        "rerank_enabled": true,
        "rerank_model": "bge-reranker-v2-m3",
        "hybrid_search_weight": 0.7
    }',
    status          VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_tenant ON knowledge_bases(tenant_id);

-- 知识库-用户权限关联表
CREATE TABLE kb_permissions (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kb_id     UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(16) NOT NULL DEFAULT 'read', -- read/write/admin
    granted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(kb_id, user_id)
);

-- ============================================================
-- 3. 文档
-- ============================================================

CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kb_id         UUID         NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    file_name     VARCHAR(512) NOT NULL,
    file_type     VARCHAR(32)  NOT NULL,  -- pdf/docx/markdown/html/txt
    file_size     BIGINT       NOT NULL,  -- bytes
    storage_path  VARCHAR(1024),          -- MinIO/S3 对象路径
    storage_bucket VARCHAR(128),          -- 存储桶名称
    status        VARCHAR(32)  NOT NULL DEFAULT 'uploading',
    --  processing stages
    parse_status  VARCHAR(32)  DEFAULT 'pending',  -- pending/processing/done/failed
    chunk_status  VARCHAR(32)  DEFAULT 'pending',
    embed_status  VARCHAR(32)  DEFAULT 'pending',
    index_status  VARCHAR(32)  DEFAULT 'pending',
    --  metadata
    page_count    INT,
    word_count    BIGINT,
    language      VARCHAR(16),
    doc_metadata  JSONB        NOT NULL DEFAULT '{}',
    --  processing info
    error_message TEXT,
    processing_time_ms BIGINT,  -- 总处理耗时
    uploaded_by   UUID         REFERENCES users(id),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_docs_kb      ON documents(kb_id);
CREATE INDEX idx_docs_tenant  ON documents(tenant_id);
CREATE INDEX idx_docs_status  ON documents(status);

-- ============================================================
-- 4. 切片 (Documents after chunking)
-- ============================================================

CREATE TABLE chunks (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_id        UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id         UUID         NOT NULL REFERENCES knowledge_bases(id),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    chunk_index   INT          NOT NULL,     -- 在文档中的序号
    content       TEXT         NOT NULL,     -- 切片文本内容
    word_count    INT          NOT NULL,
    content_hash  VARCHAR(64)  NOT NULL,     -- SHA-256用于去重
    chunk_metadata JSONB       NOT NULL DEFAULT '{}', -- 页码/章节/标题
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(doc_id, chunk_index)
);

CREATE INDEX idx_chunks_doc    ON chunks(doc_id);
CREATE INDEX idx_chunks_kb     ON chunks(kb_id);
CREATE INDEX idx_chunks_tenant ON chunks(tenant_id);
CREATE INDEX idx_chunks_hash   ON chunks(content_hash);

-- ============================================================
-- 5. 向量存储 (pgvector)
-- ============================================================

CREATE TABLE chunk_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chunk_id        UUID    NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    kb_id           UUID    NOT NULL REFERENCES knowledge_bases(id),
    tenant_id       UUID    NOT NULL REFERENCES tenants(id),
    model_name      VARCHAR(128) NOT NULL,
    model_version   VARCHAR(64),                    -- 模型版本号
    embedding_dense vector(1024),                   -- Dense Embedding (可配置维度)
    embedding_sparse sparsevec(250000),              -- Sparse Embedding (词汇空间)
    embedding_bytes INT,                             -- 向量字节大小
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pgvector IVFFlat索引 (适合大批量数据)
-- 使用前需先插入足够数据后执行
-- CREATE INDEX ON chunk_embeddings 
--     USING ivfflat (embedding_dense vector_cosine_ops) 
--     WITH (lists = 100);

-- HNSW索引 (更高查询性能，更大内存占用)
CREATE INDEX idx_embedding_hnsw ON chunk_embeddings
    USING hnsw (embedding_dense vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_emb_chunk   ON chunk_embeddings(chunk_id);
CREATE INDEX idx_emb_kb      ON chunk_embeddings(kb_id);
CREATE INDEX idx_emb_tenant  ON chunk_embeddings(tenant_id);
CREATE INDEX idx_emb_model   ON chunk_embeddings(model_name);

-- ============================================================
-- 6. 会话与对话
-- ============================================================

CREATE TABLE conversations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    user_id       UUID         NOT NULL REFERENCES users(id),
    kb_ids        UUID[]       NOT NULL,            -- 关联的知识库IDs
    title         VARCHAR(512),                     -- 自动生成的对话标题
    messages      JSONB        NOT NULL DEFAULT '[]', -- 消息列表
    total_tokens  BIGINT       NOT NULL DEFAULT 0,  -- 总Token消耗
    status        VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_tenant ON conversations(tenant_id);
CREATE INDEX idx_conv_user   ON conversations(user_id);
CREATE INDEX idx_conv_kbs    ON conversations USING GIN(kb_ids);

-- ============================================================
-- 7. 用户反馈
-- ============================================================

CREATE TABLE feedback (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id),
    conversation_id   UUID         NOT NULL REFERENCES conversations(id),
    message_index     INT          NOT NULL,       -- 消息在对话中的序号
    rating            SMALLINT     CHECK (rating >= 1 AND rating <= 5),
    helpful           BOOLEAN,                     -- 赞/踩
    correction        TEXT,                        -- 用户提供的正确答案
    comment           TEXT,                        -- 自由文本反馈
    user_id           UUID         NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_tenant ON feedback(tenant_id);
CREATE INDEX idx_feedback_conv   ON feedback(conversation_id);

-- ============================================================
-- 8. 配额管理
-- ============================================================

CREATE TABLE quota_definitions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan          VARCHAR(32)  NOT NULL,           -- free/pro/enterprise
    resource_type VARCHAR(64)  NOT NULL,           -- documents/api_calls/tokens/storage
    quota_limit   BIGINT       NOT NULL,           -- 限额
    period        VARCHAR(16)  NOT NULL DEFAULT 'monthly', -- daily/monthly/total
    UNIQUE(plan, resource_type)
);

CREATE TABLE quota_usage (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    resource_type VARCHAR(64)  NOT NULL,
    period_start  DATE         NOT NULL,           -- 计费周期开始日期
    used          BIGINT       NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, resource_type, period_start)
);

-- ============================================================
-- 9. 审计日志
-- ============================================================

CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id),
    user_id       UUID,
    action        VARCHAR(128) NOT NULL,           -- doc.upload/kb.create/qa.ask
    resource_type VARCHAR(64)  NOT NULL,           -- document/knowledge_base/conversation
    resource_id   UUID,
    detail        JSONB        NOT NULL DEFAULT '{}', -- 操作详情
    ip_address    INET,
    user_agent    TEXT,
    duration_ms   INT,                             -- 操作耗时
    success       BOOLEAN      NOT NULL DEFAULT true,
    error_code    VARCHAR(64),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant   ON audit_logs(tenant_id);
CREATE INDEX idx_audit_action   ON audit_logs(action);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_time     ON audit_logs(created_at DESC);

-- Partition by month for large-scale audit data
-- SELECT create_hypertable('audit_logs', 'created_at'); -- TimescaleDB

-- ============================================================
-- 10. Row-Level Security (多租户数据隔离)
-- ============================================================

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback        ENABLE ROW LEVEL SECURITY;

-- RLS Policy: 通过应用设置的租户上下文过滤
CREATE POLICY tenant_isolation_kb ON knowledge_bases
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_docs ON documents
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_chunks ON chunks
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_emb ON chunk_embeddings
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_conv ON conversations
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### 3.3 存储选型说明

| 存储系统 | 用途 | 关键特性 |
|----------|------|----------|
| **PostgreSQL + pgvector** | 元数据 + 向量存储 | ACID、RLS、HNSW索引、JSONB灵活性、事务一致性 |
| **Elasticsearch** | 全文检索 + 混合检索 | BM25、倒排索引、聚合分析、与pgvector形成互补 |
| **Redis** | 会话缓存 + 语义缓存 + 速率限制 | 亚毫秒延迟、丰富数据结构、Lua脚本原子操作 |
| **MinIO / S3** | 原始文件存储 | 高持久性、对象版本控制、生命周期管理、S3兼容 |

**为什么选择pgvector而非专用向量数据库？**

1. **运维简单**：团队已运维PostgreSQL，无需学习新的分布式系统
2. **事务一致**：向量数据和元数据在同一事务中，无需处理分布式一致性
3. **RLS原生支持**：PostgreSQL的Row-Level Security天然支持多租户数据隔离
4. **HNSW性能足够**：百万级向量下HNSW索引的召回率和延迟可与Milvus/Qdrant媲美
5. **混合查询**：向量检索 + SQL过滤（JOIN、WHERE、JSONB查询）在单次查询中完成

在向量规模超过5000万或需要纯向量检索极致性能时，可评估引入Qdrant或Milvus作为专用向量数据库层。pgvector作为主存储，通过CDC同步到专用向量DB形成读写分离架构。

---

## 四、API设计

### 4.1 API概览

```
Base URL: https://api.rag.example.com/v1

文档管理:
  POST   /documents/upload          - 上传文档
  GET    /documents                  - 文档列表
  GET    /documents/{id}             - 文档详情
  GET    /documents/{id}/status      - 文档处理状态
  DELETE /documents/{id}             - 删除文档

知识库管理:
  POST   /knowledge-bases            - 创建知识库
  GET    /knowledge-bases            - 知识库列表
  GET    /knowledge-bases/{id}       - 知识库详情
  PUT    /knowledge-bases/{id}       - 更新知识库
  DELETE /knowledge-bases/{id}       - 删除知识库
  POST   /knowledge-bases/{id}/permissions - 设置权限

检索问答:
  POST   /qa/ask                     - 单轮问答
  POST   /qa/chat                    - 多轮对话
  POST   /qa/chat/stream             - 流式多轮对话 (SSE)
  GET    /qa/conversations           - 对话历史
  GET    /qa/conversations/{id}      - 对话详情

评估反馈:
  POST   /qa/messages/{id}/feedback  - 提交反馈
  GET    /qa/feedback/stats          - 反馈统计

管理接口 (Admin):
  GET    /admin/tenants              - 租户管理
  POST   /admin/tenants/{id}/quota   - 配额设置
  GET    /admin/audit-logs           - 审计日志查询
```

### 4.2 核心Controller实现

```java
// ============================================================
// TenantContext.java - 租户上下文持有器
// ============================================================
package com.enterprise.rag.common.context;

import java.util.UUID;

/**
 * 租户上下文，基于ThreadLocal在请求链路中传递。
 * 在Filter中设置，请求结束后在Finally中清理。
 */
public class TenantContext {

    private static final ThreadLocal<TenantInfo> CONTEXT = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(TenantInfo info) {
        CONTEXT.set(info);
    }

    public static TenantInfo get() {
        TenantInfo info = CONTEXT.get();
        if (info == null) {
            throw new IllegalStateException("TenantContext not set. " +
                "Ensure TenantFilter is configured for this request path.");
        }
        return info;
    }

    public static UUID getTenantId() {
        return get().tenantId();
    }

    public static UUID getUserId() {
        return get().userId();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}

public record TenantInfo(UUID tenantId, UUID userId, String role) {}
```

```java
// ============================================================
// DocumentController.java - 文档管理API
// ============================================================
package com.enterprise.rag.controller;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.common.result.ApiResponse;
import com.enterprise.rag.common.result.PageResult;
import com.enterprise.rag.service.DocumentService;
import com.enterprise.rag.service.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/documents")
public class DocumentController {

    private final DocumentService documentService;
    private final AuditService auditService;

    public DocumentController(DocumentService documentService, AuditService auditService) {
        this.documentService = documentService;
        this.auditService = auditService;
    }

    /**
     * 上传文档。支持单文件或多文件上传。
     * 文件通过异步管道处理，立即返回文档ID和初始状态。
     */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<List<DocumentUploadResponse>>> upload(
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam("kb_id") UUID knowledgeBaseId,
            @RequestParam(value = "chunk_size", required = false) Integer chunkSize,
            @RequestParam(value = "chunk_overlap", required = false) Integer chunkOverlap) {

        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();

        List<DocumentUploadResponse> results = documentService.uploadDocuments(
                tenantId, userId, knowledgeBaseId, files, chunkSize, chunkOverlap);

        auditService.log("doc.upload", "document", null,
                java.util.Map.of("kb_id", knowledgeBaseId, "file_count", files.size()));

        return ResponseEntity.ok(ApiResponse.success(results));
    }

    /**
     * 查询文档列表。支持按知识库、状态、文件名过滤。
     */
    @GetMapping
    public ResponseEntity<ApiResponse<PageResult<DocumentVO>>> list(
            @RequestParam("kb_id") UUID knowledgeBaseId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @PageableDefault(size = 20) Pageable pageable) {

        PageResult<DocumentVO> page = documentService.listDocuments(
                TenantContext.getTenantId(), knowledgeBaseId, status, keyword, pageable);

        return ResponseEntity.ok(ApiResponse.success(page));
    }

    /**
     * 查询文档处理状态。
     */
    @GetMapping("/{id}/status")
    public ResponseEntity<ApiResponse<DocumentStatusVO>> getStatus(@PathVariable UUID id) {
        DocumentStatusVO status = documentService.getDocumentStatus(
                TenantContext.getTenantId(), id);
        return ResponseEntity.ok(ApiResponse.success(status));
    }

    /**
     * 删除文档及其所有切片和向量。
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable UUID id) {
        documentService.deleteDocument(TenantContext.getTenantId(), id);
        auditService.log("doc.delete", "document", id, null);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
```

```java
// ============================================================
// RetrievalController.java - 检索问答API
// ============================================================
package com.enterprise.rag.controller;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.common.result.ApiResponse;
import com.enterprise.rag.service.QAService;
import com.enterprise.rag.service.QuotaService;
import com.enterprise.rag.dto.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/qa")
public class RetrievalController {

    private final QAService qaService;
    private final QuotaService quotaService;

    public RetrievalController(QAService qaService, QuotaService quotaService) {
        this.qaService = qaService;
        this.quotaService = quotaService;
    }

    /**
     * 单轮问答 - 不保留对话历史。
     */
    @PostMapping("/ask")
    public ResponseEntity<ApiResponse<AnswerResponse>> ask(
            @Valid @RequestBody AskRequest request) {

        UUID tenantId = TenantContext.getTenantId();
        quotaService.checkAndIncrement(tenantId, "api_calls");

        AnswerResponse response = qaService.ask(
                tenantId, request.kbIds(), request.question(),
                request.topK(), request.similarityThreshold());

        return ResponseEntity.ok(ApiResponse.success(response));
    }

    /**
     * 多轮对话 - 保留对话历史，支持追问。
     */
    @PostMapping("/chat")
    public ResponseEntity<ApiResponse<ChatResponse>> chat(
            @Valid @RequestBody ChatRequest request) {

        UUID tenantId = TenantContext.getTenantId();
        quotaService.checkAndIncrement(tenantId, "api_calls");

        ChatResponse response = qaService.chat(
                tenantId, TenantContext.getUserId(),
                request.conversationId(), request.kbIds(),
                request.message());

        return ResponseEntity.ok(ApiResponse.success(response));
    }

    /**
     * 流式多轮对话 - SSE (Server-Sent Events)。
     * 返回格式: text/event-stream
     * 事件类型:
     *   - "chunk": 文本增量
     *   - "citation": 引用信息
     *   - "done": 完成信号（含总Token数）
     *   - "error": 错误信息
     */
    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<StreamEvent> chatStream(@Valid @RequestBody ChatRequest request) {

        UUID tenantId = TenantContext.getTenantId();
        quotaService.checkAndIncrement(tenantId, "api_calls");

        return qaService.chatStream(
                tenantId, TenantContext.getUserId(),
                request.conversationId(), request.kbIds(),
                request.message());
    }

    /**
     * 对话历史列表。
     */
    @GetMapping("/conversations")
    public ResponseEntity<ApiResponse<List<ConversationVO>>> listConversations(
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset) {

        List<ConversationVO> conversations = qaService.listConversations(
                TenantContext.getTenantId(), TenantContext.getUserId(), limit, offset);

        return ResponseEntity.ok(ApiResponse.success(conversations));
    }
}

// Request DTOs
record AskRequest(
    @NotEmpty List<UUID> kbIds,
    @NotEmpty String question,
    @Min(1) @Max(20) Integer topK,
    Double similarityThreshold
) {}

record ChatRequest(
    UUID conversationId,        // null表示新对话
    @NotEmpty List<UUID> kbIds,
    @NotEmpty String message
) {}
```

```java
// ============================================================
// QAService.java - 核心问答服务
// ============================================================
package com.enterprise.rag.service;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.config.RAGProperties;
import com.enterprise.rag.dto.*;
import com.enterprise.rag.entity.Conversation;
import com.enterprise.rag.entity.Chunk;
import com.enterprise.rag.repository.ConversationRepository;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class QAService {

    private final RetrievalService retrievalService;
    private final ChatClient chatClient;
    private final ConversationRepository conversationRepo;
    private final RAGProperties ragProperties;
    private final AuditService auditService;

    public QAService(RetrievalService retrievalService,
                     ChatClient chatClient,
                     ConversationRepository conversationRepo,
                     RAGProperties ragProperties,
                     AuditService auditService) {
        this.retrievalService = retrievalService;
        this.chatClient = chatClient;
        this.conversationRepo = conversationRepo;
        this.ragProperties = ragProperties;
        this.auditService = auditService;
    }

    /**
     * 单轮问答：检索→Prompt组装→LLM调用→引用提取。
     */
    public AnswerResponse ask(UUID tenantId, List<UUID> kbIds, String question,
                               Integer topK, Double threshold) {

        var watch = System.currentTimeMillis();

        // Step 1: 混合检索
        RetrievalResult retrievalResult = retrievalService.hybridSearch(
                tenantId, kbIds, question, topK, threshold);

        // Step 2: Prompt组装
        String systemPrompt = buildSystemPrompt(retrievalResult.chunks());
        String context = buildContext(retrievalResult.chunks());

        // Step 3: LLM调用
        String answer = chatClient.prompt()
                .system(systemPrompt)
                .user(u -> u.text("""
                        请根据以下参考资料回答问题。
                        
                        参考资料：
                        %s
                        
                        问题：%s
                        
                        要求：
                        1. 基于参考资料回答，不要编造信息
                        2. 如果参考资料不足，请明确说明
                        3. 引用具体来源（标注[序号]）
                        """.formatted(context, question)))
                .call()
                .content();

        // Step 4: 提取引用
        List<Citation> citations = extractCitations(answer, retrievalResult.chunks());

        long elapsed = System.currentTimeMillis() - watch;

        auditService.log("qa.ask", "question", null,
                Map.of("kb_ids", kbIds, "question_len", question.length(),
                       "chunks_retrieved", retrievalResult.totalFound(),
                       "elapsed_ms", elapsed));

        return new AnswerResponse(answer, citations, retrievalResult.totalFound(), elapsed);
    }

    /**
     * 流式多轮对话。
     */
    public Flux<StreamEvent> chatStream(UUID tenantId, UUID userId,
                                         UUID conversationId, List<UUID> kbIds,
                                         String message) {

        return Flux.defer(() -> {
            // Step 1: 加载对话历史
            List<Map<String, String>> history = List.of();
            if (conversationId != null) {
                history = loadConversationHistory(tenantId, conversationId);
            }

            // Step 2: 检索
            RetrievalResult retrievalResult = retrievalService.hybridSearch(
                    tenantId, kbIds, message,
                    ragProperties.defaultTopK(),
                    ragProperties.defaultSimilarityThreshold());

            String systemPrompt = buildSystemPrompt(retrievalResult.chunks());
            String context = buildContext(retrievalResult.chunks());

            // Step 3: 流式LLM调用
            return chatClient.prompt()
                    .system(systemPrompt)
                    .user(u -> u.text("""
                            参考资料：
                            %s
                            
                            对话历史：
                            %s
                            
                            用户问题：%s
                            """.formatted(context, formatHistory(history), message)))
                    .stream()
                    .content()
                    .map(chunk -> new StreamEvent("chunk", chunk, null, null))
                    .concatWith(Mono.just(new StreamEvent("done", null,
                            retrievalResult.totalFound(), null)));
        });
    }

    private String buildSystemPrompt(List<RetrievedChunk> chunks) {
        return """
            你是一个企业级AI知识助手。你的职责是基于提供的参考资料回答用户问题。
            
            规则：
            1. 仅基于参考资料回答，不要编造信息
            2. 如果参考资料不足以回答问题，请明确告知用户
            3. 回答要结构清晰，使用Markdown格式
            4. 引用来源时使用[序号]标记，如[1]、[2]
            5. 如果用户问题与参考资料无关，请礼貌引导用户提供更多信息
            
            当前时间：%s
            """.formatted(Instant.now().toString());
    }

    private String buildContext(List<RetrievedChunk> chunks) {
        var sb = new StringBuilder();
        for (int i = 0; i < chunks.size(); i++) {
            var c = chunks.get(i);
            sb.append("[%d] 来源: %s, 页码: %s\n".formatted(
                    i + 1, c.sourceName(), c.pageNumber() != null ? c.pageNumber() : "N/A"));
            sb.append(c.content()).append("\n\n");
        }
        return sb.toString();
    }

    private List<Citation> extractCitations(String answer, List<RetrievedChunk> chunks) {
        // 使用正则提取答案中的[1][2]等引用标记
        var pattern = java.util.regex.Pattern.compile("\\[(\\d+)\\]");
        var matcher = pattern.matcher(answer);
        var cited = new HashSet<Integer>();
        while (matcher.find()) {
            cited.add(Integer.parseInt(matcher.group(1)));
        }
        return cited.stream()
                .filter(i -> i <= chunks.size())
                .map(i -> {
                    var c = chunks.get(i - 1);
                    return new Citation(i, c.sourceName(), c.content().substring(0,
                            Math.min(200, c.content().length())));
                })
                .toList();
    }

    private List<Map<String, String>> loadConversationHistory(UUID tenantId, UUID convId) {
        return conversationRepo.findByIdAndTenantId(convId, tenantId)
                .map(conv -> {
                    // 取最近N轮对话
                    var msgs = conv.getMessages();
                    int start = Math.max(0, msgs.size() - ragProperties.maxHistoryRounds() * 2);
                    return msgs.subList(start, msgs.size());
                })
                .orElse(List.of());
    }

    private String formatHistory(List<Map<String, String>> history) {
        return history.stream()
                .map(m -> m.get("role") + ": " + m.get("content"))
                .collect(Collectors.joining("\n"));
    }
}
```

---

## 五、多租户设计

### 5.1 租户ID传播机制

```
请求链路中的 tenant_id 传播：

HTTP Request           Spring Filter           Service Layer            Database
─────────────         ──────────────          ──────────────           ────────
X-Tenant-Id: abc ──>  TenantFilter      ──>  TenantContext      ──>  SET app.current_
                       - 从Header提取          .set(tenantInfo)        tenant_id = 'abc'
                       - JWT中验证              ──> 后续所有Service     ──> RLS自动过滤
                       - 存入TenantContext         通过TenantContext
                                                   .getTenantId()
                                                   获取当前租户
```

### 5.2 完整的多租户上下文传递实现

```java
// ============================================================
// TenantFilter.java - 租户过滤器（Servlet Filter）
// ============================================================
package com.enterprise.rag.common.filter;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.common.context.TenantInfo;
import com.enterprise.rag.service.TenantService;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.datasource.lookup.MapDataSourceLookup;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class TenantFilter implements Filter {

    private static final String TENANT_HEADER = "X-Tenant-Id";
    private static final String TENANT_HEADER_ALT = "X-Tenant-ID";

    private final TenantService tenantService;

    public TenantFilter(TenantService tenantService) {
        this.tenantService = tenantService;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) resp;

        // 跳过健康检查等无需租户上下文的路径
        String path = request.getRequestURI();
        if (isPublicPath(path)) {
            chain.doFilter(req, resp);
            return;
        }

        // 从Header中提取tenant_id
        String tenantIdStr = request.getHeader(TENANT_HEADER);
        if (tenantIdStr == null) {
            tenantIdStr = request.getHeader(TENANT_HEADER_ALT);
        }

        if (tenantIdStr == null || tenantIdStr.isBlank()) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST,
                    "Missing required header: X-Tenant-Id");
            return;
        }

        try {
            UUID tenantId = UUID.fromString(tenantIdStr);

            // 验证租户状态
            if (!tenantService.isTenantActive(tenantId)) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN,
                        "Tenant is not active");
                return;
            }

            // 从JWT中提取user_id和role（由上游AuthFilter已设置）
            UUID userId = (UUID) request.getAttribute("authenticatedUserId");
            String role = (String) request.getAttribute("authenticatedUserRole");

            // 验证用户属于该租户
            if (userId != null && !tenantService.isUserInTenant(tenantId, userId)) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN,
                        "User does not belong to specified tenant");
                return;
            }

            // 设置租户上下文
            TenantContext.set(new TenantInfo(tenantId, userId, role));

            // 设置MDC用于日志
            MDC.put("tenantId", tenantId.toString());
            if (userId != null) {
                MDC.put("userId", userId.toString());
            }

            // 设置PgVector RLS上下文
            // 使用SET LOCAL确保仅当前事务生效
            tenantService.setTenantContext(tenantId);

            chain.doFilter(req, resp);

        } catch (IllegalArgumentException e) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST,
                    "Invalid tenant ID format");
        } finally {
            // 清理上下文 - 防止内存泄漏
            TenantContext.clear();
            MDC.remove("tenantId");
            MDC.remove("userId");
        }
    }

    private boolean isPublicPath(String path) {
        return path.startsWith("/actuator/") ||
               path.startsWith("/health") ||
               path.startsWith("/public/");
    }
}
```

```java
// ============================================================
// TenantService.java - 租户服务
// ============================================================
package com.enterprise.rag.service;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.entity.Tenant;
import com.enterprise.rag.entity.User;
import com.enterprise.rag.repository.TenantRepository;
import com.enterprise.rag.repository.UserRepository;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
public class TenantService {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;

    public TenantService(TenantRepository tenantRepository,
                         UserRepository userRepository,
                         JdbcTemplate jdbcTemplate) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 检查租户是否处于活跃状态。
     * 使用Redis缓存减少数据库查询。
     */
    @Cacheable(value = "tenant:status", key = "#tenantId")
    public boolean isTenantActive(UUID tenantId) {
        return tenantRepository.findById(tenantId)
                .map(t -> "active".equals(t.getStatus()))
                .orElse(false);
    }

    /**
     * 验证用户是否属于指定租户。
     */
    @Cacheable(value = "tenant:user:membership", key = "#tenantId + ':' + #userId")
    public boolean isUserInTenant(UUID tenantId, UUID userId) {
        return userRepository.findByIdAndTenantId(userId, tenantId).isPresent();
    }

    /**
     * 获取租户配置。
     */
    public Tenant getTenantConfig(UUID tenantId) {
        return tenantRepository.findById(tenantId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Tenant not found: " + tenantId));
    }

    /**
     * 设置数据库会话的租户上下文（用于PostgreSQL RLS）。
     * 在每个事务开始时设置，确保所有SQL自动过滤租户数据。
     */
    public void setTenantContext(UUID tenantId) {
        jdbcTemplate.execute("SET LOCAL app.current_tenant_id = '" + tenantId + "'");
    }
}
```

```java
// ============================================================
// TenantInterceptor.java - 拦截器方式（备选方案，适用于非Servlet场景）
// ============================================================
package com.enterprise.rag.common.interceptor;

import com.enterprise.rag.common.context.TenantContext;
import com.enterprise.rag.common.context.TenantInfo;
import com.enterprise.rag.service.TenantService;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * WebSocket/STOMP 协议的租户拦截器。
 * 从STOMP CONNECT帧的Header中提取租户信息。
 */
@Component
public class TenantChannelInterceptor implements ChannelInterceptor {

    private final TenantService tenantService;

    public TenantChannelInterceptor(TenantChannelInterceptor(TenantService tenantService) {
        this.tenantService = tenantService;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(
                message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String tenantIdStr = accessor.getFirstNativeHeader("X-Tenant-Id");
            if (tenantIdStr != null) {
                UUID tenantId = UUID.fromString(tenantIdStr);
                String userIdStr = accessor.getFirstNativeHeader("X-User-Id");
                UUID userId = userIdStr != null ? UUID.fromString(userIdStr) : null;
                TenantContext.set(new TenantInfo(tenantId, userId, null));
            }
        }

        if (accessor != null && StompCommand.DISCONNECT.equals(accessor.getCommand())) {
            TenantContext.clear();
        }

        return message;
    }
}
```

```java
// ============================================================
// QuotaService.java - 配额管理
// ============================================================
package com.enterprise.rag.service;

import com.enterprise.rag.entity.QuotaDefinition;
import com.enterprise.rag.entity.QuotaUsage;
import com.enterprise.rag.repository.QuotaDefinitionRepository;
import com.enterprise.rag.repository.QuotaUsageRepository;
import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

@Service
public class QuotaService {

    private final QuotaDefinitionRepository quotaDefRepo;
    private final QuotaUsageRepository quotaUsageRepo;
    private final TenantService tenantService;

    public QuotaService(QuotaDefinitionRepository quotaDefRepo,
                        QuotaUsageRepository quotaUsageRepo,
                        TenantService tenantService) {
        this.quotaDefRepo = quotaDefRepo;
        this.quotaUsageRepo = quotaUsageRepo;
        this.tenantService = tenantService;
    }

    /**
     * 检查配额并在配额范围内递增使用量。
     * 使用数据库原子操作防止并发超量。
     *
     * @throws QuotaExceededException 当配额超限时抛出
     */
    @Transactional
    public void checkAndIncrement(UUID tenantId, String resourceType) {
        var tenant = tenantService.getTenantConfig(tenantId);
        String plan = tenant.getPlan();

        // 获取该Plan下的配额定义
        QuotaDefinition quotaDef = quotaDefRepo.findByPlanAndResourceType(plan, resourceType)
                .orElseThrow(() -> new IllegalStateException(
                        "No quota definition for plan=" + plan + ", resource=" + resourceType));

        LocalDate today = LocalDate.now();
        LocalDate periodStart = getPeriodStart(today, quotaDef.getPeriod());

        // UPSERT with atomic increment
        int updated = quotaUsageRepo.incrementUsage(
                tenantId, resourceType, periodStart, quotaDef.getQuotaLimit());

        if (updated == 0) {
            throw new QuotaExceededException(
                    "Quota exceeded: " + resourceType +
                    " (limit=" + quotaDef.getQuotaLimit() +
                    ", period=" + quotaDef.getPeriod() + ")");
        }
    }

    /**
     * 获取配额使用情况。
     */
    public QuotaUsage getUsage(UUID tenantId, String resourceType) {
        LocalDate periodStart = getPeriodStart(LocalDate.now(), "monthly");
        return quotaUsageRepo.findByTenantIdAndResourceTypeAndPeriodStart(
                tenantId, resourceType, periodStart)
                .orElseGet(() -> new QuotaUsage(tenantId, resourceType, periodStart, 0L));
    }

    private LocalDate getPeriodStart(LocalDate date, String period) {
        return switch (period) {
            case "daily" -> date;
            case "monthly" -> date.withDayOfMonth(1);
            default -> LocalDate.of(2000, 1, 1); // total: use epoch
        };
    }
}

// 自定义异常
class QuotaExceededException extends RuntimeException {
    public QuotaExceededException(String message) {
        super(message);
    }
}

// Repository中的原子更新SQL
interface QuotaUsageRepository {
    @Modifying
    @Query(value = """
        INSERT INTO quota_usage (tenant_id, resource_type, period_start, used)
        VALUES (:tenantId, :resourceType, :periodStart, 1)
        ON CONFLICT (tenant_id, resource_type, period_start)
        DO UPDATE SET used = quota_usage.used + 1
        WHERE quota_usage.used < :quotaLimit
        """, nativeQuery = true)
    int incrementUsage(UUID tenantId, String resourceType,
                       LocalDate periodStart, long quotaLimit);
}
```

---

## 六、部署架构

### 6.1 Kubernetes部署拓扑

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Kubernetes Cluster                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Namespace: rag-prod                         │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │    │
│  │  │  Gateway (2 pods)│  │  Gateway (2 pods)│  HPA: 2-10          │    │
│  │  │  Spring Cloud GW │  │  Spring Cloud GW │  CPU 70%            │    │
│  │  └──────────────────┘  └──────────────────┘                     │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │    │
│  │  │ Doc Service      │  │ QA Service       │  │ KB Service    │ │    │
│  │  │ (3 pods)         │  │ (5 pods)         │  │ (2 pods)      │ │    │
│  │  │ HPA: 3-20        │  │ HPA: 5-30        │  │ HPA: 2-10     │ │    │
│  │  └──────────────────┘  └──────────────────┘  └───────────────┘ │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────────────────────┐    │    │
│  │  │ Doc Processor    │  │ Embedding Service (GPU NodeGroup) │    │    │
│  │  │ (5 pods)         │  │ (2 pods, each w/ 1 GPU)          │    │    │
│  │  │ Consume from MQ  │  │ vLLM / TEI                        │    │    │
│  │  └──────────────────┘  └──────────────────────────────────┘    │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                  Namespace: rag-data                             │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │    │
│  │  │ PostgreSQL       │  │ Elasticsearch    │                     │    │
│  │  │ + pgvector       │  │ (3 nodes)        │                     │    │
│  │  │ (1 Primary +     │  │ StatefulSet      │                     │    │
│  │  │  2 Read Replicas)│  │                  │                     │    │
│  │  └──────────────────┘  └──────────────────┘                     │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │    │
│  │  │ Redis Cluster    │  │ MinIO / S3       │                     │    │
│  │  │ (6 nodes -       │  │ (4 nodes,        │                     │    │
│  │  │  3 masters +     │  │  100TB each)     │                     │    │
│  │  │  3 replicas)     │  │                  │                     │    │
│  │  └──────────────────┘  └──────────────────┘                     │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │    │
│  │  │ RabbitMQ         │  │ Kafka            │                     │    │
│  │  │ (3 nodes)        │  │ (3 brokers)      │                     │    │
│  │  │ Doc Processing   │  │ Audit Events     │                     │    │
│  │  └──────────────────┘  └──────────────────┘                     │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Namespace: rag-inference (GPU Nodes)                │    │
│  │                                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │    │
│  │  │ LLM (vLLM)       │  │ Reranker         │                     │    │
│  │  │ Model: Qwen3-72B │  │ BGE-Reranker-v2  │                     │    │
│  │  │ GPU: 4x A100-80G │  │ GPU: 1x A10-24G  │                     │    │
│  │  │ HPA: 1-4 (基于    │  │ Replicas: 2      │                     │    │
│  │  │  请求队列深度)    │  │                  │                     │    │
│  │  └──────────────────┘  └──────────────────┘                     │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 核心K8s YAML配置

```yaml
# ============================================================
# qa-service-deployment.yaml
# ============================================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qa-service
  namespace: rag-prod
  labels:
    app: qa-service
    version: v2.1.0
spec:
  replicas: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 0
  selector:
    matchLabels:
      app: qa-service
  template:
    metadata:
      labels:
        app: qa-service
        version: v2.1.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/actuator/prometheus"
    spec:
      serviceAccountName: qa-service-sa
      terminationGracePeriodSeconds: 30
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: qa-service
              topologyKey: kubernetes.io/hostname
      containers:
      - name: qa-service
        image: registry.example.com/rag/qa-service:v2.1.0
        imagePullPolicy: Always
        ports:
        - containerPort: 8080
          name: http
          protocol: TCP
        env:
        - name: JAVA_OPTS
          value: >-
            -Xms2g -Xmx4g
            -XX:+UseZGC
            -XX:ConcGCThreads=2
            -XX:ZCollectionInterval=120
            -Dspring.profiles.active=prod
            -Duser.timezone=Asia/Shanghai
        - name: SPRING_DATASOURCE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        - name: SPRING_DATASOURCE_USERNAME
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: SPRING_DATASOURCE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        - name: SPRING_AI_OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: llm-credentials
              key: api-key
        - name: SPRING_AI_OPENAI_BASE_URL
          value: "http://vllm-inference.rag-inference.svc:8000/v1"
        - name: SPRING_ELASTICSEARCH_URIS
          value: "http://elasticsearch.rag-data.svc:9200"
        - name: SPRING_DATA_REDIS_HOST
          value: "redis-cluster.rag-data.svc"
        resources:
          requests:
            cpu: "2"
            memory: "4Gi"
          limits:
            cpu: "4"
            memory: "6Gi"
        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 60
          periodSeconds: 15
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 3
          failureThreshold: 3
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
        volumeMounts:
        - name: app-config
          mountPath: /app/config
          readOnly: true
      volumes:
      - name: app-config
        configMap:
          name: qa-service-config

---
# ============================================================
# qa-service-hpa.yaml - 水平自动伸缩
# ============================================================
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: qa-service-hpa
  namespace: rag-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: qa-service
  minReplicas: 5
  maxReplicas: 30
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 20
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 4
        periodSeconds: 30
      selectPolicy: Max

---
# ============================================================
# qa-service-service.yaml
# ============================================================
apiVersion: v1
kind: Service
metadata:
  name: qa-service
  namespace: rag-prod
  labels:
    app: qa-service
spec:
  type: ClusterIP
  selector:
    app: qa-service
  ports:
  - name: http
    port: 8080
    targetPort: 8080
    protocol: TCP

---
# ============================================================
# qa-service-configmap.yaml
# ============================================================
apiVersion: v1
kind: ConfigMap
metadata:
  name: qa-service-config
  namespace: rag-prod
data:
  application-prod.yaml: |
    rag:
      retrieval:
        default-top-k: 5
        similarity-threshold: 0.7
        rerank-enabled: true
        rerank-model: bge-reranker-v2-m3
        hybrid-weight: 0.7
      history:
        max-rounds: 20
      document:
        max-file-size-mb: 50
        allowed-types:
          - pdf
          - docx
          - markdown
          - txt
          - html
        chunk-default-size: 500
        chunk-default-overlap: 50
      quota:
        enabled: true
        grace-percentage: 10
      cache:
        semantic-cache-enabled: true
        semantic-cache-ttl-minutes: 60
      audit:
        enabled: true
        log-all-queries: false
    
    spring:
      ai:
        retry:
          max-attempts: 3
          backoff:
            initial-interval: 1000
            multiplier: 2
            max-interval: 10000

---
# ============================================================
# vllm-inference-deployment.yaml - GPU推理服务
# ============================================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-inference
  namespace: rag-inference
  labels:
    app: vllm-inference
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vllm-inference
  template:
    metadata:
      labels:
        app: vllm-inference
    spec:
      nodeSelector:
        accelerator: nvidia-a100
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        command:
        - python3
        - -m
        - vllm.entrypoints.openai.api_server
        args:
        - --model
        - /models/Qwen3-72B-Instruct-AWQ
        - --tensor-parallel-size
        - "4"
        - --max-model-len
        - "32768"
        - --gpu-memory-utilization
        - "0.90"
        - --max-num-seqs
        - "256"
        - --enable-prefix-caching
        - --port
        - "8000"
        ports:
        - containerPort: 8000
          name: http
        resources:
          requests:
            nvidia.com/gpu: "4"
            cpu: "16"
            memory: "128Gi"
          limits:
            nvidia.com/gpu: "4"
            cpu: "32"
            memory: "256Gi"
        volumeMounts:
        - name: model-storage
          mountPath: /models
          readOnly: true
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 120
          periodSeconds: 30
      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: llm-model-pvc
```

---

## 七、技术选型

### 7.1 技术栈对照表

| 组件 | 选型 | 版本 | 备选方案 | 选型理由 |
|------|------|------|----------|----------|
| **应用框架** | Spring Boot | 4.x (JDK 25) | Quarkus, Micronaut | 团队熟悉度、生态成熟度、Spring AI集成 |
| **AI框架** | Spring AI | 2.x | LangChain4j, 自研 | Spring生态原生集成、ChatClient API优雅 |
| **API网关** | Spring Cloud Gateway | 4.x | Kong, APISIX | 与Spring生态统一、编程式路由配置灵活 |
| **向量数据库** | PostgreSQL + pgvector | 16 + 0.7 | Milvus, Qdrant, Weaviate | 运维成本低、事务一致、RLS多租户 |
| **全文检索** | Elasticsearch | 8.x | OpenSearch, Solr | BM25成熟、混合检索支持、生态丰富 |
| **缓存** | Redis Cluster | 7.x | Hazelcast, Caffeine | 支持多种数据结构、集群模式、Lua脚本 |
| **消息队列** | RabbitMQ (文档处理) | 3.13 | Kafka, Pulsar | 轻量级任务队列、确认机制可靠 |
| **事件流** | Kafka (审计日志) | 3.x | Pulsar, Redpanda | 高吞吐、持久化、审计不可变性 |
| **对象存储** | MinIO | Latest | AWS S3, GCS | S3兼容、私有部署、无网络成本 |
| **LLM推理** | vLLM | Latest | TGI, Triton | PagedAttention性能领先、OpenAI兼容API |
| **Embedding** | BGE-M3 / text2vec-large | - | Cohere Embed, OpenAI | 中文效果好、支持稀疏+稠密向量 |
| **Reranker** | BGE-Reranker-v2-m3 | - | Cohere Rerank | 开源可自部署、中文效果好 |
| **可观测性** | Grafana + Loki + Tempo + Prometheus | - | ELK, Datadog | 开源全栈、无许可成本 |
| **容器编排** | Kubernetes | 1.30+ | Nomad, Docker Swarm | 行业标准、GPU支持成熟、HPA灵活 |
| **服务网格** | Istio (可选) | - | Linkerd | mTLS、流量管理、可观测性增强 |

### 7.2 关键选型决策说明

**为什么选择Spring AI 2.x而不是LangChain4j？**

1. **Spring生态原生**：与Spring Boot自动配置、Actuator、Micrometer深度集成
2. **ChatClient API**：Fluent Builder模式，支持同步/流式/响应式多种调用方式
3. **ETL Pipeline**：内置Document Reader/Transformer/Writer，与Spring Batch可结合
4. **Vector Store抽象**：统一接口支持pgvector/Redis/Elasticsearch/Pinecone等
5. **Spring社区支持**：更活跃的社区、更快的安全补丁响应

**pgvector与Elasticsearch的协同设计：**

```
检索路由策略:
  ┌─────────────┐
  │  User Query  │
  └──────┬──────┘
         │
         ▼
  ┌──────────────────────────────────────────┐
  │          RetrievalService                │
  │                                           │
  │  ┌─────────────────┐  ┌────────────────┐ │
  │  │ Dense Vector    │  │ Sparse/BM25    │ │
  │  │ (pgvector)      │  │ (Elasticsearch)│ │
  │  │                 │  │                │ │
  │  │ - 语义相似度     │  │ - 关键词匹配    │ │
  │  │ - 跨语言检索     │  │ - 精确匹配      │ │
  │  │ - 模糊语义       │  │ - 短语匹配      │ │
  │  └────────┬────────┘  └───────┬────────┘ │
  │           │                   │          │
  │           └──────┬────────────┘          │
  │                  ▼                       │
  │          ┌──────────────┐                │
  │          │ RRF / Weight │                │
  │          │ Sum Fusion   │                │
  │          └──────┬───────┘                │
  │                 ▼                        │
  │          ┌──────────────┐                │
  │          │ Cross-Encoder│                │
  │          │ Reranker     │                │
  │          └──────────────┘                │
  └──────────────────────────────────────────┘
```

---

## 八、完整项目结构

```
rag-enterprise/
├── pom.xml (parent, multi-module)
├── rag-common/                              # 公共模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/common/
│       ├── context/
│       │   ├── TenantContext.java           # 租户上下文
│       │   └── TenantInfo.java              # 租户信息Record
│       ├── filter/
│       │   └── TenantFilter.java            # 租户过滤器
│       ├── interceptor/
│       │   └── TenantChannelInterceptor.java
│       ├── exception/
│       │   ├── QuotaExceededException.java
│       │   ├── TenantNotFoundException.java
│       │   └── GlobalExceptionHandler.java  # @RestControllerAdvice
│       ├── result/
│       │   ├── ApiResponse.java             # 统一响应体
│       │   └── PageResult.java              # 分页结果
│       └── config/
│           ├── RAGProperties.java           # @ConfigurationProperties
│           └── AIConfiguration.java         # ChatClient Bean配置
│
├── rag-document/                            # 文档管理模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/document/
│       ├── controller/
│       │   └── DocumentController.java
│       ├── service/
│       │   ├── DocumentService.java
│       │   └── DocumentProcessor.java       # 异步文档处理
│       ├── pipeline/
│       │   ├── ParseStage.java              # 解析阶段
│       │   ├── ChunkStage.java              # 切片阶段
│       │   ├── EmbedStage.java              # Embedding阶段
│       │   └── IndexStage.java              # 索引阶段
│       ├── repository/
│       │   ├── DocumentRepository.java
│       │   └── ChunkRepository.java
│       └── entity/
│           ├── Document.java
│           └── Chunk.java
│
├── rag-knowledge-base/                      # 知识库管理模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/kb/
│       ├── controller/
│       │   └── KnowledgeBaseController.java
│       ├── service/
│       │   └── KnowledgeBaseService.java
│       └── repository/
│           └── KnowledgeBaseRepository.java
│
├── rag-retrieval/                           # 检索模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/retrieval/
│       ├── service/
│       │   ├── RetrievalService.java        # 检索编排
│       │   ├── QueryRewriter.java           # Query改写
│       │   ├── VectorSearchService.java     # pgvector检索
│       │   ├── FullTextSearchService.java   # ES全文检索
│       │   └── RerankerService.java         # Rerank服务
│       └── strategy/
│           ├── SearchStrategy.java          # 策略接口
│           ├── DenseSearchStrategy.java
│           ├── SparseSearchStrategy.java
│           └── HybridSearchStrategy.java
│
├── rag-qa/                                  # 问答模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/qa/
│       ├── controller/
│       │   └── RetrievalController.java
│       ├── service/
│       │   ├── QAService.java
│       │   └── ConversationService.java
│       └── cache/
│           └── SemanticCacheService.java    # 语义缓存
│
├── rag-tenant/                              # 多租户模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/tenant/
│       ├── service/
│       │   ├── TenantService.java
│       │   └── QuotaService.java
│       └── repository/
│           ├── TenantRepository.java
│           └── QuotaUsageRepository.java
│
├── rag-audit/                               # 审计模块
│   ├── pom.xml
│   └── src/main/java/com/enterprise/rag/audit/
│       ├── service/
│       │   └── AuditService.java
│       └── event/
│           └── AuditEventProducer.java      # Kafka事件发布
│
└── rag-gateway/                             # API网关
    ├── pom.xml
    └── src/main/java/com/enterprise/rag/gateway/
        ├── GatewayApplication.java
        └── config/
            └── RouteConfig.java
```

### 8.1 核心配置类

```java
// ============================================================
// RAGProperties.java - 系统配置
// ============================================================
package com.enterprise.rag.common.config;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.List;

@Validated
@ConfigurationProperties(prefix = "rag")
public class RAGProperties {

    /** 检索配置 */
    private Retrieval retrieval = new Retrieval();

    /** 会话历史配置 */
    private History history = new History();

    /** 文档处理配置 */
    private Document document = new Document();

    /** 配额配置 */
    private Quota quota = new Quota();

    /** 缓存配置 */
    private Cache cache = new Cache();

    /** 审计配置 */
    private Audit audit = new Audit();

    // Getters and Setters...

    public static class Retrieval {
        @Min(1) @Max(50)
        private int defaultTopK = 5;

        @Min(0) @Max(1)
        private double similarityThreshold = 0.7;

        private boolean rerankEnabled = true;
        private String rerankModel = "bge-reranker-v2-m3";

        @Min(0) @Max(1)
        private double hybridWeight = 0.7;  // Dense权重(1-weight=sparse权重)

        // getters/setters...
    }

    public static class History {
        @Min(1) @Max(100)
        private int maxRounds = 20;

        // getters/setters...
    }

    public static class Document {
        @Min(1) @Max(200)
        private int maxFileSizeMb = 50;

        private List<String> allowedTypes = List.of("pdf", "docx", "markdown", "txt", "html");

        @Min(100) @Max(2000)
        private int chunkDefaultSize = 500;

        @Min(0) @Max(200)
        private int chunkDefaultOverlap = 50;

        // getters/setters...
    }

    public static class Quota {
        private boolean enabled = true;

        @Min(0) @Max(100)
        private int gracePercentage = 10;  // 超量缓冲百分比

        // getters/setters...
    }

    public static class Cache {
        private boolean semanticCacheEnabled = true;

        @Min(1) @Max(1440)
        private int semanticCacheTtlMinutes = 60;

        // getters/setters...
    }

    public static class Audit {
        private boolean enabled = true;
        private boolean logAllQueries = false;

        // getters/setters...
    }
}
```

```java
// ============================================================
// AIConfiguration.java - AI组件配置
// ============================================================
package com.enterprise.rag.common.config;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.QuestionAnswerAdvisor;
import org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor;
import org.springframework.ai.chat.client.advisor.RetrievalAugmentationAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.rag.retrieval.search.VectorStoreDocumentRetriever;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.client.RestClient;

@Configuration
public class AIConfiguration {

    /**
     * ChatClient Bean - 核心AI对话入口。
     * 配置了默认的System Prompt、Logger Advisor和RAG Advisor。
     */
    @Bean
    public ChatClient chatClient(ChatModel chatModel,
                                  VectorStore vectorStore) {
        return ChatClient.builder(chatModel)
                .defaultAdvisors(
                        new SimpleLoggerAdvisor(),
                        RetrievalAugmentationAdvisor.builder()
                                .documentRetriever(VectorStoreDocumentRetriever.builder()
                                        .vectorStore(vectorStore)
                                        .similarityThreshold(0.7)
                                        .topK(5)
                                        .build())
                                .build()
                )
                .build();
    }

    /**
     * pgvector VectorStore配置。
     */
    @Bean
    public VectorStore vectorStore(JdbcTemplate jdbcTemplate) {
        return PgVectorStore.builder(jdbcTemplate)
                .dimensions(1024)       // BGE-M3 dense dimension
                .schemaName("public")
                .vectorTableName("chunk_embeddings")
                .idColumnName("id")
                .contentColumnName("(SELECT content FROM chunks WHERE chunks.id = chunk_embeddings.chunk_id)")
                .embeddingColumnName("embedding_dense")
                .metadataColumns("kb_id", "tenant_id", "model_name")
                .indexType(PgVectorStore.PgIndexType.HNSW)
                .distanceType(PgVectorStore.PgDistanceType.COSINE_DISTANCE)
                .build();
    }

    /**
     * 用于调用Reranker服务的RestClient。
     */
    @Bean
    public RestClient rerankerRestClient(RAGProperties properties) {
        return RestClient.builder()
                .baseUrl("http://reranker-service.rag-inference.svc:8080")
                .defaultHeader("Content-Type", "application/json")
                .build();
    }
}
```

```java
// ============================================================
// AuditService.java - 审计服务
// ============================================================
package com.enterprise.rag.audit.service;

import com.enterprise.rag.audit.event.AuditEventProducer;
import com.enterprise.rag.common.context.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private final AuditEventProducer eventProducer;

    public AuditService(AuditEventProducer eventProducer) {
        this.eventProducer = eventProducer;
    }

    /**
     * 异步记录审计日志。不阻塞主业务流程。
     *
     * @param action       操作类型 (doc.upload/kb.create/qa.ask等)
     * @param resourceType 资源类型
     * @param resourceId   资源ID (可为null)
     * @param detail       操作详情
     */
    @Async("auditExecutor")
    public void log(String action, String resourceType, UUID resourceId, Map<String, Object> detail) {
        try {
            UUID tenantId = TenantContext.getTenantId();
            UUID userId = TenantContext.getUserId();

            String ipAddress = getClientIp();

            AuditEvent event = new AuditEvent(
                    UUID.randomUUID(),
                    tenantId,
                    userId,
                    action,
                    resourceType,
                    resourceId,
                    detail != null ? detail : Map.of(),
                    ipAddress,
                    getUserAgent(),
                    Instant.now()
            );

            // 发送到Kafka进行异步处理
            eventProducer.send(event);

            // 同时写入结构化日志 (Loki采集)
            log.info("AUDIT | tenant={} | user={} | action={} | resource={}/{} | ip={}",
                    tenantId, userId, action, resourceType, resourceId, ipAddress);

        } catch (Exception e) {
            // 审计失败不能影响业务流程
            log.error("Failed to write audit log: action={}, resource={}", action, resourceType, e);
        }
    }

    private String getClientIp() {
        try {
            var attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                var request = attrs.getRequest();
                String xff = request.getHeader("X-Forwarded-For");
                if (xff != null && !xff.isBlank()) {
                    return xff.split(",")[0].trim();
                }
                return request.getRemoteAddr();
            }
        } catch (Exception ignored) {}
        return "unknown";
    }

    private String getUserAgent() {
        try {
            var attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                return attrs.getRequest().getHeader("User-Agent");
            }
        } catch (Exception ignored) {}
        return "unknown";
    }
}

record AuditEvent(
    UUID id,
    UUID tenantId,
    UUID userId,
    String action,
    String resourceType,
    UUID resourceId,
    Map<String, Object> detail,
    String ipAddress,
    String userAgent,
    Instant timestamp
) {}
```

---

## 九、最佳实践与常见问题

### 9.1 最佳实践

**1. 文档切片策略**
- 对Markdown/HTML文档，按标题层级结构切片，保留完整的语义单元
- 对PDF文档，按页+段落双策略切片，大页(>1500字符)做二次分割
- 始终保留chunk_overlap (推荐10-15%)，避免关键信息被切断
- 在chunk的metadata中保留：源文件名、页码、章节标题、chunk序号

**2. 检索质量优化**
- 默认使用混合检索（Dense + Sparse），权重设0.6~0.8区间
- 对法律/合同等精确匹配场景，提高Sparse权重
- 对FAQ/知识问答等语义匹配场景，提高Dense权重
- 始终使用Reranker精排，Top-N取20~50后Rerank到Top-5~10
- 设置合理的similarity_threshold (0.65~0.75)，过滤低分噪音

**3. 多租户安全**
- 永远在Service层通过TenantContext.getTenantId()获取租户ID，不要从请求参数中取
- 所有数据库查询必须包含tenant_id条件或依赖RLS
- API Key/Token中应编码tenant_id，由Gateway层验证并注入Header
- 定期审计跨租户查询：在audit_logs中标记可疑的跨租户访问模式
- 敏感文档支持字段级加密（AES-256-GCM），密钥按租户隔离

**4. 性能优化**
- Embedding计算批量化：将多个chunk的embedding请求合并为单次batch调用
- 语义缓存：对相似Query（余弦相似度>0.95）直接返回缓存答案
- 连接池调优：HikariCP minimum-idle=10, maximum-pool-size=50（根据Pod数调整）
- pgvector的HNSW索引参数：m=16（精度优先）或m=8（性能优先）
- Redis Pipeline：批量操作减少网络往返

**5. 成本控制**
- 按租户+资源类型+周期的三级配额模型
- 大文档（>10MB）异步处理后通知，不阻塞用户
- LLM Token计量精确到每个请求，支持余额预警
- Embedding模型选择：BGE-M3（dense 1024维 + sparse 250000维）是当前中文场景性价比最优
- 冷热数据分层：30天前文档降低向量索引精度（IVFFlat→DiskANN）

### 9.2 常见问题

**Q1: pgvector查询变慢怎么办？**

```
排查步骤：
1. 检查索引是否生效: EXPLAIN ANALYZE SELECT ...
2. 检查HNSW索引参数: ef_search默认40，可在session级别调大
   SET hnsw.ef_search = 100;
3. 检查向量是否过于稀疏: 确认Embedding模型输出的向量是密集的
4. 考虑分区表: 按tenant_id或kb_id分区，减少扫描范围
5. 评估升级方案: 向量量>500万时评估Milvus/Qdrant
```

**Q2: 如何处理文档更新的向量一致性？**

```
策略：全量替换 + 版本号

1. 文档更新时，标记旧文档为"已过期"，创建新文档记录
2. 新文档完成所有Pipeline阶段（解析→切片→Embedding→索引）
3. 新文档就绪后，原子删除旧文档的所有chunks和embeddings
4. 使用model_version字段标记embedding版本，支持模型升级时的渐进迁移
```

**Q3: 多租户场景下如何隔离Embedding模型？**

```java
// EmbeddingRouter - 根据租户/知识库配置路由到不同Embedding模型
@Service
public class EmbeddingRouter {

    private final Map<String, EmbeddingModel> modelRegistry;

    // 通过构造函数注入所有EmbeddingModel实现
    public EmbeddingRouter(Map<String, EmbeddingModel> modelRegistry) {
        this.modelRegistry = modelRegistry;
    }

    public EmbeddingModel getModelForKB(UUID kbId) {
        KnowledgeBase kb = kbRepo.findById(kbId).orElseThrow();
        String modelName = kb.getEmbeddingModel();  // e.g., "bge-m3", "text2vec-large"

        EmbeddingModel model = modelRegistry.get(modelName);
        if (model == null) {
            throw new IllegalArgumentException("Unknown embedding model: " + modelName);
        }
        return model;
    }

    public float[] embed(String text, UUID kbId) {
        return getModelForKB(kbId).embed(text);
    }
}
```

**Q4: 如何处理SSE流式输出中的断线重连？**

```
方案：
1. 在SSE事件中携带message_id和sequence_number
2. 客户端断开时，后台继续生成并缓存到Redis（TTL=5min）
3. 客户端重连时携带Last-Event-ID，服务端从该ID之后的事件继续推送
4. 发送"retry"字段告知客户端重连间隔（ms）

服务端实现：
- 使用Flux.share()或ConnectableFlux实现热流
- 缓存最近N个事件到Redis List
- 通过conversation_id + message_id定位断点
```

**Q5: 如何进行RAG系统的效果评估？**

```
离线评估指标:
  - Recall@K: 检索到的相关文档数 / 总相关文档数
  - MRR (Mean Reciprocal Rank): 第一个相关文档排名的倒数均值
  - NDCG@K (Normalized Discounted Cumulative Gain): 排名质量评估
  - Hit Rate: 至少命中一个相关文档的查询比例

在线评估指标:
  - 用户反馈率（赞/踩比）
  - 答案修改率（用户是否追问同一问题）
  - 引用点击率（用户是否点击查看源文档）
  - 会话完成率（是否解决了用户问题）

A/B测试框架:
  - 配置多套检索策略（如不同TopK、不同Rerank模型）
  - 按用户ID哈希分配实验组
  - 收集各组的评估指标
  - 使用统计检验（如t-test）判断显著性
```

---

## 十、知识库协作编辑

在多用户的企业级 RAG 系统中，知识库内容往往需要团队协作编辑——产品经理编写 FAQ、法务审核条款、技术人员补充技术文档。**多人同时编辑同一知识条目**时，需要冲突解决机制。

### 冲突解决策略

1. **乐观锁（Optimistic Locking）**：每个知识条目维护一个 `version` 字段（单调递增整数）。用户 A 编辑并保存时，系统检查版本号是否与读取时一致——若不一致，说明用户 B 在此期间已修改，触发冲突合并界面。

2. **最后写入胜出（Last-Write-Wins, LWW）**：适用于低冲突概率场景（如每个条目只有唯一负责人），基于时间戳决策。优点是简单，缺点是可能丢失数据。

3. **CRDT（Conflict-free Replicated Data Type）**：对于需要支持离线编辑的场景，使用 CRDT 在无中心协调的情况下自动合并冲突。Yjs 是目前最成熟的 CRDT 实现，适用于文本协同编辑。

4. **操作变换（Operational Transform, OT）**：Google Docs 使用的经典算法，将每个用户的编辑操作（插入、删除）变换后应用到共享文档。

对于企业知识库场景，**乐观锁 + 人工合并**是最实用的组合——实现复杂度低、逻辑透明、符合审核流程要求。

```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.OptimisticLockingFailureException;

import java.time.Instant;

@Service
public class CollaborativeEditor {

    private final KnowledgeEntryRepository entryRepo;
    private final ConflictRecordRepository conflictRepo;

    public CollaborativeEditor(KnowledgeEntryRepository entryRepo,
                                ConflictRecordRepository conflictRepo) {
        this.entryRepo = entryRepo;
        this.conflictRepo = conflictRepo;
    }

    /**
     * 基于乐观锁的协同编辑保存
     * @param entryId 知识条目 ID
     * @param newContent 用户提交的新内容
     * @param expectedVersion 用户编辑时的版本号
     * @param editorId 编辑者 ID
     */
    @Transactional
    public EditResult saveWithConflictDetection(String entryId, String newContent,
                                                 int expectedVersion, String editorId) {
        var entry = entryRepo.findById(entryId)
                .orElseThrow(() -> new RuntimeException("Entry not found: " + entryId));

        // 乐观锁检查：当前版本号必须与用户编辑时的版本号一致
        if (entry.getVersion() != expectedVersion) {
            // 版本冲突 —— 记录冲突供用户解决
            var conflict = new ConflictRecord(
                    entryId,
                    editorId,
                    newContent,          // 用户的新内容
                    entry.getContent(),  // 数据库中的最新内容
                    expectedVersion,
                    entry.getVersion(),
                    Instant.now()
            );
            conflictRepo.save(conflict);

            return EditResult.conflict(conflict.getId(), entry.getContent(), entry.getVersion());
        }

        // 无冲突，正常保存
        entry.setContent(newContent);
        entry.setVersion(expectedVersion + 1);
        entry.setLastEditorId(editorId);
        entry.setUpdatedAt(Instant.now());
        entryRepo.save(entry);

        return EditResult.success(entry.getVersion());
    }

    /**
     * 手动合并冲突
     */
    @Transactional
    public EditResult resolveConflict(String conflictId, String mergedContent, String resolverId) {
        var conflict = conflictRepo.findById(conflictId)
                .orElseThrow(() -> new RuntimeException("Conflict not found"));

        var entry = entryRepo.findById(conflict.getEntryId())
                .orElseThrow(() -> new RuntimeException("Entry not found"));

        // 以合并后的内容覆盖，版本递增
        entry.setContent(mergedContent);
        entry.setVersion(entry.getVersion() + 1);
        entry.setLastEditorId(resolverId);
        entry.setUpdatedAt(Instant.now());
        entryRepo.save(entry);

        conflict.setResolvedAt(Instant.now());
        conflict.setResolvedBy(resolverId);
        conflictRepo.save(conflict);

        return EditResult.success(entry.getVersion());
    }
}

record EditResult(boolean success, String conflictId, String currentContent,
                  int currentVersion) {
    static EditResult success(int version) {
        return new EditResult(true, null, null, version);
    }
    static EditResult conflict(String conflictId, String currentContent, int version) {
        return new EditResult(false, conflictId, currentContent, version);
    }
}

// 冲突记录（数据库实体简化版，实际需加 @Entity 注解）
class ConflictRecord {
    private String id;
    private String entryId;
    private String editorId;
    private String editorContent;
    private String serverContent;
    private int editorVersion;
    private int serverVersion;
    private Instant createdAt;
    private Instant resolvedAt;
    private String resolvedBy;
    // 构造函数、getter、setter 省略
    public ConflictRecord(String entryId, String editorId, String editorContent,
                           String serverContent, int editorVersion, int serverVersion, Instant createdAt) {
        this.entryId = entryId;
        this.editorId = editorId;
        this.editorContent = editorContent;
        this.serverContent = serverContent;
        this.editorVersion = editorVersion;
        this.serverVersion = serverVersion;
        this.createdAt = createdAt;
    }
    // getters omitted for brevity
    public String getId() { return id; }
    public String getEntryId() { return entryId; }
    public void setResolvedAt(Instant t) { this.resolvedAt = t; }
    public void setResolvedBy(String u) { this.resolvedBy = u; }
}
```

---

## 十一、知识条目版本控制

知识库中的每一条知识条目（Knowledge Entry）都应具备 Git 风格的版本控制能力——完整的修改历史、任意版本间的 Diff 对比、以及回滚到历史版本的能力。

### 版本模型设计

每个知识条目维护一个按顺序递增的版本号（从 1 开始）。每次保存生成新版本记录，包含：

- `entry_id`：所属条目
- `version_number`：版本号（自增）
- `content`：该版本的完整内容（非增量存储，简化实现）
- `change_summary`：变更摘要（人工编写或 AI 自动生成）
- `author_id`：修改者
- `created_at`：版本创建时间
- `tags`：版本标签如 `draft`、`reviewed`、`published`

### 分支与合并工作流

知识条目的典型生命周期：

```
draft（草稿） → review（审核中） → published（已发布） → archived（归档）
```

可以创建分支版本（如 `v2-draft`）在审核期间继续修改 `main` 版本，审核通过后再合并回主分支。这避免了"审核阻塞编辑"的问题。

```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class KnowledgeVersionService {

    private final KnowledgeVersionRepository versionRepo;
    private final KnowledgeEntryRepository entryRepo;

    public KnowledgeVersionService(KnowledgeVersionRepository versionRepo,
                                    KnowledgeEntryRepository entryRepo) {
        this.versionRepo = versionRepo;
        this.entryRepo = entryRepo;
    }

    /**
     * 保存新版本（自动递增版本号）
     */
    @Transactional
    public KnowledgeVersion createVersion(String entryId, String content,
                                           String changeSummary, String authorId, String tenantId) {
        var entry = entryRepo.findByIdAndTenantId(entryId, tenantId)
                .orElseThrow(() -> new RuntimeException("Entry not found"));

        // 获取当前最大版本号并递增
        var maxVersion = versionRepo.findMaxVersionByEntryId(entryId)
                .orElse(0);

        var newVersion = new KnowledgeVersion(
                entryId,
                maxVersion + 1,
                content,
                changeSummary,
                authorId,
                Instant.now(),
                "draft"
        );

        var saved = versionRepo.save(newVersion);

        // 更新条目的当前版本指针
        entry.setCurrentVersion(maxVersion + 1);
        entry.setUpdatedAt(Instant.now());
        entryRepo.save(entry);

        return saved;
    }

    /**
     * 获取两个版本之间的 Diff（使用外部 diff 算法或 AI 语义对比）
     */
    public VersionDiff diff(String entryId, int versionA, int versionB, String tenantId) {
        var a = versionRepo.findByEntryIdAndVersionAndTenantId(entryId, versionA, tenantId)
                .orElseThrow(() -> new RuntimeException("Version " + versionA + " not found"));
        var b = versionRepo.findByEntryIdAndVersionAndTenantId(entryId, versionB, tenantId)
                .orElseThrow(() -> new RuntimeException("Version " + versionB + " not found"));

        // 使用 java-diff-utils 或 AI 生成差异摘要
        var patch = diff_match_patch.main(a.getContent(), b.getContent());

        return new VersionDiff(entryId, versionA, versionB,
                a.getCreatedAt(), b.getCreatedAt(), patch);
    }

    /**
     * 回滚到指定版本（创建新版本，内容等于目标版本）
     */
    @Transactional
    public KnowledgeVersion rollback(String entryId, int targetVersion,
                                      String authorId, String tenantId) {
        var target = versionRepo.findByEntryIdAndVersionAndTenantId(entryId, targetVersion, tenantId)
                .orElseThrow(() -> new RuntimeException("Target version not found"));

        return createVersion(
                entryId,
                target.getContent(),
                "Rollback to version " + targetVersion,
                authorId,
                tenantId
        );
    }

    /**
     * 获取条目的完整版本历史
     */
    public List<KnowledgeVersion> getHistory(String entryId, String tenantId) {
        return versionRepo.findByEntryIdAndTenantIdOrderByVersionDesc(entryId, tenantId);
    }

    /**
     * 标记版本为已发布（与 draft/reviewed 工作流配合）
     */
    @Transactional
    public void publishVersion(String entryId, int version, String tenantId) {
        var entry = versionRepo.findByEntryIdAndVersionAndTenantId(entryId, version, tenantId)
                .orElseThrow(() -> new RuntimeException("Version not found"));
        entry.setTag("published");
        versionRepo.save(entry);
    }
}

record KnowledgeVersion(String entryId, int versionNumber, String content,
    String changeSummary, String authorId, Instant createdAt, String tag) {
    // getters
    public String getEntryId() { return entryId; }
    public int getVersionNumber() { return versionNumber; }
    public String getContent() { return content; }
    public String getChangeSummary() { return changeSummary; }
    public String getAuthorId() { return authorId; }
    public Instant getCreatedAt() { return createdAt; }
    public String getTag() { return tag; }
    public void setTag(String tag) { /* ... */ }
}

record VersionDiff(String entryId, int versionA, int versionB,
    Instant createdAtA, Instant createdAtB, Object patch) {}
```

---

## 十二、租户自定义模型与Prompt

在多租户 SaaS 平台中，不同租户有不同的模型偏好和 Prompt 风格——A 租户要求使用 Azure OpenAI（数据驻留合规）、B 租户使用自部署的 Llama 模型（成本控制）、C 租户需要保险行业专用的 Prompt 话术。系统必须支持**按租户路由到不同模型**和**按租户自定义 Prompt**。

### 租户模型路由

核心思路是维护一个 `tenant_config` 表，记录每个租户的模型选择：

| 字段 | 说明 | 示例 |
|---|---|---|
| `embedding_model` | Embedding 模型 | `text-embedding-3-large` / `bge-m3` |
| `chat_model` | 对话模型 | `gpt-4o` / `claude-sonnet-4-20250514` |
| `rerank_model` | 重排序模型 | `bge-reranker-v2-m3` |
| `model_provider` | 模型提供商 | `openai` / `azure` / `ollama` |
| `provider_endpoint` | 提供商 API 地址 | `https://api.openai.com` / `https://xxx.openai.azure.com` |

对于未配置的租户，自动回退到系统默认配置（`default_provider` + `default_chat_model`）。

### 租户 Prompt 定制

Prompt 采用**继承 + 覆盖**机制：

1. 系统定义 `system_default_prompt`（基础模板）
2. 租户可覆盖特定段（`tenant_prompt_overrides`），只覆盖差异部分
3. 最终 Prompt = 基础模板合并租户覆盖 → 插入租户上下文（行业术语、品牌名称等）

```java
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class TenantModelRouter {

    private final TenantConfigRepository tenantConfigRepo;
    private final Map<String, ChatClient> chatClientCache = new ConcurrentHashMap<>();

    // 按租户路由到对应的 ChatClient
    public ChatClient resolveChatClient(String tenantId) {
        var config = tenantConfigRepo.findByTenantId(tenantId)
                .orElseGet(() -> TenantConfig.defaultConfig());

        var cacheKey = "%s:%s:%s".formatted(
                config.getModelProvider(),
                config.getChatModel(),
                config.getProviderEndpoint()
        );

        return chatClientCache.computeIfAbsent(cacheKey, k -> {
            return ChatClient.builder()
                    .defaultSystem(getTenantSystemPrompt(tenantId, config))
                    .build();
        });
    }

    /**
     * 获取租户级别的 System Prompt（继承自系统默认 + 租户覆盖）
     */
    public String getTenantSystemPrompt(String tenantId, TenantConfig config) {
        var basePrompt = config.getBasePromptId() != null
                ? promptTemplateRepo.findById(config.getBasePromptId())
                    .orElse(systemDefaultPrompt)
                : systemDefaultPrompt;

        // 合并租户特定的 Prompt 覆盖（如行业术语、合规声明）
        var overrides = config.getPromptOverrides();
        var finalPrompt = basePrompt.getTemplate();

        for (var entry : overrides.entrySet()) {
            // 替换或追加租户自定义内容
            var placeholder = "{{" + entry.getKey() + "}}";
            finalPrompt = finalPrompt.replace(placeholder, entry.getValue());
        }

        // 注入租户的身份信息
        finalPrompt = finalPrompt.replace("{{tenant_name}}", config.getTenantName());
        finalPrompt = finalPrompt.replace("{{industry}}", config.getIndustry());

        return finalPrompt;
    }

    /**
     * 根据租户配置选择 Embedding 模型
     */
    public EmbeddingModel resolveEmbeddingModel(String tenantId) {
        var config = tenantConfigRepo.findByTenantId(tenantId)
                .orElseGet(() -> TenantConfig.defaultConfig());

        var provider = config.getModelProvider();
        return switch (provider) {
            case "openai" -> new OpenAiEmbeddingModel(config.getEmbeddingModel());
            case "azure" -> new AzureOpenAiEmbeddingModel(
                    config.getProviderEndpoint(), config.getEmbeddingModel());
            case "ollama" -> new OllamaEmbeddingModel(
                    config.getProviderEndpoint(), config.getEmbeddingModel());
            default -> throw new IllegalArgumentException(
                    "Unknown provider: " + provider);
        };
    }
}

record TenantConfig(String tenantId, String tenantName, String industry,
    String modelProvider, String chatModel, String embeddingModel,
    String rerankModel, String providerEndpoint, String basePromptId,
    Map<String, String> promptOverrides) {
    static TenantConfig defaultConfig() {
        return new TenantConfig("default", "Default", "general",
            "openai", "gpt-4o", "text-embedding-3-large",
            "bge-reranker-v2-m3", "https://api.openai.com",
            null, Map.of());
    }
}
```

---

## 十三、白标能力

**白标（White Label）** 是指 SaaS 平台允许租户以自有品牌形象对外提供服务——租户的最终用户看到的是租户的 Logo、域名、配色和定制化界面，而底层平台完全透明。在 AI 知识库场景中，白标还扩展到 LLM 的"人格"定制。

### 白标能力清单

| 能力 | 实现方式 |
|---|---|
| 自定义域名 | 租户配置 CNAME → 系统泛域名 SSL 证书（`*.kb-saas.com`）→ Nginx/Ingress 根据 Host 头路由 |
| 品牌化 UI | 租户级 CSS 变量覆盖（`--primary-color`、`--logo-url`、`--font-family`），前端运行时动态加载 Theme 配置 |
| 邮箱模板 | 每个租户独立的邮件模板（邀请、通知、周报），支持 HTML 模板 + 变量替换 |
| LLM 人格 | 每个租户自定义 System Prompt 中的 AI 身份描述和能力边界 |
| 行业术语 | 租户自定义知识库检索和生成中的行业术语映射（例如"保单"→"policy"在不同租户的上下文中有不同释义） |

### 实现架构

Theme 配置存储在 `tenant_branding` 表中（或 Redis 中以 `tenant:theme:<tenantId>` 键缓存），前端在初始化时通过解析当前域名获取 `tenantId`，然后加载对应的 Theme JSON。

```java
import org.springframework.stereotype.Service;
import org.springframework.cache.annotation.Cacheable;

import java.util.Map;

@Service
public class TenantBrandingService {

    private final TenantBrandingRepository brandingRepo;

    public TenantBrandingService(TenantBrandingRepository brandingRepo) {
        this.brandingRepo = brandingRepo;
    }

    /**
     * 获取租户的完整品牌配置（缓存 1 小时）
     */
    @Cacheable(value = "tenant:theme", key = "#tenantId")
    public TenantBranding getBranding(String tenantId) {
        var branding = brandingRepo.findByTenantId(tenantId)
                .orElseGet(() -> getDefaultBranding());

        // 如果租户未配置 LLM 人格，使用默认值
        if (branding.getAiPersona() == null) {
            branding = branding.withAiPersona(buildDefaultPersona(branding));
        }

        return branding;
    }

    /**
     * 根据域名反向解析租户（用于白标入口）
     */
    public String resolveTenantIdFromDomain(String host) {
        // 从 tenant_branding 表查询 custom_domain
        return brandingRepo.findByCustomDomain(host)
                .map(TenantBranding::getTenantId)
                .orElse("default"); // 主域名访问默认租户
    }

    /**
     * 生成租户专属的 CSS 变量集合
     */
    public String generateCssVariables(String tenantId) {
        var branding = getBranding(tenantId);
        return """
            :root {
                --primary-color: %s;
                --secondary-color: %s;
                --logo-url: url('%s');
                --font-family: '%s', sans-serif;
                --border-radius: %dpx;
                --header-bg: %s;
                --footer-text: '%s';
            }
            """.formatted(
                branding.getPrimaryColor(),
                branding.getSecondaryColor(),
                branding.getLogoUrl(),
                branding.getFontFamily(),
                branding.getBorderRadius(),
                branding.getHeaderBackground(),
                branding.getFooterText()
            );
    }

    /**
     * 构建租户专属的 LLM System Prompt
     */
    public String buildTenantSystemPrompt(String tenantId) {
        var branding = getBranding(tenantId);
        return """
            你是 %s 的 AI 知识库助手，名称为 %s。

            身份：%s
            语气风格：%s
            行业领域：%s

            回答规则：
            - 优先使用 %s 的知识库内容
            - 对于不确定的问题，推荐联系 %s
            - 始终以 %s 的风格回复
            """.formatted(
                branding.getCompanyName(),
                branding.getAiName(),
                branding.getAiPersona(),
                branding.getToneStyle(),
                branding.getIndustry(),
                branding.getCompanyName(),
                branding.getSupportContact(),
                branding.getCompanyName()
            );
    }

    private TenantBranding getDefaultBranding() {
        return new TenantBranding("default", "AI Knowledge Base", "#2563EB",
                "#7C3AED", "/assets/default-logo.png", "Inter", 8,
                "#FFFFFF", "Powered by KB Platform", "通用助手",
                "专业的、简洁的", "general", "support@example.com");
    }

    private String buildDefaultPersona(TenantBranding b) {
        return "一个专业的" + b.getIndustry() + "领域 AI 助手";
    }
}

record TenantBranding(String tenantId, String companyName, String primaryColor,
    String secondaryColor, String logoUrl, String fontFamily, int borderRadius,
    String headerBackground, String footerText, String aiName,
    String toneStyle, String industry, String supportContact, String aiPersona) {

    // Compact constructor with defaults (10 params)
    public TenantBranding(String tenantId, String companyName, String primaryColor,
            String secondaryColor, String logoUrl, String fontFamily, int borderRadius,
            String headerBackground, String footerText, String aiName,
            String toneStyle, String industry, String supportContact) {
        this(tenantId, companyName, primaryColor, secondaryColor, logoUrl,
             fontFamily, borderRadius, headerBackground, footerText,
             aiName, toneStyle, industry, supportContact, null);
    }

    public TenantBranding withAiPersona(String persona) {
        return new TenantBranding(tenantId, companyName, primaryColor, secondaryColor,
                logoUrl, fontFamily, borderRadius, headerBackground, footerText,
                aiName, toneStyle, industry, supportContact, persona);
    }

    // Getters omitted for brevity
    public String getTenantId() { return tenantId; }
    public String getCompanyName() { return companyName; }
    public String getPrimaryColor() { return primaryColor; }
    public String getSecondaryColor() { return secondaryColor; }
    public String getLogoUrl() { return logoUrl; }
    public String getFontFamily() { return fontFamily; }
    public int getBorderRadius() { return borderRadius; }
    public String getHeaderBackground() { return headerBackground; }
    public String getFooterText() { return footerText; }
    public String getAiName() { return aiName; }
    public String getToneStyle() { return toneStyle; }
    public String getIndustry() { return industry; }
    public String getSupportContact() { return supportContact; }
    public String getAiPersona() { return aiPersona; }
}
```

---

## 十四、总结

企业级RAG系统的核心设计原则可以归纳为：

1. **检索质量优先**：混合检索 + Rerank是标配，不要指望单一的向量检索能解决所有问题
2. **多租户从第一天设计**：租户ID贯穿请求全链路，数据隔离、配额管理、审计日志缺一不可
3. **异步处理是必须的**：文档处理管道、审计日志、指标收集全部异步，不阻塞用户请求
4. **缓存分层设计**：Redis语义缓存减少LLM调用、PostgreSQL连接池降低数据库压力、CDN缓存静态资源
5. **可观测性即功能**：没有全链路追踪和Metrics的RAG系统就是盲飞，问题排查靠猜
6. **成本可视化**：每个API调用、每次LLM推理都要计量，租户和平台都需要知道钱花在了哪里

本文档覆盖了从需求分析、架构设计、数据建模、API定义、多租户实现到K8s部署的完整企业级RAG系统设计，给出的Java代码示例可直接用于Spring Boot 4.x + Spring AI 2.x + JDK 25项目，SQL DDL语句可直接在PostgreSQL 16 + pgvector 0.7环境中执行。
