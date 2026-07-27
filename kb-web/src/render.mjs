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
  return html.replace(/<pre><code( class="hljs language-(\w+)")?>/g, (m, cls, lang) => {
    const lb = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block"><div class="code-header">${lb}<button class="copy-btn" onclick="copyCode(this)">复制</button></div><pre><code${cls || ''}>`;
  }).replace(/<\/code><\/pre>/g, '</code></pre></div>');
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
  const badges = [];
  const statusLabels = { draft: '📝 草稿', verified: '✅ 已验证', outdated: '⚠️ 过时' };
  const levelLabels = { beginner: '🟢 入门', intermediate: '🟡 中级', advanced: '🔴 高级', reference: '📖 参考' };

  badges.push(`<span class="badge badge-${meta.status}">${statusLabels[meta.status]}</span>`);
  if (meta.level) badges.push(`<span class="badge badge-level">${levelLabels[meta.level]}</span>`);
  if (meta.tags) {
    badges.push(...meta.tags.slice(0, 5).map(t => `<span class="badge badge-tag">#${escapeAttr(t)}</span>`));
  }

  const sourceList = (meta.sources || []).filter(s => s.url).map(s =>
    `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" class="source-link" title="${escapeAttr(s.description || '')}">${escapeHtml(s.description || s.url)}</a>`
  ).join('');

  return `
<article class="kb-entry" data-path="/${escapeAttr(domainDir)}">
  <div class="entry-meta">
    <div class="entry-domain"><a href="#/?d=${domainNum}">${escapeHtml(domainDir)}</a></div>
    <h1>${escapeHtml(title)}</h1>
    <div class="entry-badges">${badges.join('')}</div>
    ${sourceList ? `<div class="entry-sources"><small>📖 来源：${sourceList}</small></div>` : ''}
  </div>
  <div class="entry-body">${bodyHtml}</div>
</article>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
