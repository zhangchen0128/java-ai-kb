#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import { extname, join, normalize } from 'path';
import { chromium } from 'playwright';

const PUBLIC = new URL('../public/', import.meta.url);
const publicPath = decodeURIComponent(PUBLIC.pathname);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

if (!existsSync(join(publicPath, 'site-meta.json'))) {
  throw new Error('public/ is missing; run npm run build before npm run smoke');
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = normalize(requested);
  if (normalized.startsWith('..')) {
    response.writeHead(403).end();
    return;
  }
  const file = join(publicPath, normalized);
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': types[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
let browser;

try {
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOptions = existsSync(systemChrome)
    ? { headless: true, executablePath: systemChrome }
    : { headless: true };
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.domain-card').first().waitFor();
  if (await page.locator('.domain-card').count() !== 19) throw new Error('expected 19 domain cards');
  if (await page.locator('.learning-steps a').count() !== 4) throw new Error('learning path is incomplete');

  const nav = JSON.parse(readFileSync(join(publicPath, 'nav-tree.json'), 'utf-8'));
  const entries = [];
  const flatten = node => {
    for (const entry of node._entries || []) entries.push(entry);
    for (const [key, value] of Object.entries(node)) if (key !== '_entries') flatten(value);
  };
  flatten(nav);

  // Every generated route must be available from a clean build.
  const responses = await Promise.all(entries.map(entry => fetch(`${base}/content${entry.url}.html`)));
  const failed = responses.filter(response => !response.ok);
  if (failed.length) throw new Error(`${failed.length} generated content routes returned non-2xx`);

  for (const domain of Object.keys(nav)) {
    const number = domain.slice(0, 2);
    await page.evaluate(hash => { location.hash = hash; }, `#/?d=${number}`);
    await page.waitForFunction(expected => document.querySelector('#article h1')?.textContent === expected, domain);
  }
  await page.evaluate(() => { location.hash = '#/'; });

  await page.locator('#verifiedOnly').check();
  await page.waitForTimeout(50);
  if (await page.locator('.nav-file[data-status="draft"]').count() !== 0) {
    throw new Error('verified-only filter still exposes drafts');
  }
  await page.locator('#verifiedOnly').uncheck();

  await page.locator('#searchInput').fill('Spring AI');
  await page.locator('.search-item').first().waitFor();
  if (await page.locator('.search-status').count() === 0) throw new Error('search results lack status labels');
  await page.locator('#clearSearch').click();

  const draft = entries.find(entry => entry.status === 'draft');
  const verified = entries.find(entry => entry.status === 'verified');
  await page.goto(`${base}/#${draft.url}`);
  await page.locator('.status-notice-draft').waitFor();
  await page.goto(`${base}/#${verified.url}`);
  await page.locator('.badge-verified').waitFor();
  await page.locator('.entry-verification').waitFor();

  const labArticle = entries.find(entry => entry.status === 'verified' && entry.url.includes('SpringAI2'));
  await page.goto(`${base}/#${labArticle.url}`);
  await page.locator('.entry-verification a[href*="/tree/main/labs/"]').waitFor();
  await page.locator('.verification-evidence').waitFor();
  await page.locator('.verification-evidence summary').click();
  if (await page.locator('.verification-evidence a[href*="/blob/main/labs/"]').count() < 2) {
    throw new Error('verified article lacks concrete source and test evidence links');
  }

  const mappedArticle = entries.find(
    entry => entry.status === 'verified' && entry.url.includes('熔断限流'),
  );
  await page.goto(`${base}/#${mappedArticle.url}`);
  await page.locator('.verification-evidence summary').click();
  const mappedButton = page.locator(
    '.block-evidence-link[data-code-id="code-sliding-window-rate-limiter"]',
  );
  await mappedButton.waitFor();
  await page.locator(
    '#code-sliding-window-rate-limiter[data-code-id="sliding-window-rate-limiter"]',
  ).waitFor();
  await mappedButton.click();

  await page.locator('.copy-btn').first().waitFor();
  await page.locator('.entry-badges .badge-tag').first().click();
  await page.waitForTimeout(200);
  const tagSearch = await page.evaluate(() => ({
    query: document.querySelector('#searchInput')?.value,
    open: document.querySelector('#searchResults')?.classList.contains('open'),
    results: document.querySelectorAll('.search-item').length,
  }));
  if (!tagSearch.query || !tagSearch.open || tagSearch.results === 0) {
    throw new Error(`tag search failed: ${JSON.stringify(tagSearch)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  if (bodyWidth > 410) throw new Error(`mobile layout overflows: ${bodyWidth}px`);
  const mobileArticle = await page.evaluate(() => {
    const toc = document.querySelector('#toc');
    const article = document.querySelector('#article');
    const tocRect = toc.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    return {
      tocDisplay: getComputedStyle(toc).display,
      tocWidth: tocRect.width,
      articleLeft: articleRect.left,
      articleRight: articleRect.right,
      viewportWidth: innerWidth,
    };
  });
  if (mobileArticle.tocDisplay !== 'none' || mobileArticle.tocWidth !== 0) {
    throw new Error(`article TOC overlays mobile content: ${JSON.stringify(mobileArticle)}`);
  }
  if (mobileArticle.articleLeft < 0 || mobileArticle.articleRight > mobileArticle.viewportWidth) {
    throw new Error(`mobile article is outside the viewport: ${JSON.stringify(mobileArticle)}`);
  }

  await page.locator('#menuBtn').click();
  await page.locator('#sidebar.open').waitFor();
  await page.waitForFunction(
    () => Math.abs(document.querySelector('#sidebar').getBoundingClientRect().left) < 1,
  );
  if (await page.locator('#sidebar .nav-domain').count() !== 19) {
    throw new Error('mobile drawer is open but navigation content is missing');
  }
  const mobileDrawer = await page.evaluate(() => {
    const sidebarRect = document.querySelector('#sidebar').getBoundingClientRect();
    const contentRect = document.querySelector('#content').getBoundingClientRect();
    return {
      sidebarLeft: sidebarRect.left,
      sidebarWidth: sidebarRect.width,
      contentLeft: contentRect.left,
      overlayDisplay: getComputedStyle(document.querySelector('#overlay')).display,
      navText: document.querySelector('#navTree').textContent.trim().length,
      viewportWidth: innerWidth,
    };
  });
  if (Math.abs(mobileDrawer.sidebarLeft) > 1) {
    throw new Error(`mobile drawer is off-screen: ${JSON.stringify(mobileDrawer)}`);
  }
  if (mobileDrawer.sidebarWidth > mobileDrawer.viewportWidth - 55) {
    throw new Error(`mobile drawer is too wide: ${JSON.stringify(mobileDrawer)}`);
  }
  if (Math.abs(mobileDrawer.contentLeft) > 1) {
    throw new Error(`mobile drawer shifts main content: ${JSON.stringify(mobileDrawer)}`);
  }
  if (mobileDrawer.overlayDisplay === 'none' || mobileDrawer.navText === 0) {
    throw new Error(`mobile drawer state is incomplete: ${JSON.stringify(mobileDrawer)}`);
  }
  await page.locator('#overlay').click({ position: { x: 380, y: 100 } });
  if (await page.locator('#menuBtn').getAttribute('aria-expanded') !== 'false') {
    throw new Error('mobile drawer did not close through its overlay');
  }

  console.log(`✅ 页面冒烟测试通过：19 个领域、${entries.length} 个内容路由、搜索、筛选、徽章、Lab/块级代码证据链接和移动端布局`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
