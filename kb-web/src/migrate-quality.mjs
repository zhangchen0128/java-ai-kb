#!/usr/bin/env node
/**
 * One-way migration for the 2026 quality baseline.
 *
 * The explicit maps are intentional: content types and version anchors are
 * editorial decisions, not values that should be inferred from word counts.
 * Re-running the migration is idempotent.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { containsPerformanceNumbers } from './audit-content.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');
const REVIEWED_AT = '2026-07-27';

const contentTypes = new Map(Object.entries({
  '00-元数据规范与来源等级标准.md': 'reference',
  '00-知识关系类型详解.md': 'concept',
  '01-分布式系统理论.md': 'concept',
  '01-密码学基础.md': 'concept',
  '01-操作系统基础.md': 'concept',
  '01-数据库原理.md': 'concept',
  '01-数据结构与算法.md': 'practice',
  '01-计算机网络.md': 'concept',
  '02-Java-IO模型深度解析.md': 'practice',
  '02-JVM内部机制与调优.md': 'concept',
  '02-反射与模块化系统.md': 'concept',
  '02-Java并发深度解析.md': 'practice',
  '02-Java性能诊断全指南.md': 'production',
  '02-现代Java25深度解析.md': 'overview',
  '02-集合框架与泛型深度解析.md': 'practice',
  '03-SpringBoot4深度解析.md': 'overview',
  '03-Spring核心IoC-AOP-事务.md': 'concept',
  '03-SpringMVC与SSE流式输出.md': 'practice',
  '03-SpringSecurity-OAuth2与JWT.md': 'production',
  '03-Jackson-MapStruct-Validator序列化与校验.md': 'practice',
  '03-Maven多模块工程实践.md': 'practice',
  '03-任务调度Quartz与XXL-JOB.md': 'production',
  '03-SpringDataJPA与MyBatis深度解析.md': 'practice',
  '03-Java测试最佳实践.md': 'practice',
  '03-WebFlux响应式编程.md': 'concept',
  '03-WebSocket与gRPC通信.md': 'practice',
  '04-对象存储与中间件扩展.md': 'production',
  '04-MySQL深度解析.md': 'concept',
  '04-PostgreSQL与pgvector深度解析.md': 'practice',
  '04-Redis深度解析.md': 'production',
  '04-Elasticsearch深度解析.md': 'production',
  '04-Kafka深度解析.md': 'production',
  '05-分布式一致性与事务方案.md': 'concept',
  '05-缓存策略与多级缓存架构.md': 'production',
  '05-幂等设计与分布式锁.md': 'practice',
  '05-熔断限流与弹性设计.md': 'production',
  '05-微服务基础设施.md': 'overview',
  '05-高可用与多活架构.md': 'production',
  '06-Linux运维实战基础.md': 'practice',
  '06-CICD与基础设施即代码.md': 'production',
  '06-OpenTelemetry可观测性体系.md': 'production',
  '06-SLO与混沌工程.md': 'concept',
  '06-Docker与Kubernetes云原生部署.md': 'overview',
  '07-Embedding与Tokenization.md': 'concept',
  '07-Transformer架构深度解析.md': 'concept',
  '07-推理策略与评估方法.md': 'practice',
  '07-机器学习基础.md': 'overview',
  '07-模型训练与微调范式.md': 'practice',
  '08-JVM内嵌推理DJL与ONNXRuntime.md': 'practice',
  '08-本地推理与Ollama.md': 'production',
  '08-模型能力矩阵与路由策略.md': 'overview',
  '08-OpenAI兼容协议详解.md': 'concept',
  '08-云模型API与SDK使用.md': 'practice',
  '08-多模态API实战.md': 'practice',
  '09-LangChain4j对比与选型.md': 'concept',
  '09-SpringAI2深度解析.md': 'practice',
  '09-架构抽象层设计.md': 'production',
  '10-SpringBatch批处理流水线.md': 'production',
  '10-元数据管理与数据治理.md': 'overview',
  '10-Java文档解析全景.md': 'practice',
  '10-切片策略深度剖析.md': 'concept',
  '11-完整RAG流水线实现.md': 'practice',
  '11-高级RAG模式.md': 'production',
  '11-向量检索与混合检索.md': 'concept',
  '11-重排与上下文处理.md': 'production',
  '12-Agent工作流与人机协作.md': 'production',
  '12-多Agent协作架构.md': 'production',
  '12-Agent记忆与规划.md': 'concept',
  '12-ToolCalling完整剖析.md': 'practice',
  '12-工具生态管理.md': 'overview',
  '13-AI协议全景.md': 'overview',
  '13-A2A协议与Agent互操作.md': 'production',
  '13-MCP协议与JavaSDK.md': 'practice',
  '14-AI平台与LLMOps全景.md': 'overview',
  '14-AI评估与可观测性.md': 'practice',
  '14-模型网关与Prompt管理.md': 'production',
  '15-AI安全全面防护体系.md': 'overview',
  '15-Agent与MCP安全实战.md': 'practice',
  '15-威胁建模与红队测试.md': 'production',
  '16-ClaudeCode与上下文工程.md': 'overview',
  '16-上下文工程与ADR.md': 'production',
  '17-Agent平台设计.md': 'production',
  '17-企业级RAG系统设计.md': 'concept',
  '18-保险AI应用场景全景.md': 'case-study',
  '18-保险核心业务基础.md': 'overview',
  '18-智能核保与理赔治理.md': 'case-study',
}));

const promoted = new Map(Object.entries({
  '07-推理策略与评估方法.md': ['vLLM 0.10 / Transformers 4.54 inference APIs', 'lab-rag-pipeline'],
  '08-云模型API与SDK使用.md': ['Provider APIs reviewed 2026-07-27', 'lab-spring-ai-chat'],
  '09-SpringAI2深度解析.md': ['Spring AI 2.0.0 / Spring Boot 4.0.7', 'lab-spring-ai-chat'],
  '10-切片策略深度剖析.md': ['Spring AI 2.0.0 ETL pipeline', 'lab-rag-pipeline'],
  '11-完整RAG流水线实现.md': ['Spring AI 2.0.0 RAG APIs', 'lab-rag-pipeline'],
  '12-ToolCalling完整剖析.md': ['Spring AI 2.0.0 Tool Calling API', 'lab-spring-ai-tools'],
  '13-MCP协议与JavaSDK.md': ['MCP specification 2025-11-25', 'lab-mcp-server'],
  '14-模型网关与Prompt管理.md': ['Spring AI 2.0.0 / OTel GenAI conventions', 'lab-ai-observability'],
  '15-AI安全全面防护体系.md': ['OWASP GenAI Top 10 2025', 'lab-ai-security'],
  '16-上下文工程与ADR.md': ['Claude Code instructions / ADR process reviewed 2026-07-27', null],
  '17-Agent平台设计.md': ['MCP 2025-11-25 / Spring AI 2.0.0', 'lab-spring-ai-tools'],
  '18-智能核保与理赔治理.md': ['PIPL 2021 / GenAI Interim Measures 2023', null],
}));

const illustrativeDrafts = new Map(Object.entries({
  '13-A2A协议与Agent互操作.md': 'A2A 1.0 / a2a-java 1.1.0.Final',
  '16-ClaudeCode与上下文工程.md': 'Claude Code documentation reviewed 2026-07-27',
  '18-保险AI应用场景全景.md': 'Insurance AI architecture examples reviewed 2026-07-27',
}));

const labEvidence = {
  'lab-java25-concurrency': {
    scope: 'article-core',
    source_files: [
      'labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/VirtualThreadsDemo.java',
      'labs/lab-java25-concurrency/src/main/java25/com/javaai/kb/labs/concurrency/Jdk25StructuredConcurrencyDemo.java',
    ],
    test_files: [
      'labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/VirtualThreadsTest.java',
      'labs/lab-java25-concurrency/src/test/java25/com/javaai/kb/labs/concurrency/Jdk25StructuredConcurrencyTest.java',
    ],
  },
  'lab-spring-ai-chat': {
    scope: 'article-core',
    source_files: ['labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/chat/ChatDemo.java'],
    test_files: ['labs/lab-spring-ai-chat/src/test/java/com/javaai/kb/labs/chat/ChatDemoTest.java'],
  },
  'lab-spring-ai-tools': {
    scope: 'article-core',
    source_files: [
      'labs/lab-spring-ai-tools/src/main/java/com/javaai/kb/labs/tools/SafeToolRegistry.java',
      'labs/lab-spring-ai-tools/src/main/java/com/javaai/kb/labs/tools/ToolCallingDemo.java',
    ],
    test_files: [
      'labs/lab-spring-ai-tools/src/test/java/com/javaai/kb/labs/tools/SafeToolRegistryTest.java',
      'labs/lab-spring-ai-tools/src/test/java/com/javaai/kb/labs/tools/ToolCallingDemoTest.java',
    ],
  },
  'lab-mcp-server': {
    scope: 'article-core',
    source_files: ['labs/lab-mcp-server/src/main/java/com/javaai/kb/labs/mcp/McpStdioServerMain.java'],
    test_files: ['labs/lab-mcp-server/src/test/java/com/javaai/kb/labs/mcp/McpStdioIntegrationTest.java'],
  },
  'lab-rag-pipeline': {
    scope: 'article-core',
    source_files: [
      'labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/ChunkerDemo.java',
      'labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/DeterministicRagPipeline.java',
    ],
    test_files: ['labs/lab-rag-pipeline/src/test/java/com/javaai/kb/labs/rag/DeterministicRagPipelineTest.java'],
  },
  'lab-ai-security': {
    scope: 'article-core',
    source_files: [
      'labs/lab-ai-security/src/main/java/com/javaai/kb/labs/security/OutputValidator.java',
      'labs/lab-ai-security/src/main/java/com/javaai/kb/labs/security/ToolPolicyGuard.java',
    ],
    test_files: ['labs/lab-ai-security/src/test/java/com/javaai/kb/labs/security/AiSecurityTest.java'],
  },
  'lab-ai-observability': {
    scope: 'article-core',
    source_files: [
      'labs/lab-ai-observability/src/main/java/com/javaai/kb/labs/observability/AiCallMetrics.java',
      'labs/lab-ai-observability/src/main/java/com/javaai/kb/labs/observability/AiCallTelemetry.java',
    ],
    test_files: ['labs/lab-ai-observability/src/test/java/com/javaai/kb/labs/observability/AiCallMetricsTest.java'],
  },
};

const articleEvidence = {
  '05-熔断限流与弹性设计.md': {
    scope: 'article-core',
    source_files: [
      'labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/SlidingWindowRateLimiter.java',
    ],
    test_files: [
      'labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/SlidingWindowRateLimiterTest.java',
    ],
    blocks: [{
      id: 'sliding-window-rate-limiter',
      sources: [{
        file: 'labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/SlidingWindowRateLimiter.java',
        symbols: ['SlidingWindowRateLimiter', 'SlidingWindowRateLimiter#tryAcquire'],
      }],
      tests: [{
        file: 'labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/SlidingWindowRateLimiterTest.java',
        symbols: [
          'SlidingWindowRateLimiterTest#rejectsRequestsAboveCapacityInTheSameWindow',
          'SlidingWindowRateLimiterTest#retainsCountsAcrossAdjacentBucketsAndExpiresAFullWindowLater',
          'SlidingWindowRateLimiterTest#enforcesCapacityUnderConcurrentCallers',
          'SlidingWindowRateLimiterTest#rejectsInvalidConfiguration',
        ],
      }],
    }],
  },
  '05-缓存策略与多级缓存架构.md': {
    scope: 'article-core',
    source_files: [
      'labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/HotKeyTracker.java',
    ],
    test_files: [
      'labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/HotKeyTrackerTest.java',
    ],
    blocks: [{
      id: 'hot-key-tracker',
      sources: [{
        file: 'labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/HotKeyTracker.java',
        symbols: [
          'HotKeyTracker',
          'HotKeyTracker#recordAccess',
          'PromotionListener',
          'Observation',
        ],
      }],
      tests: [{
        file: 'labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/HotKeyTrackerTest.java',
        symbols: [
          'HotKeyTrackerTest#promotesExactlyOnceWhenThresholdIsReached',
          'HotKeyTrackerTest#startsANewCounterAndCanPromoteAgainInTheNextWindow',
          'HotKeyTrackerTest#emitsOnePromotionUnderConcurrentAccess',
          'HotKeyTrackerTest#rejectsInvalidInput',
        ],
      }],
    }],
  },
  '08-云模型API与SDK使用.md': {
    scope: 'article-core',
    source_files: [
      'labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/chat/ChatModelPort.java',
      'labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/chat/SpringAiChatAdapter.java',
    ],
    test_files: [
      'labs/lab-spring-ai-chat/src/test/java/com/javaai/kb/labs/chat/SpringAiChatAdapterTest.java',
    ],
    blocks: [{
      id: 'spring-ai-chat-port',
      sources: [
        {
          file: 'labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/chat/ChatModelPort.java',
          symbols: [
            'ChatModelPort',
            'ChatModelPort#chat',
            'ChatModelPort#chatStream',
            'ChatRequest',
            'ChatResponse',
            'ChatChunk',
          ],
        },
        {
          file: 'labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/chat/SpringAiChatAdapter.java',
          symbols: [
            'SpringAiChatAdapter',
            'SpringAiChatAdapter#chat',
            'SpringAiChatAdapter#chatStream',
            'SpringAiChatAdapter#validate',
          ],
        },
      ],
      tests: [{
        file: 'labs/lab-spring-ai-chat/src/test/java/com/javaai/kb/labs/chat/SpringAiChatAdapterTest.java',
        symbols: [
          'SpringAiChatAdapterTest#mapsSynchronousResponseWithoutLeakingProviderTypes',
          'SpringAiChatAdapterTest#mapsStreamingChunksInOrder',
          'SpringAiChatAdapterTest#validatesAdapterAndRequestBoundaries',
        ],
      }],
    }],
  },
};

function walkMarkdown(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkMarkdown(full);
    return entry.endsWith('.md') && entry !== 'README.md' ? [full] : [];
  });
}

function defaultVerification(domain, filename, hasJava) {
  const number = domain.slice(0, 2);
  const topicAnchors = {
    '00-元数据规范与来源等级标准.md': 'Knowledge metadata schema v3 (2026-07-27)',
    '00-知识关系类型详解.md': 'Knowledge relation model v2 (2026-07-27)',
    '01-分布式系统理论.md': 'CAP, Paxos and Raft primary references (2026-07-27)',
    '01-操作系统基础.md': 'POSIX/Linux process and memory model references (2026-07-27)',
    '01-数据库原理.md': 'SQL transactions and MVCC primary references (2026-07-27)',
    '01-数据结构与算法.md': 'JDK 25 collections and algorithms baseline',
    '01-计算机网络.md': 'HTTP/2, HTTP/3 and TLS 1.3 standards baseline',
    '02-Java-IO模型深度解析.md': 'JDK 25 NIO / Netty 4.1 APIs',
    '02-JVM内部机制与调优.md': 'JDK 25 HotSpot and JVM specification',
    '02-Java性能诊断全指南.md': 'JDK 25 JFR / JMC / async-profiler baseline',
    '03-SpringSecurity-OAuth2与JWT.md': 'Spring Security 7.0 / OAuth 2.1 / OpenID Connect',
    '04-对象存储与中间件扩展.md': 'Amazon S3 API / RabbitMQ 4.1',
    '04-PostgreSQL与pgvector深度解析.md': 'PostgreSQL 18 / pgvector 0.8',
    '04-Redis深度解析.md': 'Redis 8 command and data model',
    '04-Elasticsearch深度解析.md': 'Elasticsearch 9 reference',
    '04-Kafka深度解析.md': 'Apache Kafka 4.1 protocol and APIs',
    '05-分布式一致性与事务方案.md': 'Saga, TCC and transactional outbox baseline',
    '05-缓存策略与多级缓存架构.md': 'Spring Framework 7 cache / Caffeine 3',
    '05-幂等设计与分布式锁.md': 'Redis 8 / Redisson distributed locking baseline',
    '05-熔断限流与弹性设计.md': 'Spring Cloud CircuitBreaker 5 / Resilience4j 2',
    '06-CICD与基础设施即代码.md': 'GitHub Actions and Terraform references (2026-07-27)',
    '06-OpenTelemetry可观测性体系.md': 'OpenTelemetry Java / GenAI semantic conventions',
    '06-Docker与Kubernetes云原生部署.md': 'Docker 28 / Kubernetes 1.33',
  };
  const labs = {
    '01': 'lab-java25-concurrency',
    '02': 'lab-java25-concurrency',
    '03': 'lab-spring-ai-tools',
    '04': 'lab-rag-pipeline',
    '05': 'lab-java25-concurrency',
    '06': 'lab-ai-observability',
  };
  const promotedValue = promoted.get(filename);
  const lab = promotedValue?.[1] || labs[number];
  return {
    reviewed_at: REVIEWED_AT,
    version_anchor: promotedValue?.[0] || topicAnchors[filename],
    code_status: hasJava ? 'tested' : 'not-applicable',
    ...(hasJava ? {
      lab,
      evidence: articleEvidence[filename] || labEvidence[lab],
    } : {}),
  };
}

function normalizeSources(meta, filename) {
  if (filename === '07-推理策略与评估方法.md') {
    meta.sources = [
      {
        level: 'L1',
        url: 'https://docs.vllm.ai/en/latest/',
        description: 'vLLM official documentation — serving and inference',
      },
      {
        level: 'L1',
        url: 'https://huggingface.co/docs/transformers/main/en/generation_strategies',
        description: 'Hugging Face Transformers official generation strategies',
      },
      ...meta.sources.filter((source, index, values) =>
        values.findIndex(candidate => candidate.url === source.url) === index),
    ];
  }

  const replacements = new Map([
    ['https://github.com/a2a-protocol/a2a-java', 'https://github.com/a2aproject/a2a-java'],
    ['https://spring.io/blog/2025/06/spring-ai-a2a-support', 'https://github.com/a2aproject/a2a-java'],
    ['https://modelcontextprotocol.io/sdk/java/mcp-server', 'https://github.com/modelcontextprotocol/java-sdk'],
    ['https://modelcontextprotocol.io/sdk/java/mcp-client', 'https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html'],
    ['https://spring.io/blog/2025/05/15/spring-ai-2', 'https://docs.spring.io/spring-ai/reference/'],
  ]);
  meta.sources = meta.sources.map(source => ({
    ...source,
    ...(replacements.has(source.url) ? { url: replacements.get(source.url) } : {}),
  }));
  meta.sources = meta.sources.filter((source, index, values) =>
    values.findIndex(candidate => candidate.url === source.url) === index);
}

for (const file of walkMarkdown(KNOWLEDGE)) {
  const raw = readFileSync(file, 'utf-8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${file}`);
  const meta = YAML.parse(match[1]);
  let body = match[2];
  const filename = basename(file);
  const contentType = contentTypes.get(filename);
  if (!contentType) throw new Error(`Missing editorial content type: ${filename}`);

  meta.content_type = contentType;
  if (promoted.has(filename)) meta.status = 'verified';
  else if (illustrativeDrafts.has(filename)) meta.status = 'draft';
  normalizeSources(meta, filename);

  for (const [type, values] of Object.entries(meta.relations || {})) {
    if (Array.isArray(values)) meta.relations[type] = [...new Set(values)];
  }

  if (meta.status === 'verified') {
    const javaBlocks = (match[2].match(/^```java\b/gm) || []).length;
    meta.verification = defaultVerification(meta.domain, filename, javaBlocks > 0);
    meta.updated = REVIEWED_AT;
    const hasPerformanceNumbers = containsPerformanceNumbers(body);
    if (hasPerformanceNumbers) {
      meta.verification.performance = { status: 'illustrative' };
    }
    if (hasPerformanceNumbers && !body.includes('性能数据声明')) {
      const notice = [
        '',
        '> **性能数据声明：** 除非具体表格同时给出硬件、软件版本、数据规模、参数、',
        '> 测试脚本、运行次数、P50/P95/P99、日期和原始结果链接，否则本文中的精确',
        '> 性能数字均为“示意值，不代表基准结果”，不能用于容量规划或产品比较。',
        '',
      ].join('\n');
      body = body.replace(/^(# .+\n)/m, `$1${notice}`);
    }
  } else if (illustrativeDrafts.has(filename)) {
    meta.verification = {
      reviewed_at: REVIEWED_AT,
      version_anchor: illustrativeDrafts.get(filename),
      code_status: 'illustrative',
    };
    meta.updated = REVIEWED_AT;
  } else {
    delete meta.verification;
  }

  const next = `---\n${YAML.stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
  if (next !== raw) writeFileSync(file, next, 'utf-8');
}

console.log(`Migrated ${contentTypes.size} knowledge entries to the 2026 quality baseline.`);
