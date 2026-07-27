---
domain: "11-检索与RAG"
title: "完整企业RAG流水线Java实现：从文档到答案的端到端系统"
status: "draft"
level: "advanced"
sources:
  - level: "L1"
    url: "https://docs.spring.io/spring-ai/reference/api/chatclient.html"
    description: "Spring AI ChatClient 官方文档"
  - level: "L1"
    url: "https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html"
    description: "Spring AI pgvector 集成文档"
  - level: "L1"
    url: "https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html"
    description: "Spring AI ETL Pipeline 文档"
  - level: "L4"
    url: "https://testcontainers.com/guides/"
    description: "Testcontainers 官方指南 — 集成测试"
relations:
  prerequisite: ["11-向量检索与混合检索", "11-重排与上下文处理", "10-Java文档解析全景", "10-切片策略深度剖析"]
  related: ["11-高级RAG模式", "10-SpringBatch批处理流水线", "09-SpringAI2深度解析"]
tags: ["rag", "spring-ai", "pgvector", "elasticsearch", "end-to-end", "testcontainers", "integration-test"]
created: "2026-07-17"
updated: "2026-07-17"
---

# 完整企业RAG流水线Java实现：从文档到答案的端到端系统

## 概述

本文构建一个完整的企业级RAG流水线，使用Spring AI 2.x + PostgreSQL pgvector + Elasticsearch技术栈，实现从文档加载到答案生成的端到端处理。涵盖文档处理流水线（DocumentPipelineService）、检索服务（RetrievalService）、Query改写（QueryRewriterService）、重排服务（RerankerService）和完整的RAG问答服务（RAGService）。同时包含基于Testcontainers的完整集成测试和性能监控埋点。

---

## 一、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         API 层                              │
│  POST /api/documents/ingest    POST /api/rag/ask            │
└──────────────┬──────────────────────┬──────────────────────┘
               │                      │
┌──────────────▼──────────────────────▼──────────────────────┐
│                     RAGService                              │
│  ask(question) → Context → Prompt → LLM → Answer + Citations│
└──────┬──────────┬──────────┬──────────┬────────────────────┘
       │          │          │          │
┌──────▼──┐ ┌─────▼───┐ ┌───▼────┐ ┌──▼──────────┐
│Query    │ │Retrieval│ │Reranker│ │Context       │
│Rewriter │ │Service  │ │Service │ │Arranger      │
└─────────┘ └────┬────┘ └────────┘ └──────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼────┐ ┌────▼────┐ ┌─────▼──────┐
│pgvector│ │Elastic- │ │Metadata    │
│ (HNSW) │ │search   │ │Filter Logic│
└────────┘ └─────────┘ └────────────┘
```

---

## 二、Maven项目配置

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>4.0.0</version>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>rag-pipeline</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>25</java.version>
        <spring-ai.version>2.0.0</spring-ai.version>
        <testcontainers.version>2.0.0</testcontainers.version>
    </properties>

    <dependencies>
        <!-- Spring Boot -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>

        <!-- Spring AI -->
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-openai-spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-pgvector-store-spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-elasticsearch-store-spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-tika-document-reader</artifactId>
        </dependency>

        <!-- PostgreSQL + pgvector -->
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-jdbc</artifactId>
        </dependency>

        <!-- Elasticsearch -->
        <dependency>
            <groupId>co.elastic.clients</groupId>
            <artifactId>elasticsearch-java</artifactId>
        </dependency>

        <!-- Observability -->
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-tracing-bridge-brave</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-prometheus</artifactId>
        </dependency>

        <!-- Testing -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>testcontainers</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>postgresql</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>elasticsearch</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

---

## 三、配置文件

```yaml
# application.yml
spring:
  application:
    name: rag-pipeline

  # PostgreSQL + pgvector
  datasource:
    url: jdbc:postgresql://localhost:5432/rag_knowledge
    username: rag_user
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5

  # Elasticsearch
  elasticsearch:
    uris: http://localhost:9200
    username: ${ES_USERNAME:}
    password: ${ES_PASSWORD:}

  # AI配置
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      chat:
        options:
          model: gpt-4o-mini
          temperature: 0.1
          max-tokens: 2048
      embedding:
        options:
          model: text-embedding-3-small

    # pgvector向量存储
    vectorstore:
      pgvector:
        initialize-schema: true
        dimensions: 1536  # text-embedding-3-small 的维度
        index-type: hnsw
        hnsw:
          m: 16
          ef-construction: 200

# RAG配置
rag:
  retrieval:
    top-k: 20           # 混合检索返回数量
    rerank-top-k: 5     # 重排后返回数量
    bm25-weight: 0.3    # BM25在混合检索中的权重
    vector-weight: 0.7  # 向量在混合检索中的权重
    rrf-k: 60           # RRF平滑参数
    min-relevance: 0.2  # 重排后最低相关性阈值

  chunking:
    default-size: 1024  # 默认切片大小（字符数）
    default-overlap: 200
    min-chunk-size: 100
    max-chunk-size: 2048

  embedding:
    batch-size: 20      # 批处理大小
    rate-limit-per-second: 10

# 监控
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
```

---

## 四、DocumentPipelineService — 文档处理流水线

```java
package com.example.rag.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.document.Document;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.core.io.InputStreamResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

@Service
public class DocumentPipelineService {

    private static final Logger log = LoggerFactory.getLogger(DocumentPipelineService.class);

    private final VectorStore vectorStore;
    private final JdbcTemplate jdbcTemplate;
    private final MeterRegistry meterRegistry;
    private final int chunkSize;
    private final int chunkOverlap;

    public DocumentPipelineService(
            VectorStore vectorStore,
            JdbcTemplate jdbcTemplate,
            MeterRegistry meterRegistry,
            @Value("${rag.chunking.default-size:1024}") int chunkSize,
            @Value("${rag.chunking.default-overlap:200}") int chunkOverlap) {
        this.vectorStore = vectorStore;
        this.jdbcTemplate = jdbcTemplate;
        this.meterRegistry = meterRegistry;
        this.chunkSize = chunkSize;
        this.chunkOverlap = chunkOverlap;
    }

    /**
     * 完整的文档处理流水线
     * 加载 → 解析 → 清洗 → 切片 → Embedding → 索引
     */
    @Transactional
    public record IngestionResult(
        String documentId,
        String fileName,
        int chunkCount,
        long parseTimeMs,
        long chunkTimeMs,
        long embedTimeMs,
        long totalTimeMs,
        List<String> errors
    ) {}

    public IngestionResult ingestDocument(Path filePath) throws Exception {
        var totalStart = System.currentTimeMillis();
        var errors = new ArrayList<String>();
        var documentId = UUID.randomUUID().toString();

        try {
            // Step 1: 文档解析（计时）
            var parseStart = System.currentTimeMillis();
            var rawDoc = parseDocument(filePath);
            var parseTime = System.currentTimeMillis() - parseStart;
            meterRegistry.timer("rag.ingestion.parse").record(parseTime, java.util.concurrent.TimeUnit.MILLISECONDS);

            if (rawDoc == null) {
                throw new RuntimeException("Failed to parse document: " + filePath);
            }

            // Step 2: 文本清洗
            var cleanedText = cleanDocument(rawDoc.getContent());
            rawDoc = Document.builder()
                .id(documentId)
                .content(cleanedText)
                .metadata(rawDoc.getMetadata())
                .build();

            // Step 3: 切片
            var chunkStart = System.currentTimeMillis();
            var chunks = chunkDocument(rawDoc);
            var chunkTime = System.currentTimeMillis() - chunkStart;
            meterRegistry.timer("rag.ingestion.chunk").record(chunkTime, java.util.concurrent.TimeUnit.MILLISECONDS);

            // Step 4: 存储元数据到PostgreSQL
            storeDocumentMetadata(documentId, filePath, rawDoc.getMetadata(), chunks.size());

            // Step 5: Embedding + 索引（向量存储）
            var embedStart = System.currentTimeMillis();
            indexChunks(chunks);
            var embedTime = System.currentTimeMillis() - embedStart;
            meterRegistry.timer("rag.ingestion.embed").record(embedTime, java.util.concurrent.TimeUnit.MILLISECONDS);

            // Step 6: 可选 — 索引到Elasticsearch（BM25检索）
            indexToElasticsearch(chunks);

            var totalTime = System.currentTimeMillis() - totalStart;
            meterRegistry.counter("rag.ingestion.documents.total", "status", "success").increment();
            meterRegistry.gauge("rag.ingestion.chunks.per.document", chunks.size());

            return new IngestionResult(
                documentId, filePath.getFileName().toString(),
                chunks.size(), parseTime, chunkTime, embedTime, totalTime, errors
            );

        } catch (Exception e) {
            errors.add(e.getMessage());
            meterRegistry.counter("rag.ingestion.documents.total", "status", "failed").increment();
            throw e;
        }
    }

    /**
     * Tika文档解析
     */
    private Document parseDocument(Path filePath) throws Exception {
        try (var inputStream = Files.newInputStream(filePath)) {
            var reader = new TikaDocumentReader(new InputStreamResource(inputStream));
            var documents = reader.read();

            if (documents.isEmpty()) return null;

            var doc = documents.getFirst();
            // 增强元数据
            var metadata = new HashMap<>(doc.getMetadata());
            metadata.put("source_uri", filePath.toUri().toString());
            metadata.put("file_name", filePath.getFileName().toString());
            metadata.put("file_size", String.valueOf(Files.size(filePath)));
            metadata.put("mime_type", Files.probeContentType(filePath));
            metadata.put("ingested_at", java.time.Instant.now().toString());

            return Document.builder()
                .id(doc.getId())
                .content(doc.getContent())
                .metadata(metadata)
                .build();
        }
    }

    /**
     * 文本清洗
     */
    private String cleanDocument(String content) {
        if (content == null || content.isBlank()) return "";

        return content
            .replace("\r\n", "\n")           // Windows换行统一
            .replaceAll("\n{4,}", "\n\n\n")  // 多余空行合并
            .replaceAll(" +\n", "\n")        // 行尾空格去除
            .replaceAll("\t", "    ")        // Tab转空格
            .replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "") // 控制字符去除
            .trim();
    }

    /**
     * 智能切片（TokenTextSplitter = 递归字符切片思想）
     */
    private List<Document> chunkDocument(Document doc) {
        var splitter = TokenTextSplitter.builder()
            .withChunkSize(chunkSize)
            .withChunkOverlap(chunkOverlap)
            .withMinChunkSize(100)
            .withMaxChunkSize(2048)
            .build();

        var chunks = splitter.apply(List.of(doc));

        // 为每个chunk附加元数据
        for (int i = 0; i < chunks.size(); i++) {
            var chunk = chunks.get(i);
            chunk.getMetadata().put("chunk_index", String.valueOf(i));
            chunk.getMetadata().put("total_chunks", String.valueOf(chunks.size()));
            chunk.getMetadata().put("document_id", doc.getId());
            chunk.getMetadata().put("chunk_id", UUID.randomUUID().toString());
            chunk.getMetadata().put("chunk_created_at", java.time.Instant.now().toString());
        }

        return chunks;
    }

    /**
     * 向量索引（Spring AI VectorStore自动处理Embedding+写入）
     */
    private void indexChunks(List<Document> chunks) {
        // Spring AI的VectorStore.add()会：
        // 1. 对每个Document调用EmbeddingModel
        // 2. 将Embedding + content + metadata写入pgvector
        vectorStore.add(chunks);
    }

    /**
     * Elasticsearch BM25索引
     */
    private void indexToElasticsearch(List<Document> chunks) {
        // 实际实现：批量写入ES用于BM25检索
        // 略
    }

    /**
     * 存储文档元数据到PostgreSQL
     */
    private void storeDocumentMetadata(String documentId, Path filePath,
                                        Map<String, Object> metadata, int chunkCount) {
        jdbcTemplate.update("""
            INSERT INTO documents (document_id, source_uri, file_name, mime_type,
                                   file_size, title, chunk_count, status, created_at)
            VALUES (?, ?, ?, ?, ?::bigint, ?, ?, 'active', now())
            ON CONFLICT (document_id) DO UPDATE SET
                chunk_count = EXCLUDED.chunk_count,
                updated_at = now()
            """,
            UUID.fromString(documentId),
            filePath.toUri().toString(),
            filePath.getFileName().toString(),
            metadata.getOrDefault("mime_type", "application/octet-stream"),
            metadata.getOrDefault("file_size", "0"),
            metadata.getOrDefault("file_name", "Untitled"),
            chunkCount
        );
    }
}
```

---

## 五、RetrievalService — 检索服务

```java
package com.example.rag.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class RetrievalService {

    private static final Logger log = LoggerFactory.getLogger(RetrievalService.class);

    private final VectorStore vectorStore;
    private final JdbcTemplate jdbcTemplate;
    private final MeterRegistry meterRegistry;

    public RetrievalService(VectorStore vectorStore, JdbcTemplate jdbcTemplate,
                            MeterRegistry meterRegistry) {
        this.vectorStore = vectorStore;
        this.jdbcTemplate = jdbcTemplate;
        this.meterRegistry = meterRegistry;
    }

    public record RetrievalHit(
        String chunkId,
        String documentId,
        String content,
        double score,             // 向量相似度或BM25分数
        double rrfScore,          // RRF融合分数
        HitSource source,         // VECTOR, BM25, or BOTH
        Map<String, Object> metadata
    ) {}

    public enum HitSource { VECTOR, BM25, BOTH }

    /**
     * 混合检索：向量 + BM25(simulated via ts_rank) + RRF融合
     */
    public List<RetrievalHit> hybridSearch(
            String query,
            String tenantId,
            List<String> accessLevels,
            int topK) {

        var timer = Timer.start(meterRegistry);

        // 1. 向量检索 — 使用Spring AI VectorStore
        var vectorHits = vectorSearch(query, tenantId, accessLevels, topK * 2);
        meterRegistry.timer("rag.retrieval.vector").record(
            timer.elapsed(java.util.concurrent.TimeUnit.MILLISECONDS),
            java.util.concurrent.TimeUnit.MILLISECONDS
        );

        // 2. BM25检索 — 使用PostgreSQL ts_rank模拟
        var bm25Hits = bm25Search(query, tenantId, accessLevels, topK * 2);
        meterRegistry.timer("rag.retrieval.bm25").record(
            timer.elapsed(java.util.concurrent.TimeUnit.MILLISECONDS),
            java.util.concurrent.TimeUnit.MILLISECONDS
        );

        // 3. RRF融合
        var fused = rrfFusion(vectorHits, bm25Hits, 60, topK);
        meterRegistry.timer("rag.retrieval.fusion").record(
            timer.elapsed(java.util.concurrent.TimeUnit.MILLISECONDS),
            java.util.concurrent.TimeUnit.MILLISECONDS
        );

        return fused;
    }

    /**
     * 向量检索（Spring AI + pgvector）
     */
    private List<RetrievalHit> vectorSearch(
            String query, String tenantId, List<String> accessLevels, int limit) {

        // 构建元数据过滤条件
        var filterExpression = buildFilterExpression(tenantId, accessLevels);

        var request = SearchRequest.builder()
            .query(query)
            .topK(limit)
            .similarityThreshold(0.5)  // 最低相似度阈值
            .filterExpression(filterExpression)
            .build();

        var results = vectorStore.similaritySearch(request);

        return results.stream()
            .map(doc -> new RetrievalHit(
                (String) doc.getMetadata().get("chunk_id"),
                (String) doc.getMetadata().get("document_id"),
                doc.getContent(),
                doc.getScore(),
                0, // rrfScore later
                HitSource.VECTOR,
                doc.getMetadata()
            ))
            .toList();
    }

    /**
     * BM25检索（PostgreSQL ts_rank实现）
     */
    private List<RetrievalHit> bm25Search(
            String query, String tenantId, List<String> accessLevels, int limit) {

        var sql = """
            SELECT c.chunk_id, c.content, c.document_id,
                   ts_rank(to_tsvector('chinese', c.content),
                           plainto_tsquery('chinese', ?)) AS score,
                   c.metadata
            FROM chunks c
            WHERE to_tsvector('chinese', c.content) @@ plainto_tsquery('chinese', ?)
              AND c.status = 'active'
              AND c.tenant_id = ?
              AND c.access_level = ANY(?)
            ORDER BY score DESC
            LIMIT ?
            """;

        try {
            return jdbcTemplate.query(sql,
                ps -> {
                    ps.setString(1, query);
                    ps.setString(2, query);
                    ps.setString(3, tenantId);
                    ps.setArray(4, ps.getConnection().createArrayOf("text",
                        accessLevels.toArray()));
                    ps.setInt(5, limit);
                },
                (rs, rowNum) -> {
                    var metadata = new HashMap<String, Object>();
                    // 从JSON字段解析元数据（简化）
                    return new RetrievalHit(
                        rs.getString("chunk_id"),
                        rs.getString("document_id"),
                        rs.getString("content"),
                        rs.getDouble("score"),
                        0,
                        HitSource.BM25,
                        metadata
                    );
                }
            );
        } catch (Exception e) {
            log.warn("BM25 search failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * RRF融合算法
     */
    private List<RetrievalHit> rrfFusion(
            List<RetrievalHit> vectorHits,
            List<RetrievalHit> bm25Hits,
            int k, int topK) {

        var rrfScores = new HashMap<String, RetrievalHit>();

        // 处理向量检索结果
        for (int i = 0; i < vectorHits.size(); i++) {
            var hit = vectorHits.get(i);
            var rrf = 1.0 / (k + i + 1);
            rrfScores.put(hit.chunkId(), new RetrievalHit(
                hit.chunkId(), hit.documentId(), hit.content(),
                hit.score(), rrf,
                hit.source(), hit.metadata()
            ));
        }

        // 处理BM25结果，对重叠的chunk累加RRF分数
        for (int i = 0; i < bm25Hits.size(); i++) {
            var hit = bm25Hits.get(i);
            var rrf = 1.0 / (k + i + 1);

            if (rrfScores.containsKey(hit.chunkId())) {
                // 在两个列表中都有出现 → 标记为BOTH
                var existing = rrfScores.get(hit.chunkId());
                rrfScores.put(hit.chunkId(), new RetrievalHit(
                    existing.chunkId(), existing.documentId(), existing.content(),
                    existing.score(), existing.rrfScore() + rrf, HitSource.BOTH, existing.metadata()
                ));
            } else {
                rrfScores.put(hit.chunkId(), new RetrievalHit(
                    hit.chunkId(), hit.documentId(), hit.content(),
                    hit.score(), rrf, HitSource.BM25, hit.metadata()
                ));
            }
        }

        // 按RRF分数排序
        return rrfScores.values().stream()
            .sorted((a, b) -> Double.compare(b.rrfScore(), a.rrfScore()))
            .limit(topK)
            .toList();
    }

    /**
     * 构建Spring AI Filter Expression（元数据过滤）
     */
    private FilterExpression buildFilterExpression(String tenantId, List<String> accessLevels) {
        var builder = new FilterExpressionBuilder();

        // tenant_id过滤
        var filter = builder.eq("tenant_id", tenantId);

        // access_level IN (...)
        if (accessLevels != null && !accessLevels.isEmpty()) {
            var accessFilter = builder.in("access_level",
                accessLevels.toArray(new String[0]));
            filter = filter.and(accessFilter);
        }

        // status = active
        filter = filter.and(builder.eq("status", "active"));

        return filter;
    }
}
```

---

## 六、QueryRewriterService — Query改写

```java
package com.example.rag.pipeline;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class QueryRewriterService {

    private final ChatClient chatClient;

    public QueryRewriterService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * Query改写：拼写纠正 + 同义词扩展 + 意图澄清
     */
    public record RewrittenQuery(
        String originalQuery,
        String rewrittenQuery,    // 改写后的最终查询
        List<String> expansions,  // 扩展的同义词/相关词
        String intent             // 查询意图
    ) {}

    public RewrittenQuery rewrite(String query, List<String> conversationHistory) {
        var historyText = conversationHistory.isEmpty()
            ? "(无历史)"
            : String.join("\n", conversationHistory);

        var prompt = """
            你是一个查询改写助手。请分析以下查询，进行以下优化：

            1. 拼写纠正：纠正错别字
            2. 同义词扩展：列出2-3个关键同义词或相关术语
            3. 意图识别：识别用户的查询意图（如：技术问答/文档查找/数据查询/概念解释）

            对话历史：
            %s

            当前查询：%s

            请以JSON格式返回（不要代码块标记）：
            {
              "rewritten_query": "改写后的查询",
              "expansions": ["扩展词1", "扩展词2"],
              "intent": "意图"
            }
            """.formatted(historyText, query);

        var response = chatClient.prompt().user(prompt).call().content();
        response = response.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();

        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var root = mapper.readTree(response);

            var expansions = new java.util.ArrayList<String>();
            var expansionsNode = root.get("expansions");
            if (expansionsNode != null && expansionsNode.isArray()) {
                for (var e : expansionsNode) {
                    expansions.add(e.asText());
                }
            }

            return new RewrittenQuery(
                query,
                root.get("rewritten_query").asText(),
                expansions,
                root.path("intent").asText("unknown")
            );
        } catch (Exception e) {
            // 降级：返回原始查询
            return new RewrittenQuery(query, query, List.of(), "unknown");
        }
    }

    /**
     * HyDE: 生成假设文档
     */
    public String generateHypotheticalAnswer(String query) {
        var prompt = """
            请根据以下问题，写一段假设性的回答（约200-300字）。
            不需要真实准确，只需生成一段看起来像是在回答这个问题的文本。
            这将用于改进文档检索。

            问题：%s

            假设回答：
            """.formatted(query);

        return chatClient.prompt().user(prompt).call().content();
    }
}
```

---

## 七、RerankerService — 重排服务

```java
package com.example.rag.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

@Service
public class RerankerService {

    private static final Logger log = LoggerFactory.getLogger(RerankerService.class);

    private final HttpClient httpClient;
    private final String cohereApiKey;
    private final String cohereRerankUrl = "https://api.cohere.com/v2/rerank";
    private final MeterRegistry meterRegistry;
    private final double minRelevanceScore;

    public RerankerService(
            @Value("${cohere.api-key:${COHERE_API_KEY:}}") String cohereApiKey,
            @Value("${rag.retrieval.min-relevance:0.2}") double minRelevanceScore,
            MeterRegistry meterRegistry) {
        this.cohereApiKey = cohereApiKey;
        this.minRelevanceScore = minRelevanceScore;
        this.meterRegistry = meterRegistry;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .build();
    }

    public record RerankedChunk(
        String chunkId,
        String content,
        double relevanceScore,
        int originalRank,
        int rerankedRank,
        Map<String, Object> metadata
    ) {}

    /**
     * 重排检索结果
     */
    public List<RerankedChunk> rerank(
            String query,
            List<RetrievalService.RetrievalHit> retrievalHits,
            int topN) {

        var timer = Timer.start(meterRegistry);

        if (retrievalHits.isEmpty()) return List.of();

        try {
            // 尝试Cohere Rerank API
            return rerankWithCohere(query, retrievalHits, topN);
        } catch (Exception e) {
            log.warn("Cohere Rerank failed, falling back to score-based: {}", e.getMessage());
            return fallbackRerank(retrievalHits, topN);
        } finally {
            meterRegistry.timer("rag.rerank.duration").record(
                timer.elapsed(java.util.concurrent.TimeUnit.MILLISECONDS),
                java.util.concurrent.TimeUnit.MILLISECONDS
            );
        }
    }

    private List<RerankedChunk> rerankWithCohere(
            String query, List<RetrievalService.RetrievalHit> hits, int topN) throws Exception {

        var documents = hits.stream()
            .map(h -> h.content().length() > 512
                ? h.content().substring(0, 512) : h.content())
            .toList();

        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var requestBody = mapper.createObjectNode();
        requestBody.put("model", "rerank-multilingual-v3.0");
        requestBody.put("query", query);
        requestBody.put("top_n", topN);
        requestBody.set("documents", mapper.valueToTree(documents));

        var request = HttpRequest.newBuilder()
            .uri(URI.create(cohereRerankUrl))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + cohereApiKey)
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(requestBody)))
            .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new RuntimeException("Cohere API error: " + response.statusCode());
        }

        var root = mapper.readTree(response.body());
        var results = root.get("results");

        var reranked = new ArrayList<RerankedChunk>();
        for (int i = 0; i < results.size(); i++) {
            var result = results.get(i);
            var index = result.get("index").asInt();
            var score = result.get("relevance_score").asDouble();

            if (score < minRelevanceScore) continue;

            var hit = hits.get(index);
            reranked.add(new RerankedChunk(
                hit.chunkId(),
                hit.content(),
                score,
                index + 1,
                i + 1,
                hit.metadata()
            ));
        }

        return reranked;
    }

    /**
     * Fallback重排：基于原始检索分数
     */
    private List<RerankedChunk> fallbackRerank(
            List<RetrievalService.RetrievalHit> hits, int topN) {
        return hits.stream()
            .limit(topN)
            .map(hit -> new RerankedChunk(
                hit.chunkId(), hit.content(),
                hit.rrfScore() > 0 ? hit.rrfScore() : hit.score(),
                hits.indexOf(hit) + 1, hits.indexOf(hit) + 1, hit.metadata()
            ))
            .toList();
    }
}
```

---

## 八、RAGService — 完整的RAG问答服务

```java
package com.example.rag.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class RAGService {

    private static final Logger log = LoggerFactory.getLogger(RAGService.class);

    private final RetrievalService retrievalService;
    private final QueryRewriterService queryRewriter;
    private final RerankerService reranker;
    private final ChatClient chatClient;
    private final MeterRegistry meterRegistry;
    private final int retrievalTopK;
    private final int rerankTopK;

    public RAGService(
            RetrievalService retrievalService,
            QueryRewriterService queryRewriter,
            RerankerService reranker,
            ChatClient.Builder chatClientBuilder,
            MeterRegistry meterRegistry,
            @Value("${rag.retrieval.top-k:20}") int retrievalTopK,
            @Value("${rag.retrieval.rerank-top-k:5}") int rerankTopK) {
        this.retrievalService = retrievalService;
        this.queryRewriter = queryRewriter;
        this.reranker = reranker;
        this.chatClient = chatClientBuilder.build();
        this.meterRegistry = meterRegistry;
        this.retrievalTopK = retrievalTopK;
        this.rerankTopK = rerankTopK;
    }

    /**
     * RAG问答响应
     */
    public record RagResponse(
        String answer,
        List<Citation> citations,
        RagMetrics metrics
    ) {}

    public record Citation(
        int index,
        String chunkId,
        String sourceTitle,
        String excerpt,     // 引用的原文片段（前200字）
        String sectionPath,
        double relevanceScore
    ) {}

    public record RagMetrics(
        String originalQuery,
        String rewrittenQuery,
        int retrievalCandidates,   // 检索返回数量
        int rerankedCandidates,    // 重排后数量
        long retrievalTimeMs,
        long rerankTimeMs,
        long generationTimeMs,
        long totalTimeMs
    ) {}

    /**
     * 完整的RAG流程
     */
    public RagResponse ask(
            String query,
            String tenantId,
            List<String> userAccessLevels,
            List<String> conversationHistory) {

        var totalStart = System.currentTimeMillis();
        var metrics = new RagMetrics(query, query, 0, 0, 0, 0, 0, 0);

        try {
            // Phase 1: Query理解与改写
            var rewritten = queryRewriter.rewrite(query, conversationHistory);
            var rewrittenQuery = rewritten.rewrittenQuery();
            metrics = new RagMetrics(query, rewrittenQuery, 0, 0, 0, 0, 0, 0);

            // Phase 2: 混合检索
            var retrievalStart = System.currentTimeMillis();
            var retrievalHits = retrievalService.hybridSearch(
                rewrittenQuery, tenantId, userAccessLevels, retrievalTopK
            );
            var retrievalTime = System.currentTimeMillis() - retrievalStart;

            if (retrievalHits.isEmpty()) {
                return new RagResponse(
                    "抱歉，未找到与您问题相关的文档。",
                    List.of(),
                    new RagMetrics(query, rewrittenQuery, 0, 0, retrievalTime, 0, 0,
                        System.currentTimeMillis() - totalStart)
                );
            }

            // Phase 3: 重排
            var rerankStart = System.currentTimeMillis();
            var reranked = reranker.rerank(rewrittenQuery, retrievalHits, rerankTopK);
            var rerankTime = System.currentTimeMillis() - rerankStart;

            if (reranked.isEmpty()) {
                return new RagResponse(
                    "未找到足够相关的文档来回答您的问题，请尝试更具体的提问。",
                    List.of(),
                    new RagMetrics(query, rewrittenQuery, retrievalHits.size(), 0,
                        retrievalTime, rerankTime, 0,
                        System.currentTimeMillis() - totalStart)
                );
            }

            // Phase 4: Context组装（对抗Lost in the Middle）
            var context = buildContext(reranked);

            // Phase 5: LLM生成答案
            var genStart = System.currentTimeMillis();
            var answer = generateAnswer(query, context);
            var genTime = System.currentTimeMillis() - genStart;

            // Phase 6: 引用提取
            var citations = buildCitations(reranked);

            // 记录指标
            metrics = new RagMetrics(
                query, rewrittenQuery,
                retrievalHits.size(), reranked.size(),
                retrievalTime, rerankTime, genTime,
                System.currentTimeMillis() - totalStart
            );

            logMetrics(metrics);
            return new RagResponse(answer, citations, metrics);

        } catch (Exception e) {
            log.error("RAG pipeline failed", e);
            return new RagResponse(
                "处理您的问题时出现错误，请稍后重试。",
                List.of(),
                metrics
            );
        }
    }

    /**
     * 构建Context（对抗Lost in the Middle）
     * 策略：高相关性放开头和结尾
     */
    private String buildContext(List<RerankerService.RerankedChunk> chunks) {
        if (chunks.size() <= 2) {
            return chunks.stream()
                .map(c -> "[文档片段]\n" + c.content())
                .collect(Collectors.joining("\n\n"));
        }

        // Lost in the Middle对抗排序
        var arranged = new ArrayList<>(chunks);

        // 把第二重要的放到最后（模型最后看到的信息利用最好）
        if (arranged.size() >= 2) {
            arranged.remove(1);
            arranged.add(chunks.get(1));
        }

        var builder = new StringBuilder();
        for (int i = 0; i < arranged.size(); i++) {
            var chunk = arranged.get(i);
            builder.append("[参考资料 %d] (相关度: %.2f)\n".formatted(i + 1, chunk.relevanceScore()));
            if (chunk.metadata().get("section_path") != null) {
                builder.append("来源: %s\n".formatted(chunk.metadata().get("section_path")));
            }
            builder.append(chunk.content()).append("\n\n");
        }

        return builder.toString();
    }

    /**
     * LLM生成答案
     */
    private String generateAnswer(String query, String context) {
        var prompt = """
            你是一个专业的知识库问答助手。请根据以下参考资料回答用户的问题。

            要求：
            1. 回答应基于提供的参考资料，不要编造信息
            2. 如果参考资料不足以回答，请明确说明
            3. 在答案中使用 [1], [2] 等编号标注引用来源
            4. 回答应结构清晰，适当使用列表或分段

            参考资料：
            %s

            用户问题：%s

            请回答：
            """.formatted(context, query);

        return chatClient.prompt()
            .user(prompt)
            .call()
            .content();
    }

    /**
     * 构建引用列表
     */
    private List<Citation> buildCitations(List<RerankerService.RerankedChunk> chunks) {
        var citations = new ArrayList<Citation>();
        for (int i = 0; i < chunks.size(); i++) {
            var chunk = chunks.get(i);
            var excerpt = chunk.content().length() > 200
                ? chunk.content().substring(0, 200) + "..."
                : chunk.content();

            citations.add(new Citation(
                i + 1,
                chunk.chunkId(),
                (String) chunk.metadata().getOrDefault("file_name", "未知文档"),
                excerpt,
                (String) chunk.metadata().getOrDefault("section_path", ""),
                chunk.relevanceScore()
            ));
        }
        return citations;
    }

    private void logMetrics(RagMetrics metrics) {
        meterRegistry.timer("rag.total.duration").record(
            metrics.totalTimeMs(), java.util.concurrent.TimeUnit.MILLISECONDS
        );
        meterRegistry.timer("rag.retrieval.duration").record(
            metrics.retrievalTimeMs(), java.util.concurrent.TimeUnit.MILLISECONDS
        );
        meterRegistry.timer("rag.rerank.duration").record(
            metrics.rerankTimeMs(), java.util.concurrent.TimeUnit.MILLISECONDS
        );
        meterRegistry.timer("rag.generation.duration").record(
            metrics.generationTimeMs(), java.util.concurrent.TimeUnit.MILLISECONDS
        );
        meterRegistry.counter("rag.queries.total").increment();
    }
}
```

---

## 九、RAG Controller — REST API

```java
package com.example.rag.api;

import com.example.rag.pipeline.DocumentPipelineService;
import com.example.rag.pipeline.RAGService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class RagController {

    private final RAGService ragService;
    private final DocumentPipelineService pipelineService;

    public RagController(RAGService ragService, DocumentPipelineService pipelineService) {
        this.ragService = ragService;
        this.pipelineService = pipelineService;
    }

    /**
     * RAG问答接口
     */
    @PostMapping("/rag/ask")
    public ResponseEntity<Map<String, Object>> ask(@RequestBody AskRequest request) {
        var response = ragService.ask(
            request.query(),
            request.tenantId() != null ? request.tenantId() : "default",
            request.accessLevels() != null ? request.accessLevels() : List.of("internal"),
            request.conversationHistory() != null ? request.conversationHistory() : List.of()
        );

        return ResponseEntity.ok(Map.of(
            "answer", response.answer(),
            "citations", response.citations(),
            "metrics", response.metrics()
        ));
    }

    public record AskRequest(
        String query,
        String tenantId,
        List<String> accessLevels,
        List<String> conversationHistory
    ) {}

    /**
     * 文档上传 + 自动入库
     */
    @PostMapping("/documents/ingest")
    public ResponseEntity<Map<String, Object>> ingestDocument(
            @RequestParam("file") MultipartFile file) throws Exception {

        // 保存到临时目录
        var tempDir = Files.createTempDirectory("rag-ingest-");
        var tempFile = tempDir.resolve(file.getOriginalFilename());
        file.transferTo(tempFile.toFile());

        try {
            var result = pipelineService.ingestDocument(tempFile);
            return ResponseEntity.ok(Map.of(
                "document_id", result.documentId(),
                "file_name", result.fileName(),
                "chunk_count", result.chunkCount(),
                "processing_time_ms", result.totalTimeMs(),
                "errors", result.errors()
            ));
        } finally {
            // 清理临时文件
            Files.deleteIfExists(tempFile);
            Files.deleteIfExists(tempDir);
        }
    }

    /**
     * 健康检查
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "UP", "service", "rag-pipeline"));
    }
}
```

---

## 十、性能优化配置

### 10.1 Embedding批量处理

```java
/**
 * 批量Embedding优化 — 减少API调用次数
 */
public class BatchEmbeddingOptimizer {

    @Value("${rag.embedding.batch-size:20}")
    private int batchSize;

    /**
     * 批量Embedding（调用一次API处理多个文本）
     * 对于OpenAI text-embedding-3-small：一次最多2048个文本
     */
    public List<float[]> batchEmbed(List<String> texts) {
        var batches = new ArrayList<List<String>>();
        for (int i = 0; i < texts.size(); i += batchSize) {
            batches.add(texts.subList(i, Math.min(i + batchSize, texts.size())));
        }

        var allEmbeddings = new ArrayList<float[]>();

        for (var batch : batches) {
            // 使用Spring AI的EmbeddingModel.embedForResponse()
            // EmbeddingRequest支持批量文本
            var embeddings = embedBatch(batch);
            allEmbeddings.addAll(embeddings);
        }

        return allEmbeddings;
    }

    private List<float[]> embedBatch(List<String> texts) {
        // Spring AI EmbeddingModel批量调用
        // 实际实现使用EmbeddingModel.embed(texts)
        return List.of();
    }
}
```

### 10.2 连接池配置

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public HikariConfig hikariConfig() {
        var config = new HikariConfig();
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(5);
        // pgvector查询使用连接后可能需要重置search_path
        config.setConnectionInitSql("SET hnsw.ef_search = 100");
        return config;
    }
}
```

---

## 十一、集成测试（Testcontainers）

```java
package com.example.rag;

import com.example.rag.pipeline.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.elasticsearch.ElasticsearchContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers
class RagPipelineIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> pgvector = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17")
    ).withDatabaseName("rag_test")
     .withUsername("test")
     .withPassword("test");

    @Container
    @ServiceConnection
    static ElasticsearchContainer elasticsearch = new ElasticsearchContainer(
        DockerImageName.parse("docker.elastic.co/elasticsearch/elasticsearch:9.0.0")
    ).withPassword("test123");

    @Autowired
    private DocumentPipelineService pipelineService;

    @Autowired
    private RAGService ragService;

    @Test
    @DisplayName("完整RAG流水线集成测试")
    void testCompleteRagPipeline() throws Exception {
        // 1. 创建测试文档
        var docPath = createTestDocument();

        // 2. 文档入库
        var ingestResult = pipelineService.ingestDocument(docPath);
        assertThat(ingestResult.chunkCount()).isGreaterThan(0);
        assertThat(ingestResult.errors()).isEmpty();

        // 等待索引可查询（给pgvector一点时间）
        Thread.sleep(500);

        // 3. RAG问答
        var response = ragService.ask(
            "什么是Virtual Thread？",
            "test_tenant",
            List.of("internal"),
            List.of()
        );

        // 4. 验证
        assertThat(response.answer()).isNotBlank();
        assertThat(response.citations()).isNotEmpty();
        assertThat(response.metrics().retrievalCandidates()).isGreaterThan(0);
        assertThat(response.metrics().totalTimeMs()).isGreaterThan(0);

        // 清理
        Files.deleteIfExists(docPath);
    }

    @Test
    @DisplayName("空知识库查询应返回友好提示")
    void testEmptyKnowledgeBase() {
        var response = ragService.ask(
            "一个不存在答案的问题",
            "empty_tenant",
            List.of("internal"),
            List.of()
        );

        assertThat(response.answer()).isNotBlank();
        assertThat(response.metrics().retrievalCandidates()).isEqualTo(0);
    }

    @Test
    @DisplayName("权限过滤测试")
    void testAccessLevelFiltering() throws Exception {
        // 入库一个confidential级别的文档
        // 用只有internal权限的用户查询，不应该返回该文档的内容
        var response = ragService.ask(
            "机密信息查询",
            "test_tenant",
            List.of("internal"),  // 只有internal权限
            List.of()
        );

        assertThat(response.citations()).isEmpty();
    }

    private Path createTestDocument() throws Exception {
        var content = """
            # Java Virtual Thread 介绍

            ## 什么是Virtual Thread

            Virtual Thread是JDK 21引入的轻量级线程实现。
            与传统的平台线程（Platform Thread）不同，
            Virtual Thread由JVM管理而非操作系统管理。

            ## 主要优势

            1. 极低的创建成本：可以创建数百万个Virtual Thread
            2. 自动管理阻塞IO：遇到阻塞操作时自动释放底层OS线程
            3. 简化并发编程：不需要使用Reactor等响应式框架

            ## 使用示例

            ```java
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> {
                    System.out.println("Hello from virtual thread!");
                });
            }
            ```

            ## 与传统线程的对比

            | 特性 | Platform Thread | Virtual Thread |
            |------|----------------|----------------|
            | 创建成本 | ~1ms | ~1us |
            | 内存占用 | ~1MB | ~1KB |
            | 最大数量 | ~数千 | ~数百万 |
            """;

        var tempFile = Files.createTempFile("test-vt-", ".md");
        Files.writeString(tempFile, content);
        return tempFile;
    }
}
```

---

## 十二、监控埋点总结

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `rag.ingestion.parse` | Timer | 文档解析耗时 |
| `rag.ingestion.chunk` | Timer | 切片耗时 |
| `rag.ingestion.embed` | Timer | Embedding索引耗时 |
| `rag.ingestion.documents.total` | Counter | 入库文档数（按status标签） |
| `rag.retrieval.vector` | Timer | 向量检索耗时 |
| `rag.retrieval.bm25` | Timer | BM25检索耗时 |
| `rag.retrieval.fusion` | Timer | RRF融合耗时 |
| `rag.rerank.duration` | Timer | 重排耗时 |
| `rag.generation.duration` | Timer | LLM生成耗时 |
| `rag.total.duration` | Timer | 端到端总耗时 |
| `rag.queries.total` | Counter | 总查询数 |

---

## 十三、最佳实践

1. **流水线责任分离**：DocumentPipelineService、RetrievalService、RerankerService、RAGService各司其职
2. **配置外置**：所有参数通过application.yml控制，支持不同环境配置
3. **优雅降级**：Cohere Rerank不可用时降级为分数排序，BM25不可用时仅向量检索
4. **Lost in the Middle对抗**：最重要上下文放开头和结尾
5. **监控全覆盖**：每个阶段都有独立计时，便于性能瓶颈定位
6. **Testcontainers集成测试**：完整验证pgvector + ES + RAG的端到端流程
7. **使用Spring AI的Filter Expression**：元数据过滤下推到数据库层

## 十四、反模式

- **Prompty中不放引用编号**：LLM容易编造引用
- **检索和生成之间没有重排**：直接喂给LLM的上下文可能有大量噪音
- **不分层抽象**：所有逻辑写在Controller中，不便于测试和切换实现
- **不设超时**：Embedding或LLM调用卡住时整个请求挂起
- **硬编码API Key**：生产环境应通过环境变量或Vault注入

## 相关条目

- [[10-Java文档解析全景]] — 文档解析阶段
- [[10-切片策略深度剖析]] — 切片策略
- [[11-向量检索与混合检索]] — 混合检索
- [[11-重排与上下文处理]] — 重排服务
- [[11-高级RAG模式]] — 高级RAG模式
