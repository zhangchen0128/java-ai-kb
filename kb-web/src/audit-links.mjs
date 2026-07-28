#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const KNOWLEDGE = join(ROOT, 'knowledge');
const REPORTS = join(__dirname, '..', 'reports');

const GLOBAL_CONCURRENCY = 12;
const HOST_CONCURRENCY = 2;
const TIMEOUT_MS = 8_000;

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

function changedKnowledgeFiles() {
  const commands = [
    ['diff', '--name-only', 'origin/main...HEAD'],
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
  ];
  const files = new Set();
  for (const args of commands) {
    try {
      const output = execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
      for (const file of output.split('\n')) {
        if (file.startsWith('knowledge/') && file.endsWith('.md')) files.add(file.slice('knowledge/'.length));
      }
    } catch {
      // A shallow checkout may not have origin/main. Other diff modes still work.
    }
  }
  return [...files];
}

export function collectSources({ changedOnly = false } = {}) {
  let files = changedOnly ? changedKnowledgeFiles() : walk(KNOWLEDGE);
  if (changedOnly && files.length === 0) return new Map();

  const urls = new Map();
  for (const rel of files) {
    const full = join(KNOWLEDGE, rel);
    if (!existsSync(full)) continue;
    const raw = readFileSync(full, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;
    let meta;
    try {
      meta = YAML.parse(match[1]);
    } catch {
      continue;
    }
    for (const source of meta.sources || []) {
      if (!source.url) continue;
      const url = source.url.trim();
      if (!urls.has(url)) urls.set(url, { files: [], descriptions: [] });
      const info = urls.get(url);
      info.files.push(rel);
      if (source.description) info.descriptions.push(source.description);
    }
  }
  return urls;
}

export async function requestUrl(url, method = 'HEAD', timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'User-Agent': 'java-ai-kb-link-audit/1.0 (+https://github.com/zhangchen0128/java-ai-kb)',
      Accept: '*/*',
    };
    if (method === 'GET') headers.Range = 'bytes=0-1023';
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (response.body) await response.body.cancel().catch(() => {});
    return {
      status: response.status,
      finalUrl: response.url,
      redirected: response.redirected,
    };
  } catch (error) {
    return {
      status: 0,
      error: error.cause?.code || error.name || error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkUrl(
  url,
  requester = requestUrl,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  let result = await requester(url, 'HEAD');
  if ([0, 403, 404, 405].includes(result.status)) {
    result = await requester(url, 'GET');
  }
  if (result.status === 0 || result.status === 429 || result.status >= 500) {
    await wait(500);
    result = await requester(url, 'GET');
  }
  return result;
}

export function classifyResult(result) {
  if ([404, 410].includes(result.status)) return 'broken';
  if ((result.status >= 200 && result.status < 400)) return 'passed';
  return 'warning';
}

async function runPool(urls, worker) {
  const pending = [...urls];
  const hostActive = new Map();
  let active = 0;
  let complete = 0;

  return new Promise((resolve, reject) => {
    function schedule() {
      while (active < GLOBAL_CONCURRENCY && pending.length > 0) {
        const index = pending.findIndex(url => {
          const host = new URL(url).hostname;
          return (hostActive.get(host) || 0) < HOST_CONCURRENCY;
        });
        if (index === -1) break;

        const [url] = pending.splice(index, 1);
        const host = new URL(url).hostname;
        active++;
        hostActive.set(host, (hostActive.get(host) || 0) + 1);

        Promise.resolve(worker(url))
          .then(() => {
            complete++;
            if (complete % 20 === 0 || complete === urls.length) {
              process.stdout.write(` ${complete}/${urls.length}\n`);
            }
          })
          .catch(reject)
          .finally(() => {
            active--;
            hostActive.set(host, hostActive.get(host) - 1);
            if (pending.length === 0 && active === 0) resolve();
            else schedule();
          });
      }
    }
    if (pending.length === 0) resolve();
    else schedule();
  });
}

export async function auditLinks({ changedOnly = false, writeReports = true } = {}) {
  const started = Date.now();
  const sourceMap = collectSources({ changedOnly });
  const urls = [...sourceMap.keys()];
  const results = { passed: [], broken: [], warnings: [] };

  await runPool(urls, async url => {
    const checked = await checkUrl(url);
    const info = sourceMap.get(url);
    const entry = {
      url,
      files: [...new Set(info.files)],
      descriptions: [...new Set(info.descriptions)],
      ...checked,
    };
    const classification = classifyResult(checked);
    if (classification === 'broken') {
      results.broken.push(entry);
      process.stdout.write('❌');
    } else if (classification === 'passed') {
      results.passed.push(entry);
      process.stdout.write('.');
    } else {
      results.warnings.push(entry);
      process.stdout.write('⚠️');
    }
  });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: changedOnly ? 'changed' : 'full',
    durationMs: Date.now() - started,
    stats: {
      uniqueUrls: urls.length,
      passed: results.passed.length,
      broken: results.broken.length,
      warnings: results.warnings.length,
    },
    ...results,
  };

  if (writeReports) {
    if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, 'link-audit-report.json'), JSON.stringify(report, null, 2), 'utf-8');
    let markdown = '# 外部链接审计报告\n\n';
    markdown += `生成时间：${report.generatedAt}\n\n`;
    markdown += `模式：${report.mode}；唯一 URL：${urls.length}；通过：${results.passed.length}；失效：${results.broken.length}；警告：${results.warnings.length}；耗时：${Math.round(report.durationMs / 1000)} 秒。\n\n`;
    markdown += `## 失效链接（${results.broken.length}）\n\n`;
    for (const item of results.broken) {
      markdown += `- ${item.status} ${item.url}\n`;
      for (const file of item.files) markdown += `  - \`${file}\`\n`;
    }
    markdown += `\n## 警告（${results.warnings.length}）\n\n`;
    for (const item of results.warnings) {
      markdown += `- ${item.status || item.error || 'ERR'} ${item.url}\n`;
    }
    writeFileSync(join(REPORTS, 'link-audit-report.md'), markdown, 'utf-8');
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changedOnly = process.argv.includes('--changed');
  console.log(`🔍 ${changedOnly ? '变更' : '全量'}链接审计...`);
  const report = await auditLinks({ changedOnly });
  console.log(
    `\n✅ ${report.stats.passed} 通过  ❌ ${report.stats.broken} 失效`
    + `  ⚠️ ${report.stats.warnings} 警告  ⏱️ ${Math.round(report.durationMs / 1000)}s`,
  );
  if (report.stats.broken > 0) process.exit(1);
}
