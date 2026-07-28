import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = path => readFileSync(join(root, path), 'utf-8');

describe('version fact regression', () => {
  it('locks the six-week version baseline', () => {
    const lock = read('versions.lock.yaml');
    assert.match(lock, /jdk: "25"[\s\S]*status: "GA"/);
    assert.match(lock, /boot: "4\.0\.7"/);
    assert.match(lock, /ai: "2\.0\.0"/);
    assert.match(lock, /mcp: "2025-11-25"/);
    assert.match(lock, /a2a: "1\.0"/);
    assert.match(lock, /owasp_genai_top_10: "2025"/);
  });

  it('records the correct JDK 25 feature status', () => {
    const article = read('knowledge/02-Java平台/语言特性/02-现代Java25深度解析.md');
    assert.match(article, /JEP 508: Vector API \(Tenth Incubator\)/);
    assert.match(article, /JEP 513（Flexible Constructor Bodies）/);
    assert.doesNotMatch(article, /JEP 513（Flexible Constructor Bodies，Preview）/);
    assert.match(article, /String Templates[\s\S]{0,120}JDK 25 中不可用/);
  });

  it('keeps A2A HTTP+JSON and JSON-RPC method names separate', () => {
    const article = read('knowledge/13-AI协议/13-A2A协议与Agent互操作.md');
    assert.ok(article.includes('/message:send'));
    assert.match(article, /"method": "SendMessage"/);
    assert.doesNotMatch(article, /"method": "message:send"/);
    assert.match(article, /org\.a2aproject\.sdk/);
    assert.doesNotMatch(article, /spring-ai-a2a-spring-boot-starter/);
  });

  it('contains the exact OWASP GenAI Top 10 2025 list', () => {
    const article = read('knowledge/15-AI安全与治理/15-AI安全全面防护体系.md');
    const canonical = [
      'LLM01 | Prompt Injection',
      'LLM02 | Sensitive Information Disclosure',
      'LLM03 | Supply Chain',
      'LLM04 | Data and Model Poisoning',
      'LLM05 | Improper Output Handling',
      'LLM06 | Excessive Agency',
      'LLM07 | System Prompt Leakage',
      'LLM08 | Vector and Embedding Weaknesses',
      'LLM09 | Misinformation',
      'LLM10 | Unbounded Consumption',
    ];
    for (const item of canonical) assert.ok(article.includes(item), `missing ${item}`);
  });

  it('uses Spring AI 2 starter coordinates instead of removed names', () => {
    const springAi = read('knowledge/09-Java AI框架/09-SpringAI2深度解析.md');
    const rag = read('knowledge/11-检索与RAG/RAG实现/11-完整RAG流水线实现.md');
    const combined = `${springAi}\n${rag}`;
    assert.match(combined, /spring-ai-starter-model-openai/);
    assert.match(combined, /spring-ai-starter-vector-store-pgvector/);
    assert.doesNotMatch(combined, /spring-ai-openai-spring-boot-starter/);
    assert.doesNotMatch(combined, /spring-ai-pgvector-store-spring-boot-starter/);
    assert.doesNotMatch(combined, /spring-ai-micrometer-spring-boot-starter/);
  });

  it('keeps the Pages deployment output and clean-build contract', () => {
    const workflow = read('.github/workflows/deploy.yml');
    assert.match(workflow, /rm -rf public/);
    assert.match(workflow, /id: deployment/);
    assert.ok(workflow.includes('url: ${{ steps.deployment.outputs.page_url }}'));
    assert.match(workflow, /mvn -B -f labs\/pom\.xml test/);
    assert.match(workflow, /npm run smoke/);
  });

  it('fails the MCP module compilation when deprecated SDK APIs return', () => {
    const pom = read('labs/lab-mcp-server/pom.xml');
    const sources = [
      'labs/lab-mcp-server/src/main/java/com/javaai/kb/labs/mcp/InMemoryMcpLab.java',
      'labs/lab-mcp-server/src/main/java/com/javaai/kb/labs/mcp/McpStdioServerMain.java',
      'labs/lab-mcp-server/src/test/java/com/javaai/kb/labs/mcp/McpStdioIntegrationTest.java',
    ].map(read).join('\n');

    assert.match(pom, /<showDeprecation>true<\/showDeprecation>/);
    assert.match(pom, /<failOnWarning>true<\/failOnWarning>/);
    assert.doesNotMatch(sources, /new McpSchema\.Tool\(/);
    assert.doesNotMatch(sources, /new McpSchema\.Implementation\(/);
    assert.doesNotMatch(sources, /new McpSchema\.TextContent\(/);
  });

  it('keeps the mobile drawer visible without stale asset mixtures', () => {
    const css = read('kb-web/app.css');
    const app = read('kb-web/app.js');
    const index = read('kb-web/index.html');
    const worker = read('kb-web/sw.js');

    assert.doesNotMatch(
      css,
      /\.sidebar-visible #content\s*\{\s*margin-left:\s*var\(--sidebar-w\)/,
    );
    assert.match(css, /#sidebar\{width:min\(82vw,320px\)/);
    assert.match(css, /\.sidebar-visible #content\{margin-left:0\}/);
    assert.match(app, /await renderNav\(\);[\s\S]*await navigate\(getRoute\(\)\)/);
    assert.match(index, /app\.css\?v=5/);
    assert.match(index, /app\.js\?v=5/);
    assert.match(index, /updateViaCache:\s*'none'/);
    assert.match(worker, /const CACHE = 'kb-v5'/);
    assert.match(worker, /networkFirst\(e\.request\)/);
    assert.match(worker, /fetch\(request,\s*\{\s*cache:\s*'no-store'\s*\}\)/);
  });
});
