import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// Configure marked with proper highlight.js integration
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch {}
    }
    return hljs.highlightAuto(code).value;
  }
}));

marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Render markdown body to HTML with code highlighting.
 */
export function renderMarkdown(body) {
  return marked.parse(body);
}

/**
 * Add callout blocks: > **Info:** text → <blockquote class="callout callout-info">
 */
export function processCallouts(html) {
  const calloutMap = {
    'info': 'info', 'information': 'info', '注意': 'info',
    'warn': 'warn', 'warning': 'warn', '警告': 'warn',
    'tip': 'tip', '提示': 'tip',
  };

  html = html.replace(/<blockquote>\s*<p><strong>(Info|Information|Warning|Warn|Tip|注意|警告|提示)[：:]?\s*<\/strong>\s*/gi,
    (match, keyword) => {
      const type = calloutMap[keyword.toLowerCase()] || 'info';
      return `<blockquote class="callout callout-${type}"><p><strong>${keyword[0].toUpperCase() + keyword.slice(1)}：</strong> `;
    });

  return html;
}

/**
 * Add copy buttons and language labels to code blocks.
 */
export function enhanceCodeBlocks(html) {
  const enhanced = html.replace(/<pre><code( class="hljs language-(\w+)")?>/g, (m, cls, lang) => {
    const lb = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block"><div class="code-header">${lb}<button class="copy-btn" onclick="copyCode(this)">复制</button></div><pre><code${cls || ''}>`;
  }).replace(/<\/code><\/pre>/g, '</code></pre></div>');
  return enhanced.replace(
    /<!--\s*code-id:\s*([a-z][a-z0-9-]{2,63})\s*-->\s*<div class="code-block"><div class="code-header">/g,
    (_, id) => `<div class="code-block code-evidenced" id="code-${id}" data-code-id="${id}"><div class="code-header"><span class="code-evidence-id">已映射 · ${id}</span>`,
  );
}

/**
 * Build full HTML for a knowledge entry page.
 * @param {string} title
 * @param {object} meta - Validated frontmatter
 * @param {string} bodyHtml - Rendered & processed HTML content
 * @param {string} domainDir - Domain directory name
 * @param {string} domainNum - Domain number (01-18)
 * @returns {string} Full HTML article
 */
export function buildEntryHTML(title, meta, bodyHtml, domainDir, domainNum) {
  const repositoryUrl = 'https://github.com/zhangchen0128/java-ai-kb';
  const badges = [];
  const statusLabels = { draft: '📝 草稿', verified: '✅ 已验证', outdated: '⚠️ 过时' };
  const levelLabels = { beginner: '🟢 入门', intermediate: '🟡 中级', advanced: '🔴 高级', reference: '📖 参考' };
  const contentLabels = {
    overview: '总览',
    concept: '原理',
    practice: '实践',
    production: '生产',
    'case-study': '案例',
    reference: '参考',
  };

  badges.push(`<span class="badge badge-${meta.status}">${statusLabels[meta.status]}</span>`);
  if (meta.stale) badges.push('<span class="badge badge-stale">⏰ 待复核</span>');
  if (meta.level) badges.push(`<span class="badge badge-level">${levelLabels[meta.level]}</span>`);
  if (meta.content_type) {
    badges.push(`<span class="badge badge-content">${contentLabels[meta.content_type] || escapeHtml(meta.content_type)}</span>`);
  }
  if (meta.tags) {
    badges.push(...meta.tags.slice(0, 5).map(t =>
      `<button type="button" class="badge badge-tag" data-tag="${escapeAttr(t)}" onclick="searchTag(this.dataset.tag)">#${escapeHtml(t)}</button>`));
  }

  const sourceList = (meta.sources || []).filter(s => s.url).map(s =>
    `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" class="source-link" title="${escapeAttr(s.description || '')}"><span class="source-level">${escapeHtml(s.level)}</span>${escapeHtml(s.description || s.url)}</a>`
  ).join('');

  const verification = meta.verification;
  const labUrl = verification?.lab
    ? `${repositoryUrl}/tree/main/labs/${encodeURIComponent(verification.lab)}`
    : null;
  const evidence = verification?.evidence;
  const evidenceFiles = evidence
    ? [
        ...evidence.source_files.map(path => ({ path, kind: '源码' })),
        ...evidence.test_files.map(path => ({ path, kind: '测试' })),
      ]
    : [];
  const evidenceHtml = evidence ? `
      <details class="verification-evidence">
        <summary><strong>核心代码证据：</strong>${evidence.source_files.length} 个源码 / ${evidence.test_files.length} 个测试${evidence.blocks?.length ? ` / ${evidence.blocks.length} 个精确代码块` : ''}</summary>
        <ul>
          ${(evidence.blocks || []).map(block => {
            const sourceSymbols = block.sources.flatMap(item => item.symbols);
            const testSymbols = block.tests.flatMap(item => item.symbols);
            return `<li class="block-evidence-item"><button type="button" class="block-evidence-link" data-code-id="code-${escapeAttr(block.id)}" onclick="document.getElementById(this.dataset.codeId)?.scrollIntoView({behavior:'smooth',block:'center'})">代码块：${escapeHtml(block.id)}</button><small>源码符号 ${sourceSymbols.map(escapeHtml).join(', ')}；测试 ${testSymbols.map(escapeHtml).join(', ')}</small></li>`;
          }).join('')}
          ${evidenceFiles.map(file => `<li><a href="${repositoryUrl}/blob/main/${escapeAttr(file.path)}" target="_blank" rel="noopener">${file.kind}：${escapeHtml(file.path)}</a></li>`).join('')}
        </ul>
      </details>` : '';
  const performanceLabel = verification?.performance?.status === 'reproducible'
    ? '可复现基准'
    : (verification?.performance?.status === 'illustrative' ? '示意数据（非基准）' : null);
  const verificationHtml = verification ? `
    <div class="entry-verification" aria-label="内容验证信息">
      <span><strong>复核：</strong>${escapeHtml(verification.reviewed_at)}</span>
      <span><strong>版本：</strong>${escapeHtml(verification.version_anchor)}</span>
      <span><strong>代码：</strong>${escapeHtml(verification.code_status)}${evidence ? `（文章核心${evidence.blocks?.length ? `，${evidence.blocks.length} 块精确映射` : ''}）` : ''}</span>
      ${labUrl ? `<a href="${labUrl}" target="_blank" rel="noopener"><strong>实验：</strong>${escapeHtml(verification.lab)}</a>` : ''}
      ${performanceLabel ? `<span><strong>性能：</strong>${performanceLabel}</span>` : ''}
      ${evidenceHtml}
    </div>` : '';

  const statusNotice = meta.status === 'draft'
    ? '<div class="status-notice status-notice-draft"><strong>草稿提示：</strong>本条目尚未完成来源、版本和代码联合复核，请勿将示例直接用于生产环境。</div>'
    : (meta.stale
      ? '<div class="status-notice status-notice-stale"><strong>复核提示：</strong>本条目已超过维护周期，内容可能与当前版本存在差异。</div>'
      : '');

  return `
<article class="kb-entry" data-path="/${escapeAttr(domainDir)}" data-status="${escapeAttr(meta.status)}" data-content-type="${escapeAttr(meta.content_type || '')}">
  <div class="entry-meta">
    <div class="entry-domain"><a href="#/?d=${domainNum}">${escapeHtml(domainDir)}</a></div>
    <h1>${escapeHtml(title)}</h1>
    <div class="entry-badges">${badges.join('')}</div>
    ${verificationHtml}
    ${sourceList ? `<div class="entry-sources"><small>📖 来源：${sourceList}</small></div>` : ''}
  </div>
  ${statusNotice}
  <div class="entry-body">${bodyHtml}</div>
</article>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
