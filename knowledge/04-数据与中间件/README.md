# 04 — 数据与中间件

> PostgreSQL、Redis、Kafka、Elasticsearch、对象存储。

## 子域

| 子域 | 条目 |
|------|------|
| [数据库与缓存](数据库与缓存/) | PostgreSQL + pgvector、Redis（含向量检索、分布式锁） |
| [消息与搜索](消息与搜索/) | Kafka（含KRaft、事务）、Elasticsearch（含混合检索、语义重排） |
| [对象存储](对象存储/) | MinIO、S3兼容API、RabbitMQ对比选型 |

## 默认选型

| 场景 | 主选 |
|------|------|
| 默认数据库 | PostgreSQL + pgvector |
| 全文/混合检索 | Elasticsearch |
| 实时上下文/缓存 | Redis |
| 大规模独立向量 | Qdrant / Milvus |
| 知识图谱 | Neo4j |
