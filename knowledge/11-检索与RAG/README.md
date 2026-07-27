# 11 — 检索与RAG

> 向量检索、关键词检索、混合检索、重排、引用、高级RAG、GraphRAG。

## RAG 完整流水线

```
文档加载 → 清洗 → 切片 → 元数据与ACL → Embedding → 向量索引
                                                      ↓
Query理解 → Query改写 → Metadata过滤 → 稀疏/稠密检索 → 混合融合
    → Rerank → Context压缩 → Prompt组装 → 答案生成 → 引用 → 评估
```

## 子域

| 子域 | 条目 |
|------|------|
| [检索技术](检索技术/) | HNSW/IVFFlat向量检索、BM25、RRF混合检索、Cross-Encoder重排、Lost in the Middle |
| [RAG实现](RAG实现/) | 10种高级RAG模式(Parent-Child/CRAG/GraphRAG等)、完整企业RAG流水线Java实现 |

## 主栈

PostgreSQL + pgvector + Elasticsearch + Spring AI 2.x
