#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');
const REPORTS = join(__dirname, '..', 'reports');
const OUT = join(REPORTS, 'link-audit-report.md');
const OUT_JSON = join(REPORTS, 'link-audit-report.json');

const CONCURRENCY = 8;
const TIMEOUT = 10_000;
const MAX_RETRIES = 1;

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

async function checkOnce(url, method = 'HEAD') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const opts = { method, signal: ctrl.signal, redirect: 'follow' };
    if (method === 'GET') opts.headers = { Range: 'bytes=0-1023' };
    const r = await fetch(url, opts);
    clearTimeout(t);
    return { status: r.status, ok: r.ok, redirected: r.redirected };
  } catch (e) {
    clearTimeout(t);
    return { status: 0, ok: false, error: e.cause?.code || e.message };
  }
}

async function checkUrl(url) {
  // 1. HEAD first
  let r = await checkOnce(url, 'HEAD');

  // 2. If HEAD blocked (403/405) or failed, retry with Range GET
  if (!r.ok || r.status === 403 || r.status === 405 || r.status === 0) {
    r = await checkOnce(url, 'GET');
  }

  // 3. If network error or timeout, retry once
  if (r.status === 0 || r.status === 429 || r.status >= 500) {
    await new Promise(res => setTimeout(res, 2000));
    r = await checkOnce(url, 'GET');
  }

  return r;
}

async function run() {
  console.log('🔍 全量链接审计...\n');

  const files = walk(KNOWLEDGE);
  const urlMap = new Map(); // url -> { files, desc }
  const now = new Date();
  const STALE_DAYS = 180;
  const staleEntries = [];

  // Collect & deduplicate URLs
  for (const rel of files) {
    const raw = readFileSync(join(KNOWLEDGE, rel), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    let meta; try { meta = YAML.parse(m[1]); } catch { continue; }

    if (meta.updated) {
      const age = (now - new Date(meta.updated)) / (1000 * 60 * 60 * 24);
      if (age > STALE_DAYS) staleEntries.push({ file: rel, updated: meta.updated, age: Math.round(age) });
    }
    for (const s of (meta.sources || [])) {
      if (!s.url) continue;
      const u = s.url.trim();
      if (!urlMap.has(u)) urlMap.set(u, { files: [], desc: s.description || '' });
      urlMap.get(u).files.push(rel);
    }
  }

  const uniqueUrls = [...urlMap.keys()];
  console.log(`📊 总URL: ${[...urlMap.values()].reduce((a, v) => a + v.files.length, 0)} 个引用`);
  console.log(`📊 唯一URL: ${uniqueUrls.length} 个`);
  console.log(`📊 并发: ${CONCURRENCY}  超时: ${TIMEOUT / 1000}s\n`);

  // Check with concurrency
  const broken = [];
  const warnings = [];
  const passed = [];
  let checked = 0;

  async function processUrl(url) {
    const info = urlMap.get(url);
    const r = await checkUrl(url);
    const entry = { url, files: info.files, desc: info.desc, status: r.status };

    if (r.status === 404 || r.status === 410) {
      broken.push(entry);
      process.stdout.write('❌');
    } else if (r.status === 0 || r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) {
      warnings.push({ ...entry, error: r.error || '' });
      process.stdout.write('⚠️');
    } else if (r.ok || r.status >= 300 && r.status < 400) {
      passed.push(entry);
      process.stdout.write('.');
    } else {
      warnings.push({ ...entry, error: `Unexpected status ${r.status}` });
      process.stdout.write('?');
    }
    checked++;
    if (checked % 20 === 0) process.stdout.write(` ${checked}/${uniqueUrls.length}\n`);
  }

  // Process in batches
  const queue = [...uniqueUrls];
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(processUrl));
    if (queue.length > 0) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n\n✅ 完成: ${passed.length}  ✅  失效: ${broken.length}  ❌  警告: ${warnings.length}  ⚠️\n`);

  // Generate report
  if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

  let md = `# 外部链接审计报告\n\n`;
  md += `**生成时间**: ${now.toISOString().slice(0, 19).replace('T', ' ')}\n`;
  md += `**总引用**: ${[...urlMap.values()].reduce((a, v) => a + v.files.length, 0)}\n`;
  md += `**唯一URL**: ${uniqueUrls.length}   **已检**: ${checked}\n`;
  md += `**通过**: ${passed.length}   **失效**: ${broken.length}   **警告**: ${warnings.length}\n\n`;

  // Broken links
  md += `## ❌ 失效链接 (${broken.length})\n\n`;
  if (broken.length === 0) md += '✅ 无失效链接。\n\n';
  else for (const b of broken) {
    md += `### \`${b.url}\`\n\n- **状态**: ${b.status}\n- **描述**: ${b.desc}\n- **引用文件**:\n`;
    for (const f of b.files) md += `  - \`${f}\`\n`;
    md += '\n';
  }

  // Warnings
  md += `## ⚠️ 需关注 (${warnings.length})\n\n`;
  if (warnings.length === 0) md += '无。\n\n';
  else for (const w of warnings) {
    md += `- [${w.status || 'ERR'}] \`${w.url}\` — ${w.error || w.desc}\n`;
    for (const f of w.files) md += `  - \`${f}\`\n`;
    md += '\n';
  }

  // Stale
  md += `## ⏰ 超过${STALE_DAYS}天未更新 (${staleEntries.length})\n\n`;
  for (const s of staleEntries.slice(0, 30)) md += `- \`${s.file}\` — ${s.age}天前 (${s.updated})\n`;
  if (staleEntries.length > 30) md += `\n... 还有 ${staleEntries.length - 30} 篇\n`;

  writeFileSync(OUT, md, 'utf-8');
  writeFileSync(OUT_JSON, JSON.stringify({ broken, warnings, passed, stale: staleEntries, stats: { totalRefs: [...urlMap.values()].reduce((a, v) => a + v.files.length, 0), uniqueUrls: uniqueUrls.length, checked, passed: passed.length, broken: broken.length, warnings: warnings.length } }, null, 2), 'utf-8');

  console.log(`📊 Markdown报告: ${OUT}`);
  console.log(`📊 JSON报告:    ${OUT_JSON}`);

  // Exit code: 1 if broken links found
  if (broken.length > 0) {
    console.log(`\n❌ 发现 ${broken.length} 个失效链接，退出码 1`);
    process.exit(1);
  } else {
    console.log('\n✅ 所有链接正常');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(2); });
