#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { parseFrontmatter } from './parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const KNOWLEDGE = join(ROOT, 'knowledge');
const LABS = join(ROOT, 'labs');
const REPORTS = join(__dirname, '..', 'reports');
const SOURCE_AUTHORITIES = join(__dirname, '..', 'source-authorities.yaml');
const authorityHosts = new Set(YAML.parse(readFileSync(SOURCE_AUTHORITIES, 'utf-8')).hosts);

const REVIEW_DAYS = { fast: 90, normal: 180, stable: 365 };
const FAST_DOMAINS = new Set(['03', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16']);
const STABLE_DOMAINS = new Set(['00', '01']);
const TECHNICAL_PRACTICE_DOMAINS = new Set(
  Array.from({ length: 14 }, (_, i) => String(i + 2).padStart(2, '0')),
);
const PRODUCTION_DOMAINS = new Set(['03', '04', '05', '06', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);

export function getReviewDeadline(domain) {
  const number = domain.match(/^(\d{2})/)?.[1];
  if (FAST_DOMAINS.has(number)) return REVIEW_DAYS.fast;
  if (STABLE_DOMAINS.has(number)) return REVIEW_DAYS.stable;
  return REVIEW_DAYS.normal;
}

export function isReviewStale(domain, reviewedAt, now = new Date()) {
  if (!reviewedAt) return false;
  const age = Math.floor((now - new Date(`${reviewedAt}T00:00:00Z`)) / 86_400_000);
  return age > getReviewDeadline(domain);
}

export function walkMarkdown(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) results.push(...walkMarkdown(full, rel));
    else if (entry.endsWith('.md') && entry !== 'README.md') results.push(rel);
  }
  return results;
}

function walkJava(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...walkJava(full));
    else if (entry.endsWith('.java')) results.push(full);
  }
  return results;
}

function relationTargets(relations) {
  return Object.values(relations || {})
    .flatMap(value => Array.isArray(value) ? value : [])
    .filter(Boolean);
}

function resolveRelation(target, entriesByName, entriesByPath, domains) {
  if (domains.has(target)) return true;
  if (entriesByPath.has(target.replace(/\.md$/, ''))) return true;
  const last = target.replace(/\.md$/, '').split('/').pop();
  return entriesByName.has(last);
}

function labState(labName) {
  if (!labName) return { exists: false, main: 0, tests: 0 };
  const root = join(LABS, labName);
  return {
    exists: existsSync(root),
    main: walkJava(join(root, 'src', 'main')).length,
    tests: walkJava(join(root, 'src', 'test')).length,
  };
}

function unique(values) {
  return [...new Set(values)];
}

export function inspectRelations(relations, isResolvable = () => true) {
  const duplicates = [];
  const broken = [];
  const validTargets = [];
  const relationTypesByTarget = new Map();
  for (const [type, values] of Object.entries(relations || {})) {
    if (!Array.isArray(values)) continue;
    const repeated = values.filter((value, index) => values.indexOf(value) !== index);
    if (repeated.length) duplicates.push({ type, targets: unique(repeated) });
    for (const target of unique(values.filter(Boolean))) {
      const priorTypes = relationTypesByTarget.get(target) || [];
      if (priorTypes.length && !priorTypes.includes(type)) {
        duplicates.push({ type: 'cross-type', targets: [target] });
      }
      relationTypesByTarget.set(target, [...priorTypes, type]);
      if (isResolvable(target)) validTargets.push(target);
      else broken.push({ type, target });
    }
  }
  return {
    duplicates,
    broken,
    validTargets,
    targetCount: relationTargets(relations).length,
  };
}

export function containsPerformanceNumbers(raw) {
  const directMeasurement =
    /\b(?:P50|P95|P99|QPS|TPS)\b|(?:\d+(?:\.\d+)?\s*(?:ns|μs|ms|MB\/s|GB\/s|req\/s|ops\/s))/i;
  const percentageClaim =
    /(?:提升|降低|减少|增加|节省|命中率|准确率|召回率|失败率|利用率|吞吐(?:量)?|延迟|性能|成本|显存|内存(?:占用)?|带宽)[^\n]{0,48}?(?:<|>|约|可达|从)?\s*\d+(?:\.\d+)?(?:\s*[-~至]\s*\d+(?:\.\d+)?)?\s*%/i;
  const multiplierClaim =
    /(?:加速(?:比)?|提升|降低|减少|增加|快|成本(?:相差)?|吞吐(?:量)?)[^\n]{0,48}?\d+(?:\.\d+)?(?:\s*[-~至]\s*\d+(?:\.\d+)?)?\s*(?:x(?!x)|倍)/i;
  return directMeasurement.test(raw) || percentageClaim.test(raw) || multiplierClaim.test(raw);
}

export function findJavaPlaceholders(raw) {
  const findings = [];
  const javaBlock = /^```java[^\n]*\n([\s\S]*?)^```/gm;
  const placeholder =
    /\b(?:TODO|FIXME)\b|UnsupportedOperationException|(?:省略|略去).{0,12}(?:实现|代码|逻辑)|待实现|示例中不实现|^\s*(?:(?:\/\/|\*)\s*)?\.{3}\s*;?\s*$/i;
  let match;
  let block = 0;
  while ((match = javaBlock.exec(raw))) {
    block++;
    for (const [index, line] of match[1].split('\n').entries()) {
      if (placeholder.test(line)) {
        findings.push({ block, line: index + 1, text: line.trim() });
      }
    }
  }
  return findings;
}

export function extractJavaCodeBlocks(raw) {
  const blocks = [];
  const pattern =
    /(?:^<!--\s*code-id:\s*([a-z][a-z0-9-]{2,63})\s*-->\s*\n)?^```java[^\n]*\n([\s\S]*?)^```/gm;
  let match;
  while ((match = pattern.exec(raw))) {
    blocks.push({
      index: blocks.length + 1,
      id: match[1] || null,
      code: match[2],
    });
  }
  return blocks;
}

export function isGenericVersionAnchor(anchor = '') {
  return /JDK 25\s*\/\s*Spring Boot 4|Official references reviewed|Foundational CS references reviewed|Data platform documentation reviewed|Distributed systems patterns reviewed|Cloud native specifications reviewed/i.test(anchor);
}

export function validateVerifiedCode(
  meta,
  raw,
  getLabState = labState,
  fileExists = path => existsSync(join(ROOT, path)),
  readText = path => readFileSync(join(ROOT, path), 'utf-8'),
) {
  if (meta.status !== 'verified') return [];
  const issues = [];
  const verification = meta.verification;
  const javaBlocks = (raw.match(/^```java\b/gm) || []).length;

  if (javaBlocks > 0) {
    if (verification?.code_status !== 'tested') {
      issues.push('包含 Java 代码的 verified 条目必须标记 tested');
    }
    if (!verification?.lab) issues.push('包含 Java 代码的 verified 条目必须关联 lab');
    if (!verification?.evidence) issues.push('包含 Java 代码的 verified 条目必须提供具体源码和测试证据');
  } else if (verification?.code_status !== 'not-applicable') {
    issues.push('不含 Java 代码的 verified 条目应标记 not-applicable');
  }

  if (verification?.lab) {
    const state = getLabState(verification.lab);
    if (!state.exists) issues.push(`关联 lab 不存在: ${verification.lab}`);
    else {
      if (state.main === 0) issues.push(`关联 lab 没有生产源码: ${verification.lab}`);
      if (state.tests === 0) issues.push(`关联 lab 没有测试源码: ${verification.lab}`);
    }
  }
  if (verification?.evidence && verification?.lab) {
    const expectedPrefix = `labs/${verification.lab}/`;
    for (const source of verification.evidence.source_files || []) {
      if (!source.startsWith(`${expectedPrefix}src/main/`)) {
        issues.push(`源码证据不属于关联 lab: ${source}`);
      } else if (!fileExists(source)) {
        issues.push(`源码证据不存在: ${source}`);
      }
    }
    for (const test of verification.evidence.test_files || []) {
      if (!test.startsWith(`${expectedPrefix}src/test/`)) {
        issues.push(`测试证据不属于关联 lab: ${test}`);
      } else if (!fileExists(test)) {
        issues.push(`测试证据不存在: ${test}`);
      }
    }

    const blocks = extractJavaCodeBlocks(raw);
    const annotatedIds = blocks.map(block => block.id).filter(Boolean);
    const duplicateIds = unique(
      annotatedIds.filter((id, index) => annotatedIds.indexOf(id) !== index),
    );
    for (const id of duplicateIds) {
      issues.push(`Java 代码块 ID 重复: ${id}`);
    }

    const mappings = verification.evidence.blocks || [];
    const mappedIds = new Set(mappings.map(mapping => mapping.id));
    for (const id of unique(annotatedIds)) {
      if (!mappedIds.has(id)) issues.push(`代码块已标注但缺少证据映射: ${id}`);
    }

    const checkArtifacts = (mapping, artifacts, aggregateFiles, kind) => {
      for (const artifact of artifacts) {
        if (!aggregateFiles.includes(artifact.file)) {
          issues.push(`代码块 ${mapping.id} 的${kind}未列入文章核心证据: ${artifact.file}`);
          continue;
        }
        if (!fileExists(artifact.file)) continue;
        const content = readText(artifact.file);
        for (const symbol of artifact.symbols) {
          const member = symbol.split('#').pop();
          const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (!new RegExp(`\\b${escaped}\\b`).test(content)) {
            issues.push(`代码块 ${mapping.id} 的${kind}符号不存在: ${artifact.file}#${symbol}`);
          }
        }
      }
    };

    for (const mapping of mappings) {
      const matchingBlocks = blocks.filter(block => block.id === mapping.id);
      if (matchingBlocks.length === 0) {
        issues.push(`代码块证据 ID 在正文中不存在: ${mapping.id}`);
      } else if (matchingBlocks.length > 1) {
        issues.push(`代码块证据 ID 在正文中不唯一: ${mapping.id}`);
      }
      checkArtifacts(
        mapping,
        mapping.sources,
        verification.evidence.source_files,
        '源码',
      );
      checkArtifacts(
        mapping,
        mapping.tests,
        verification.evidence.test_files,
        '测试',
      );
    }
  }
  return issues;
}

function normalizedHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function auditContent({ now = new Date(), writeReports = true } = {}) {
  const files = walkMarkdown(KNOWLEDGE);
  const entries = [];
  const entriesByName = new Map();
  const entriesByPath = new Map();
  const domains = new Set();

  for (const rel of files) {
    const raw = readFileSync(join(KNOWLEDGE, rel), 'utf-8');
    const parsed = parseFrontmatter(raw);
    const domain = rel.split('/')[0];
    const name = basename(rel, '.md');
    const entry = {
      path: rel,
      normalizedPath: rel.replace(/\.md$/, ''),
      name,
      domain,
      raw,
      body: parsed.body,
      meta: parsed.meta,
      parseErrors: parsed.errors,
    };
    entries.push(entry);
    entriesByName.set(name, entry);
    entriesByPath.set(entry.normalizedPath, entry);
    domains.add(domain);
  }

  const report = {
    generatedAt: now.toISOString(),
    totals: {
      entries: entries.length,
      verified: 0,
      draft: 0,
      outdated: 0,
      verifiedPass: 0,
      verifiedFail: 0,
      stale: 0,
      sourceRefs: 0,
      javaBlocks: 0,
      labLinked: 0,
      codeEvidenceLinked: 0,
      codeBlockEvidenceLinked: 0,
      javaPlaceholderFindings: 0,
    },
    entries: [],
    brokenRelations: [],
    duplicateRelations: [],
    noRelations: [],
    orphanVerified: [],
    stale: [],
    coverage: {},
    coverageErrors: [],
  };

  const incoming = new Map(entries.map(entry => [entry.name, 0]));
  const outgoing = new Map(entries.map(entry => [entry.name, 0]));

  for (const entry of entries) {
    const { meta, raw, parseErrors, path, domain, name } = entry;
    const issues = [...parseErrors];
    const warnings = [];
    const status = meta.status || 'invalid';
    const isVerified = status === 'verified';
    const sources = meta.sources || [];
    const relations = meta.relations || {};
    const targets = relationTargets(relations);
    const javaBlocks = (raw.match(/^```java\b/gm) || []).length;
    const verification = meta.verification;
    const domainNumber = domain.match(/^(\d{2})/)?.[1] || '';

    if (status in report.totals) report.totals[status]++;
    report.totals.sourceRefs += sources.length;
    report.totals.javaBlocks += javaBlocks;
    if (verification?.lab) report.totals.labLinked++;
    if (verification?.evidence) report.totals.codeEvidenceLinked++;
    report.totals.codeBlockEvidenceLinked += verification?.evidence?.blocks?.length || 0;

    const relationAudit = inspectRelations(
      relations,
      target => resolveRelation(target, entriesByName, entriesByPath, domains),
    );
    for (const duplicate of relationAudit.duplicates) {
      report.duplicateRelations.push({ path, ...duplicate });
      issues.push(`relations.${duplicate.type} 存在重复目标: ${duplicate.targets.join(', ')}`);
    }
    for (const broken of relationAudit.broken) {
      report.brokenRelations.push({ path, ...broken });
      issues.push(`relations.${broken.type} 目标不存在: ${broken.target}`);
    }
    for (const target of relationAudit.validTargets) {
      const targetName = target.replace(/\.md$/, '').split('/').pop();
      if (incoming.has(targetName)) incoming.set(targetName, incoming.get(targetName) + 1);
      outgoing.set(name, outgoing.get(name) + 1);
    }

    if (targets.length === 0) {
      report.noRelations.push({ path, status });
      issues.push('条目不能没有知识关系');
    }

    const hasL0L1 = sources.some(source => source.level === 'L0' || source.level === 'L1');
    if (isVerified && !hasL0L1) issues.push('verified 条目至少需要一个 L0/L1 来源');
    const independentHosts = unique(sources.map(source => normalizedHost(source.url)).filter(Boolean));
    if (isVerified && FAST_DOMAINS.has(domainNumber) && independentHosts.length < 2) {
      issues.push('快速变化领域的 verified 条目至少需要两个不同来源域名');
    }
    if (isVerified) {
      for (const source of sources.filter(item => item.level === 'L0' || item.level === 'L1')) {
        const host = normalizedHost(source.url);
        if (!host) issues.push(`${source.level} 来源必须提供有效 URL: ${source.description}`);
        else if (!authorityHosts.has(host)) {
          issues.push(`${source.level} 来源域名未登记为权威来源: ${host}`);
        }
      }
    }

    for (const source of sources) {
      if (!source.url) continue;
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) issues.push(`来源 URL 协议无效: ${source.url}`);
      } catch {
        issues.push(`来源 URL 无效: ${source.url}`);
      }
    }

    const referenceDate = isVerified
      ? verification?.reviewed_at
      : (meta.updated || meta.created);
    if (referenceDate) {
      const age = Math.floor((now - new Date(`${referenceDate}T00:00:00Z`)) / 86_400_000);
      const deadline = getReviewDeadline(domain);
      if (isReviewStale(domain, referenceDate, now)) {
        const stale = { path, status, age, deadline };
        report.stale.push(stale);
        if (isVerified) issues.push(`超过复核期限: ${age} 天 > ${deadline} 天`);
        else warnings.push(`草稿超过建议复核期限: ${age} 天 > ${deadline} 天`);
      }
    }

    if (isVerified) {
      if (!verification?.reviewed_at) issues.push('缺少 verification.reviewed_at');
      if (!verification?.version_anchor) issues.push('缺少 verification.version_anchor');
      if (verification?.version_anchor && isGenericVersionAnchor(verification.version_anchor)) {
        issues.push('verification.version_anchor 过于通用，必须与文章主题直接相关');
      }
      if (!verification?.code_status) issues.push('缺少 verification.code_status');
      if (verification?.code_status === 'illustrative') issues.push('verified 不能使用 illustrative 代码状态');
      if (containsPerformanceNumbers(raw)) {
        if (!verification?.performance) {
          issues.push('包含精确性能数字但缺少 verification.performance');
        } else if (
          verification.performance.status === 'illustrative'
          && !raw.includes('示意值，不代表基准结果')
        ) {
          issues.push('示意性能数字必须明确标记“示意值，不代表基准结果”');
        } else if (verification.performance.status === 'reproducible') {
          for (const artifact of [verification.performance.script, verification.performance.raw_results]) {
            if (
              typeof artifact !== 'string'
              || (
                !artifact.startsWith('http://')
                && !artifact.startsWith('https://')
                && !existsSync(join(ROOT, artifact))
              )
            ) {
              issues.push(`可复现性能证据不存在: ${artifact}`);
            }
          }
        }
      }

      const placeholders = findJavaPlaceholders(raw);
      report.totals.javaPlaceholderFindings += placeholders.length;
      if (placeholders.length) {
        const locations = placeholders
          .slice(0, 5)
          .map(item => `代码块 ${item.block} 第 ${item.line} 行`)
          .join('、');
        issues.push(`verified Java 代码包含显式占位实现: ${locations}`);
      }

      issues.push(...validateVerifiedCode(meta, raw));
    }

    const passed = issues.length === 0;
    if (isVerified) {
      if (passed) report.totals.verifiedPass++;
      else report.totals.verifiedFail++;
    }
    report.entries.push({
      path,
      domain,
      status,
      contentType: meta.content_type,
      javaBlocks,
      sources: sources.length,
      lab: verification?.lab || null,
      codeBlockEvidence: verification?.evidence?.blocks?.length || 0,
      passed,
      issues,
      warnings,
    });
  }

  for (const entry of entries) {
    if (entry.meta.status !== 'verified') continue;
    const degree = (incoming.get(entry.name) || 0) + (outgoing.get(entry.name) || 0);
    if (degree === 0) {
      report.orphanVerified.push({ path: entry.path });
      const result = report.entries.find(item => item.path === entry.path);
      if (result && !result.issues.includes('verified 条目是知识图谱孤岛')) {
        result.issues.push('verified 条目是知识图谱孤岛');
        result.passed = false;
        report.totals.verifiedPass--;
        report.totals.verifiedFail++;
      }
    }
  }

  for (const domain of [...domains].sort()) {
    const domainEntries = entries.filter(entry => entry.domain === domain);
    const number = domain.match(/^(\d{2})/)?.[1] || '';
    const types = new Set(domainEntries.map(entry => entry.meta.content_type).filter(Boolean));
    const verified = domainEntries.filter(entry => entry.meta.status === 'verified').length;
    const labs = unique(domainEntries.map(entry => entry.meta.verification?.lab).filter(Boolean));
    const problems = [];
    if (!types.has('overview') && !types.has('concept')) problems.push('缺少 overview/concept');
    if (TECHNICAL_PRACTICE_DOMAINS.has(number) && !types.has('practice')) problems.push('缺少 practice');
    if (PRODUCTION_DOMAINS.has(number) && !types.has('production') && !types.has('case-study')) {
      problems.push('缺少 production/case-study');
    }
    if (verified === 0) problems.push('缺少 verified 锚点');

    report.coverage[domain] = {
      entries: domainEntries.length,
      verified,
      types: [...types].sort(),
      labs,
      problems,
    };
    if (problems.length) report.coverageErrors.push({ domain, problems });
  }

  report.totals.stale = report.stale.length;

  if (writeReports) {
    if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, 'content-audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');

    let markdown = '# 内容质量审计报告\n\n';
    markdown += `生成时间：${report.generatedAt}\n\n`;
    markdown += '## 总览\n\n';
    markdown += '| 指标 | 数量 |\n|---|---:|\n';
    markdown += `| 条目 | ${report.totals.entries} |\n`;
    markdown += `| verified 通过 | ${report.totals.verifiedPass} |\n`;
    markdown += `| verified 问题 | ${report.totals.verifiedFail} |\n`;
    markdown += `| draft | ${report.totals.draft} |\n`;
    markdown += `| Java 代码块 | ${report.totals.javaBlocks} |\n`;
    markdown += `| 实验关联 | ${report.totals.labLinked} |\n`;
    markdown += `| 文章核心代码证据 | ${report.totals.codeEvidenceLinked} |\n`;
    markdown += `| 精确代码块证据 | ${report.totals.codeBlockEvidenceLinked} |\n`;
    markdown += `| verified Java 显式占位符 | ${report.totals.javaPlaceholderFindings} |\n`;
    markdown += `| 失效关系 | ${report.brokenRelations.length} |\n`;
    markdown += `| 过期条目 | ${report.stale.length} |\n\n`;

    markdown += '## 领域覆盖\n\n';
    markdown += '| 领域 | 条目 | verified | 类型 | Labs | 问题 |\n|---|---:|---:|---|---|---|\n';
    for (const [domain, coverage] of Object.entries(report.coverage)) {
      markdown += `| ${domain} | ${coverage.entries} | ${coverage.verified} | ${coverage.types.join(', ')} | ${coverage.labs.join(', ') || '-'} | ${coverage.problems.join('；') || '✅'} |\n`;
    }

    const failed = report.entries.filter(entry => entry.issues.length);
    if (failed.length) {
      markdown += `\n## 条目问题（${failed.length}）\n\n`;
      for (const entry of failed) {
        markdown += `### \`${entry.path}\`\n\n`;
        for (const issue of entry.issues) markdown += `- ${issue}\n`;
        markdown += '\n';
      }
    }

    writeFileSync(join(REPORTS, 'content-audit-report.md'), markdown, 'utf-8');
  }

  return report;
}

export function downgradeFailedVerified(report, today = new Date().toISOString().slice(0, 10)) {
  const changed = [];
  for (const entry of report.entries.filter(item => item.status === 'verified' && item.issues.length)) {
    const file = join(KNOWLEDGE, entry.path);
    const raw = readFileSync(file, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) continue;
    const meta = YAML.parse(match[1]);
    meta.status = 'draft';
    meta.updated = today;
    // A failed verification block may contain generic anchors, missing labs or
    // invalid evidence links. Keeping it on a draft would still present those
    // claims on the website, so a later review must rebuild it from evidence.
    delete meta.verification;
    const next = `---\n${YAML.stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n${match[2]}`;
    writeFileSync(file, next, 'utf-8');
    changed.push(entry.path);
  }
  return changed;
}

function printSummary(report) {
  console.log('🔍 深度内容审计...\n');
  console.log(
    `📊 ${report.totals.entries} 篇 | verified ✅ ${report.totals.verifiedPass}`
    + ` ❌ ${report.totals.verifiedFail} | draft ${report.totals.draft}`,
  );
  console.log(
    `🔗 失效关系 ${report.brokenRelations.length} | 重复关系 ${report.duplicateRelations.length}`
    + ` | 无关系 ${report.noRelations.length} | 孤立 verified ${report.orphanVerified.length}`
    + ` | 过期 ${report.stale.length}`,
  );
  console.log(`🧭 领域覆盖问题 ${report.coverageErrors.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let report = auditContent();
  printSummary(report);
  if (process.argv.includes('--downgrade')) {
    const changed = downgradeFailedVerified(report);
    if (changed.length) {
      console.warn(`\n📝 已将 ${changed.length} 篇不合格 verified 自动降为 draft`);
      for (const path of changed) console.warn(`   - ${path}`);
      report = auditContent();
      printSummary(report);
    }
  }
  const failed = report.totals.verifiedFail > 0
    || report.brokenRelations.length > 0
    || report.duplicateRelations.length > 0
    || report.noRelations.length > 0
    || report.orphanVerified.length > 0
    || report.coverageErrors.length > 0;
  if (failed) {
    console.error('\n❌ 内容质量审计失败');
    process.exit(1);
  }
  console.log('\n✅ 内容质量审计通过');
}
