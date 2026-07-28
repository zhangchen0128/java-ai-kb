---
domain: 10-AI数据工程
title: Spring Batch在AI数据工程中的批处理流水线
status: draft
level: advanced
sources:
  - level: L1
    url: https://docs.spring.io/spring-batch/reference/
    description: Spring Batch 官方参考文档
  - level: L4
    url: https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html
    description: Spring AI ETL Pipeline 文档
relations:
  prerequisite:
    - 03-SpringBoot4深度解析
    - 10-Java文档解析全景
  related:
    - 10-切片策略深度剖析
    - 11-完整RAG流水线实现
    - 05-分布式一致性与事务方案
tags:
  - spring-batch
  - batch-processing
  - embedding
  - rate-limiting
  - partitioning
  - etl
created: 2026-07-17
updated: 2026-07-17
content_type: production
---

# Spring Batch在AI数据工程中的批处理流水线

## 概述

AI数据工程中的文档处理是一个典型的批处理场景：从文件系统/对象存储读取数千份文档，逐文档执行解析、清洗、切片、Embedding，最后写入向量数据库和搜索引擎。Spring Batch提供了经过生产验证的分区并行、错误处理、检查点和重启能力，是构建AI数据管道的理想基座。

本文构建一个完整的6步骤AI数据批处理Job，覆盖Reader到Writer的全链路，包含Embedding API速率限制、分区并行和完整的错误处理策略。

---

## 一、Spring Batch在AI数据工程中的应用场景

| 场景 | 说明 | 典型规模 |
|------|------|----------|
| 全量文档入库 | 首次将文件系统中的所有文档导入知识库 | 10K-1M 文档 |
| 增量文档同步 | 监听数据库/S3变更，增量处理新文档 | 100-10K/day |
| Embedding升级迁移 | 模型升级时，所有chunk重新Embedding | 100K-10M chunks |
| 索引重建 | 变更索引参数或策略后全量重建 | 全量 |
| 定期OCR补扫 | 对低文本量的PDF重新OCR | 按需 |

---

## 二、批处理流水线设计

### 2.1 总体架构

```
Job: documentIngestionJob
 │
 ├─ Step 1: listDocuments (Reader: 从文件系统/S3读取待处理文档列表)
 │
 ├─ Step 2: parseDocuments (Processor: Tika/PDFBox/POI解析文档)
 │
 ├─ Step 3: cleanDocuments (Processor: Markdown标准化、隐私脱敏)
 │
 ├─ Step 4: chunkDocuments (Processor: 智能切片)
 │
 ├─ Step 5: embedChunks (Processor: 调用Embedding API — 含速率限制)
 │
 └─ Step 6: indexChunks (Writer: 写入pgvector + Elasticsearch)
```

### 2.2 Domain Model

```java
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 批处理领域对象
 */
public record DocumentItem(
    UUID documentId,
    String sourceUri,
    String fileName,
    String mimeType,
    long fileSize,
    DocumentStatus status,      // PENDING, PARSING, PARSED, CHUNKING, CHUNKED, EMBEDDING, INDEXED, FAILED
    String rawContent,          // 解析后的原始文本
    String cleanedContent,      // 清洗后的Markdown
    List<ChunkItem> chunks,
    String errorMessage,
    Instant createdAt,
    Instant updatedAt
) {
    public enum DocumentStatus {
        PENDING, PARSING, PARSED, CHUNKING, CHUNKED, EMBEDDING, INDEXED, FAILED
    }

    public DocumentItem withParsedContent(String content) {
        return new DocumentItem(
            documentId, sourceUri, fileName, mimeType, fileSize,
            DocumentStatus.PARSED, content, null, null, null, createdAt, Instant.now()
        );
    }

    public DocumentItem withCleanedContent(String cleaned) {
        return new DocumentItem(
            documentId, sourceUri, fileName, mimeType, fileSize,
            DocumentStatus.PARSED, rawContent, cleaned, null, null, createdAt, Instant.now()
        );
    }

    public DocumentItem withChunks(List<ChunkItem> chunks) {
        return new DocumentItem(
            documentId, sourceUri, fileName, mimeType, fileSize,
            DocumentStatus.CHUNKED, rawContent, cleanedContent, chunks, null, createdAt, Instant.now()
        );
    }

    public DocumentItem withError(String error) {
        return new DocumentItem(
            documentId, sourceUri, fileName, mimeType, fileSize,
            DocumentStatus.FAILED, rawContent, cleanedContent, chunks, error, createdAt, Instant.now()
        );
    }
}

public record ChunkItem(
    UUID chunkId,
    int chunkIndex,
    String content,
    int tokenCount,
    float[] embedding,
    String sectionPath,
    ChunkStatus status     // PENDING, EMBEDDING, EMBEDDED, INDEXED, FAILED
) {
    public enum ChunkStatus {
        PENDING, EMBEDDING, EMBEDDED, INDEXED, FAILED
    }

    public ChunkItem withEmbedding(float[] embedding) {
        return new ChunkItem(
            chunkId, chunkIndex, content, tokenCount, embedding, sectionPath, ChunkStatus.EMBEDDED
        );
    }
}
```

---

## 三、Step-by-Step 实现

### 3.1 Job配置主类

```java
import org.springframework.batch.core.Job;
import org.springframework.batch.core.Step;
import org.springframework.batch.core.configuration.annotation.EnableBatchProcessing;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.builder.StepBuilder;
import org.springframework.batch.integration.async.AsyncItemProcessor;
import org.springframework.batch.integration.async.AsyncItemWriter;
import org.springframework.batch.item.ItemProcessor;
import org.springframework.batch.item.ItemReader;
import org.springframework.batch.item.ItemWriter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.VirtualThreadTaskExecutor;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;

@Configuration
@EnableBatchProcessing
public class DocumentIngestionJobConfig {

    private final JobRepository jobRepository;
    private final PlatformTransactionManager transactionManager;
    private final DocumentReader documentReader;
    private final DocumentParserProcessor parserProcessor;
    private final DocumentCleanerProcessor cleanerProcessor;
    private final DocumentChunkingProcessor chunkingProcessor;
    private final EmbeddingProcessor embeddingProcessor;
    private final VectorIndexWriter indexWriter;

    public DocumentIngestionJobConfig(
            JobRepository jobRepository,
            PlatformTransactionManager transactionManager) {
        this.jobRepository = jobRepository;
        this.transactionManager = transactionManager;
        // 在实际项目中这些通过构造器注入
        this.documentReader = new DocumentReader(null);
        this.parserProcessor = new DocumentParserProcessor();
        this.cleanerProcessor = new DocumentCleanerProcessor();
        this.chunkingProcessor = new DocumentChunkingProcessor();
        this.embeddingProcessor = new EmbeddingProcessor(null);
        this.indexWriter = new VectorIndexWriter(null);
    }

    @Bean
    public Job documentIngestionJob() {
        return new JobBuilder("documentIngestionJob", jobRepository)
            .start(parseStep())
            .next(chunkStep())
            .next(embedAndIndexStep())
            .build();
    }

    /**
     * Step 1+2+3 合并：读取 → 解析 → 清洗
     * 使用 CompositeItemProcessor 串联处理
     */
    @Bean
    public Step parseStep() {
        return new StepBuilder("parseStep", jobRepository)
            .<DocumentItem, DocumentItem>chunk(10, transactionManager) // chunk=10个文档一批事务
            .reader(documentReader)
            .processor(new org.springframework.batch.item.support.CompositeItemProcessor<>(
                List.of(parserProcessor, cleanerProcessor)
            ))
            .writer(parsedDocumentWriter())
            .faultTolerant()
            .skip(DocumentParseException.class)
            .skipLimit(100)          // 跳过最多100个解析失败的文档
            .retryLimit(3)           // 重试3次
            .retry(java.io.IOException.class)
            .listener(new DocumentProcessListener())
            .build();
    }

    /**
     * Step 4: 切片
     */
    @Bean
    public Step chunkStep() {
        return new StepBuilder("chunkStep", jobRepository)
            .<DocumentItem, DocumentItem>chunk(10, transactionManager)
            .reader(parsedDocumentReader())
            .processor(chunkingProcessor)
            .writer(chunkedDocumentWriter())
            .faultTolerant()
            .skip(RuntimeException.class)
            .skipLimit(50)
            .build();
    }

    /**
     * Step 5+6: Embedding + 索引写入
     * 使用 AsyncItemProcessor 提高 Embedding API 调用的并发度
     */
    @Bean
    public Step embedAndIndexStep() {
        // 异步处理器：Embedding API 调用是 IO 密集型
        var asyncProcessor = new AsyncItemProcessor<ChunkItem, ChunkItem>();
        asyncProcessor.setDelegate(embeddingProcessor);
        var taskExecutor = new VirtualThreadTaskExecutor("embedding-");
        asyncProcessor.setTaskExecutor(taskExecutor);

        // 异步写入器
        var asyncWriter = new AsyncItemWriter<ChunkItem>();
        asyncWriter.setDelegate(indexWriter);

        return new StepBuilder("embedAndIndexStep", jobRepository)
            .<ChunkItem, Future<ChunkItem>>chunk(50, transactionManager)
            .reader(chunkReader())
            .processor(asyncProcessor)
            .writer(asyncWriter)
            .faultTolerant()
            .skip(EmbeddingException.class)
            .skipLimit(200)
            .retryLimit(5)
            .retry(EmbeddingException.class)
            .listener(new ChunkProcessListener())
            .build();
    }

    // --- Reader/Writer 占位（在实际项目中从Bean容器注入）---
    @Bean
    public ItemWriter<DocumentItem> parsedDocumentWriter() {
        return items -> items.forEach(item ->
            System.out.println("Parsed: " + item.fileName())
        );
    }

    @Bean
    public ItemReader<DocumentItem> parsedDocumentReader() {
        return new ParsedDocumentReader(null);
    }

    @Bean
    public ItemWriter<DocumentItem> chunkedDocumentWriter() {
        return items -> items.forEach(item ->
            System.out.println("Chunked: " + item.fileName() + " → " + item.chunks().size() + " chunks")
        );
    }

    @Bean
    public ItemReader<ChunkItem> chunkReader() {
        return new ChunkReader(null);
    }
}
```

### 3.2 DocumentReader — 从文件系统/S3读取

```java
import org.springframework.batch.item.ItemReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import java.util.Iterator;

public class DocumentReader implements ItemReader<DocumentItem> {

    private final Path documentRoot;
    private Iterator<Path> fileIterator;
    private boolean initialized = false;

    public DocumentReader(Path documentRoot) {
        this.documentRoot = documentRoot;
    }

    @Override
    public DocumentItem read() throws Exception {
        if (!initialized) {
            try (var files = Files.walk(documentRoot)) {
                var fileList = files
                    .filter(Files::isRegularFile)
                    .filter(this::isSupportedFormat)
                    .toList();
                fileIterator = fileList.iterator();
            }
            initialized = true;
        }

        if (!fileIterator.hasNext()) {
            return null; // Spring Batch: null表示Reader已读完
        }

        var filePath = fileIterator.next();
        try {
            var mimeType = Files.probeContentType(filePath);
            return new DocumentItem(
                UUID.randomUUID(),
                filePath.toUri().toString(),
                filePath.getFileName().toString(),
                mimeType != null ? mimeType : "application/octet-stream",
                Files.size(filePath),
                DocumentItem.DocumentStatus.PENDING,
                null, null, null, null,
                java.time.Instant.now(), java.time.Instant.now()
            );
        } catch (Exception e) {
            // 无法读取的文件跳过，记录日志
            return read(); // 递归读下一个
        }
    }

    private boolean isSupportedFormat(Path path) {
        var name = path.getFileName().toString().toLowerCase();
        return name.endsWith(".pdf") || name.endsWith(".docx") ||
               name.endsWith(".xlsx") || name.endsWith(".pptx") ||
               name.endsWith(".html") || name.endsWith(".htm") ||
               name.endsWith(".txt") || name.endsWith(".md") ||
               name.endsWith(".json") || name.endsWith(".csv");
    }
}
```

### 3.3 DocumentParserProcessor — 文档解析

```java
import org.springframework.batch.item.ItemProcessor;
import java.nio.file.Path;

public class DocumentParserProcessor implements ItemProcessor<DocumentItem, DocumentItem> {

    private final DocumentParserService parserService;

    public DocumentParserProcessor() {
        // 实际项目中注入
        this.parserService = new DocumentParserService(null);
    }

    @Override
    public DocumentItem process(DocumentItem item) throws Exception {
        try {
            var filePath = Path.of(java.net.URI.create(item.sourceUri()));
            var result = parserService.parse(filePath);

            // 将警告信息记录到元数据中
            if (!result.warnings().isEmpty()) {
                // log.warn("Parse warnings for {}: {}", item.fileName(), result.warnings());
            }

            return item.withParsedContent(result.markdownContent());

        } catch (DocumentParseException e) {
            // 解析失败：记录错误，让Spring Batch决定跳过还是重试
            throw e;
        }
    }
}

class DocumentParseException extends RuntimeException {
    public DocumentParseException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 3.4 DocumentCleanerProcessor — 文本清洗

```java
import org.springframework.batch.item.ItemProcessor;
import java.util.regex.Pattern;

public class DocumentCleanerProcessor implements ItemProcessor<DocumentItem, DocumentItem> {

    private final PiiDetector piiDetector = new PiiDetector();

    // 清洗模式
    private static final Pattern MULTIPLE_NEWLINES = Pattern.compile("\n{4,}");
    private static final Pattern TRAILING_SPACES = Pattern.compile(" +$", Pattern.MULTILINE);
    private static final Pattern PAGE_NUMBERS = Pattern.compile("^\\s*\\d+\\s*$", Pattern.MULTILINE);

    @Override
    public DocumentItem process(DocumentItem item) {
        if (item.rawContent() == null) {
            throw new IllegalStateException("rawContent is null for " + item.fileName());
        }

        var cleaned = item.rawContent();

        // 1. 基础清洗
        cleaned = normalizeNewlines(cleaned);
        cleaned = removeExcessiveWhitespace(cleaned);
        cleaned = removePageNumbers(cleaned);

        // 2. 统一Unicode
        cleaned = normalizeUnicode(cleaned);

        // 3. Markdown标准化
        cleaned = normalizeMarkdown(cleaned);

        // 4. PII脱敏
        cleaned = maskPii(cleaned);

        return item.withCleanedContent(cleaned);
    }

    private String normalizeNewlines(String text) {
        // Windows \r\n → \n，多余的连续换行合并
        text = text.replace("\r\n", "\n");
        text = MULTIPLE_NEWLINES.matcher(text).replaceAll("\n\n\n");
        return text;
    }

    private String removeExcessiveWhitespace(String text) {
        text = TRAILING_SPACES.matcher(text).replaceAll("");
        return text;
    }

    private String removePageNumbers(String text) {
        return PAGE_NUMBERS.matcher(text).replaceAll("");
    }

    private String normalizeUnicode(String text) {
        // 全角转半角、统一等号、统一引号等
        return text
            .replace('‘', '\'')  // 左单引号
            .replace('’', '\'')  // 右单引号
            .replace('“', '"')   // 左双引号
            .replace('”', '"')   // 右双引号
            .replace('–', '-')   // en dash
            .replace('—', '-')   // em dash
            .replace(' ', ' ')   // non-breaking space
            .replace("　", " ");       // 全角空格
    }

    private String normalizeMarkdown(String text) {
        // 确保标题前后有空行
        text = text.replaceAll("(?<!\n\n)(#{1,6}\\s)", "\n\n$1");
        text = text.replaceAll("(#{1,6}\\s.+)(?!\n\n)", "$1\n\n");
        return text;
    }

    private String maskPii(String text) {
        var matches = piiDetector.detect(text);
        if (matches.isEmpty()) return text;

        var result = new StringBuilder(text);
        int offset = 0;
        for (var match : matches) {
            var start = match.start() + offset;
            var end = match.end() + offset;
            var masked = match.maskedValue();
            result.replace(start, end, masked);
            offset += masked.length() - (end - start);
        }
        return result.toString();
    }
}
```

### 3.5 DocumentChunkingProcessor — 智能切片

```java
import org.springframework.batch.item.ItemProcessor;
import java.util.ArrayList;
import java.util.UUID;

public class DocumentChunkingProcessor implements ItemProcessor<DocumentItem, DocumentItem> {

    private final RecursiveCharacterChunker chunker = new RecursiveCharacterChunker();
    private final int chunkSize = 1024;   // 字符数
    private final int overlap = 200;       // 重叠字符数

    @Override
    public DocumentItem process(DocumentItem item) {
        if (item.cleanedContent() == null || item.cleanedContent().isBlank()) {
            return item.withChunks(java.util.List.of());
        }

        var rawChunks = chunker.splitText(item.cleanedContent(), chunkSize, overlap);

        var chunks = new ArrayList<ChunkItem>();
        for (int i = 0; i < rawChunks.size(); i++) {
            var rc = rawChunks.get(i);
            var tokenCount = estimateTokens(rc.text());
            chunks.add(new ChunkItem(
                UUID.randomUUID(),
                i,
                rc.text(),
                tokenCount,
                null,           // embedding 后续步骤填充
                null,           // sectionPath 可从结构感知切分获得
                ChunkItem.ChunkStatus.PENDING
            ));
        }

        return item.withChunks(chunks);
    }

    /**
     * 简单Token估算：中文约0.6 token/字，英文约0.25 token/字
     */
    private int estimateTokens(String text) {
        var chineseChars = text.codePoints()
            .filter(cp -> Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN)
            .count();
        var otherChars = text.length() - chineseChars;
        return (int) (chineseChars * 0.6 + otherChars * 0.25);
    }
}
```

### 3.6 EmbeddingProcessor — 带速率限制的Embedding调用

```java
import org.springframework.batch.item.ItemProcessor;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public class EmbeddingProcessor implements ItemProcessor<ChunkItem, ChunkItem> {

    private final String embeddingApiUrl;
    private final String apiKey;
    private final HttpClient httpClient;
    private final RateLimiter rateLimiter;
    private final int maxRetries = 3;

    // 令牌桶速率限制器
    private static class RateLimiter {
        private final double permitsPerSecond;
        private double tokens;
        private long lastRefillTime;

        RateLimiter(double permitsPerSecond) {
            this.permitsPerSecond = permitsPerSecond;
            this.tokens = permitsPerSecond;
            this.lastRefillTime = System.nanoTime();
        }

        synchronized void acquire() throws InterruptedException {
            refill();
            if (tokens < 1.0) {
                var waitMs = (long) ((1.0 - tokens) / permitsPerSecond * 1000);
                Thread.sleep(Math.max(waitMs, 10));
                refill();
            }
            tokens -= 1.0;
        }

        private void refill() {
            var now = System.nanoTime();
            var elapsed = (now - lastRefillTime) / 1_000_000_000.0;
            tokens = Math.min(tokens + elapsed * permitsPerSecond, permitsPerSecond);
            lastRefillTime = now;
        }
    }

    public EmbeddingProcessor(String embeddingApiUrl) {
        this.embeddingApiUrl = embeddingApiUrl != null
            ? embeddingApiUrl : "http://localhost:11434/api/embeddings";
        this.apiKey = System.getenv("EMBEDDING_API_KEY");
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(30))
            .build();
        // 默认速率：每秒10个请求（根据API限制调整）
        this.rateLimiter = new RateLimiter(10);
    }

    @Override
    public ChunkItem process(ChunkItem item) throws Exception {
        for (int attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 速率限制
                rateLimiter.acquire();

                var embedding = callEmbeddingApi(item.content());

                return item.withEmbedding(embedding);

            } catch (RateLimitException e) {
                // 429 Too Many Requests — 指数退避后重试
                var backoffMs = (long) Math.pow(2, attempt) * 1000;
                Thread.sleep(backoffMs);
                if (attempt == maxRetries - 1) {
                    throw new EmbeddingException("Max retries exceeded for chunk " + item.chunkId(), e);
                }
            } catch (java.io.IOException e) {
                if (attempt == maxRetries - 1) {
                    throw new EmbeddingException("Network error, max retries exceeded", e);
                }
                Thread.sleep(2000);
            }
        }
        throw new EmbeddingException("Unexpected: all retries exhausted");
    }

    private float[] callEmbeddingApi(String text) throws Exception {
        var jsonBody = """
            {
                "model": "bge-large-zh-v1.5",
                "input": "%s"
            }
            """.formatted(escapeJson(text));

        var request = HttpRequest.newBuilder()
            .uri(URI.create(embeddingApiUrl))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + (apiKey != null ? apiKey : ""))
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 429) {
            throw new RateLimitException("Rate limited");
        }
        if (response.statusCode() != 200) {
            throw new EmbeddingException("API returned " + response.statusCode());
        }

        // 解析响应（假设Ollama格式）
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var root = mapper.readTree(response.body());
        var embeddingNode = root.get("embedding");
        var embedding = new float[embeddingNode.size()];
        for (int i = 0; i < embedding.length; i++) {
            embedding[i] = embeddingNode.get(i).floatValue();
        }
        return embedding;
    }

    private String escapeJson(String text) {
        return text.replace("\\", "\\\\")
                   .replace("\"", "\\\"")
                   .replace("\n", "\\n")
                   .replace("\r", "\\r")
                   .replace("\t", "\\t");
    }
}

class RateLimitException extends RuntimeException {
    public RateLimitException(String msg) { super(msg); }
}

class EmbeddingException extends RuntimeException {
    public EmbeddingException(String msg) { super(msg); }
    public EmbeddingException(String msg, Throwable cause) { super(msg, cause); }
}
```

### 3.7 VectorIndexWriter — 写入pgvector + Elasticsearch

```java
import org.springframework.batch.item.Chunk;
import org.springframework.batch.item.ItemWriter;
import javax.sql.DataSource;
import java.sql.PreparedStatement;
import java.util.List;

public class VectorIndexWriter implements ItemWriter<ChunkItem> {

    private final DataSource dataSource;

    public VectorIndexWriter(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void write(Chunk<? extends ChunkItem> chunk) throws Exception {
        batchInsertPgVector(chunk.getItems());
        // 可选：同步写入Elasticsearch用于BM25检索
        // batchIndexElasticsearch(chunk.getItems());
    }

    private void batchInsertPgVector(List<? extends ChunkItem> items) {
        var sql = """
            INSERT INTO chunk_embeddings (chunk_id, embedding, model_name, model_version)
            VALUES (?::uuid, ?::vector, 'bge-large-zh-v1.5', '1.5')
            ON CONFLICT (chunk_id, model_name) DO UPDATE
            SET embedding = EXCLUDED.embedding, model_version = EXCLUDED.model_version
            """;

        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(sql)) {

            for (var item : items) {
                if (item.embedding() == null) continue;

                stmt.setObject(1, item.chunkId());
                // 将float[]转换为pgvector格式：'[0.1, 0.2, ...]'
                var vectorStr = java.util.Arrays.stream(item.embedding())
                    .mapToObj(f -> String.format("%.6f", f))
                    .collect(java.util.stream.Collectors.joining(",", "[", "]"));
                stmt.setString(2, vectorStr);
                stmt.addBatch();
            }

            stmt.executeBatch();

        } catch (java.sql.SQLException e) {
            throw new RuntimeException("Failed to insert embeddings", e);
        }
    }
}
```

---

## 四、分区并行处理 (Partitioning)

当文档量达到数万级别时，单机处理太慢。Spring Batch支持按文档数量分区，多线程并行处理。

```java
import org.springframework.batch.core.partition.support.Partitioner;
import org.springframework.batch.item.ExecutionContext;
import java.util.HashMap;
import java.util.Map;

/**
 * 按文件数量分区
 * 例如：10000个文档，分4个分区，每个分区2500个
 */
public class DocumentPartitioner implements Partitioner {

    private final Path documentRoot;
    private final int partitionSize; // 每个分区的文档数

    public DocumentPartitioner(Path documentRoot, int partitionSize) {
        this.documentRoot = documentRoot;
        this.partitionSize = partitionSize;
    }

    @Override
    public Map<String, ExecutionContext> partition(int gridSize) {
        var files = listAllFiles(documentRoot);
        var partitions = new HashMap<String, ExecutionContext>();
        var totalFiles = files.size();
        var numPartitions = (int) Math.ceil((double) totalFiles / partitionSize);

        for (int i = 0; i < numPartitions; i++) {
            var ctx = new ExecutionContext();
            var start = i * partitionSize;
            var end = Math.min(start + partitionSize, totalFiles);
            var partitionFiles = files.subList(start, end);

            ctx.put("files", partitionFiles);
            ctx.putInt("startIndex", start);
            ctx.putInt("endIndex", end);
            ctx.putInt("partitionNumber", i);

            partitions.put("partition" + i, ctx);
        }

        return partitions;
    }

    private List<Path> listAllFiles(Path root) {
        try (var files = java.nio.file.Files.walk(root)) {
            return files
                .filter(java.nio.file.Files::isRegularFile)
                .toList();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

分区Step配置：

```java
@Bean
public Step partitionedParseStep() {
    return new StepBuilder("partitionedParseStep", jobRepository)
        .partitioner("parseStep", new DocumentPartitioner(documentRoot, 500))
        .step(parseStep())   // 复用了之前定义的parseStep
        .gridSize(4)          // 4个并发分区
        .taskExecutor(new VirtualThreadTaskExecutor("partition-"))
        .build();
}
```

---

## 五、错误处理与容错

### 5.1 Skip Policy

```java
import org.springframework.batch.core.SkipListener;

public class DocumentProcessListener implements SkipListener<DocumentItem, DocumentItem> {

    @Override
    public void onSkipInRead(Throwable t) {
        // 读取失败（如文件被删除）—— 记录并继续
        // log.error("Skip reading: {}", t.getMessage());
    }

    @Override
    public void onSkipInWrite(DocumentItem item, Throwable t) {
        // 写入失败 —— 记录失败的文档ID，供人工处理
        // log.error("Skip writing document {}: {}", item.documentId(), t.getMessage());
        // failedDocumentRepository.save(item.documentId(), t.getMessage());
    }

    @Override
    public void onSkipInProcess(DocumentItem item, Throwable t) {
        // 处理失败 —— 记录错误详情
        // log.error("Skip processing document {} ({}): {}",
        //     item.fileName(), item.sourceUri(), t.getMessage());
    }
}
```

### 5.2 重试策略

```java
// 在Step配置中定义
// .retryLimit(3)
// .retry(IOException.class)            // 网络临时故障重试
// .retry(RateLimitException.class)     // API限流重试
// .noRetry(IllegalArgumentException.class)  // 参数错误不重试
// .noRetry(DocumentParseException.class)    // 文档损坏不重试
```

### 5.3 检查点 (Checkpoint)

Spring Batch的`Step Execution Context`自动持久化处理进度。重启时从上次成功的位置继续：

```java
// Job参数控制行为
@Bean
public JobParameters documentIngestionJobParameters() {
    return new JobParametersBuilder()
        .addString("documentRoot", "/data/documents/")
        .addString("runMode", "INCREMENTAL")  // FULL / INCREMENTAL
        .addString("tenantId", "tenant_001")
        .addLong("run.id", System.currentTimeMillis()) // 保证每次运行唯一
        .toJobParameters();
}
```

---

## 六、性能优化

### 6.1 Chunk Size调优

| 文档平均大小 | 推荐chunkSize | 说明 |
|-------------|---------------|------|
| <100KB | 50 | 小文档，高并发 |
| 100KB-1MB | 20 | 中文档 |
| 1MB-10MB | 10 | 大文档，事务开销小 |
| >10MB | 5 | 超大文档，避免长事务 |

### 6.2 Embedding批处理

```java
/**
 * 批量Embedding处理器 — 将多个chunk合并为一个API请求
 * 将吞吐量提升5-10倍
 */
public class BatchEmbeddingProcessor implements ItemProcessor<List<ChunkItem>, List<ChunkItem>> {

    private final int batchSize = 20; // 一次API请求最多20个文本

    @Override
    public List<ChunkItem> process(List<ChunkItem> items) throws Exception {
        if (items.isEmpty()) return List.of();

        // 提取所有文本
        var texts = items.stream().map(ChunkItem::content).toList();

        // 一次API调用获取所有Embedding
        var embeddings = batchEmbed(texts);

        // 将Embedding分配回对应的ChunkItem
        var result = new ArrayList<ChunkItem>();
        for (int i = 0; i < items.size(); i++) {
            result.add(items.get(i).withEmbedding(embeddings.get(i)));
        }

        return result;
    }

    private List<float[]> batchEmbed(List<String> texts) throws Exception {
        // 调用支持batch的Embedding API
        var jsonBody = """
            {
                "model": "bge-large-zh-v1.5",
                "input": %s
            }
            """.formatted(toJsonArray(texts));

        // ... HTTP调用解析 ...
        return List.of(); // 实际实现
    }

    private String toJsonArray(List<String> texts) {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        try {
            return mapper.writeValueAsString(texts);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 6.3 连接池配置

```yaml
# application.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20       # Embedding步骤IO密集，需要更多连接
      minimum-idle: 5
      connection-timeout: 30000
      idle-timeout: 600000

  batch:
    jdbc:
      initialize-schema: always   # 自动创建Spring Batch元数据表
    job:
      enabled: false              # 不要自动运行，等手动触发
```

---

## 七、完整Job执行与监控

### 7.1 启动Job

```java
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/batch")
public class BatchJobController {

    private final JobLauncher jobLauncher;
    private final Job documentIngestionJob;

    public BatchJobController(JobLauncher jobLauncher, Job documentIngestionJob) {
        this.jobLauncher = jobLauncher;
        this.documentIngestionJob = documentIngestionJob;
    }

    @PostMapping("/ingest")
    public String startIngestion(
            @RequestParam String documentRoot,
            @RequestParam(defaultValue = "INCREMENTAL") String runMode,
            @RequestParam String tenantId) {

        var params = new JobParametersBuilder()
            .addString("documentRoot", documentRoot)
            .addString("runMode", runMode)
            .addString("tenantId", tenantId)
            .addLong("run.id", System.currentTimeMillis())
            .toJobParameters();

        try {
            JobExecution execution = jobLauncher.run(documentIngestionJob, params);
            return "Job started: " + execution.getJobId();
        } catch (Exception e) {
            return "Job failed to start: " + e.getMessage();
        }
    }
}
```

### 7.2 监控埋点

```java
import org.springframework.batch.core.JobExecutionListener;
import org.springframework.batch.core.JobExecution;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.concurrent.TimeUnit;

public class DocumentIngestionMetrics implements JobExecutionListener {

    private final MeterRegistry meterRegistry;

    public DocumentIngestionMetrics(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void beforeJob(JobExecution jobExecution) {
        jobExecution.getExecutionContext().putLong("startTime", System.nanoTime());
    }

    @Override
    public void afterJob(JobExecution jobExecution) {
        var startTime = jobExecution.getExecutionContext().getLong("startTime");
        var duration = System.nanoTime() - startTime;

        // 记录Job总耗时
        Timer.builder("batch.ingestion.duration")
            .description("Document ingestion job duration")
            .register(meterRegistry)
            .record(duration, TimeUnit.NANOSECONDS);

        // 记录处理统计
        meterRegistry.counter("batch.ingestion.documents.total",
            "status", jobExecution.getStatus().name())
            .increment(jobExecution.getStepExecutions().stream()
                .mapToInt(se -> (int) se.getReadCount())
                .sum());

        meterRegistry.counter("batch.ingestion.documents.failed",
            "status", "FAILED")
            .increment(jobExecution.getStepExecutions().stream()
                .mapToInt(se -> (int) se.getSkipCount())
                .sum());
    }
}
```

---

## 八、最佳实践

1. **使用CompositeItemProcessor串联步骤**：一个Step内完成多个处理阶段
2. **Embedding步骤使用AsyncItemProcessor**：IO密集操作获益最大
3. **设置合理的chunkSize**：平衡事务开销和内存占用
4. **区分可重试异常和不可重试异常**：网络故障重试，数据损坏跳过
5. **Batch Embedding API**：将吞吐量提升5-10倍
6. **令牌桶限流器**：简单有效的Embedding API速率控制
7. **Job参数化**：documentRoot、runMode、tenantId等通过参数传入
8. **Virtual Threads分区**：JDK 25的Virtual Threads适合IO密集型并行任务

## 九、反模式

- **所有步骤一个Job**：步骤之间无依赖时拆分为独立Job
- **无视chunk大小盲目调大**：影响事务提交频率和重启粒度
- **同步调用Embedding API**：不利用并发，处理几千个chunk需要数小时
- **硬编码速率限制值**：应通过配置注入，不同API厂商限制不同
- **忽略Skip Listener**：不记录跳过的文档=永久丢失数据
- **不使用Job参数区分运行**：无法增量处理，每次都是全量

## 相关条目

- [[10-Java文档解析全景]] — 批处理的解析阶段详解
- [[10-切片策略深度剖析]] — 批处理的切片阶段详解
- [[10-元数据管理与数据治理]] — 批处理的元数据和治理
- [[11-完整RAG流水线实现]] — 从批处理到在线RAG的完整链路
