import * as cheerio from 'cheerio';

/**
 * Resolve [[wikilinks]] in HTML body fragment, using Cheerio to safely
 * target only text nodes, skipping pre, code, a, script, style.
 * Returns a raw HTML fragment — never wraps in html/head/body.
 *
 * @param {string} html - Rendered HTML body fragment
 * @param {Map} entryMap - Map of relPath → { url, name, title, domainNum }
 * @param {Set} domainSet - Set of domain directory names
 * @param {boolean} strict - If true, unresolved wikilinks throw
 * @returns {{html: string, unresolved: string[]}}
 */
export function resolveWikilinks(html, entryMap, domainSet, strict = true) {
  // Load as fragment — no automatic html/head/body wrapper
  const $ = cheerio.load(html, { xml: { decodeEntities: false, xmlMode: false } }, false);
  const unresolved = [];

  const skipTags = new Set(['pre', 'code', 'a', 'script', 'style', 'head']);

  // Walk all text nodes recursively, skipping protected elements
  function walkNodes(root) {
    if (!root || !root.childNodes) return;
    for (const el of root.childNodes) {
      if (el.type === 'text') {
        processTextNode(el);
      } else if (el.type === 'tag' || el.type === 'script' || el.type === 'style') {
        if (!skipTags.has((el.name || '').toLowerCase())) {
          walkNodes(el);
        }
      }
    }
  }

  function processTextNode(textNode) {
    const text = textNode.data;
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    const replacements = [];

    while ((m = re.exec(text)) !== null) {
      const ref = m[1].trim();
      const fullMatch = m[0];
      const idx = m.index;

      const resolved = resolveRef(ref, entryMap, domainSet);
      if (!resolved) {
        if (strict) {
          throw new Error(`Unresolved wikilink: [[${ref}]]`);
        }
        unresolved.push(ref);
        replacements.push({
          idx, len: fullMatch.length,
          html: `<span class="broken-ref" title="未找到: ${escapeHtml(ref)}">${escapeHtml(ref)}</span>`
        });
      } else {
        replacements.push({ idx, len: fullMatch.length, html: resolved });
      }
    }

    if (replacements.length > 0) {
      let result = '';
      let pos = 0;
      for (const r of replacements) {
        result += text.slice(pos, r.idx) + r.html;
        pos = r.idx + r.len;
      }
      result += text.slice(pos);
      $(textNode).replaceWith(result);
    }
  }

  // Detect body wrapper: if input has <html> or <body>, work within body only
  const bodyEl = $('body');
  if (bodyEl.length) {
    walkNodes(bodyEl[0]);
    return { html: bodyEl.html() || '', unresolved };
  }

  // Otherwise walk root-level children (fragment mode)
  walkNodes($.root()[0]);
  return { html: $.root().html() || '', unresolved };
}

function resolveRef(ref, entryMap, domainSet) {
  // 1. Direct filename match (ref.md)
  let found = entryMap.get(ref + '.md');
  if (found) return link(found.url, ref);

  // 2. Match by title
  for (const v of entryMap.values()) {
    if (v.name === ref || v.title === ref) return link(v.url, ref);
  }

  // 3. Path-based match (e.g. "02-java-platform/some-file")
  if (ref.includes('/')) {
    for (const [k, v] of entryMap) {
      if (k.endsWith('/' + ref + '.md') || k.includes('/' + ref + '.md'))
        return link(v.url, ref);
    }
  }

  // 4. Domain-level ref (e.g. "02-java-platform" or "02-Java平台")
  if (domainSet.has(ref)) {
    const num = ref.match(/^(\d{2})/)?.[1] || '00';
    return `<a href="#/?d=${num}" class="cross-ref domain-ref">${escapeHtml(ref)}</a>`;
  }

  // 5. README refs: "XX-知识域/README" or "README"
  if (ref.endsWith('/README') || ref === 'README') {
    const parts = ref.split('/');
    if (parts.length === 2 && domainSet.has(parts[0])) {
      const num = parts[0].match(/^(\d{2})/)?.[1] || '00';
      return `<a href="#/?d=${num}" class="cross-ref domain-ref">${escapeHtml(parts[0])}</a>`;
    }
  }

  // 6. Project doc refs: KNOWLEDGE_TAXONOMY, TECHNOLOGY_RADAR, CLAUDE
  const docRefs = {
    'KNOWLEDGE_TAXONOMY': '分类体系',
    'TECHNOLOGY_RADAR': '技术雷达',
    'CLAUDE': '操作规则',
    'README': '项目说明',
  };
  if (docRefs[ref]) {
    return `<span class="cross-ref project-ref" title="${docRefs[ref]}">${escapeHtml(ref)}</span>`;
  }

  return null;
}

function link(url, label) {
  return `<a href="#${url}" class="cross-ref">${escapeHtml(label)}</a>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { escapeHtml };
