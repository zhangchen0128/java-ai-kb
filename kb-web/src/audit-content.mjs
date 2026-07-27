#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from './parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');
const REPORTS = join(__dirname, '..', 'reports');

const REVIEW_DAYS = { fast: 90, normal: 180, stable: 365 };
const FAST_DOMAINS = ['07', '08', '09', '12', '13', '14'];
const STABLE_DOMAINS = ['00', '01', '02', '03'];

function getReviewDeadline(domain) {
  const num = domain.match(/^(\d{2})/)?.[1];
  if (FAST_DOMAINS.includes(num)) return REVIEW_DAYS.fast;
  if (STABLE_DOMAINS.includes(num)) return REVIEW_DAYS.stable;
  return REVIEW_DAYS.normal;
}

function walk(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) results.push(...walk(full, rel));
    else if (entry.endsWith('.md') && entry !== 'README.md') results.push(rel);
  }
  return results;
}

console.log('🔍 深度内容审计...\n');

const files = walk(KNOWLEDGE);
const now = new Date();
const report = {
  verified: { pass: [], fail: [] },
  draft: { pass: [], fail: [] },
  stale: [],
  orphan: [],
  noRelations: [],
  weakSources: [],
  summary: {},
};

const entryMap = new Map();
const relationGraph = new Map();

for (const rel of files) {
  const raw = readFileSync(join(KNOWLEDGE, rel), 'utf-8');
  const { meta, errors: parseErrors } = parseFrontmatter(raw);
  const domain = rel.split('/')[0];
  const name = basename(rel, '.md');

  entryMap.set(name, { path: rel, meta, domain });

  // Collect relation targets
  const rels = meta.relations || {};
  const targets = [];
  for (const arr of Object.values(rels)) {
    if (Array.isArray(arr)) targets.push(...arr.filter(Boolean));
  }
  relationGraph.set(name, { path: rel, targets, domain });

  let issues = [];

  // ===== 1. Status check =====
  const isVerified = meta.status === 'verified';
  const isDraft = meta.status === 'draft';

  // ===== 2. Version anchor =====
  if (isVerified && !meta.verification?.version_anchor) {
    issues.push('缺少 verification.version_anchor');
  }

  // ===== 3. Source quality =====
  const sources = meta.sources || [];
  const hasL0L1 = sources.some(s => s.level === 'L0' || s.level === 'L1');
  if (isVerified && !hasL0L1) {
    issues.push('已验证条目缺少 L0/L1 级别来源');
  }
  if (sources.length > 0 && !hasL0L1) {
    if (!isVerified) {
      // draft without L0/L1 is ok, but flag
    }
  }

  // Source URL validation
  for (const s of sources) {
    if (s.url) {
      try {
        const u = new URL(s.url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push(`无效来源URL协议: ${s.url}`);
        }
      } catch { issues.push(`无效来源URL: ${s.url}`); }
    }
  }

  // ===== 4. Staleness =====
  const updated = meta.updated || meta.created;
  if (updated) {
    const age = (now - new Date(updated)) / (1000 * 60 * 60 * 24);
    const deadline = getReviewDeadline(domain);
    if (age > deadline) {
      report.stale.push({ path: rel, domain, age: Math.round(age), deadline, status: meta.status });
      if (isVerified) issues.push(`超过复核期限 (${Math.round(age)}天 > ${deadline}天)`);
    }
  }

  // ===== 5. Empty relations =====
  const relationCount = Object.values(rels).flat().filter(Boolean).length;
  if (relationCount === 0) {
    report.noRelations.push({ path: rel, domain });
  }

  // ===== 6. Verification review date =====
  if (isVerified && !meta.verification?.reviewed_at) {
    issues.push('缺少 verification.reviewed_at');
  }

  // ===== 7. Code/lab linkage =====
  const body = raw.replace(/^---[\s\S]*?---/, '');
  const hasJavaCode = body.includes('```java');
  if (isVerified && hasJavaCode && !meta.verification?.lab) {
    issues.push('含Java代码但未关联实验(lab)');
  }

  if (issues.length > 0) {
    if (isVerified) report.verified.fail.push({ path: rel, domain, issues });
    else report.draft.fail.push({ path: rel, domain, issues });
  } else {
    if (isVerified) report.verified.pass.push({ path: rel, domain });
    else report.draft.pass.push({ path: rel, domain });
  }
}

// ===== 8. Orphan detection =====
const referencedBy = new Map();
for (const [name, info] of relationGraph) {
  for (const target of info.targets) {
    const t = target.split('/').pop();
    if (!referencedBy.has(t)) referencedBy.set(t, []);
    referencedBy.get(t).push(name);
  }
}
for (const [name, info] of entryMap) {
  if (!referencedBy.has(name) && info.meta.status === 'verified') {
    report.orphan.push({ path: info.path, domain: info.domain });
  }
}

// ===== Generate Report =====
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });
const OUT = join(REPORTS, 'content-audit-report.md');

let md = `# 内容质量审计报告\n\n**生成时间**: ${now.toISOString().slice(0, 19).replace('T', ' ')}\n\n`;
md += `## 📊 总览\n\n`;
md += `| 指标 | 数值 |\n|------|------|\n`;
md += `| 条目总数 | ${files.length} |\n`;
md += `| verified 通过 | ${report.verified.pass.length} |\n`;
md += `| verified 问题 | ${report.verified.fail.length} |\n`;
md += `| draft 待审 | ${report.draft.pass.length + report.draft.fail.length} |\n`;
md += `| 过期条目 | ${report.stale.length} |\n`;
md += `| 无关系条目 | ${report.noRelations.length} |\n`;
md += `| 孤立verified | ${report.orphan.length} |\n\n`;

if (report.verified.fail.length) {
  md += `## ❌ Verified 条目问题 (${report.verified.fail.length})\n\n`;
  for (const v of report.verified.fail) {
    md += `### \`${v.path}\`\n`;
    for (const i of v.issues) md += `- ${i}\n`;
    md += '\n';
  }
}

if (report.stale.length) {
  md += `## ⏰ 过期条目 (${report.stale.length})\n\n`;
  const byDomain = {};
  for (const s of report.stale) {
    byDomain[s.domain] = (byDomain[s.domain] || 0) + 1;
  }
  for (const [d, c] of Object.entries(byDomain).sort()) {
    md += `- **${d}**: ${c}篇\n`;
  }
  md += '\n';
}

if (report.noRelations.length) {
  md += `## 🔗 无关系条目 (${report.noRelations.length})\n\n`;
  for (const n of report.noRelations.slice(0, 20)) {
    md += `- \`${n.path}\`\n`;
  }
  if (report.noRelations.length > 20) md += `\n... 还有 ${report.noRelations.length - 20} 篇\n`;
  md += '\n';
}

if (report.orphan.length) {
  md += `## 🏝️ 孤立Verified条目 (${report.orphan.length})\n\n`;
  for (const o of report.orphan) {
    md += `- \`${o.path}\`\n`;
  }
  md += '\n';
}

writeFileSync(OUT, md, 'utf-8');

// Console summary
const failedVerified = report.verified.fail.length;
console.log(`\n📊 内容审计: ${files.length}篇 | verified✅${report.verified.pass.length} verified❌${failedVerified} | 过期${report.stale.length} | 孤立${report.orphan.length}`);
console.log(`📊 报告: ${OUT}`);

if (failedVerified > 0) {
  console.error(`\n❌ ${failedVerified} 篇 verified 条目存在问题`);
  process.exit(1);
}
console.log('✅ 内容审计通过\n');
