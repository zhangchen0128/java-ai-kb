#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');
const OUT = join(__dirname, '..', 'public', 'link-audit-report.md');

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

async function checkUrl(url, timeout = 10000) {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'follow' }); clearTimeout(t);
    return { status: r.status, ok: r.ok }; }
  catch {
    try { const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
      const r = await fetch(url, { method: 'GET', signal: c.signal, redirect: 'follow' }); clearTimeout(t);
      return { status: r.status, ok: r.ok }; }
    catch (e) { return { status: 0, ok: false, error: e.cause?.code || e.message }; }
  }
}

console.log('🔍 审计外部链接...\n');

const files = walk(KNOWLEDGE);
const report = { broken: [], warnings: [], stale: [], total: 0, checked: 0 };
const now = new Date();
const STALE_DAYS = 180;

// Collect all URLs first
const allUrls = [];
for (const rel of files) {
  const raw = readFileSync(join(KNOWLEDGE, rel), 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) continue;
  let meta; try { meta = YAML.parse(m[1]); } catch { continue; }

  if (meta.updated) {
    const age = (now - new Date(meta.updated)) / (1000 * 60 * 60 * 24);
    if (age > STALE_DAYS) report.stale.push({ file: rel, updated: meta.updated, age: Math.round(age) });
  }
  for (const s of (meta.sources || [])) {
    if (s.url) allUrls.push({ file: rel, url: s.url, desc: s.description || '' });
  }
}

report.total = allUrls.length;
console.log(`找到 ${report.total} 个来源 URL，开始检查（限50个）...\n`);

// Check with rate limiting
let i = 0;
for (const { file, url, desc } of allUrls) {
  if (i++ >= 50) break;
  report.checked++;
  const result = await checkUrl(url);
  if (result.status === 404 || result.status === 410) {
    report.broken.push({ file, url, status: result.status, desc });
    console.log(`  ❌ ${result.status} ${url}`);
  } else if (result.status === 0 || result.status === 401 || result.status === 403 || result.status === 429) {
    report.warnings.push({ file, url, status: result.status, error: result.error || '' });
    console.log(`  ⚠️  ${result.status || 'ERR'} ${url}`);
  } else {
    console.log(`  ✅ ${result.status} ${url}`);
  }
  await new Promise(r => setTimeout(r, 600));
}

// Generate report
const outDir = dirname(OUT);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
let md = `# 外部链接审计报告\n\n**生成时间**: ${now.toISOString().slice(0, 19).replace('T', ' ')}\n**总链接数**: ${report.total}\n**已检查**: ${report.checked}\n\n`;

md += `## ❌ 失效链接 (${report.broken.length})\n\n`;
if (!report.broken.length) md += '无失效链接。\n';
else for (const b of report.broken) md += `- [${b.status}] \`${b.url}\` — ${b.file}\n`;

md += `\n## ⚠️ 需关注 (${report.warnings.length})\n\n`;
if (!report.warnings.length) md += '无。\n';
else for (const w of report.warnings) md += `- [${w.status || 'ERR'}] \`${w.url}\` — ${w.file}\n`;

md += `\n## ⏰ 超过${STALE_DAYS}天未更新 (${report.stale.length})\n\n`;
for (const s of report.stale.slice(0, 25)) md += `- \`${s.file}\` — ${s.age}天前 (${s.updated})\n`;
if (report.stale.length > 25) md += `\n... 还有 ${report.stale.length - 25} 篇\n`;

writeFileSync(OUT, md, 'utf-8');
console.log(`\n📊 报告: ${OUT}`);
console.log(`   失效: ${report.broken.length}  警告: ${report.warnings.length}  过期: ${report.stale.length}`);
