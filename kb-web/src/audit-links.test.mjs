import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, classifyResult } from './audit-links.mjs';

describe('link result classification', () => {
  it('fails confirmed 404 and 410 responses', () => {
    assert.equal(classifyResult({ status: 404 }), 'broken');
    assert.equal(classifyResult({ status: 410 }), 'broken');
  });

  it('treats restricted and transient responses as warnings', () => {
    for (const status of [0, 401, 403, 429, 500, 504]) {
      assert.equal(classifyResult({ status }), 'warning');
    }
  });

  it('accepts success and redirects', () => {
    assert.equal(classifyResult({ status: 200 }), 'passed');
    assert.equal(classifyResult({ status: 301 }), 'passed');
  });
});

describe('link verification request strategy', () => {
  it('rechecks a HEAD 404 with a Range GET before failing', async () => {
    const calls = [];
    const result = await checkUrl('https://example.test/missing', async (url, method) => {
      calls.push(method);
      return { status: 404 };
    }, async () => {});
    assert.deepEqual(calls, ['HEAD', 'GET']);
    assert.equal(classifyResult(result), 'broken');
  });

  it('allows a Range GET to recover a restricted HEAD response', async () => {
    const responses = [{ status: 403 }, { status: 200 }];
    const result = await checkUrl('https://example.test/head-blocked', async () => responses.shift(), async () => {});
    assert.equal(classifyResult(result), 'passed');
  });

  it('retries transient failures only once', async () => {
    const calls = [];
    const result = await checkUrl('https://example.test/busy', async (url, method) => {
      calls.push(method);
      return { status: 429 };
    }, async () => {});
    assert.deepEqual(calls, ['HEAD', 'GET']);
    assert.equal(classifyResult(result), 'warning');
  });
});
