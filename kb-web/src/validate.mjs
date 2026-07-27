#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from './parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(__dirname, '..', '..', 'knowledge');

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

console.log('🔍 验证知识库...\n');

const files = walk(KNOWLEDGE);
let errors = 0;
let warnings = 0;

const allEntries = [];
const entryNames = new Set();
const domainSet = new Set();

for (const rel of files) {
  const fullPath = join(KNOWLEDGE, rel);
  const raw = readFileSync(fullPath, 'utf-8');
  const { meta, errors: parseErrors } = parseFrontmatter(raw);

  if (parseErrors.length > 0) {
    console.error(`❌ ${rel}:`);
    parseErrors.forEach(e => console.error(`   ${e}`));
    errors += parseErrors.length;
    continue;
  }

  const domain = rel.split('/')[0];
  domainSet.add(domain);
  entryNames.add(meta.title || basename(rel, '.md'));
  allEntries.push({ path: rel, meta, domain });

  // Check source URLs
  for (const s of meta.sources || []) {
    if (s.url) {
      try { const u = new URL(s.url); if (u.protocol !== 'http:' && u.protocol !== 'https:') { console.warn(`⚠️  ${rel}: source URL 协议无效: ${s.url}`); warnings++; } }
      catch { console.warn(`⚠️  ${rel}: source URL 无效: ${s.url}`); warnings++; }
    }
  }
}

// Validate relations
const fileNames = new Set(files.map(f => f.replace(/\.md$/, '').split('/').pop()));
const domainNames = new Set(files.map(f => f.split('/')[0]));
// Build path→entry map for path-based references
const pathMap = new Map();
for (const f of files) {
  const name = f.replace(/\.md$/, '').split('/').pop();
  pathMap.set(name, true);
  // Also register with relative path from knowledge root
  pathMap.set(f.replace(/\.md$/, ''), true);
}

for (const e of allEntries) {
  const rels = e.meta.relations || {};
  for (const [type, targets] of Object.entries(rels)) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (!target) continue;
      // Domain ref: must match an exact domain directory name
      if (/^\d{2}-.+$/.test(target) && domainNames.has(target)) continue;
      // If it looks like a domain ref but doesn't match a real domain, treat as invalid entry
      if (/^\d{2}-[a-z-]+$/.test(target) && !domainNames.has(target)) {
        warnings++;
        console.warn(`⚠️  ${e.path}: relations.${type} → "${target}" 不是有效的域或条目`);
        continue;
      }
      // Path-based ref: "05-分布式架构/05-熔断限流与弹性设计"
      if (pathMap.has(target)) continue;
      // Bare filename ref
      if (fileNames.has(target)) continue;
      // Try stripping dirname
      const last = target.split('/').pop();
      if (fileNames.has(last)) continue;

      console.warn(`⚠️  ${e.path}: relations.${type} → "${target}" 未找到`); warnings++;
    }
  }
}

// Summary
const statusDist = {};
const levelDist = {};
for (const e of allEntries) {
  statusDist[e.meta.status] = (statusDist[e.meta.status] || 0) + 1;
  levelDist[e.meta.level] = (levelDist[e.meta.level] || 0) + 1;
}

console.log(`\n📊 验证报告:`);
console.log(`   条目总数: ${allEntries.length}`);
console.log(`   错误: ${errors}  警告: ${warnings}`);
console.log(`   状态分布: ${JSON.stringify(statusDist)}`);
console.log(`   难度分布: ${JSON.stringify(levelDist)}`);
console.log(`   知识域:   ${domainSet.size}`);

if (errors > 0 || warnings > 0) {
  console.error(`\n❌ 验证失败: ${errors} 错误, ${warnings} 警告`);
  process.exit(1);
}
console.log('✅ 验证通过 (0 错误, 0 警告)\n');
