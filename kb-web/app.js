// ===== State =====
let navTree = null;
let searchIdx = null;
let siteMeta = null;
const CONTENT_SCOPE_KEY = 'kb-content-scope-v3';
let verifiedOnly = localStorage.getItem(CONTENT_SCOPE_KEY) === 'verified';

// ===== DOM refs =====
const $ = s => document.querySelector(s);
const sidebar = $('#sidebar');
const overlay = $('#overlay');
const navTreeEl = $('#navTree');
const articleEl = $('#article');
const searchInput = $('#searchInput');
const searchResults = $('#searchResults');
const searchResultsInner = $('#searchResultsInner');
const clearSearch = $('#clearSearch');
const progressBar = $('#progressBar');
const backToTop = $('#backToTop');
const prevNext = $('#prevNext');
const domainGrid = $('#domainGrid');
const tocEl = $('#toc');
const tocNav = $('#tocNav');
const verifiedOnlyInput = $('#verifiedOnly');
verifiedOnlyInput.checked = verifiedOnly;
verifiedOnlyInput.addEventListener('change', async () => {
  verifiedOnly = verifiedOnlyInput.checked;
  localStorage.setItem(CONTENT_SCOPE_KEY, verifiedOnly ? 'verified' : 'all');
  await renderNav();
  if (getRoute() === '/') await renderHome();
  else if (getRoute().startsWith('/?d=')) await navigate(getRoute());
  if (searchInput.value.trim()) await doSearch(searchInput.value.trim());
});

// ===== Theme =====
const themeBtn = $('#themeBtn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  themeBtn.textContent = dark ? '☀️' : '🌙';
  localStorage.setItem('kb-theme', dark ? 'dark' : 'light');
}
themeBtn.onclick = () => applyTheme(!document.documentElement.classList.contains('dark'));
const savedTheme = localStorage.getItem('kb-theme');
if (savedTheme === 'dark') applyTheme(true);
else if (!savedTheme && window.matchMedia('(prefers-color-scheme:dark)').matches) applyTheme(true);

// ===== Sidebar =====
$('#menuBtn').onclick = () => setSidebarOpen(!sidebar.classList.contains('open'));
overlay.onclick = closeSidebar;
function setSidebarOpen(open) {
  sidebar.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-visible', open);
  $('#menuBtn').setAttribute('aria-expanded', String(open));
}
function closeSidebar() {
  setSidebarOpen(false);
}
window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) closeSidebar();
}, { passive: true });

// ===== Scroll =====
window.addEventListener('scroll', () => {
  const h = document.documentElement;
  progressBar.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + '%';
  backToTop.classList.toggle('visible', h.scrollTop > 400);
}, { passive: true });
backToTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// ===== Load Data =====
async function loadNav() {
  if (navTree) return navTree;
  const r = await fetch('nav-tree.json');
  if (!r.ok) throw new Error('Failed to load navigation');
  navTree = await r.json();
  return navTree;
}
async function loadSearch() {
  if (searchIdx) return searchIdx;
  const r = await fetch('search-index.json');
  searchIdx = await r.json();
  return searchIdx;
}
async function loadSiteMeta() {
  if (siteMeta) return siteMeta;
  try {
    const r = await fetch('site-meta.json');
    siteMeta = await r.json();
    return siteMeta;
  } catch { return null; }
}

// ===== Hash routing =====
function getRoute() {
  const hashRoute = location.hash.startsWith('#/') ? location.hash.slice(1) : '/';
  try { return decodeURIComponent(hashRoute); } catch { return hashRoute; }
}

// ===== Escape HTML =====
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== renderHome =====
async function renderHome() {
  const meta = await loadSiteMeta();
  const entries = meta?.entries || 80;
  const domains = meta?.domains || 19;
  const lines = meta?.lines || 85000;
  const verified = meta?.verified || 0;
  const draft = meta?.status?.draft || 0;
  const stale = meta?.stale || 0;

  articleEl.innerHTML = `
    <div class="welcome">
      <h1>📚 Java AI 工程师知识库</h1>
      <p class="subtitle">覆盖 Java 企业开发到 AI 应用工程的公开可验证知识体系</p>
      <div class="stats">
        <div class="stat"><strong>18+1</strong><span>主题域+知识工程元域</span></div>
        <div class="stat"><strong>${entries}</strong><span>篇笔记</span></div>
        <div class="stat"><strong>${verified}</strong><span>已验证</span></div>
        <div class="stat"><strong>${stale}</strong><span>待复核</span></div>
      </div>
      <section class="content-scope-note" aria-label="内容质量范围">
        <div>
          <strong>默认展示全部 ${entries} 篇内容</strong>
          <span>${verified} 篇已验证，${draft} 篇草稿；草稿会明确标识，顶部可按需只看已验证内容。</span>
        </div>
        <a class="draft-workspace-link" href="#/?status=draft">查看草稿清单 · ${draft}篇</a>
      </section>
      <section class="learning-path" aria-labelledby="learningPathTitle">
        <h2 id="learningPathTitle">推荐学习路径</h2>
        <div class="learning-steps">
          <a href="#/?d=02"><strong>1. 基础 Java</strong><span>Java 25、JVM 与工程基础</span></a>
          <a href="#/?d=09"><strong>2. AI 应用</strong><span>Spring AI 与统一模型接入</span></a>
          <a href="#/?d=11"><strong>3. Agent / RAG</strong><span>检索、工具与协议协作</span></a>
          <a href="#/?d=14"><strong>4. 生产治理</strong><span>平台、安全、观测与行业落地</span></a>
        </div>
      </section>
      <div class="quick-nav"><h3>快速导航</h3><div class="domain-grid" id="domainGrid"></div></div>
    </div>`;
  renderDomainGrid();
  prevNext.innerHTML = '';
  clearTOC();
}

async function renderDraftWorkspace() {
  const tree = await loadNav();
  const meta = await loadSiteMeta();
  const isDraft = entry => entry.status === 'draft';
  const draftCount = meta?.status?.draft || countEntriesMatching(tree, isDraft);
  const groups = Object.keys(tree).sort().map(domain => {
    const count = countEntriesMatching(tree[domain], isDraft);
    if (!count) return '';
    return `<section class="draft-domain">
      <h2>${esc(domain)} <span>${count}篇</span></h2>
      <ul class="domain-listing">${renderDomainEntries(tree[domain], isDraft)}</ul>
    </section>`;
  }).join('');

  articleEl.innerHTML = `
    <div class="draft-workspace">
      <div class="draft-workspace-header">
        <span class="draft-workspace-kicker">独立内容区</span>
        <h1>草稿工作区</h1>
        <p>这里集中展示 ${draftCount} 篇尚未完成来源、版本和代码联合复核的条目。草稿可用于学习和协作审阅，但不作为生产依据。</p>
        <a class="verified-home-link" href="#/">← 返回已验证内容</a>
      </div>
      <div class="draft-domain-list">${groups}</div>
    </div>`;
  prevNext.innerHTML = '';
  highlightNav(null);
  clearTOC();
}

// ===== Render Nav =====
async function renderNav() {
  const tree = await loadNav();
  let html = '';
  for (const domain of Object.keys(tree).sort()) {
    const d = tree[domain];
    const num = domain.match(/^(\d{2})/)?.[1] || '99';
    const name = domain.replace(/^\d{2}-/, '');
    html += `<div class="nav-domain">
      <div class="nav-domain-title" data-domain="${esc(domain)}" role="button" aria-label="${esc(domain)}" aria-expanded="false" tabindex="0">
        <span class="arrow" aria-hidden="true"></span>
        <span class="nav-domain-label"><span class="nav-domain-number">${esc(num)}</span><span class="nav-domain-name">${esc(name)}</span></span>
        <span class="nav-domain-count">${countEntries(d)}篇</span>
      </div><div class="nav-sub">${renderNavNode(d)}</div></div>`;
  }
  navTreeEl.innerHTML = html;

  navTreeEl.querySelectorAll('.nav-domain-title').forEach(el => {
    const toggle = () => {
      const sub = el.nextElementSibling;
      const arrow = el.querySelector('.arrow');
      const open = !sub.classList.contains('open');
      sub.classList.toggle('open');
      arrow.classList.toggle('open');
      el.setAttribute('aria-expanded', open);
      localStorage.setItem('kb-nav-' + el.dataset.domain, open ? '1' : '0');
    };
    el.onclick = toggle;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    if (localStorage.getItem('kb-nav-' + el.dataset.domain) === '1') {
      el.nextElementSibling.classList.add('open');
      el.querySelector('.arrow').classList.add('open');
      el.setAttribute('aria-expanded', 'true');
    }
  });

  navTreeEl.querySelectorAll('.nav-subdir-title').forEach(el => {
    const toggleSub = () => {
      const sub = el.nextElementSibling;
      const open = sub.hidden;
      sub.hidden = !open;
      el.classList.toggle('open', open);
      el.setAttribute('aria-expanded', open);
    };
    el.onclick = e => { e.stopPropagation(); toggleSub(); };
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSub(); } };
  });
}

function countEntriesMatching(node, predicate) {
  let count = node._entries?.filter(predicate).length || 0;
  for (const key of Object.keys(node)) {
    if (key !== '_entries') count += countEntriesMatching(node[key], predicate);
  }
  return count;
}
function countEntries(node) {
  return countEntriesMatching(node, isVisibleEntry);
}
function isVisibleEntry(entry) {
  return !verifiedOnly || entry.status === 'verified';
}
function renderNavNode(node, depth = 0) {
  let html = '';
  for (const sub of Object.keys(node).filter(k => k !== '_entries').sort()) {
    const subCount = countEntries(node[sub]);
    if (subCount === 0) continue;
    html += `<div class="nav-subdir" data-depth="${depth}">
      <div class="nav-subdir-title" role="button" tabindex="0" aria-expanded="false">
        <span class="subdir-arrow" aria-hidden="true"></span>
        <span class="nav-subdir-label">${esc(sub)}</span>
        <span class="nav-file-count">${subCount}</span>
      </div>
      <div class="nav-subdir-content" hidden>${renderNavNode(node[sub], depth + 1)}</div>
    </div>`;
  }
  if (node._entries?.length) {
    for (const e of node._entries.filter(isVisibleEntry)) {
      const status = e.stale ? 'stale' : e.status;
      html += `<a href="#${esc(e.url)}" class="nav-file" data-url="${esc(e.url)}" data-status="${esc(status)}"><span class="nav-status" aria-label="${esc(status)}"></span><span class="nav-file-title">${esc(e.title)}</span></a>`;
    }
  }
  return html;
}

// ===== Domain Grid =====
async function renderDomainGrid() {
  const tree = await loadNav();
  const domains = Object.keys(tree).sort();
  const el = document.getElementById('domainGrid');
  if (!el) return;
  el.innerHTML = domains.map(d => {
    const num = d.match(/^(\d{2})/)?.[1] || '99';
    return `<a href="#/?d=${num}" class="domain-card"><div class="dc-num">${esc(num)}</div><div class="dc-name">${esc(d)}</div><div class="dc-desc">${countEntries(tree[d])}篇笔记</div></a>`;
  }).join('');
}

// ===== TOC =====
function clearTOC() {
  if (tocEl) tocEl.hidden = true;
  if (tocNav) tocNav.innerHTML = '';
}
function buildTOC() {
  if (!tocEl || !tocNav) return;
  const headings = articleEl.querySelectorAll('.entry-body h2, .entry-body h3');
  if (headings.length < 2) { clearTOC(); return; }
  tocEl.hidden = false;
  tocNav.innerHTML = [...headings].map((h, i) => {
    h.id = 'h-' + i;
    const cls = h.tagName === 'H2' ? 'toc-h2' : 'toc-h3';
    return `<a href="#${h.id}" class="${cls}" onclick="document.getElementById('${h.id}').scrollIntoView({behavior:'smooth'});return false">${esc(h.textContent)}</a>`;
  }).join('');
}

// ===== Navigate =====
async function navigate(path) {
  if (path === '/?status=draft') {
    await renderDraftWorkspace();
  } else if (path.startsWith('/?d=')) {
    // Domain listing page
    const domainNum = path.split('d=')[1];
    const tree = await loadNav();
    const domain = Object.keys(tree).find(k => k.startsWith(domainNum));
    if (!domain) { articleEl.innerHTML = '<p>域未找到</p>'; prevNext.innerHTML = ''; clearTOC(); return; }
    articleEl.innerHTML = `<div class="entry-meta"><h1>${esc(domain)}</h1></div><div class="entry-body"><ul class="domain-listing">${renderDomainEntries(tree[domain])}</ul></div>`;
    prevNext.innerHTML = '';
    highlightNav(null);
    clearTOC();
  } else {
    const url = path || '/';
    if (url === '/') { await renderHome(); }
    else {
      try {
        const r = await fetch('content' + url + '.html');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        articleEl.innerHTML = await r.text();
        highlightNav(url);
        renderPrevNext(url);
        setTimeout(buildTOC, 50);
      } catch (err) {
        articleEl.innerHTML = `<div class="welcome"><h1>加载失败</h1><p>${esc(err.message)}</p><button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);cursor:pointer;margin-top:12px">重试</button></div>`;
        prevNext.innerHTML = '';
        clearTOC();
      }
    }
  }
  window.scrollTo(0, 0);
  if (window.innerWidth < 1024) closeSidebar();
  // Focus heading for screen readers
  setTimeout(() => { const h = articleEl.querySelector('h1'); if (h) h.setAttribute('tabindex', '-1'); try { h?.focus(); } catch {} }, 150);
}

function renderDomainEntries(node, predicate = isVisibleEntry) {
  let html = '';
  for (const sub of Object.keys(node).filter(k => k !== '_entries').sort()) {
    if (countEntriesMatching(node[sub], predicate) === 0) continue;
    html += `<li class="domain-listing-group"><strong>${esc(sub)}</strong><ul>${renderDomainEntries(node[sub], predicate)}</ul></li>`;
  }
  if (node._entries) {
    for (const e of node._entries.filter(predicate)) {
      const label = e.stale ? '待复核' : (e.status === 'verified' ? '已验证' : '草稿');
      html += `<li class="domain-listing-entry"><a href="#${esc(e.url)}">${esc(e.title)}</a> <span class="listing-status listing-${esc(e.stale ? 'stale' : e.status)}">${label}</span></li>`;
    }
  }
  return html;
}

function highlightNav(url) {
  navTreeEl.querySelectorAll('.nav-file').forEach(a => a.classList.remove('active'));
  if (url) {
    const active = navTreeEl.querySelector(`.nav-file[data-url="${esc(url)}"]`);
    if (active) {
      active.classList.add('active');
      expandParentDomain(url);
      let parent = active.parentElement;
      while (parent && parent !== navTreeEl) {
        if (parent.classList.contains('nav-subdir-content') && parent.hidden) {
          parent.hidden = false;
          const title = parent.previousElementSibling;
          title?.classList.add('open');
          title?.setAttribute('aria-expanded', 'true');
        }
        parent = parent.parentElement;
      }
      active.scrollIntoView({ block: 'nearest' });
    }
  }
}

function expandParentDomain(url) {
  const parts = url.split('/').filter(Boolean);
  if (!parts.length) return;
  const domainTitle = navTreeEl.querySelector(`.nav-domain-title[data-domain="${esc(parts[0])}"]`);
  if (domainTitle && !domainTitle.nextElementSibling?.classList.contains('open')) {
    domainTitle.click();
  }
}

function renderPrevNext(path) {
  const flat = [];
  (function flatten(node) {
    if (node._entries) for (const e of node._entries.filter(isVisibleEntry)) flat.push(e);
    for (const key of Object.keys(node)) { if (key !== '_entries') flatten(node[key]); }
  })(navTree || {});
  if (!flat.length) { prevNext.innerHTML = ''; return; }

  const idx = flat.findIndex(e => e.url === path);
  let html = '';
  if (idx > 0) html += `<a href="#${esc(flat[idx-1].url)}">← ${esc(flat[idx-1].title)}</a>`;
  else html += '<span></span>';
  if (idx < flat.length - 1) html += `<a href="#${esc(flat[idx+1].url)}">${esc(flat[idx+1].title)} →</a>`;
  else html += '<span></span>';
  prevNext.innerHTML = html;
}

// ===== Search =====
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length >= 1) { clearSearch.classList.add('visible'); searchTimeout = setTimeout(() => doSearch(q), 150); }
  else { clearSearch.classList.remove('visible'); searchResults.classList.remove('open'); }
});
searchInput.addEventListener('focus', () => { if (searchInput.value.trim().length >= 1) doSearch(searchInput.value.trim()); });
clearSearch.onclick = () => { searchInput.value = ''; clearSearch.classList.remove('visible'); searchResults.classList.remove('open'); searchInput.focus(); };
document.addEventListener('click', e => {
  if (e.target.closest?.('.badge-tag')) return;
  if (!searchResults.contains(e.target) && e.target !== searchInput) searchResults.classList.remove('open');
});

async function doSearch(q) {
  const idx = await loadSearch();
  const keywords = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = idx.filter(item => !verifiedOnly || item.st === 'verified').map(item => {
    let score = 0;
    const t = item.t.toLowerCase(), d = item.d.toLowerCase(), s = item.s.toLowerCase(), g = (item.g||[]).map(x=>x.toLowerCase());
    for (const kw of keywords) {
      if (t.includes(kw)) score += 100; else if (g.some(tag=>tag.includes(kw))) score += 50;
      else if (d.includes(kw)) score += 30; else if (s.includes(kw)) score += 10;
    }
    return { item, score };
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,20);

  searchResults.classList.add('open');
  if (!scored.length) { searchResultsInner.innerHTML = '<div class="no-results">未找到匹配结果</div>'; return; }
  searchResultsInner.innerHTML = scored.map(r => {
    const i = r.item;
    return `<a href="#${esc(i.u)}" class="search-item">
      <div class="si-title"><span class="si-domain">${esc(i.d)}</span><span class="search-status search-${esc(i.x ? 'stale' : i.st)}">${esc(i.x ? '待复核' : (i.st === 'verified' ? '已验证' : '草稿'))}</span>${hl(i.t, q)}</div>
      <div class="si-snippet">${hl(i.s.slice(0,180), q)}</div>
      ${i.g?.length ? '<div class="si-tags">'+i.g.slice(0,5).map(t=>`<span class="badge badge-tag">#${esc(t)}</span>`).join('')+'</div>' : ''}
    </a>`;
  }).join('');
}

function hl(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return esc(text).replace(re, '<mark style="background:#fde68a;padding:0 2px;border-radius:2px">$1</mark>');
}

window.searchTag = function(tag) {
  searchInput.value = tag;
  clearSearch.classList.add('visible');
  searchInput.focus();
  doSearch(tag);
};

// ===== Code Copy =====
window.copyCode = function(btn) {
  const code = btn.closest('.code-block').querySelector('pre').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
  });
};

// ===== Keyboard =====
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); }
  if (e.key === 'Escape') {
    closeSidebar();
    searchInput.blur();
    searchResults.classList.remove('open');
    clearSearch.classList.remove('visible');
  }
});

// ===== Hash routing =====
window.addEventListener('hashchange', () => navigate(getRoute()));

// ===== Init =====
async function init() {
  try {
    await loadNav();
    await renderNav();
    await navigate(getRoute());
    Promise.all([loadSearch(), loadSiteMeta()]).catch(error => {
      console.warn('Optional index preload failed', error);
    });
  } catch (error) {
    navTreeEl.innerHTML = `<div class="nav-error">导航加载失败：${esc(error.message)}<br><button type="button" onclick="location.reload()">重新加载</button></div>`;
  }
}
init();
