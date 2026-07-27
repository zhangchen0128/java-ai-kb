import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWikilinks, escapeHtml } from './wikilinks.mjs';

// Test helpers
function makeEntry(path, name, title, domain, num) {
  const parts = path.split('/');
  return { path, url: '/' + path.replace(/\.md$/, ''), name, title, domain, domainNum: num };
}

describe('resolveWikilinks', () => {
  const entryMap = new Map();
  entryMap.set('02-java-platform/JVM/02-jvm-deep.md',
    makeEntry('02-java-platform/JVM/02-jvm-deep.md', '02-jvm-deep', 'JVM深度解析', '02-java-platform', '02'));
  entryMap.set('03-spring/03-ioc.md',
    makeEntry('03-spring/03-ioc.md', '03-ioc', 'Spring IoC容器', '03-spring', '03'));
  const domains = new Set(['02-java-platform', '03-spring']);

  it('resolves direct filename wikilinks', () => {
    const { html } = resolveWikilinks('<p>See [[02-jvm-deep]]</p>', entryMap, domains);
    assert.match(html, /href="#\/02-java-platform\/JVM\/02-jvm-deep"/);
  });

  it('resolves domain-level refs', () => {
    const { html } = resolveWikilinks('<p>See [[02-java-platform]]</p>', entryMap, domains);
    assert.match(html, /href="#\/\?d=02"/);
    assert.match(html, /domain-ref/);
  });

  it('throws on unresolved wikilinks in strict mode', () => {
    assert.throws(() => {
      resolveWikilinks('<p>[[nonexistent]]</p>', entryMap, domains, true);
    }, /Unresolved wikilink/);
  });

  it('skips wikilinks inside code blocks', () => {
    const html = '<pre><code>if [[ -f file ]]; then</code></pre><p>Normal [[02-jvm-deep]]</p>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.match(out, /if \[\[ -f file \]\]; then/);
    assert.match(out, /href="#\/02-java-platform/);
  });

  it('skips wikilinks inside <a> tags', () => {
    const html = '<a href="x">Click [[me]]</a><p>Real [[02-jvm-deep]]</p>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.match(out, /Click \[\[me\]\]/);
    assert.match(out, /href="#\/02-java-platform/);
  });

  it('does not generate nested html/body tags', () => {
    const html = '<h2>Test</h2><p>See [[02-jvm-deep]]</p>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.ok(!out.includes('<html'));
    assert.ok(!out.includes('<body'));
    assert.ok(!out.includes('<head'));
  });

  it('returns clean fragment for body-wrapped input', () => {
    const html = '<html><head></head><body><p>[[02-jvm-deep]]</p></body></html>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.ok(!out.includes('<html'));
    assert.ok(!out.includes('<body'));
    assert.match(out, /href="#\/02-java-platform/);
  });

  it('protects Bash [[ ]] conditions', () => {
    const html = '<pre><code class="language-bash">if [[ -z "$VAR" ]]; then echo yes; fi</code></pre>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.match(out, /\[\[ -z "\$VAR" \]\]/);
    assert.ok(!out.includes('broken-ref'));
  });

  it('handles mixed wikilinks and code', () => {
    const html = '<p>Intro</p><pre><code>[[noise]]</code></pre><p>Link [[03-ioc]]</p>';
    const { html: out } = resolveWikilinks(html, entryMap, domains);
    assert.match(out, /\[\[noise\]\]/); // Protected
    assert.match(out, /href="#\/03-spring/); // Resolved
  });
});

describe('escapeHtml', () => {
  it('escapes special characters', () => {
    assert.equal(escapeHtml('<script>alert("x")</script>'),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
  it('handles empty string', () => {
    assert.equal(escapeHtml(''), '');
  });
  it('preserves normal text', () => {
    assert.equal(escapeHtml('Hello World'), 'Hello World');
  });
});
