---
domain: "04-数据与中间件"
title: "PostgreSQL 与 pgvector 深度解析"
status: "verified"
verification:
  reviewed_at: "2026-07-27"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
level: "advanced"
sources:
  - level: "L1"
    url: "https://www.postgresql.org/docs/17/"
    description: "PostgreSQL 17 官方文档"
  - level: "L1"
    url: "https://github.com/pgvector/pgvector"
    description: "pgvector 官方仓库与文档"
  - level: "L2"
    url: "https://github.com/postgres/postgres"
    description: "PostgreSQL 源码（MVCC、VACUUM、WAL）"
  - level: "L3"
    url: "https://www.interdb.jp/pg/"
    description: "《The Internals of PostgreSQL》— 铃木启修，PostgreSQL 内部机制权威参考"
relations:
  prerequisite: ["01-数据库原理"]
  related: ["04-Redis深度解析", "04-Elasticsearch深度解析"]
tags: ["postgresql", "pgvector", "mvcc", "vacuum", "wal", "sql-optimization", "hnsw", "ivfflat", "hybrid-search", "hikaricp"]
created: "2026-07-17"
updated: "2026-07-17"
---

# PostgreSQL 与 pgvector 深度解析

## 概述

PostgreSQL 是企业级开源关系数据库的标杆，以其对 SQL 标准的遵从性、扩展性和可靠性著称。在 AI 应用场景中，pgvector 扩展使得 PostgreSQL 成为最便捷的向量数据库选择——无需额外基础设施即可在同一数据库中完成业务数据和向量数据的存储与检索。

本文深入 PostgreSQL 核心内部机制（MVCC、VACUUM、WAL、复制）、索引策略、SQL 优化方法论，以及 pgvector 扩展的完整使用指南，并提供 Spring AI + pgvector 混合检索的完整代码示例。

---

## 一、MVCC 实现深入

### 1.1 核心概念

PostgreSQL 使用多版本并发控制（MVCC）实现事务隔离，无需读锁即可支持高并发读写。每条元组（tuple）包含四个隐藏系统列：

| 系统列 | 含义 |
|--------|------|
| `xmin` | 插入此元组的事务 ID（XID） |
| `xmax` | 删除或更新此元组的事务 ID（0 表示未删除） |
| `cmin` | 同一事务内的命令 ID（插入） |
| `cmax` | 同一事务内的命令 ID（删除） |

### 1.2 元组可见性判定

当一个事务读取数据时，PostgreSQL 根据当前事务的快照（snapshot）判定每个元组是否可见：

```
可见性判定规则：
1. 如果 xmin 是当前事务 → 可见
2. 如果 xmin 已提交 且 xmax 未设置或未提交 → 可见
3. 如果 xmin 在快照生成后启动 → 不可见
4. 如果 xmin 已回滚 → 不可见
```

快照存储的是该时刻的活跃事务列表（`active_txids`）、最小活跃 XID（`xmin`）、下一个待分配 XID（`xmax`）。

### 1.3 UPDATE 操作的真实行为

PostgreSQL 的 UPDATE 不是原地修改，而是 **插入新版本 + 标记旧版本删除**：

```sql
-- 逻辑上：UPDATE users SET name = 'Bob' WHERE id = 1;
-- 物理上等价于：
INSERT INTO users (id, name) VALUES (1, 'Bob');  -- xmin = 当前事务ID
UPDATE 旧元组 SET xmax = 当前事务ID;
```

**重要后果：** 每次 UPDATE 都会产生死元组（dead tuple），需要 VACUUM 回收。

### 1.4 事务 ID 回卷（XID Wraparound）

XID 是 32 位无符号整数（约 4.3 亿），采用循环使用。当 XID 使用过半时，旧 XID 会因为比新 XID"大"而导致数据丢失。PostgreSQL 通过 **冻结（freeze）**机制处理：

```sql
-- 查看各数据库的 XID 消耗情况
SELECT datname, age(datfrozenxid), datfrozenxid
FROM pg_database
ORDER BY age(datfrozenxid) DESC;
```

当 `age(datfrozenxid)` 达到 2 亿时触发自动 VACUUM freeze，达到 10 亿时数据库进入只读模式。

---

## 二、VACUUM 与表膨胀

### 2.1 VACUUM 分类

| 类型 | 行为 | 是否阻塞 | 是否回收磁盘空间 |
|------|------|----------|------------------|
| `VACUUM` | 标记死元组可重用，更新空闲空间映射 | 不阻塞读写 | 不回收 |
| `VACUUM FULL` | 重写整个表，物理移除死元组 | 阻塞（AccessExclusiveLock） | 回收 |
| 自动 VACUUM | 后台自动执行，基于阈值触发 | 不阻塞 | 不回收 |

### 2.2 自动 VACUUM 调优

```ini
# postgresql.conf 关键参数
autovacuum = on
autovacuum_vacuum_scale_factor = 0.1   # 10% 死元组触发 VACUUM
autovacuum_vacuum_threshold = 50       # 至少 50 个死元组
autovacuum_vacuum_cost_limit = 200     # 成本限速（I/O 限制）
autovacuum_vacuum_cost_delay = 2ms     # 达到成本限制后暂停时间
```

**高频更新表推荐使用表级调优：**

```sql
ALTER TABLE high_traffic_events SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 100
);
```

### 2.3 表膨胀检测

```sql
-- 查询表膨胀率
SELECT schemaname, relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
            ELSE 0 END AS dead_ratio
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 2.4 膨胀应对策略

1. **预防：** 合理设置 autovacuum 参数，避免长事务（长时间持有快照会使 VACUUM 无法回收）
2. **发现：** 监控 `pg_stat_user_tables.n_dead_tup`
3. **处理：** 高峰期外执行 `VACUUM FULL` 或使用 `pg_repack`（在线重建，不阻塞写入）

---

## 三、WAL（预写日志）

### 3.1 WAL 原理

WAL 确保崩溃恢复和复制。所有数据变更先写入 WAL，再写入数据文件。WAL 是顺序追加写，性能极高。

```
事务提交流程：
1. 生成 WAL Record
2. 写入 WAL Buffer → 触发条件后 fsync 到磁盘 WAL Segment 文件
3. 返回客户端"提交成功"
4. Checkpointer 将脏页写入数据文件（异步）
```

### 3.2 WAL 调优

```ini
# 关键参数
wal_level = replica           # 支持流复制；logical 支持逻辑复制
wal_buffers = 16MB            # WAL buffer；大事务场景增大
wal_sync_method = fdatasync   # 刷新方式，Linux 推荐 fdatasync
checkpoint_timeout = 15min    # 检查点间隔
max_wal_size = 4GB            # WAL 最大尺寸（触发检查点）
min_wal_size = 1GB            # WAL 回收基准尺寸
```

### 3.3 流复制与逻辑复制

**流复制（物理复制）：** 复制 WAL 记录，主备完全一致（块级复制）。

```
主库 → WAL Sender 进程 → 网络 → WAL Receiver 进程 → 备库应用
```

```sql
-- 查看复制状态
SELECT pid, state, sync_state, write_lag, flush_lag, replay_lag
FROM pg_stat_replication;
```

**逻辑复制：** 基于发布/订阅模型，复制指定表的变更（行级），允许异构版本、部分复制。

```sql
-- 发布端
CREATE PUBLICATION my_pub FOR TABLE users, orders;
-- 订阅端
CREATE SUBSCRIPTION my_sub CONNECTION 'host=master dbname=mydb' PUBLICATION my_pub;
```

**适用场景对比：**

| 场景 | 流复制 | 逻辑复制 |
|------|--------|----------|
| 读写分离 | 适用 | 适用 |
| 大版本升级 | 不适用 | 适用 |
| 跨平台复制 | 不适用 | 适用 |
| 部分表复制 | 不适用 | 适用 |
| CDC（变更数据捕获） | 不适用 | 适用（配合 Debezium） |

---

## 四、索引深入

### 4.1 索引类型全景

| 索引类型 | 适用数据类型 | 典型操作符 | 场景 |
|----------|-------------|-----------|------|
| B-Tree | 标量类型 | `<`, `=`, `>`, `BETWEEN`, `IN` | 通用主键、等值、范围查询 |
| GiST | 几何、全文检索、范围 | `&&` (overlap), `@>` (contains) | 空间索引、全文检索 |
| GIN | 数组、JSONB、全文检索 | `@>` (contains), `?` (exists) | 数组字段、JSONB 查询、倒排索引 |
| BRIN | 大数据量顺序列 | `=` | 时序数据、日志表 |
| Hash | 等值 | `=` | 仅等值查询（已不常用，B-Tree 代替） |

### 4.2 部分索引（Partial Index）

只为满足条件的行创建索引，减小索引尺寸：

```sql
-- 只为活跃用户创建索引（假设80%数据是已归档的）
CREATE INDEX idx_active_users ON users (created_at)
WHERE status = 'active';
```

### 4.3 表达式索引（Expression Index）

针对表达式的计算结果创建索引：

```sql
-- 大小写不敏感搜索
CREATE INDEX idx_users_email_lower ON users (LOWER(email));

-- 查询时可使用该索引
SELECT * FROM users WHERE LOWER(email) = LOWER('User@Example.com');
```

### 4.4 索引扫描类型

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';
```

EXPLAIN 解读关键字段：

| 字段 | 含义 |
|------|------|
| `Seq Scan` | 全表扫描（表小于阈值或无可用索引） |
| `Index Scan` | 使用索引，回表获取完整行 |
| `Index Only Scan` | 仅扫描索引即可获取所需数据（覆盖索引），伴随 VM 位判断 |
| `Bitmap Index Scan + Bitmap Heap Scan` | 索引过滤中间结果后用位图合并，再回表 |
| `Rows` | 计划估计返回行数 |
| `actual ... rows` | 实际返回行数（差距大说明统计信息不准） |
| `Width` | 估计每行宽度（字节） |
| `Cost` | `启动代价..总代价` |

**快速诊断：**

```sql
-- 查找缺失索引
SELECT schemaname || '.' || relname AS table,
       seq_scan, seq_tup_read,
       idx_scan, seq_tup_read / GREATEST(seq_scan, 1) AS avg_seq_tup,
       n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 20;

-- 查找未使用索引
SELECT schemaname || '.' || relname AS table,
       indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%pkey'
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## 五、SQL 优化

### 5.1 JOIN 策略

```sql
-- 查看 JOIN 策略
SET enable_nestloop = off;  -- 临时禁用，对比效果
EXPLAIN ANALYZE SELECT ...
```

| JOIN 策略 | 算法 | 适用场景 | 内存需求 |
|-----------|------|----------|----------|
| Nested Loop | 外表每行扫描内表索引 | 外表小+内表有索引 | 低 |
| Hash Join | 建内表哈希表→扫描外表探测 | 两表都较大 | `work_mem` (哈希表) |
| Merge Join | 两表排序后归并 | 两表都有序 | 低 |

**调优：**

```ini
# 增加 work_mem 使 Hash Join 能在内存中完成
work_mem = 256MB  # 每个操作可用内存，注意 = 并发数 * work_mem
```

### 5.2 常见慢查询模式

1. **隐式类型转换导致索引失效：**
   ```sql
   -- 错误：id 是 int 类型但比较值用了字符串
   SELECT * FROM users WHERE id = '123';
   -- 正确的做法
   SELECT * FROM users WHERE id = 123;
   ```

2. **函数包裹索引列：**
   ```sql
   -- 错误：索引失效
   SELECT * FROM orders WHERE DATE(created_at) = '2026-01-01';
   -- 正确：使用范围查询
   SELECT * FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02';
   ```

3. **负向查询无法使用索引：**
   ```sql
   -- 以下通常不走索引
   SELECT * FROM users WHERE status != 'deleted';
   -- 如果 deleted 占比很小，用部分索引
   SELECT * FROM users WHERE status IN ('active', 'pending');
   ```

4. **大 OFFSET 分页：**
   ```sql
   -- 错误：OFFSET 1000000 需要扫描并丢弃前100万行
   SELECT * FROM orders ORDER BY id OFFSET 1000000 LIMIT 20;
   -- 正确：基于游标的分页（Keyset Pagination）
   SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
   ```

### 5.3 统计信息

```sql
-- 收集统计信息
ANALYZE tablename;

-- 查看统计信息
SELECT * FROM pg_stats WHERE tablename = 'orders' AND attname = 'customer_id';
-- n_distinct: -1 表示唯一列；正值表示不同值数量
-- most_common_vals / most_common_freqs: 最常见值及其频率
-- correlation: 列值和物理存储顺序的相关性（1 理想，0 随机）
```

---

## 六、pgvector 深入

### 6.1 安装与基础配置

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    metadata JSONB,
    chunk_text TEXT,
    embedding VECTOR(1536)  -- OpenAI text-embedding-3-small = 1536 维
);

-- 创建向量索引
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- 或 HNSW
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
```

### 6.2 操作符

| 操作符 | 含义 | 计算 |
|--------|------|------|
| `<->` | L2 欧几里得距离 | sqrt(sum((a-b)^2)) |
| `<#>` | 负内积 | -sum(a*b) |
| `<=>` | 余弦距离 | 1 - cosine_similarity |
| `<+>` | L1 曼哈顿距离 | sum(\|a-b\|) |

**注意：** 所有操作符返回"距离"而非"相似度"。距离越小越相似。`<=>` 范围 [0, 2]。

```sql
-- L2 距离最近邻
SELECT id, chunk_text, embedding <-> query_embedding AS distance
FROM documents
ORDER BY distance
LIMIT 10;

-- 余弦距离最近邻（推荐用于语义搜索）
SELECT id, chunk_text, 1 - (embedding <=> query_embedding) AS similarity
FROM documents
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

### 6.3 IVFFlat 索引

**原理：** 使用 K-means 将向量空间划分为 `lists` 个聚类。查询时，先计算查询向量最近的 `probes` 个聚类中心，然后只在这些聚类中搜索。

**构建过程：**
```
1. 随机采样或全量数据执行 K-means 聚类
2. 为每个向量分配聚类 ID
3. 将同一聚类向量存储在一起（倒排文件）
```

**查询流程：**
```
1. 计算查询向量到所有聚类中心的距离
2. 选择最近的 probes 个聚类
3. 遍历选中的聚类，计算精确距离
4. 排序返回 top-k
```

**调优：**
```sql
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 200);  -- lists ≈ sqrt(总行数) 作为起点

-- 查询时动态设置探针数
SET ivfflat.probes = 10;  -- 默认 1；增加提升召回率但牺牲速度
```

**lists 选择法则：**
- `lists = sqrt(rows)` 作为起点
- 100 万行数据：lists 约 1000
- lists 过小 → 每个列表太大 → 扫描时间长
- lists 过大 → probes 无法覆盖足够多的列表 → 召回率下降

### 6.4 HNSW 索引

**原理：** 构建分层图结构，每层是近似 Delaunay 图。底层包含所有节点，上层逐层稀疏。

**关键参数：**

| 参数 | 含义 | 默认值 | 建议 |
|------|------|--------|------|
| `m` | 每个节点最大连接数 | 16 | 16-64；越大精度越高、内存越大 |
| `ef_construction` | 构建时搜索深度 | 64 | 100-2000；越大索引质量越高、构建越慢 |

**查询参数：**
```sql
SET hnsw.ef_search = 100;  -- 查询时搜索深度，默认 40；越大精度越高
```

**HNSW vs IVFFlat 对比：**

| 维度 | HNSW | IVFFlat |
|------|------|---------|
| 查询速度 | 更快 | 较慢 |
| 召回率 | 更高 | 稍低（取决于 lists + probes） |
| 构建时间 | 较慢 | 较快 |
| 内存占用 | 更大（图结构） | 较小 |
| 插入后可查询 | 是（增量更新图） | 否（需要重建索引） |
| 并发写入 | 需要锁 | 不阻塞写入（但需要重建） |

### 6.5 混合检索：全文 + 向量 RRF 融合

在实际 RAG 场景中，纯向量检索可能遗漏精确关键词匹配的文档。混合检索将全文检索（BM25 等价实现）与向量检索融合。

```sql
-- 1. 创建全文检索索引
ALTER TABLE documents ADD COLUMN fts tsvector
GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;
CREATE INDEX idx_documents_fts ON documents USING GIN (fts);

-- 2. 混合检索函数（使用 RRF 融合）
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text TEXT,
    query_embedding VECTOR(1536),
    match_limit INT DEFAULT 20,
    full_text_limit INT DEFAULT 50,
    vector_limit INT DEFAULT 50,
    rrf_k INT DEFAULT 60
)
RETURNS TABLE(
    id BIGINT,
    chunk_text TEXT,
    rrf_score DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    WITH fts_results AS (
        SELECT id, chunk_text,
               ts_rank(fts, websearch_to_tsquery('english', query_text)) AS score,
               row_number() OVER (ORDER BY ts_rank(fts, websearch_to_tsquery('english', query_text)) DESC) AS rank
        FROM documents
        WHERE fts @@ websearch_to_tsquery('english', query_text)
        ORDER BY score DESC
        LIMIT full_text_limit
    ),
    vector_results AS (
        SELECT id, chunk_text,
               1 - (embedding <=> query_embedding) AS score,
               row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank
        FROM documents
        ORDER BY embedding <=> query_embedding
        LIMIT vector_limit
    ),
    rrf AS (
        SELECT COALESCE(f.id, v.id) AS id,
               COALESCE(f.chunk_text, v.chunk_text) AS chunk_text,
               COALESCE(1.0 / (rrf_k + f.rank), 0.0) +
               COALESCE(1.0 / (rrf_k + v.rank), 0.0) AS rrf_score
        FROM fts_results f
        FULL OUTER JOIN vector_results v ON f.id = v.id
    )
    SELECT r.id, r.chunk_text, r.rrf_score
    FROM rrf r
    ORDER BY r.rrf_score DESC
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;
```

### 6.6 Spring AI + pgvector 完整示例

#### 6.6.1 PgvectorConfig — 向量存储配置

配置 `PgVectorStore` Bean，指定向量维度、距离类型、HNSW 索引参数。Spring AI 的 `VectorStore` 抽象屏蔽了不同向量数据库的 API 差异。

```java
// PgvectorConfig.java
@Configuration
public class PgvectorConfig {

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public VectorStore pgvectorStore(JdbcTemplate jdbcTemplate,
                                     EmbeddingModel embeddingModel) {
        return PgVectorStore.builder(jdbcTemplate, embeddingModel)
                .dimensions(1536)
                .distanceType(PgVectorStore.PgDistanceType.COSINE_DISTANCE)
                .indexType(PgVectorStore.PgIndexType.HNSW)
                .hnswM(16)
                .hnswEfConstruction(200)
                .vectorTableName("document_embeddings")
                .schemaName("public")
                .build();
    }
}
```

#### 6.6.2 HybridSearchService — 混合检索服务

直接使用 `JdbcTemplate` 执行 RRF（Reciprocal Rank Fusion）混合检索 SQL，融合 BM25 全文检索和向量余弦相似度检索的结果。`SearchResult` 使用 JDK record 定义返回类型。

```java
// HybridSearchService.java
@Service
public class HybridSearchService {

    private final JdbcTemplate jdbcTemplate;
    private final EmbeddingModel embeddingModel;

    public HybridSearchService(JdbcTemplate jdbcTemplate,
                               EmbeddingModel embeddingModel) {
        this.jdbcTemplate = jdbcTemplate;
        this.embeddingModel = embeddingModel;
    }

    public record SearchResult(Long id, String chunkText, double rrfScore) {}

    public List<SearchResult> hybridSearch(String query, int limit) {
        var embedding = embeddingModel.embed(query);
        var vectorStr = Arrays.toString(embedding)
                .replace('[', '{').replace(']', '}');

        var sql = """
            WITH fts_results AS (
                SELECT id, chunk_text,
                       ts_rank(fts, websearch_to_tsquery('english', ?)) AS score,
                       row_number() OVER (ORDER BY ts_rank(fts, websearch_to_tsquery('english', ?)) DESC) AS rank
                FROM documents
                WHERE fts @@ websearch_to_tsquery('english', ?)
                ORDER BY score DESC
                LIMIT ?
            ),
            vector_results AS (
                SELECT id, chunk_text,
                       1 - (embedding <=> ?::vector) AS score,
                       row_number() OVER (ORDER BY embedding <=> ?::vector) AS rank
                FROM documents
                ORDER BY embedding <=> ?::vector
                LIMIT ?
            ),
            rrf AS (
                SELECT COALESCE(f.id, v.id) AS id,
                       COALESCE(f.chunk_text, v.chunk_text) AS chunk_text,
                       COALESCE(1.0 / (60 + f.rank), 0.0) +
                       COALESCE(1.0 / (60 + v.rank), 0.0) AS rrf_score
                FROM fts_results f
                FULL OUTER JOIN vector_results v ON f.id = v.id
            )
            SELECT id, chunk_text, rrf_score
            FROM rrf
            ORDER BY rrf_score DESC
            LIMIT ?
            """;

        return jdbcTemplate.query(sql,
                new Object[]{query, query, query, limit, vectorStr, vectorStr, vectorStr, limit, limit},
                (rs, rowNum) -> new SearchResult(
                        rs.getLong("id"),
                        rs.getString("chunk_text"),
                        rs.getDouble("rrf_score")
                ));
    }
}
```

#### 6.6.3 application.yml — 数据源与 AI 配置

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/ai_knowledge
    username: app
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      idle-timeout: 300000
      max-lifetime: 1200000
      connection-timeout: 10000
      leak-detection-threshold: 60000
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      embedding:
        options:
          model: text-embedding-3-small
```

### 6.7 RAGDocumentService — 完整的 RAG 检索服务

以下 `RAGDocumentService` 封装了 RAG 场景中的核心操作：文档插入（自动生成 Embedding）、混合检索（BM25 + 向量 + RRF 融合）、元数据过滤（按 category / tags / created_at）、以及批量 Embedding 和批量插入。使用 JDK 25 风格：`var` 局部变量类型推断、Record 类型、Text Block SQL、`Stream.toList()`。

```java
// RAGDocumentService.java
package com.example.rag.service;

import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

@Service
public class RAGDocumentService {

    private final JdbcTemplate jdbcTemplate;
    private final EmbeddingModel embeddingModel;

    public RAGDocumentService(JdbcTemplate jdbcTemplate,
                               EmbeddingModel embeddingModel) {
        this.jdbcTemplate = jdbcTemplate;
        this.embeddingModel = embeddingModel;
    }

    // ============================================================
    // Record 类型定义
    // ============================================================

    /** 文档插入输入 */
    public record DocumentInput(String content, String chunkText,
                                 String category, String tags) {}

    /** 文档数据库记录 */
    public record DocumentRecord(Long id, String content, String chunkText,
                                  String category, String tags,
                                  LocalDateTime createdAt) {}

    /** 混合检索结果，含 RRF 融合分数和各路原始分数 */
    public record HybridSearchResult(Long id, String chunkText, double rrfScore,
                                      String category, String tags,
                                      double vectorScore, double ftsScore) {}

    // ============================================================
    // 文档插入（带 Embedding）
    // ============================================================

    /**
     * 插入单个文档，自动调用 EmbeddingModel 生成向量并写入 pgvector。
     * 返回自增主键 id。
     */
    @Transactional
    public long insertDocument(String content, String chunkText,
                                String category, String tags) {
        var embedding = embeddingModel.embed(chunkText);
        var vectorStr = toPgVector(embedding);

        var sql = """
            INSERT INTO documents (content, chunk_text, category, tags, embedding, created_at)
            VALUES (?, ?, ?, ?, ?::vector, NOW())
            RETURNING id
            """;

        var id = jdbcTemplate.queryForObject(sql, Long.class,
                content, chunkText, category, tags, vectorStr);
        return Objects.requireNonNullElse(id, -1L);
    }

    // ============================================================
    // 混合检索：BM25 全文 + 向量相似度 + RRF 融合 + 元数据过滤
    // ============================================================

    /**
     * 混合检索，融合 BM25 全文搜索和向量余弦相似度。
     * 支持按 category 和 tags 进行元数据过滤。
     *
     * @param query    查询文本
     * @param category 分类过滤（null 或空字符串表示不过滤）
     * @param tags     标签过滤（null 或空字符串表示不过滤，逗号分隔多标签匹配任一）
     * @param limit    返回结果数上限
     * @return 按 RRF 分数降序排列的检索结果
     */
    public List<HybridSearchResult> hybridSearch(String query, String category,
                                                  String tags, int limit) {
        var embedding = embeddingModel.embed(query);
        var vectorStr = toPgVector(embedding);
        var hasCategory = category != null && !category.isBlank();
        var hasTags = tags != null && !tags.isBlank();

        // 动态构建元数据过滤子句
        var categoryClause = hasCategory ? "AND d.category = ?" : "";
        var tagsClause = hasTags
                ? "AND string_to_array(d.tags, ',') && string_to_array(?, ',')" : "";

        var sql = """
            WITH fts_results AS (
                SELECT d.id, d.chunk_text, d.category, d.tags,
                       ts_rank(d.fts, websearch_to_tsquery('english', ?)) AS score,
                       row_number() OVER (
                           ORDER BY ts_rank(d.fts, websearch_to_tsquery('english', ?)) DESC
                       ) AS rank
                FROM documents d
                WHERE d.fts @@ websearch_to_tsquery('english', ?)
                  %s
                  %s
                ORDER BY score DESC
                LIMIT 50
            ),
            vector_results AS (
                SELECT d.id, d.chunk_text, d.category, d.tags,
                       1 - (d.embedding <=> ?::vector) AS score,
                       row_number() OVER (ORDER BY d.embedding <=> ?::vector) AS rank
                FROM documents d
                WHERE 1=1
                  %s
                  %s
                ORDER BY d.embedding <=> ?::vector
                LIMIT 50
            ),
            rrf AS (
                SELECT COALESCE(f.id, v.id) AS id,
                       COALESCE(f.chunk_text, v.chunk_text) AS chunk_text,
                       COALESCE(f.category, v.category) AS category,
                       COALESCE(f.tags, v.tags) AS tags,
                       COALESCE(1.0 / (60 + f.rank), 0.0) +
                       COALESCE(1.0 / (60 + v.rank), 0.0) AS rrf_score,
                       COALESCE(f.score, 0.0) AS fts_score,
                       COALESCE(v.score, 0.0) AS vector_score
                FROM fts_results f
                FULL OUTER JOIN vector_results v ON f.id = v.id
            )
            SELECT id, chunk_text, rrf_score, category, tags, vector_score, fts_score
            FROM rrf
            ORDER BY rrf_score DESC
            LIMIT ?
            """.formatted(categoryClause, tagsClause, categoryClause, tagsClause);

        // 按占位符顺序构建参数
        var params = new ArrayList<>();
        params.add(query);         // fts: ts_rank #1
        params.add(query);         // fts: ts_rank #2 (row_number)
        params.add(query);         // fts: WHERE fts @@
        if (hasCategory) params.add(category);
        if (hasTags) params.add(tags);
        // fts LIMIT 50 (hardcoded above)
        params.add(vectorStr);     // vector: <=> #1
        params.add(vectorStr);     // vector: <=> #2 (row_number)
        if (hasCategory) params.add(category);
        if (hasTags) params.add(tags);
        params.add(vectorStr);     // vector: ORDER BY <=>
        // vector LIMIT 50 (hardcoded above)
        params.add(limit);         // final LIMIT

        return jdbcTemplate.query(sql, params.toArray(),
                (rs, rowNum) -> new HybridSearchResult(
                        rs.getLong("id"),
                        rs.getString("chunk_text"),
                        rs.getDouble("rrf_score"),
                        rs.getString("category"),
                        rs.getString("tags"),
                        rs.getDouble("vector_score"),
                        rs.getDouble("fts_score")
                ));
    }

    // ============================================================
    // 批量 Embedding
    // ============================================================

    /**
     * 批量生成 Embedding。使用 parallelStream 并行调用 EmbeddingModel，
     * 适用于大批量文本的离线 Embedding 生成场景。
     */
    public List<float[]> batchEmbed(List<String> texts) {
        return texts.parallelStream()
                .map(embeddingModel::embed)
                .toList();
    }

    // ============================================================
    // 批量插入文档
    // ============================================================

    /**
     * 批量插入文档：先调用 batchEmbed 生成所有向量，再通过 batchUpdate 一次性写入。
     * 整个操作在一个事务中完成。
     */
    @Transactional
    public int[] batchInsertDocuments(List<DocumentInput> documents) {
        var texts = documents.stream().map(DocumentInput::chunkText).toList();
        var embeddings = batchEmbed(texts);

        var sql = """
            INSERT INTO documents (content, chunk_text, category, tags, embedding, created_at)
            VALUES (?, ?, ?, ?, ?::vector, NOW())
            """;

        var batchArgs = new ArrayList<Object[]>();
        for (int i = 0; i < documents.size(); i++) {
            var doc = documents.get(i);
            batchArgs.add(new Object[]{
                    doc.content(), doc.chunkText(), doc.category(), doc.tags(),
                    toPgVector(embeddings.get(i))
            });
        }

        return jdbcTemplate.batchUpdate(sql, batchArgs,
                new int[]{java.sql.Types.VARCHAR, java.sql.Types.VARCHAR,
                          java.sql.Types.VARCHAR, java.sql.Types.VARCHAR,
                          java.sql.Types.OTHER});
    }

    // ============================================================
    // 按元数据过滤检索
    // ============================================================

    /** 按 category 过滤，返回最近创建的文档。 */
    public List<DocumentRecord> findByCategory(String category, int limit) {
        var sql = """
            SELECT id, content, chunk_text, category, tags, created_at
            FROM documents
            WHERE category = ?
            ORDER BY created_at DESC
            LIMIT ?
            """;
        return jdbcTemplate.query(sql,
                (rs, rowNum) -> new DocumentRecord(
                        rs.getLong("id"),
                        rs.getString("content"),
                        rs.getString("chunk_text"),
                        rs.getString("category"),
                        rs.getString("tags"),
                        rs.getTimestamp("created_at").toLocalDateTime()
                ),
                category, limit);
    }

    /** 按 tags 过滤（包含任一标签即匹配）。 */
    public List<DocumentRecord> findByTags(String tags, int limit) {
        var sql = """
            SELECT id, content, chunk_text, category, tags, created_at
            FROM documents
            WHERE string_to_array(tags, ',') && string_to_array(?, ',')
            ORDER BY created_at DESC
            LIMIT ?
            """;
        return jdbcTemplate.query(sql,
                (rs, rowNum) -> new DocumentRecord(
                        rs.getLong("id"),
                        rs.getString("content"),
                        rs.getString("chunk_text"),
                        rs.getString("category"),
                        rs.getString("tags"),
                        rs.getTimestamp("created_at").toLocalDateTime()
                ),
                tags, limit);
    }

    /** 按创建时间范围过滤。 */
    public List<DocumentRecord> findByCreatedAtRange(LocalDateTime from,
                                                      LocalDateTime to,
                                                      int limit) {
        var sql = """
            SELECT id, content, chunk_text, category, tags, created_at
            FROM documents
            WHERE created_at BETWEEN ? AND ?
            ORDER BY created_at DESC
            LIMIT ?
            """;
        return jdbcTemplate.query(sql,
                (rs, rowNum) -> new DocumentRecord(
                        rs.getLong("id"),
                        rs.getString("content"),
                        rs.getString("chunk_text"),
                        rs.getString("category"),
                        rs.getString("tags"),
                        rs.getTimestamp("created_at").toLocalDateTime()
                ),
                from, to, limit);
    }

    // ============================================================
    // 工具方法
    // ============================================================

    /** 将 float[] 转为 pgvector 兼容格式 "{v1,v2,...,vn}" */
    private static String toPgVector(float[] embedding) {
        var sb = new StringBuilder("{");
        for (int i = 0; i < embedding.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(embedding[i]);
        }
        sb.append("}");
        return sb.toString();
    }
}
```

`hybridSearch` 方法的设计要点：
- **动态过滤**：根据 `category` / `tags` 是否传入，使用 `String.formatted()` 将过滤子句注入 Text Block SQL
- **RRF k=60**：与 6.5 节中的 SQL 函数保持一致
- **双路各取 50**：全文和向量两路各取 top-50，再通过 FULL OUTER JOIN 融合
- **返回每路原始分数**：`vectorScore` 和 `ftsScore` 便于排查排序问题

### 6.8 Testcontainers 集成测试

使用 Testcontainers 启动真实的 PostgreSQL + pgvector 容器，验证 RAGDocumentService 的各项功能。`@ServiceConnection` 自动将容器连接信息注入 Spring 上下文，无需手动配置 `@DynamicPropertySource`。

```java
// PgvectorHybridSearchIntegrationTest.java
package com.example.rag;

import com.example.rag.service.RAGDocumentService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@DisplayName("pgvector 混合检索集成测试")
class PgvectorHybridSearchIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            "pgvector/pgvector:pg17"
    );

    @Autowired
    private RAGDocumentService ragDocumentService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeAll
    void setupDatabase() {
        // 启用 pgvector 扩展
        jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector");

        // 创建文档表（含全文检索列和向量列）
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id BIGSERIAL PRIMARY KEY,
                content TEXT NOT NULL,
                chunk_text TEXT NOT NULL,
                category VARCHAR(100),
                tags VARCHAR(500),
                fts tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', chunk_text)
                ) STORED,
                embedding VECTOR(1536),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """);

        // 创建 GIN 全文检索索引
        jdbcTemplate.execute("""
            CREATE INDEX IF NOT EXISTS idx_documents_fts
            ON documents USING GIN (fts)
            """);

        // 创建 HNSW 向量索引
        jdbcTemplate.execute("""
            CREATE INDEX IF NOT EXISTS idx_documents_embedding
            ON documents USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 200)
            """);
    }

    @BeforeEach
    void setUp() {
        jdbcTemplate.execute("DELETE FROM documents");
    }

    @Test
    @DisplayName("插入文档并验证 embedding 已生成")
    void shouldInsertDocumentWithEmbedding() {
        var id = ragDocumentService.insertDocument(
                "Spring AI 是 Spring 生态的 AI 集成框架，"
                + "提供了与多种 LLM 的集成能力。",
                "Spring AI 框架概述",
                "java-ai",
                "spring,ai,framework"
        );

        assertThat(id).isGreaterThan(0);

        // 验证 embedding 列不为空
        var count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM documents WHERE id = ? AND embedding IS NOT NULL",
                Integer.class, id);
        assertThat(count).isEqualTo(1);
    }

    @Test
    @DisplayName("混合检索应返回与查询语义相关的文档")
    void shouldReturnRelevantDocumentsViaHybridSearch() {
        // 准备测试数据：覆盖不同主题的文档
        ragDocumentService.batchInsertDocuments(List.of(
                new RAGDocumentService.DocumentInput(
                        "全文1", "Spring Boot makes it easy to create stand-alone applications",
                        "java-ai", "spring,boot"
                ),
                new RAGDocumentService.DocumentInput(
                        "全文2", "PostgreSQL pgvector enables vector similarity search",
                        "database", "postgresql,pgvector"
                ),
                new RAGDocumentService.DocumentInput(
                        "全文3", "Machine learning models require large datasets for training",
                        "ai-ml", "machine-learning,training"
                ),
                new RAGDocumentService.DocumentInput(
                        "全文4", "Vector databases store embeddings for semantic search in RAG pipelines",
                        "database", "vector-db,rag,embeddings"
                ),
                new RAGDocumentService.DocumentInput(
                        "全文5", "Spring AI integrates with vector stores for RAG applications",
                        "java-ai", "spring,ai,rag,vector-store"
                )
        ));

        // 执行混合检索
        var results = ragDocumentService.hybridSearch(
                "vector database semantic search", null, null, 5);

        // 验证返回了结果且分数合法
        assertThat(results).isNotEmpty();
        assertThat(results).allSatisfy(result -> {
            assertThat(result.chunkText()).isNotBlank();
            assertThat(result.rrfScore()).isGreaterThan(0);
        });

        // 验证 "Vector databases" 相关文档出现在 top 结果中
        var topChunks = results.stream()
                .map(RAGDocumentService.HybridSearchResult::chunkText)
                .toList();
        assertThat(topChunks)
                .anyMatch(chunk -> chunk.toLowerCase().contains("vector"));
    }

    @Test
    @DisplayName("按 category 元数据过滤应仅返回匹配分类的文档")
    void shouldFilterByCategory() {
        ragDocumentService.batchInsertDocuments(List.of(
                new RAGDocumentService.DocumentInput(
                        "c1", "Java virtual threads improve concurrency",
                        "java-ai", "java"),
                new RAGDocumentService.DocumentInput(
                        "c2", "PostgreSQL is a powerful relational database",
                        "database", "postgresql"),
                new RAGDocumentService.DocumentInput(
                        "c3", "Spring Boot simplifies application development",
                        "java-ai", "spring")
        ));

        // 按 database 分类检索
        var dbResults = ragDocumentService.findByCategory("database", 10);
        assertThat(dbResults).hasSize(1);
        assertThat(dbResults.getFirst().chunkText())
                .contains("PostgreSQL");

        // 按 java-ai 分类检索
        var javaResults = ragDocumentService.findByCategory("java-ai", 10);
        assertThat(javaResults).hasSize(2);
    }

    @Test
    @DisplayName("按 tags 元数据过滤应仅返回匹配标签的文档")
    void shouldFilterByTags() {
        ragDocumentService.batchInsertDocuments(List.of(
                new RAGDocumentService.DocumentInput(
                        "t1", "RAG pipeline design", "ai", "rag,pipeline"),
                new RAGDocumentService.DocumentInput(
                        "t2", "Agent memory management", "ai", "agent,memory"),
                new RAGDocumentService.DocumentInput(
                        "t3", "RAG evaluation metrics", "ai", "rag,evaluation")
        ));

        var ragDocs = ragDocumentService.findByTags("rag", 10);
        assertThat(ragDocs).hasSize(2);
        assertThat(ragDocs).allSatisfy(doc ->
                assertThat(doc.tags()).contains("rag"));
    }

    @Test
    @DisplayName("混合检索 + category 过滤应同时生效")
    void shouldCombineHybridSearchWithCategoryFilter() {
        ragDocumentService.batchInsertDocuments(List.of(
                new RAGDocumentService.DocumentInput(
                        "d1", "Vector search with pgvector in PostgreSQL",
                        "database", "vector"),
                new RAGDocumentService.DocumentInput(
                        "d2", "Vector search applied in Java AI applications",
                        "java-ai", "vector"),
                new RAGDocumentService.DocumentInput(
                        "d3", "Embedding generation with Spring AI framework",
                        "java-ai", "spring,ai")
        ));

        // 混合检索 + category=java-ai 过滤
        var results = ragDocumentService.hybridSearch(
                "vector search", "java-ai", null, 5);

        assertThat(results).isNotEmpty();
        // 所有返回结果应只属于 java-ai 分类
        assertThat(results).allSatisfy(r ->
                assertThat(r.category()).isEqualTo("java-ai"));
    }

    @AfterAll
    void tearDown() {
        jdbcTemplate.execute("DROP TABLE IF EXISTS documents CASCADE");
    }
}
```

测试覆盖了以下场景：

| 测试用例 | 覆盖能力 |
|----------|----------|
| `shouldInsertDocumentWithEmbedding` | 单文档插入 + Embedding 自动生成验证 |
| `shouldReturnRelevantDocumentsViaHybridSearch` | 混合检索准确性：语义相关文档排在前面 |
| `shouldFilterByCategory` | 按 category 元数据过滤 |
| `shouldFilterByTags` | 按 tags 元数据过滤 |
| `shouldCombineHybridSearchWithCategoryFilter` | 混合检索 + 元数据过滤组合使用 |

---

## 七、连接池：HikariCP + PgBouncer

### 7.1 HikariCP 关键配置

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20       # 最大连接数 = (CPU核数 * 2) + 有效磁盘数
      minimum-idle: 5             # 最小空闲连接（默认等于 maximum-pool-size）
      idle-timeout: 600000        # 空闲连接最大存活时间（10分钟）
      max-lifetime: 1800000       # 连接最大生命周期（30分钟，应小于数据库连接超时）
      connection-timeout: 30000   # 等待连接超时（30秒）
      connection-test-query: "SELECT 1"
      leak-detection-threshold: 60000  # 连接泄漏检测（仅开发环境启用）
```

**连接池大小公式：** `connections = ((core_count * 2) + effective_spindle_count)`

### 7.2 PgBouncer

当微服务实例数激增时，数据库直接连接数会成倍增长。PgBouncer 作为轻量级连接池代理，将大量短连接复用为少数长连接。

**pool_mode 选择：**

| 模式 | 含义 | 适用场景 |
|------|------|----------|
| `session` | 一个客户端连接绑定一个服务器连接 | 需要 prepared statement / SET 变量 |
| `transaction` | 仅在事务期间占用服务器连接 | 通用 Web 应用（推荐） |
| `statement` | 仅在单条语句期间占用 | 自动提交模式，极少使用 |

```ini
# pgbouncer.ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
reserve_pool_timeout = 3.0
```

---

## 八、分区表

```sql
-- Range 分区（按日期）
CREATE TABLE events (
    id BIGSERIAL,
    event_type TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_q1 PARTITION OF events
FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE events_2026_q2 PARTITION OF events
FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

-- 分区裁剪自动生效
SELECT * FROM events WHERE created_at BETWEEN '2026-02-01' AND '2026-02-28';
-- 只扫描 events_2026_q1 分区

-- List 分区（按类型）
CREATE TABLE orders PARTITION BY LIST (region);

CREATE TABLE orders_us PARTITION OF orders FOR VALUES IN ('US', 'CA');
CREATE TABLE orders_eu PARTITION OF orders FOR VALUES IN ('UK', 'DE', 'FR');

-- Hash 分区（按 user_id 均匀分布）
CREATE TABLE user_logs PARTITION BY HASH (user_id);

CREATE TABLE user_logs_p0 PARTITION OF user_logs FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE user_logs_p1 PARTITION OF user_logs FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE user_logs_p2 PARTITION OF user_logs FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE user_logs_p3 PARTITION OF user_logs FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

---

## 九、常用扩展

### 9.1 pg_stat_statements

```sql
CREATE EXTENSION pg_stat_statements;

-- Top 10 慢查询（总耗时）
SELECT queryid, LEFT(query, 120) AS query_preview,
       calls, mean_exec_time, total_exec_time,
       rows, shared_blks_hit, shared_blks_read
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 重置统计
SELECT pg_stat_statements_reset();
```

### 9.2 auto_explain

```sql
-- postgresql.conf
shared_preload_libraries = 'auto_explain'
auto_explain.log_min_duration = 1000  -- 记录超过1秒的查询计划
auto_explain.log_analyze = on
auto_explain.log_buffers = on
auto_explain.log_format = json
```

### 9.3 pg_cron

```sql
CREATE EXTENSION pg_cron;

-- 每天凌晨3点清理过期会话
SELECT cron.schedule(
    'cleanup-expired-sessions',
    '0 3 * * *',
    $$DELETE FROM user_sessions WHERE expires_at < NOW()$$
);

-- 每小时 VACUUM 高频更新表
SELECT cron.schedule(
    'vacuum-high-traffic',
    '0 * * * *',
    'VACUUM ANALYZE high_traffic_events'
);
```

---

## 常见问题

**Q: pgvector 能支持多少向量？**
A: 无硬限制。100 万向量内索引效果良好；1000 万以上需考虑分区表 + 合理调优 `lists/m`。

**Q: VACUUM FULL 阻塞多久？**
A: 取决于表大小。大表可能数小时。优先使用 `pg_repack` 进行在线重建。

**Q: HNSW 索引占用多少内存？**
A: `m * 向量数 * 维度 * 4bytes`。例如 m=16, 100 万 1536 维向量 ≈ 98GB。生产环境需保证 `shared_buffers + OS Cache` 能容纳索引。

**Q: 什么时候用流复制 vs 逻辑复制？**
A: 读写分离/灾备用流复制；CDC/跨版本升级/部分表同步用逻辑复制。

---

## 相关条目

- [[04-Redis深度解析]] — Redis 缓存与向量检索
- [[04-Elasticsearch深度解析]] — Elasticsearch 全文检索与混合搜索
- [[04-对象存储与中间件扩展]] — 对象存储与 AI 文件链路
- [[05-分布式一致性与事务方案]] — 分布式事务（含 Outbox Pattern）
