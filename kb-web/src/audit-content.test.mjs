import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditContent,
  containsPerformanceNumbers,
  extractJavaCodeBlocks,
  findJavaPlaceholders,
  getReviewDeadline,
  inspectRelations,
  isReviewStale,
  isGenericVersionAnchor,
  validateVerifiedCode,
} from './audit-content.mjs';

describe('review windows', () => {
  it('uses 90/180/365 day windows by domain volatility', () => {
    assert.equal(getReviewDeadline('13-AI协议'), 90);
    assert.equal(getReviewDeadline('18-保险行业'), 180);
    assert.equal(getReviewDeadline('01-计算机基础'), 365);
  });

  it('marks each bucket stale only after its own deadline', () => {
    const now = new Date('2026-07-27T12:00:00Z');
    assert.equal(isReviewStale('13-AI协议', '2026-04-28', now), false);
    assert.equal(isReviewStale('13-AI协议', '2026-04-27', now), true);
    assert.equal(isReviewStale('18-保险行业', '2026-01-28', now), false);
    assert.equal(isReviewStale('18-保险行业', '2026-01-27', now), true);
    assert.equal(isReviewStale('01-计算机基础', '2025-07-27', now), false);
    assert.equal(isReviewStale('01-计算机基础', '2025-07-26', now), true);
  });
});

describe('version anchors', () => {
  it('rejects generic batch-filled anchors', () => {
    assert.equal(isGenericVersionAnchor('JDK 25 / Spring Boot 4.x / Spring AI 2.x'), true);
    assert.equal(isGenericVersionAnchor('MCP specification 2025-11-25'), false);
  });
});

describe('relation quality gate', () => {
  it('detects duplicate and missing relation targets', () => {
    const result = inspectRelations({
      prerequisite: ['known', 'known'],
      related: ['missing'],
    }, target => target === 'known');
    assert.deepEqual(result.duplicates, [{ type: 'prerequisite', targets: ['known'] }]);
    assert.deepEqual(result.broken, [{ type: 'related', target: 'missing' }]);
    assert.deepEqual(result.validTargets, ['known']);
  });

  it('reports an empty relation set', () => {
    assert.equal(inspectRelations({}, () => true).targetCount, 0);
  });

  it('detects the same target assigned to different relation types', () => {
    const result = inspectRelations({
      prerequisite: ['same'],
      related: ['same'],
    });
    assert.deepEqual(result.duplicates, [{ type: 'cross-type', targets: ['same'] }]);
  });
});

describe('verified Java linkage', () => {
  it('fails a verified Java entry without a tested lab', () => {
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Spring AI 2.0.0',
        code_status: 'not-applicable',
      },
    }, '```java\nclass Demo {}\n```');
    assert.ok(issues.some(issue => issue.includes('必须标记 tested')));
    assert.ok(issues.some(issue => issue.includes('必须关联 lab')));
  });

  it('accepts a tested lab with production and test sources', () => {
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Spring AI 2.0.0',
        code_status: 'tested',
        lab: 'lab-demo',
        evidence: {
          scope: 'article-core',
          source_files: ['labs/lab-demo/src/main/java/Demo.java'],
          test_files: ['labs/lab-demo/src/test/java/DemoTest.java'],
        },
      },
    }, '```java\nclass Demo {}\n```',
    () => ({ exists: true, main: 1, tests: 1 }),
    () => true);
    assert.deepEqual(issues, []);
  });

  it('rejects evidence outside the declared lab', () => {
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Spring AI 2.0.0',
        code_status: 'tested',
        lab: 'lab-demo',
        evidence: {
          scope: 'article-core',
          source_files: ['labs/other/src/main/java/Demo.java'],
          test_files: ['labs/other/src/test/java/DemoTest.java'],
        },
      },
    }, '```java\nclass Demo {}\n```',
    () => ({ exists: true, main: 1, tests: 1 }),
    () => true);
    assert.ok(issues.every(issue => issue.includes('不属于关联 lab')));
  });

  it('validates a code block id against real source and test symbols', () => {
    const source = 'labs/lab-demo/src/main/java/Demo.java';
    const test = 'labs/lab-demo/src/test/java/DemoTest.java';
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Demo API 1.0',
        code_status: 'tested',
        lab: 'lab-demo',
        evidence: {
          scope: 'article-core',
          source_files: [source],
          test_files: [test],
          blocks: [{
            id: 'demo-call',
            sources: [{ file: source, symbols: ['Demo#call'] }],
            tests: [{ file: test, symbols: ['DemoTest#callsDemo'] }],
          }],
        },
      },
    }, '<!-- code-id: demo-call -->\n```java\nnew Demo().call();\n```',
    () => ({ exists: true, main: 1, tests: 1 }),
    () => true,
    path => path === source
      ? 'class Demo { void call() {} }'
      : 'class DemoTest { void callsDemo() {} }');
    assert.deepEqual(issues, []);
  });

  it('rejects missing block ids and missing Java symbols', () => {
    const source = 'labs/lab-demo/src/main/java/Demo.java';
    const test = 'labs/lab-demo/src/test/java/DemoTest.java';
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Demo API 1.0',
        code_status: 'tested',
        lab: 'lab-demo',
        evidence: {
          scope: 'article-core',
          source_files: [source],
          test_files: [test],
          blocks: [{
            id: 'missing-block',
            sources: [{ file: source, symbols: ['Demo#missingMethod'] }],
            tests: [{ file: test, symbols: ['DemoTest#missingTest'] }],
          }],
        },
      },
    }, '```java\nnew Demo().call();\n```',
    () => ({ exists: true, main: 1, tests: 1 }),
    () => true,
    () => 'class Demo { void call() {} }');
    assert.ok(issues.some(issue => issue.includes('正文中不存在')));
    assert.ok(issues.some(issue => issue.includes('源码符号不存在')));
    assert.ok(issues.some(issue => issue.includes('测试符号不存在')));
  });

  it('rejects duplicate annotations and annotations without evidence', () => {
    const raw = `
<!-- code-id: duplicate-demo -->
\`\`\`java
class First {}
\`\`\`
<!-- code-id: duplicate-demo -->
\`\`\`java
class Second {}
\`\`\`
<!-- code-id: unmapped-demo -->
\`\`\`java
class Third {}
\`\`\`
`;
    const issues = validateVerifiedCode({
      status: 'verified',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'Demo API 1.0',
        code_status: 'tested',
        lab: 'lab-demo',
        evidence: {
          scope: 'article-core',
          source_files: ['labs/lab-demo/src/main/java/Demo.java'],
          test_files: ['labs/lab-demo/src/test/java/DemoTest.java'],
        },
      },
    }, raw,
    () => ({ exists: true, main: 1, tests: 1 }),
    () => true);
    assert.ok(issues.some(issue => issue.includes('ID 重复')));
    assert.ok(issues.some(issue => issue.includes('缺少证据映射')));
  });
});

describe('Java code block extraction', () => {
  it('attaches only an immediately preceding valid code id', () => {
    const blocks = extractJavaCodeBlocks(`
<!-- code-id: mapped-demo -->
\`\`\`java
class Mapped {}
\`\`\`

\`\`\`java
class Unmapped {}
\`\`\`
`);
    assert.deepEqual(blocks.map(block => block.id), ['mapped-demo', null]);
    assert.deepEqual(blocks.map(block => block.index), [1, 2]);
  });
});

describe('performance evidence gate', () => {
  it('detects exact performance claims but ignores ordinary versions', () => {
    assert.equal(containsPerformanceNumbers('P95 120ms, throughput 2GB/s'), true);
    assert.equal(containsPerformanceNumbers('检索失败率降低49%'), true);
    assert.equal(containsPerformanceNumbers('实际吞吐提升 2-3x'), true);
    assert.equal(containsPerformanceNumbers('Spring AI 2.0.0 and JDK 25'), false);
    assert.equal(containsPerformanceNumbers('HTTP 5xx should trigger a retry'), false);
  });
});

describe('verified Java placeholder gate', () => {
  it('finds explicit omissions inside Java fences', () => {
    const findings = findJavaPlaceholders(`
\`\`\`java
class Demo {
    // ...
    void run() { throw new UnsupportedOperationException("待实现"); }
}
\`\`\`
`);
    assert.equal(findings.length, 2);
    assert.deepEqual(findings.map(item => item.block), [1, 1]);
  });

  it('does not treat valid null handling or prose as a placeholder', () => {
    assert.deepEqual(findJavaPlaceholders(`
The prose can use ... as punctuation.
\`\`\`java
if (value == null) return null;
\`\`\`
`), []);
  });
});

describe('repository content gate', () => {
  it('has no failed verified entries, relation errors, or domain gaps', () => {
    const report = auditContent({ now: new Date('2026-07-27T12:00:00Z'), writeReports: false });
    assert.equal(report.totals.verifiedFail, 0);
    assert.ok(report.totals.verified >= 30);
    assert.equal(Object.keys(report.coverage).length, 19);
    assert.deepEqual(report.brokenRelations, []);
    assert.deepEqual(report.duplicateRelations, []);
    assert.deepEqual(report.noRelations, []);
    assert.deepEqual(report.orphanVerified, []);
    assert.deepEqual(report.coverageErrors, []);
    assert.equal(report.totals.javaPlaceholderFindings, 0);
  });
});
