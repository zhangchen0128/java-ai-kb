#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from './parse.mjs';
import { renderMarkdown, processCallouts, enhanceCodeBlocks, buildEntryHTML } from './render.mjs';
import { resolveWikilinks, escapeHtml } from './wikilinks.mjs';
import { isReviewStale } from './audit-content.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');
const PUBLIC = join(__dirname, '..', 'public');
const CONTENT = join(PUBLIC, 'content');
const BUILD_DATE = new Date();

// ===== Utilities =====
function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
function walk(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) { results.push(...walk(full, rel)); }
    else if (entry.endsWith('.md') && entry !== 'README.md') { results.push(rel); }
  }
  return results;
}

// ===== Main Build =====
console.log('🔨 构建知识库网页...\n');

// A build is always reproducible from an empty output directory. This also
// prevents deleted pages and old audit reports from surviving a deployment.
if (existsSync(PUBLIC)) rmSync(PUBLIC, { recursive: true });
ensureDir(PUBLIC);
console.log('🧹 已从空 public/ 目录开始构建');

const files = walk(KNOWLEDGE);
console.log(`📄 找到 ${files.length} 个条目\n`);

// Phase 1: Parse all files and collect metadata
const entries = [];
const entryMap = new Map(); // relPath → entry
const domainSet = new Set();
let totalLines = 0;

for (const rel of files) {
  const fullPath = join(KNOWLEDGE, rel);
  const raw = readFileSync(fullPath, 'utf-8');
  totalLines += raw.split('\n').length;

  const { meta, body, errors } = parseFrontmatter(raw);
  if (errors.length > 0) {
    console.error(`❌ 解析错误: ${rel}`);
    errors.forEach(e => console.error(`   ${e}`));
    process.exit(1);
  }

  const parts = rel.split('/');
  const domainDir = parts[0];
  const fname = basename(rel, '.md');
  const urlPath = '/' + rel.replace(/\.md$/, '');
  const domainNum = domainDir.match(/^(\d{2})/)?.[1] || '99';

  domainSet.add(domainDir);

  const entry = {
    path: rel,
    url: urlPath,
    name: fname,
    title: meta.title || fname,
    domain: domainDir,
    domainNum,
    status: meta.status,
    level: meta.level,
    tags: meta.tags || [],
    sources: meta.sources || [],
    relations: meta.relations || {},
    contentType: meta.content_type,
    stale: isEntryStale(meta, domainDir),
    meta,
    body,
  };
  entries.push(entry);
  entryMap.set(rel, entry);
}

function isEntryStale(meta, domain) {
  const reference = meta.status === 'verified'
    ? meta.verification?.reviewed_at
    : (meta.updated || meta.created);
  if (!reference) return false;
  return isReviewStale(domain, reference, BUILD_DATE);
}

// Phase 2: Validate relations
console.log('🔍 验证交叉引用...');
let relErrors = 0;
const entryNames = new Set(entries.map(e => e.name));
entryNames.add('README');
for (const e of entries) {
  const rels = e.relations;
  for (const [type, targets] of Object.entries(rels)) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      // Domain reference like "02-java-platform"
      if (/^\d{2}-[a-z-]+$/.test(target) && domainSet.has(target)) continue;
      // Entry name
      if (entryNames.has(target)) continue;
      // Full path reference
      const found = [...entryMap.keys()].some(k => k.includes('/' + target + '.md') || k.endsWith('/' + target + '.md'));
      if (found) continue;
      // References may retain an old directory prefix while the filename is stable.
      const last = target.replace(/\.md$/, '').split('/').pop();
      if (entryNames.has(last)) continue;

      console.error(`  ❌ ${e.path}: relations.${type} → "${target}" 未找到`);
      relErrors++;
    }
  }
}
console.log(`  ${relErrors > 0 ? '⚠️ ' + relErrors + ' 个未解析的关系引用' : '✅ 全部关系引用有效'}\n`);
if (relErrors > 0) process.exit(1);

// Phase 3: Build nav tree
console.log('🌳 构建导航树...');
const tree = {};
for (const e of entries) {
  const parts = e.path.split('/');
  parts.pop(); // Remove filename
  let node = tree;
  for (const part of parts) {
    if (!node[part]) node[part] = { _entries: [] };
    node = node[part];
  }
  node._entries.push({
    url: e.url,
    title: e.title,
    status: e.status,
    level: e.level,
    contentType: e.contentType,
    stale: e.stale,
  });
}
function sortTree(node) {
  if (node._entries) node._entries.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  for (const key of Object.keys(node)) {
    if (key !== '_entries') sortTree(node[key]);
  }
}
sortTree(tree);
writeFileSync(join(PUBLIC, 'nav-tree.json'), JSON.stringify(tree), 'utf-8');
console.log('✅ nav-tree.json');

// Phase 4: Build search index
console.log('🔍 构建搜索索引...');
const searchIndex = entries.map(e => ({
  u: e.url,
  t: e.title,
  d: e.domain,
  g: e.tags,
  st: e.status,
  ct: e.contentType,
  x: e.stale,
  s: e.body.replace(/[#*`\[\]()>|\-]/g, '').replace(/\n+/g, ' ').trim().slice(0, 240),
}));
writeFileSync(join(PUBLIC, 'search-index.json'), JSON.stringify(searchIndex), 'utf-8');
console.log('✅ search-index.json');

// Phase 5: Render and write HTML
console.log('📝 渲染 HTML...');
const domainCount = domainSet.size;
let renderedCount = 0;

for (const e of entries) {
  let html = renderMarkdown(e.body);
  html = processCallouts(html);
  html = enhanceCodeBlocks(html);

  // Resolve wikilinks (strict mode — fail on broken links)
  try {
    const { html: resolvedHtml } = resolveWikilinks(html, entryMap, domainSet, true);
    html = resolvedHtml;
  } catch (err) {
    console.error(`❌ ${e.path}: ${err.message}`);
    process.exit(1);
  }

  const fullHtml = buildEntryHTML(e.title, { ...e.meta, stale: e.stale }, html, e.domain, e.domainNum);

  const outPath = join(CONTENT, e.url + '.html');
  ensureDir(dirname(outPath));
  writeFileSync(outPath, fullHtml, 'utf-8');
  renderedCount++;
}

// Phase 6: Copy static assets
console.log('📋 复制静态资源...');
const staticFiles = ['index.html', '404.html', 'app.css', 'app.js', 'sw.js', 'manifest.json'];
const srcDir = join(__dirname, '..');
for (const f of staticFiles) {
  const src = join(srcDir, f);
  if (existsSync(src)) {
    writeFileSync(join(PUBLIC, f), readFileSync(src, 'utf-8'), 'utf-8');
  }
}
// .nojekyll for GitHub Pages
writeFileSync(join(PUBLIC, '.nojekyll'), '', 'utf-8');

// Phase 7: Generate site-meta.json
const statusDist = {};
const levelDist = {};
for (const e of entries) {
  statusDist[e.status] = (statusDist[e.status] || 0) + 1;
  levelDist[e.level] = (levelDist[e.level] || 0) + 1;
}
const siteMeta = {
  entries: entries.length,
  domains: domainCount,
  lines: totalLines,
  status: statusDist,
  level: levelDist,
  verified: statusDist.verified || 0,
  stale: entries.filter(entry => entry.stale).length,
  updated: new Date().toISOString().slice(0, 10),
};
writeFileSync(join(PUBLIC, 'site-meta.json'), JSON.stringify(siteMeta), 'utf-8');
console.log('✅ site-meta.json');

// ===== Build Summary =====
console.log(`\n🎉 构建完成！`);
console.log(`   知识条目: ${renderedCount} 篇`);
console.log(`   知识域:   ${domainCount} 个`);
console.log(`   总行数:   ${totalLines.toLocaleString()} 行`);
console.log(`   输出目录: ${PUBLIC}`);
console.log(`   预览:     npx serve ${PUBLIC} -l 3000\n`);
