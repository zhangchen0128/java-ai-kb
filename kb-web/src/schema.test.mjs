import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FrontmatterSchema } from './schema.mjs';

function validMeta(overrides = {}) {
  return {
    domain: '13-AI协议',
    title: 'A2A 1.0 协议与 Java SDK',
    status: 'verified',
    level: 'intermediate',
    content_type: 'practice',
    verification: {
      reviewed_at: '2026-07-27',
      version_anchor: 'A2A 1.0',
      code_status: 'tested',
      lab: 'lab-a2a-agent',
      evidence: {
        scope: 'article-core',
        source_files: [
          'labs/lab-a2a-agent/src/main/java/com/javaai/kb/labs/a2a/InProcessA2aAgent.java',
        ],
        test_files: [
          'labs/lab-a2a-agent/src/test/java/com/javaai/kb/labs/a2a/A2aProtocolLabTest.java',
        ],
        blocks: [{
          id: 'a2a-send-message',
          sources: [{
            file: 'labs/lab-a2a-agent/src/main/java/com/javaai/kb/labs/a2a/InProcessA2aAgent.java',
            symbols: ['InProcessA2aAgent#sendMessage'],
          }],
          tests: [{
            file: 'labs/lab-a2a-agent/src/test/java/com/javaai/kb/labs/a2a/A2aProtocolLabTest.java',
            symbols: ['A2aProtocolLabTest#sendsMessage'],
          }],
        }],
      },
    },
    sources: [{
      level: 'L0',
      url: 'https://a2a-protocol.org/latest/specification/',
      description: 'A2A official specification',
    }],
    relations: { related: ['13-MCP协议与JavaSDK'] },
    tags: ['a2a'],
    created: '2026-07-27',
    updated: '2026-07-27',
    ...overrides,
  };
}

describe('frontmatter quality contract', () => {
  it('accepts and preserves legal verification metadata', () => {
    const parsed = FrontmatterSchema.parse(validMeta());
    assert.deepEqual(parsed.verification, validMeta().verification);
    assert.equal(parsed.content_type, 'practice');
  });

  it('rejects verified metadata without reviewed_at', () => {
    const meta = validMeta();
    delete meta.verification.reviewed_at;
    assert.equal(FrontmatterSchema.safeParse(meta).success, false);
  });

  it('rejects verified metadata without version_anchor', () => {
    const meta = validMeta();
    delete meta.verification.version_anchor;
    assert.equal(FrontmatterSchema.safeParse(meta).success, false);
  });

  it('requires a lab when code_status is tested', () => {
    const meta = validMeta();
    delete meta.verification.lab;
    const result = FrontmatterSchema.safeParse(meta);
    assert.equal(result.success, false);
    assert.match(result.error.issues.map(issue => issue.message).join(' '), /requires a lab/);
  });

  it('requires concrete source and test evidence when code is tested', () => {
    const meta = validMeta();
    delete meta.verification.evidence;
    const result = FrontmatterSchema.safeParse(meta);
    assert.equal(result.success, false);
    assert.match(result.error.issues.map(issue => issue.message).join(' '), /concrete source and test evidence/);
  });

  it('rejects duplicate code block evidence ids', () => {
    const meta = validMeta();
    meta.verification.evidence.blocks.push({
      ...meta.verification.evidence.blocks[0],
    });
    const result = FrontmatterSchema.safeParse(meta);
    assert.equal(result.success, false);
    assert.match(
      result.error.issues.map(issue => issue.message).join(' '),
      /duplicate code block evidence id/,
    );
  });

  it('requires block artifacts to be included in aggregate evidence', () => {
    const meta = validMeta();
    meta.verification.evidence.blocks[0].sources[0].file =
      'labs/lab-a2a-agent/src/main/java/com/javaai/kb/labs/a2a/Other.java';
    const result = FrontmatterSchema.safeParse(meta);
    assert.equal(result.success, false);
    assert.match(
      result.error.issues.map(issue => issue.message).join(' '),
      /block source must be listed/,
    );
  });

  it('allows illustrative code only for drafts', () => {
    const draft = validMeta({
      status: 'draft',
      verification: {
        reviewed_at: '2026-07-27',
        version_anchor: 'A2A 1.0',
        code_status: 'illustrative',
      },
    });
    assert.equal(FrontmatterSchema.safeParse(draft).success, true);
    assert.equal(FrontmatterSchema.safeParse({ ...draft, status: 'verified' }).success, false);
  });

  it('accepts an explicit illustrative performance declaration', () => {
    const meta = validMeta();
    meta.verification.performance = { status: 'illustrative' };
    const parsed = FrontmatterSchema.parse(meta);
    assert.deepEqual(parsed.verification.performance, { status: 'illustrative' });
  });

  it('requires the full reproducible performance record', () => {
    const meta = validMeta();
    meta.verification.performance = {
      status: 'reproducible',
      hardware: 'Apple M4 Pro',
      software: 'JDK 25, Spring AI 2.0.0',
      data_size: '10,000 documents',
      parameters: 'topK=10, runs=20',
      script: 'benchmarks/rag/run.sh',
      runs: 20,
      percentiles: ['P50', 'P95', 'P99'],
      measured_at: '2026-07-27',
      raw_results: 'benchmarks/rag/results.json',
    };
    assert.equal(FrontmatterSchema.safeParse(meta).success, true);

    delete meta.verification.performance.raw_results;
    assert.equal(FrontmatterSchema.safeParse(meta).success, false);
  });
});
