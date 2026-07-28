---
domain: 04-数据与中间件
title: Elasticsearch 深度解析
status: verified
verification:
  reviewed_at: 2026-07-27
  version_anchor: Elasticsearch 9 reference
  code_status: tested
  lab: lab-rag-pipeline
  evidence:
    scope: article-core
    source_files:
      - labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/ChunkerDemo.java
      - labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/DeterministicRagPipeline.java
    test_files:
      - labs/lab-rag-pipeline/src/test/java/com/javaai/kb/labs/rag/DeterministicRagPipelineTest.java
  performance:
    status: illustrative
level: advanced
sources:
  - level: L1
    url: https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html
    description: Elasticsearch 9.x 官方参考文档
  - level: L2
    url: https://github.com/elastic/elasticsearch
    description: Elasticsearch 源码（倒排索引、相关性评分、集群管理）
  - level: L3
    url: https://www.oreilly.com/library/view/elasticsearch-the-definitive/
    description: "《Elasticsearch: The Definitive Guide》— Elastic 官方权威指南"
relations:
  prerequisite:
    - 01-数据库原理
    - 04-PostgreSQL与pgvector深度解析
  related:
    - 04-Redis深度解析
    - 11-向量检索与混合检索
tags:
  - elasticsearch
  - inverted-index
  - bm25
  - aggregation
  - knn
  - hybrid-search
  - rerank
  - rag
  - spring-data-elasticsearch
created: 2026-07-17
updated: 2026-07-27
content_type: production
---

# Elasticsearch 深度解析

> **性能数据声明：** 除非具体表格同时给出硬件、软件版本、数据规模、参数、
> 测试脚本、运行次数、P50/P95/P99、日期和原始结果链接，否则本文中的精确
> 性能数字均为“示意值，不代表基准结果”，不能用于容量规划或产品比较。

## 概述

Elasticsearch 是基于 Apache Lucene 的分布式搜索和分析引擎，在 AI 应用中承担全文检索、向量检索、混合搜索和语义重排等核心角色。RAG 系统典型的检索流水线中，ES 作为多阶段检索的执行引擎：BM25 关键词检索 → kNN 向量检索 → 语义重排。

本文深入倒排索引原理、分析器链、查询 DSL、相关性评分机制、向量检索能力、集群管理和性能优化。

---

## 一、基础概念

### 1.1 核心抽象

| 概念 | Elasticsearch | 关系数据库类比 |
|------|--------------|---------------|
| Index | 索引 | Table |
| Document | 文档 | Row |
| Field | 字段 | Column |
| Mapping | 映射 | Schema |
| Shard | 分片 | Partition |
| Replica | 副本 | Replica |

### 1.2 索引架构

```
Index (逻辑)
├── Primary Shard 0 ────── Replica Shard 0 (在另一个节点)
├── Primary Shard 1 ────── Replica Shard 1
└── Primary Shard 2 ────── Replica Shard 2

每个 Shard 是一个独立的 Lucene Index
```

### 1.3 倒排索引原理

倒排索引是 Elasticsearch 高效全文检索的基础。

**数据结构：**

```
倒排索引 = Term Dictionary + Posting List

Term Dictionary (FST/Finite State Transducer, 内存映射):
  "elasticsearch" → term_id: 3
  "kafka"         → term_id: 7
  "redis"         → term_id: 12

Posting List (倒排表 + 跳表/Skip List):
  term_id: 3 → [doc_id: [1(tf=2), 5(tf=1), 9(tf=3)]]
               └─ skip: doc_id 1 → doc_id 5 → doc_id 9
```

**跳表（Skip List）加速交集运算：**

```
Query: "elasticsearch AND kafka"
doc_ids(elasticsearch): [1, 5, 9, 15, 20, ...]
doc_ids(kafka):         [3, 5, 8, 20, ...]

使用跳表快速定位：
1. elasticsearch[0]=1 < kafka[0]=3 → 移动 elasticsearch
2. 都定位到 5 → 匹配！都移动
3. elasticsearch[2]=9 > kafka[2]=8 → 移动 kafka
4. 都定位到 20 → 匹配！
```

**字段存储方式：**

| 存储方式 | 用途 | 查询类型 |
|----------|------|----------|
| `inverted index` | 全文检索 | match, match_phrase |
| `doc_values` | 聚合、排序 | terms aggregation, sort |
| `fielddata` | 聚合、排序（text 类型，已废弃） | — |
| `_source` | 原始 JSON 文档 | 返回搜索结果 |
| `stored fields` | 特定字段原始值 | stored_fields 参数 |

---

## 二、分析器（Analyzer）

### 2.1 分析器链

```
"Hello, Elasticsearch 2026!"
        │
        ▼
┌────────────────────┐
│ Character Filter   │ ← HTML 剥离、特殊字符映射
│ → "Hello, Elasticsearch 2026!"
└────────┬───────────┘
         ▼
┌────────────────────┐
│ Tokenizer          │ ← 按规则切分 Token
│ → [Hello, Elasticsearch, 2026]
└────────┬───────────┘
         ▼
┌────────────────────┐
│ Token Filters      │ ← 小写化、停用词、同义词、N-gram
│ → [hello, elasticsearch, 2026]
└────────────────────┘
```

### 2.2 自定义分析器

```json
PUT /my_index
{
  "settings": {
    "analysis": {
      "char_filter": {
        "my_char_filter": {
          "type": "mapping",
          "mappings": ["&=> and", "=>=> greater_than"]
        }
      },
      "filter": {
        "my_stop": {
          "type": "stop",
          "stopwords": ["_english_", "the", "a"]
        },
        "my_synonym": {
          "type": "synonym",
          "synonyms": ["AI, artificial intelligence, 人工智能"]
        }
      },
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "char_filter": ["html_strip", "my_char_filter"],
          "tokenizer": "standard",
          "filter": ["lowercase", "my_stop", "my_synonym"]
        }
      }
    }
  }
}
```

### 2.3 ik 分词器

中文分词首选插件 `elasticsearch-analysis-ik`。

| 模式 | 粒度 | 示例 | 适用场景 |
|------|------|------|----------|
| `ik_smart` | 最粗 | "中华人民共和国" → ["中华人民共和国"] | 短语匹配 |
| `ik_max_word` | 最细 | "中华人民共和国" → ["中华人民共和国", "中华人民", "中华", "华人", "人民共和国", "人民", "共和国", "共和", "国"] | 索引阶段（提高召回率） |

```json
PUT /docs
{
  "settings": {
    "analysis": {
      "analyzer": {
        "ik_index_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase"]
        },
        "ik_search_analyzer": {
          "type": "custom",
          "tokenizer": "ik_smart",
          "filter": ["lowercase"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_index_analyzer",
        "search_analyzer": "ik_search_analyzer"
      }
    }
  }
}
```

**索引时细粒度 + 搜索时粗粒度** 是最佳实践：提高召回率同时保证精度。

---

## 三、查询 DSL

### 3.1 Bool Query

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "spring ai" } }
      ],
      "filter": [
        { "term": { "status": "published" } },
        { "range": { "created_at": { "gte": "2026-01-01" } } }
      ],
      "should": [
        { "term": { "tags": "ai" } },
        { "term": { "tags": "machine-learning" } }
      ],
      "must_not": [
        { "term": { "status": "deleted" } }
      ],
      "minimum_should_match": 1
    }
  }
}
```

| 子句 | 用途 | 对评分的影响 | 缓存 |
|------|------|-------------|------|
| `must` | AND 逻辑，必须匹配 | 参与计分 | 不缓存 |
| `filter` | 精确过滤 | 不计分 | 自动缓存 |
| `should` | OR 逻辑 | 参与计分 | 不缓存 |
| `must_not` | NOT 逻辑 | 不计分 | 自动缓存 |

### 3.2 核心查询类型

```json
// Term 查询（不分词，精确匹配keyword类型）
{ "term": { "user_id": "12345" } }

// Terms 查询（多值精确匹配）
{ "terms": { "tags": ["java", "spring", "ai"] } }

// Match 查询（分词后匹配）
{ "match": { "content": "分布式事务实现" } }

// Match Phrase 查询（分词+顺序匹配）
{ "match_phrase": { "content": "分布式事务", "slop": 2 } }

// Multi-Match 查询（多字段搜索）
{
  "multi_match": {
    "query": "spring ai pgvector",
    "fields": ["title^3", "content", "tags^2"]
  }
}

// Range 查询
{
  "range": {
    "price": { "gte": 100, "lte": 500 }
  }
}

// Wildcard 查询（性能差，避免前导通配符）
{ "wildcard": { "email": "*@example.com" } }
```

### 3.3 聚合（Aggregation）

**Bucket 聚合（分桶）：**

```json
{
  "size": 0,
  "aggs": {
    "status_distribution": {
      "terms": { "field": "status", "size": 10 }
    },
    "date_histogram": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "1d"
      }
    }
  }
}
```

**Metrics 聚合（计算）：**

```json
{
  "size": 0,
  "aggs": {
    "avg_response_time": { "avg": { "field": "response_time_ms" } },
    "max_response_time": { "max": { "field": "response_time_ms" } },
    "p95_response_time": {
      "percentiles": { "field": "response_time_ms", "percents": [50, 95, 99] }
    }
  }
}
```

**Pipeline 聚合（对聚合结果的二次计算）：**

```json
{
  "size": 0,
  "aggs": {
    "daily_orders": {
      "date_histogram": { "field": "created_at", "calendar_interval": "day" },
      "aggs": {
        "order_count": { "value_count": { "field": "id" } }
      }
    },
    "avg_daily_orders": {
      "avg_bucket": {
        "buckets_path": "daily_orders>order_count"
      }
    }
  }
}
```

---

## 四、相关性评分

### 4.1 BM25 公式

Elasticsearch 默认使用 BM25（Best Matching 25）评分：

```
score(doc, query) = sum(
  IDF(qi) * (f(qi, doc) * (k1 + 1)) / (f(qi, doc) + k1 * (1 - b + b * |doc| / avg_doc_len))
)
where:
- IDF(qi) = log(1 + (docCount - f(qi) + 0.5) / (f(qi) + 0.5))
- f(qi, doc) = 词项 qi 在文档 doc 中的频率
- |doc| = 文档长度
- avg_doc_len = 平均文档长度
- k1 = 1.2 (词频饱和参数)
- b = 0.75 (长度归一化参数)
```

### 4.2 Explain API

```json
GET /my_index/_explain/doc_id
{
  "query": { "match": { "title": "elasticsearch" } }
}

// 返回：
{
  "value": 3.14,
  "description": "weight(title:elasticsearch in 42) [PerFieldSimilarity], result of:",
  "details": [
    {
      "value": 3.14,
      "description": "score(freq=3.0), computed as boost * idf * tf from:",
      "details": [
        { "value": 2.2, "description": "idf, computed as ..." },
        { "value": 1.43, "description": "tf, computed as ..." }
      ]
    }
  ]
}
```

### 4.3 Function Score

```json
{
  "query": {
    "function_score": {
      "query": { "match": { "title": "elasticsearch" } },
      "boost_mode": "multiply",
      "functions": [
        {
          "filter": { "term": { "is_verified": true } },
          "weight": 2
        },
        {
          "field_value_factor": {
            "field": "popularity",
            "modifier": "log1p",
            "factor": 0.1
          }
        },
        {
          "gauss": {
            "publish_date": {
              "origin": "2026-07-17",
              "scale": "30d",
              "decay": 0.5
            }
          }
        }
      ]
    }
  }
}
```

---

## 五、向量检索

### 5.1 dense_vector 类型

```json
PUT /docs
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "content": { "type": "text" },
      "title_vector": {
        "type": "dense_vector",
        "dims": 1536,
        "index": true,
        "similarity": "cosine"
      },
      "content_vector": {
        "type": "dense_vector",
        "dims": 1536,
        "index": true,
        "similarity": "dot_product"
      }
    }
  }
}
```

### 5.2 kNN 查询

```json
GET /docs/_search
{
  "knn": {
    "field": "content_vector",
    "query_vector": [0.12, -0.34, 0.56, ...],
    "k": 10,
    "num_candidates": 100
  }
}
```

### 5.3 混合检索（RRF 融合）

```json
GET /docs/_search
{
  "sub_searches": [
    {
      "query": {
        "match": {
          "content": {
            "query": "分布式事务实现方案",
            "boost": 1.0
          }
        }
      }
    },
    {
      "knn": {
        "field": "content_vector",
        "query_vector": [0.12, -0.34, ...],
        "k": 10,
        "num_candidates": 50
      }
    }
  ],
  "rank": {
    "rrf": {
      "window_size": 50,
      "rank_constant": 60
    }
  }
}
```

### 5.4 语义重排

```json
// 使用 text_similarity_reranker（ES 8.15+ 支持 Cross-Encoder 重排）
GET /docs/_search
{
  "retriever": {
    "standard": {
      "query": {
        "match": { "content": "如何实现分布式事务" }
      }
    }
  },
  "rank": {
    "rrf": { /* ... */ }
  },
  "retrievers": {
    "rrf_reranker": {
      "text_similarity_reranker": {
        "retriever": {
          "standard": { /* ... */ }
        },
        "field": "content",
        "inference_id": "my-cross-encoder",
        "inference_text": "如何实现分布式事务",
        "min_score": 0.5
      }
    }
  }
}
```

---

## 六、索引优化

### 6.1 Mapping 设计

```json
PUT /optimized_docs
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "30s",      // 降低刷新频率提高写入性能
    "index": {
      "sort.field": "created_at",   // 索引排序（提升范围查询）
      "sort.order": "desc"
    }
  },
  "mappings": {
    "dynamic": "strict",            // 禁止动态映射，防止字段爆炸
    "_source": { "enabled": true },
    "properties": {
      "id": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",
        "fields": {
          "keyword": { "type": "keyword" }  // 多字段映射
        }
      },
      "status": { "type": "keyword", "doc_values": true },
      "created_at": { "type": "date", "doc_values": true },
      "content_vector": {
        "type": "dense_vector",
        "dims": 1536,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}
```

### 6.2 Refresh / Flush / Merge

| 操作 | 触发条件 | 作用 |
|------|----------|------|
| Refresh | 默认 1s | 将内存中的文档写入 Segment（可搜索） |
| Flush | 30m 或 translog 满 | 将 Segment 持久化到磁盘 + 清空 translog |
| Merge | 自动后台 | 合并小 Segment 为大 Segment |

```json
PUT /my_index/_settings
{
  "refresh_interval": "30s",
  "translog": {
    "durability": "async",
    "sync_interval": "5s"
  }
}
```

### 6.3 Force Merge

```json
// 索引不再写入后，强制合并减少 Segment 数量
POST /my_index/_forcemerge?max_num_segments=1&only_expunge_deletes=true

// 批量重建索引后执行
POST /rebuild_target/_forcemerge?max_num_segments=5
```

**注意：** Force merge 是 I/O 密集型操作，仅在索引写入停止后执行，生产环境使用 `max_num_segments=5-10` 而非 1。

### 6.4 段合并策略

```json
PUT /my_index/_settings
{
  "index.merge.policy.max_merged_segment": "5gb",
  "index.merge.policy.segments_per_tier": 10,
  "index.merge.policy.max_merge_at_once": 10
}
```

---

## 七、集群管理

### 7.1 集群健康状态

| 状态 | 含义 |
|------|------|
| Green | 所有主分片和副本已分配 |
| Yellow | 所有主分片已分配，部分副本未分配 |
| Red | 部分主分片未分配（数据丢失/不可用） |

```json
GET /_cluster/health
GET /_cat/shards?v
GET /_cat/indices?v
```

### 7.2 Master 选举

Master 节点负责集群元数据管理（索引创建/删除、分片分配、节点增删）。

```
Zen Discovery (ES 7.x-) → 基于 Bully 算法的单轮选举
ES 8.x+ → 改进的选举协议，使用基于 term 的共识

候选 Master 节点配置：
node.roles: [master, data_content]  # 默认
node.roles: [master]                # 专用 Master（推荐大型集群）
```

### 7.3 Hot-Warm-Cold 架构

```
              写入
 ┌─────────────────────────────────┐
 │   Hot Nodes (SSD, 高性能)        │  ← 近期数据 (0-7 天)
 │   CPU/Memory optimized          │
 └───────────────┬─────────────────┘
                 │ ILM 迁移 (7 天)
 ┌───────────────▼─────────────────┐
 │   Warm Nodes (HDD, 中等性能)     │  ← 历史数据 (7-30 天)
 │   less replicas, merged segments│
 └───────────────┬─────────────────┘
                 │ ILM 迁移 (30 天)
 ┌───────────────▼─────────────────┐
 │   Cold Nodes (HDD, 高密度)      │  ← 归档数据 (30+ 天)
 │   force merged, searchable snap │
 └─────────────────────────────────┘
```

```json
PUT _ilm/policy/logs_policy
{
  "phases": {
    "hot": {
      "actions": { "rollover": { "max_size": "50GB", "max_age": "1d" } }
    },
    "warm": {
      "min_age": "7d",
      "actions": {
        "forcemerge": { "max_num_segments": 1 },
        "shrink": { "number_of_shards": 1 },
        "allocate": { "require": { "data": "warm" } }
      }
    },
    "delete": {
      "min_age": "90d",
      "actions": { "delete": {} }
    }
  }
}
```

---

## 八、性能优化

### 8.1 查询缓存

| 缓存类型 | 作用域 | 内容 |
|----------|--------|------|
| Node Query Cache | 节点级 | Filter 子句的 bitset 结果 |
| Shard Request Cache | 分片级 | 整个查询的序列化结果 |
| Fielddata Cache | 分片级 | text 字段聚合（已基本不用） |

```json
GET /_nodes/stats/indices/query_cache
GET /_nodes/stats/indices/request_cache
```

### 8.2 doc_values

默认所有 keyword、date、numeric、geo_point 类型字段开启 `doc_values`（列式存储），用于聚合和排序。

```json
// 始终不需要聚合排序的字段关闭 doc_values 节省磁盘
{
  "mappings": {
    "properties": {
      "raw_content": {
        "type": "keyword",
        "doc_values": false
      }
    }
  }
}
```

### 8.3 性能诊断

```json
// Profile API（分析各组件耗时）
GET /docs/_search
{
  "profile": true,
  "query": { "match": { "content": "elasticsearch" } }
}

// Hot Threads（查看繁忙线程）
GET /_nodes/hot_threads

// Nodes Stats（节点统计）
GET /_nodes/stats/indices,os,jvm,thread_pool
```

---

## 九、Java 客户端

### 9.1 Elasticsearch Java Client

```java
@Configuration
public class ElasticsearchConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        var restClient = RestClient.builder(
                HttpHost.create("http://localhost:9200"))
                .setHttpClientConfigCallback(httpClientBuilder ->
                        httpClientBuilder.setDefaultCredentialsProvider(() ->
                                new UsernamePasswordCredentials("user", "pass")))
                .build();
        var transport = new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}

@Service
public class DocumentSearchService {

    private final ElasticsearchClient client;

    public List<Doc> hybridSearch(String query, float[] queryVector, int topK) throws IOException {
        var response = client.search(s -> s
                .index("docs")
                .subSearches(ss -> ss
                        .subSearch(sub -> sub
                                .query(q -> q.match(m -> m.field("content").query(query))))
                        .subSearch(sub -> sub
                                .knn(k -> k.field("content_vector")
                                        .queryVector(queryVector).k(topK).numCandidates(100))))
                .rank(r -> r.rrf(rrf -> rrf.windowSize(50).rankConstant(60))),
                Doc.class);

        return response.hits().hits().stream()
                .map(hit -> hit.source())
                .toList();
    }
}
```

### 9.2 Spring Data Elasticsearch

```java
@Document(indexName = "docs")
public record Doc(
        @Id String id,
        @Field(type = FieldType.Text, analyzer = "ik_max_word") String title,
        @Field(type = FieldType.Text, analyzer = "ik_max_word") String content,
        @Field(type = FieldType.Dense_Vector, dims = 1536) float[] contentVector,
        @Field(type = FieldType.Date) Instant createdAt
) {}

@Repository
public interface DocRepository extends ElasticsearchRepository<Doc, String> {

    // 全文搜索
    @Query("{\"match\": {\"content\": \"?0\"}}")
    List<Doc> searchByContent(String query);

    // 混合搜索（全文 + 向量）需要在 Service 层组合实现
}
```

---

## 十、AI 场景：RAG 检索流水线

```
RAG 三阶段检索流水线：

Query: "Spring AI pgvector混合检索的实现"
          │
          ▼
┌──────────────────────────┐
│ Stage 1: BM25 关键词检索   │  ← Elasticsearch match query
│ 召回 top-100              │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ Stage 2: kNN 向量检索     │  ← Elasticsearch kNN query
│ 召回 top-100              │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ RRF 融合                  │  ← Rank Fusion: BM25 + Vector
│ 产生 top-50 候选集        │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ Stage 3: Cross-Encoder   │  ← text_similarity_reranker
│ 语义重排 top-50 → top-10  │
└──────────┬───────────────┘
           ▼
         返回 top-10 到 RAG 上下文
```

---

## 常见问题

**Q: ES 内存应该设多大？**
A: JVM heap 不超过 32GB（压缩指针优势），不超过机器内存的 50%。剩下给 OS Page Cache（Lucene 使用）。

**Q: 分片数怎么定？**
A: 单分片 10-50GB 为宜。太小浪费资源，太大恢复慢。公式：`shards = ceil(data_size / 30GB)`。

**Q: 什么时候用索引排序（index sorting）？**
A: 主要为 range 聚合加速（如时序数据按时间排序）。

**Q: ES 和 pgvector 怎么分工？**
A: pgvector 适合"与业务数据紧耦合的向量检索"；ES 适合"大规模多维度检索（全文+向量+聚合+过滤）"。

---

## 相关条目

- [[04-PostgreSQL与pgvector深度解析]] — pgvector 与 ES 向量检索对比
- [[04-Kafka深度解析]] — CDC → Kafka → ES 索引更新管道
- [[11-向量检索与混合检索]] — 混合检索 RRF 融合原理
