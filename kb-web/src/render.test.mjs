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

  it('turns a code-id annotation into a visible evidence marker', () => {
    const html = '<!-- code-id: mapped-demo -->\n<pre><code class="hljs language-java">class Demo {}</code></pre>';
    const out = enhanceCodeBlocks(html);
    assert.match(out, /id="code-mapped-demo"/);
    assert.match(out, /data-code-id="mapped-demo"/);
    assert.match(out, /已映射 · mapped-demo/);
    assert.doesNotMatch(out, /<!-- code-id:/);
  });
});

describe('buildEntryHTML', () => {
  const meta = {
    status: 'verified',
    level: 'advanced',
    content_type: 'practice',
    tags: ['java', 'jvm'],
    sources: [{ level: 'L1', url: 'https://example.com', description: 'Example' }],
    verification: {
      reviewed_at: '2026-07-27',
      version_anchor: 'JDK 25 GA',
      code_status: 'tested',
      lab: 'lab-java25-concurrency',
      evidence: {
        scope: 'article-core',
        source_files: ['labs/lab-java25-concurrency/src/main/java/Demo.java'],
        test_files: ['labs/lab-java25-concurrency/src/test/java/DemoTest.java'],
        blocks: [{
          id: 'mapped-demo',
          sources: [{
            file: 'labs/lab-java25-concurrency/src/main/java/Demo.java',
            symbols: ['Demo#run'],
          }],
          tests: [{
            file: 'labs/lab-java25-concurrency/src/test/java/DemoTest.java',
            symbols: ['DemoTest#runsDemo'],
          }],
        }],
      },
      performance: { status: 'illustrative' },
    },
  };
  it('generates valid article HTML', () => {
    const html = buildEntryHTML('Test Article', meta, '<p>Content</p>', '02-Java平台', '02');
    assert.match(html, /article class="kb-entry"/);
    assert.match(html, /Test Article/);
    assert.match(html, /badge-verified/);
    assert.match(html, /badge-level/);
    assert.match(html, /badge-content/);
    assert.match(html, /badge-tag[\s\S]*?>#java/);
    assert.match(html, /entry-verification/);
    assert.match(html, /lab-java25-concurrency/);
    assert.match(html, /核心代码证据/);
    assert.match(html, /1 个源码 \/ 1 个测试 \/ 1 个精确代码块/);
    assert.match(html, /class="block-evidence-link"/);
    assert.match(html, /代码块：mapped-demo/);
    assert.match(html, /Demo#run/);
    assert.match(html, /DemoTest#runsDemo/);
    assert.match(html, /blob\/main\/labs\/lab-java25-concurrency\/src\/main\/java\/Demo.java/);
    assert.match(html, /代码：<\/strong>tested（文章核心，1 块精确映射）/);
    assert.match(html, /性能：<\/strong>示意数据（非基准）/);
  });

  it('escapes HTML in title', () => {
    const html = buildEntryHTML('<script>alert(1)</script>', meta, '<p>x</p>', '01-Test', '01');
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('renders conspicuous draft and stale notices', () => {
    const draft = buildEntryHTML('Draft', {
      ...meta,
      status: 'draft',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'A2A 1.0',
        code_status: 'illustrative',
      },
    }, '<p>x</p>', '13-AI协议', '13');
    assert.match(draft, /status-notice-draft/);

    const stale = buildEntryHTML('Stale', { ...meta, stale: true }, '<p>x</p>', '02-Java平台', '02');
    assert.match(stale, /badge-stale/);
    assert.match(stale, /status-notice-stale/);
  });
});
