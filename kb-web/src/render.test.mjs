import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, processCallouts, enhanceCodeBlocks, buildEntryHTML } from './render.mjs';

describe('renderMarkdown', () => {
  it('renders basic markdown', async () => {
    const html = await renderMarkdown('# Hello\n\nWorld');
    assert.match(html, /<h1/);
    assert.match(html, /Hello/);
  });

  it('renders code blocks with highlight.js classes', async () => {
    const html = await renderMarkdown('```java\npublic class Test {}\n```');
    assert.match(html, /hljs/);
    assert.match(html, /language-java/);
  });

  it('renders tables', async () => {
    const html = await renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    assert.match(html, /<table/);
    assert.match(html, /<th/);
  });

  it('renders Bash code without breaking [[ ]]', async () => {
    const html = await renderMarkdown('```bash\nif [[ -f file ]]; then\n  echo yes\nfi\n```');
    assert.match(html, /\[\[ -f file \]\]/);
  });
});

describe('processCallouts', () => {
  it('converts Info callout', () => {
    const html = '<blockquote>\n<p><strong>Info:</strong> This is info</p>\n</blockquote>';
    const out = processCallouts(html);
    assert.match(out, /callout-info/);
  });

  it('converts Warning callout', () => {
    const html = '<blockquote>\n<p><strong>Warning:</strong> Danger</p>\n</blockquote>';
    const out = processCallouts(html);
    assert.match(out, /callout-warn/);
  });

  it('converts 注意 callout', () => {
    const html = '<blockquote>\n<p><strong>注意：</strong> 重要事项</p>\n</blockquote>';
    const out = processCallouts(html);
    assert.match(out, /callout-info/);
  });
});

describe('enhanceCodeBlocks', () => {
  it('adds copy button and code header', () => {
    const html = '<pre><code class="hljs language-java">System.out.println();</code></pre>';
    const out = enhanceCodeBlocks(html);
    assert.match(out, /code-block/);
    assert.match(out, /code-header/);
    assert.match(out, /copy-btn/);
    assert.match(out, /code-lang">java/);
  });

  it('handles code without language', () => {
    const html = '<pre><code>plain text</code></pre>';
    const out = enhanceCodeBlocks(html);
    assert.match(out, /code-block/);
    assert.match(out, /copy-btn/);
  });
});

describe('buildEntryHTML', () => {
  const meta = {
    status: 'verified',
    level: 'advanced',
    tags: ['java', 'jvm'],
    sources: [{ url: 'https://example.com', description: 'Example' }],
  };
  it('generates valid article HTML', () => {
    const html = buildEntryHTML('Test Article', meta, '<p>Content</p>', '02-Java平台', '02');
    assert.match(html, /article class="kb-entry"/);
    assert.match(html, /Test Article/);
    assert.match(html, /badge-verified/);
    assert.match(html, /badge-level/);
    assert.match(html, /badge-tag">#java/);
  });

  it('escapes HTML in title', () => {
    const html = buildEntryHTML('<script>alert(1)</script>', meta, '<p>x</p>', '01-Test', '01');
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});
