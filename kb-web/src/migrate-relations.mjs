#!/usr/bin/env node
// One-time migration: fix relations and wikilinks to use canonical names
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');

// Build canonical entry name → real path map
const entryNames = new Set();
const domainDirs = new Set(); // Actual domain directory names
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) {
      if (dir === KNOWLEDGE) {
        domainDirs.add(f); // Top-level directories are domains
      }
      walk(full);
    } else if (f.endsWith('.md') && f !== 'README.md') {
      entryNames.add(basename(f, '.md'));
    }
  }
}
walk(KNOWLEDGE);

// Helper: check if ref is a valid domain or entry
function isValidRef(ref) {
  // Exact match: entry name
  if (entryNames.has(ref)) return true;
  // Exact match: domain directory name
  if (domainDirs.has(ref)) return true;
  // Not a valid ref — will be migrated
  return false;
}

// Known invalid → valid mapping
const relMap = {
  // Path-based → canonical name
  '计算机网络/TLS': '01-计算机网络',
  'SpringSecurity-OAuth2与JWT': '03-SpringSecurity-OAuth2与JWT',
  '01-计算机基础/01-os-io-models': '01-操作系统基础',
  '02-Java平台/02-virtual-threads-in-depth': '02-现代Java25深度解析',
  '02-Java平台/02-java-concurrency': '02-Java并发深度解析',
  '01-data-structures-algorithms': '01-数据结构与算法',
  '02-jmm-and-concurrency': '02-Java并发深度解析',
  '02-performance-diagnostics': '02-Java性能诊断全指南',
  '02-virtual-threads-in-depth': '02-现代Java25深度解析',
  '02-jvm-gc-in-depth': '02-JVM内部机制与调优',
  '02-jvm-memory-model': '02-JVM内部机制与调优',
  '02-gc-implementations': '02-JVM内部机制与调优',
  '02-jit-compilation': '02-JVM内部机制与调优',
  '01-计算机基础': '01-数据结构与算法',
  '01-计算机基础/01-concurrency-fundamentals': '02-Java并发深度解析',
  '02-Java平台/02-jvm-gc-deep-dive': '02-JVM内部机制与调优',
  '02-Java平台/02-jmm-concurrency': '02-Java并发深度解析',
  '01-数据结构（数组、链表、树、哈希表）': '01-数据结构与算法',
  '02-Java平台': '02-现代Java25深度解析',
  '03-spring-core-ioc-aop': '03-Spring核心IoC-AOP-事务',
  '03-spring-mvc-sse': '03-SpringMVC与SSE流式输出',
  '02-Java平台/02-servlet-container-tomcat': '03-SpringMVC与SSE流式输出',
  '03-spring-boot-autoconfiguration': '03-SpringBoot4深度解析',
  '03-webflux-vs-virtual-threads': '02-现代Java25深度解析',
  '03-webflux-sse-vs-mvc-sse': '03-SpringMVC与SSE流式输出',
  '05-分布式架构/05-resilience4j-circuit-breaker': '05-熔断限流与弹性设计',
  '15-AI安全与治理/15-oauth2-oidc-ai': '15-AI安全全面防护体系',
  '05-分布式架构': '05-分布式一致性与事务方案',
  '03-spring-boot-core': '03-SpringBoot4深度解析',
  '03-spring-boot-testing': '03-Java测试最佳实践',
  '04-数据与中间件/04-PostgreSQL与pgvector深度解析': '04-PostgreSQL与pgvector深度解析',
  '04-数据与中间件/04-Kafka深度解析': '04-Kafka深度解析',
  '04-数据与中间件/04-Redis深度解析': '04-Redis深度解析',
  '04-数据与中间件/04-Elasticsearch深度解析': '04-Elasticsearch深度解析',
  '10-AI数据工程': '10-Java文档解析全景',
  '01-计算机基础/01-数据库原理': '01-数据库原理',
  '01-计算机基础/01-分布式系统理论': '01-分布式系统理论',
  '04-数据与中间件': '04-PostgreSQL与pgvector深度解析',
  '05-分布式架构/05-缓存策略与多级缓存架构': '05-缓存策略与多级缓存架构',
  '05-分布式架构/05-幂等设计与分布式锁': '05-幂等设计与分布式锁',
  '05-分布式架构/05-分布式一致性与事务方案': '05-分布式一致性与事务方案',
  '05-分布式架构/05-熔断限流与弹性设计': '05-熔断限流与弹性设计',
  '03-Java应用平台': '03-SpringBoot4深度解析',
  '03-Java应用平台/03-MyBatis与SpringDataJPA深度解析': '03-SpringDataJPA与MyBatis深度解析',
  '06-云原生与SRE/06-Docker与Kubernetes云原生部署': '06-Docker与Kubernetes云原生部署',
  '06-云原生与SRE/06-OpenTelemetry可观测性体系': '06-OpenTelemetry可观测性体系',
  '06-云原生与SRE/06-CICD与基础设施即代码': '06-CICD与基础设施即代码',
  '06-云原生与SRE': '06-Docker与Kubernetes云原生部署',
  '06-云原生与SRE/可观测性与CI': '06-OpenTelemetry可观测性体系',
  '06-云原生与SRE/可观测性与CI/06-OpenTelemetry可观测性体系': '06-OpenTelemetry可观测性体系',
  '02-Java平台/02-JVM内存与GC调优': '02-JVM内部机制与调优',
  '05-弹性设计与容错': '05-熔断限流与弹性设计',
  '05-分布式架构/弹性设计': '05-熔断限流与弹性设计',
  '11-检索与RAG': '11-向量检索与混合检索',
  '14-AI平台与LLMOps': '14-模型网关与Prompt管理',
  '12-Agent工程': '12-ToolCalling完整剖析',
  '13-AI协议': '13-MCP协议与JavaSDK',
  '15-AI安全与治理': '15-AI安全全面防护体系',
  '07-AI基础': '07-Transformer架构深度解析',
  '09-Java AI框架': '09-SpringAI2深度解析',
  '08-模型接入与推理': '08-OpenAI兼容协议详解',
  '10-AI数据工程/README': '10-Java文档解析全景',
  '07-AI基础/README': '07-Transformer架构深度解析',
  '01-线性代数基础': null, // Remove — concept, not entry
  '07-神经网络与深度学习基础': '07-机器学习基础',
  '07-训练基础概念': '07-模型训练与微调范式',
  'java-ai-basics': '09-SpringAI2深度解析',
  'spring-ai-agent-framework': '09-SpringAI2深度解析',
  'multi-agent-patterns': '12-多Agent协作架构',
  'spring-ai-quickstart': '09-SpringAI2深度解析',
  'spring-ai-tool-calling': '12-ToolCalling完整剖析',
  '12-chat-model-basics': '09-SpringAI2深度解析',
  '12-agent-reasoning-patterns': '12-Agent记忆与规划',
  '14-ai-quickstart-spring-ai': '09-SpringAI2深度解析',
  '14-rag-patterns-and-vector-stores': '11-向量检索与混合检索',
  '14-function-calling-and-tool-use': '12-ToolCalling完整剖析',
  '15-llm-application-frameworks': '09-SpringAI2深度解析',
  'rag-patterns': '11-向量检索与混合检索',
  '03-SpringBoot4深度解析': '03-SpringBoot4深度解析', // self, keep
  '02-现代Java25深度解析': '02-现代Java25深度解析', // self, keep
  'ThreadLocal with Scoped Values': null, // concept — remove from relations
  'Reactor/WebFlux with Virtual Threads': null,
  'JNI with FFM API': null,
  '01-计算机基础/01-操作系统基础': '01-操作系统基础',
  // Wikilink fixes
  '04-数据库与缓存': '04-PostgreSQL与pgvector深度解析',
  '04-数据库与缓存/PostgreSQL': '04-PostgreSQL与pgvector深度解析',
  '02-Java平台/README': '02-现代Java25深度解析',
  '11-检索与RAG/README': '11-向量检索与混合检索',
  '12-Agent工程/README': '12-ToolCalling完整剖析',
  '13-AI协议/README': '13-MCP协议与JavaSDK',
  '14-AI平台与LLMOps/README': '14-模型网关与Prompt管理',
  '03-MyBatis与SpringDataJPA深度解析': '03-SpringDataJPA与MyBatis深度解析',
  '06-可观测性与CI': '06-OpenTelemetry可观测性体系',
  '06-云原生与SRE/容器与编排/06-Kubernetes深度解析': '06-Docker与Kubernetes云原生部署',
  '02-JVM内存与GC调优': '02-JVM内部机制与调优',
  '07-神经网络与深度学习基础': '07-机器学习基础',
  '07-训练基础概念': '07-模型训练与微调范式',
  '14-AI平台与LLMOps/评估体系': '14-AI评估与可观测性',
  '01-数据结构（树与哈希表）': '01-数据结构与算法',
  // Old English domain slug refs
  '01-data-structures-algorithms': '01-数据结构与算法',
  '02-jmm-and-concurrency': '02-Java并发深度解析',
  '02-performance-diagnostics': '02-Java性能诊断全指南',
  '02-virtual-threads-in-depth': '02-现代Java25深度解析',
  '02-jvm-gc-in-depth': '02-JVM内部机制与调优',
  '02-jvm-memory-model': '02-JVM内部机制与调优',
  '02-gc-implementations': '02-JVM内部机制与调优',
  '02-jit-compilation': '02-JVM内部机制与调优',
  '02-modern-java-features': '02-现代Java25深度解析',
  '03-spring-core-ioc-aop': '03-Spring核心IoC-AOP-事务',
  '03-spring-mvc-sse': '03-SpringMVC与SSE流式输出',
  '03-spring-boot-core': '03-SpringBoot4深度解析',
  '03-spring-boot-testing': '03-Java测试最佳实践',
  '12-chat-model-basics': '09-SpringAI2深度解析',
  '12-agent-reasoning-patterns': '12-Agent记忆与规划',
  '14-ai-quickstart-spring-ai': '09-SpringAI2深度解析',
  '14-rag-patterns-and-vector-stores': '11-向量检索与混合检索',
  '14-function-calling-and-tool-use': '12-ToolCalling完整剖析',
  '15-llm-application-frameworks': '09-SpringAI2深度解析',
};

// Fix domain-level refs
for (const key of Object.keys(relMap)) {
  if (relMap[key] && !entryNames.has(relMap[key])) {
    console.warn(`⚠️  Target "${relMap[key]}" for "${key}" also does not exist`);
  }
}

// Process all markdown files
let fixedRelations = 0;
let fixedWikilinks = 0;
let removedRelations = 0;

function processFile(filepath) {
  const raw = readFileSync(filepath, 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return;

  let frontmatter = m[1];
  let body = m[2];
  let changed = false;

  // Fix relations in frontmatter — handle both inline arrays and multi-line lists
  // Inline format: `prerequisite: ["old-ref"]`
  // Multi-line: `  - old-ref`

  // First, fix inline arrays
  frontmatter = frontmatter.replace(/^(\s*)(prerequisite|related|derived|contrast|version-of|replaces):\s*\[(.*?)\]/gm,
    (match, indent, key, items) => {
      if (!items.trim()) return match; // Empty array, keep
      const refs = items.split(',').map(s => s.trim().replace(/^['"](.*)['"]$/, '$1'));
      const fixed = [];
      let changed = false;
      for (const ref of refs) {
        if (!ref) continue;
        if (isValidRef(ref)) { fixed.push(ref); continue; }
        const mapped = relMap[ref];
        if (mapped) { fixed.push(mapped); fixedRelations++; changed = true; }
        else if (mapped === null) { removedRelations++; changed = true; /* skip */ }
        else {
          const lastPart = ref.split('/').pop();
          if (entryNames.has(lastPart)) { fixed.push(lastPart); fixedRelations++; changed = true; }
          else { removedRelations++; changed = true; /* skip concept refs */ }
        }
      }
      return fixed.length ? `${indent}${key}: ["${fixed.join('", "')}"]` : '';
    });

  // Second, fix multi-line list items within relations block
  let inRelations = false;
  const newLines = [];
  for (const line of frontmatter.split('\n')) {
    if (line.match(/^relations:/)) {
      inRelations = true;
      newLines.push(line);
      continue;
    }
    if (inRelations && line.match(/^\w[\w-]*:/) && !line.startsWith(' ')) {
      inRelations = false;
      newLines.push(line);
      continue;
    }
    if (inRelations && line.match(/^\s+-\s+(.+)/)) {
      const target = line.match(/^\s+-\s+(.+)/)[1].trim();
      if (isValidRef(target)) {
        newLines.push(line); continue;
      }
      const mapped = relMap[target];
      const indent = line.match(/^(\s*)/)[1];
      if (mapped) { newLines.push(`${indent}- ${mapped}`); fixedRelations++; }
      else if (mapped === null) { removedRelations++; }
      else {
        const lastPart = target.split('/').pop();
        if (entryNames.has(lastPart)) { newLines.push(`${indent}- ${lastPart}`); fixedRelations++; }
        else { removedRelations++; /* skip */ }
      }
    } else {
      newLines.push(line);
    }
  }
  frontmatter = newLines.join('\n');

  // Fix wikilinks in body
  body = body.replace(/\[\[([^\]]+)\]\]/g, (match, ref) => {
    const trimmed = ref.trim();
    if (entryNames.has(trimmed)) return match;
    if (/^\d{2}-[a-z-]+$/.test(trimmed)) return match; // domain ref

    // Check with .md suffix
    if (entryNames.has(trimmed + '.md')) return match;

    const mapped = relMap[trimmed];
    if (mapped) {
      fixedWikilinks++;
      return `[[${mapped}]]`;
    }
    // Try last part
    const lastPart = trimmed.split('/').pop();
    if (entryNames.has(lastPart)) {
      fixedWikilinks++;
      return `[[${lastPart}]]`;
    }
    console.warn(`  ⚠️  No wikilink mapping for: "${trimmed}" in ${filepath}`);
    return match;
  });

  if (frontmatter !== m[1] || body !== m[2]) {
    changed = true;
  }

  if (changed) {
    const newContent = `---\n${frontmatter}\n---\n${body}`;
    writeFileSync(filepath, newContent, 'utf-8');
  }
}

// Walk all files
function walkDir(dir) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walkDir(full);
    else if (f.endsWith('.md') && f !== 'README.md') processFile(full);
  }
}

console.log('🔧 运行关系引用迁移...\n');
walkDir(KNOWLEDGE);
console.log(`\n✅ 迁移完成:`);
console.log(`   修复关系引用: ${fixedRelations}`);
console.log(`   修复双链:     ${fixedWikilinks}`);
console.log(`   移除无效引用: ${removedRelations}`);
console.log(`\n现在运行 npm run validate 验证...`);
