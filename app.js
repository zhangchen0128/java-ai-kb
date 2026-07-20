// ===== State =====
let navTree = null;
let searchIdx = null;
let currentPath = null;
let allEntries = [];

// GitHub Pages repo name detection
const isGHpages = location.hostname.includes('github.io');
const BASE = isGHpages ? '/' + location.pathname.split('/')[1] : '';

function fixPath(p) {
  if (isGHpages && p.startsWith(BASE)) return p.slice(BASE.length) || '/';
  return p;
}

// ===== DOM refs =====
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const sidebar = $('#sidebar');
const overlay = $('#overlay');
const navTreeEl = $('#navTree');
const articleEl = $('#article');
const searchInput = $('#searchInput');
const searchResults = $('#searchResults');
const searchResultsInner = $('#searchResultsInner');
const clearSearch = $('#clearSearch');
const content = $('#content');
const progressBar = $('#progressBar');
const backToTop = $('#backToTop');
const prevNext = $('#prevNext');
const domainGrid = $('#domainGrid');

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

// ===== Sidebar toggle =====
$('#menuBtn').onclick = () => {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
  document.body.classList.toggle('sidebar-visible', sidebar.classList.contains('open'));
};
overlay.onclick = () => {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
  document.body.classList.remove('sidebar-visible');
};

// ===== Scroll =====
window.addEventListener('scroll', () => {
  const h = document.documentElement;
  const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
  progressBar.style.width = pct + '%';
  backToTop.classList.toggle('visible', h.scrollTop > 400);
}, { passive: true });
backToTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// ===== Load Data =====
async function loadNav() {
  if (navTree) return navTree;
  const r = await fetch('nav-tree.json');
  navTree = await r.json();
  return navTree;
}

async function loadSearch() {
  if (searchIdx) return searchIdx;
  const r = await fetch('search-index.json');
  searchIdx = await r.json();
  allEntries = searchIdx;
  return searchIdx;
}

// ===== Render Nav =====
async function renderNav() {
  const tree = await loadNav();
  let html = '';
  const sortedDomains = Object.keys(tree).sort();
  for (const domain of sortedDomains) {
    const d = tree[domain];
    const num = domain.match(/^(\d{2})/)?.[1] || '99';
    const entryCount = countEntries(d);
    html += `<div class="nav-domain">
      <div class="nav-domain-title" data-domain="${domain}">
        <span class="arrow"></span>${domain} <span class="nav-file-count">${entryCount}篇</span>
      </div>
      <div class="nav-sub">`;
    html += renderNavNode(d, '');
    html += `</div></div>`;
  }
  navTreeEl.innerHTML = html;

  // Toggle domain
  navTreeEl.querySelectorAll('.nav-domain-title').forEach(el => {
    el.onclick = () => {
      const sub = el.nextElementSibling;
      const arrow = el.querySelector('.arrow');
      sub.classList.toggle('open');
      arrow.classList.toggle('open');
      localStorage.setItem('kb-nav-' + el.dataset.domain, sub.classList.contains('open') ? '1' : '0');
    };
    // Restore state
    if (localStorage.getItem('kb-nav-' + el.dataset.domain) === '1') {
      el.nextElementSibling.classList.add('open');
      el.querySelector('.arrow').classList.add('open');
    }
  });

  // Subdir toggle
  navTreeEl.querySelectorAll('.nav-subdir-title').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const sub = el.nextElementSibling;
      const show = sub.style.display !== 'none';
      sub.style.display = show ? 'none' : 'block';
      el.textContent = (show ? '▸ ' : '▾ ') + el.textContent.slice(2);
    };
  });
}

function countEntries(node) {
  let count = node._entries?.length || 0;
  for (const key of Object.keys(node)) {
    if (key !== '_entries') count += countEntries(node[key]);
  }
  return count;
}

function renderNavNode(node, prefix) {
  let html = '';
  const subdirs = Object.keys(node).filter(k => k !== '_entries').sort();
  for (const sub of subdirs) {
    const subCount = countEntries(node[sub]);
    html += `<div class="nav-subdir-title">▸ ${sub} <span class="nav-file-count">${subCount}</span></div>`;
    html += `<div style="display:none">`;
    if (node[sub]._entries?.length) {
      for (const e of node[sub]._entries) {
        html += `<a href="${e.url}" class="nav-file" data-url="${e.url}">${e.title}</a>`;
      }
    }
    html += renderNavNode(node[sub], prefix + '  ');
    html += `</div>`;
  }
  if (node._entries?.length) {
    for (const e of node._entries) {
      html += `<a href="${e.url}" class="nav-file" data-url="${e.url}">${e.title}</a>`;
    }
  }
  return html;
}

// ===== Render Domain Grid =====
async function renderDomainGrid() {
  const tree = await loadNav();
  const domains = Object.keys(tree).sort();
  let html = '';
  for (const d of domains) {
    const num = d.match(/^(\d{2})/)?.[1] || '99';
    html += `<a href="/?d=${num}" class="domain-card">
      <div class="dc-num">${num}</div>
      <div class="dc-name">${d}</div>
      <div class="dc-desc">${countEntries(tree[d])}篇笔记</div>
    </a>`;
  }
  if (domainGrid) domainGrid.innerHTML = html;
}

// ===== SPA Router =====
async function navigate(path) {
  const isDomain = path.startsWith('/?d=');
  if (isDomain) {
    const domainNum = path.split('d=')[1];
    articleEl.innerHTML = '<div class="loading">加载中…</div>';
    const tree = await loadNav();
    const domain = Object.keys(tree).find(k => k.startsWith(domainNum));
    if (!domain) { articleEl.innerHTML = '<p>域未找到</p>'; return; }
    let itemsHtml = `<h1>${domain}</h1><ul class="domain-listing">`;
    itemsHtml += renderDomainEntries(tree[domain]);
    itemsHtml += '</ul>';
    articleEl.innerHTML = `<div class="entry-meta"><h1>${domain}</h1></div><div class="entry-body">${itemsHtml}</div>`;
    prevNext.innerHTML = '';
    highlightNav(null);
  } else {
    const url = path || '/';
    let contentPath = url === '/' || url === '' ? null : url;
    if (contentPath) {
      try {
        const r = await fetch('content' + contentPath + '.html');
        if (!r.ok) throw new Error('Not found');
        const html = await r.text();
        articleEl.innerHTML = html;
        highlightNav(contentPath);
        renderPrevNext(contentPath);
      } catch {
        articleEl.innerHTML = '<div class="welcome"><h1>404</h1><p>页面未找到</p></div>';
        prevNext.innerHTML = '';
      }
    } else {
      articleEl.innerHTML = document.querySelector('#article .welcome')?.outerHTML || '<p>欢迎</p>';
      renderDomainGrid();
      prevNext.innerHTML = '';
      highlightNav(null);
    }
  }
  window.scrollTo(0, 0);
  // Close sidebar on mobile after navigation
  if (window.innerWidth < 1024) {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.classList.remove('sidebar-visible');
  }
}

function renderDomainEntries(node, prefix = '') {
  let html = '';
  const subdirs = Object.keys(node).filter(k => k !== '_entries').sort();
  for (const sub of subdirs) {
    html += `<li style="list-style:none;margin-top:.8em"><strong>${sub}</strong><ul>`;
    html += renderDomainEntries(node[sub], prefix + '  ');
    html += '</ul></li>';
  }
  if (node._entries?.length) {
    for (const e of node._entries) {
      html += `<li><a href="${e.url}" class="cross-ref">${e.title}</a> ${e.status === 'draft' ? '📝' : e.status === 'verified' ? '✅' : ''}</li>`;
    }
  }
  return html;
}

function highlightNav(url) {
  navTreeEl.querySelectorAll('.nav-file').forEach(a => a.classList.remove('active'));
  if (url) {
    const active = navTreeEl.querySelector(`.nav-file[data-url="${url}"]`);
    if (active) {
      active.classList.add('active');
      active.scrollIntoView({ block: 'nearest' });
    }
  }
}

function renderPrevNext(path) {
  // Build flat list from navTree
  const flat = [];
  function flatten(node) {
    if (node._entries) for (const e of node._entries) flat.push(e);
    for (const key of Object.keys(node)) {
      if (key !== '_entries') flatten(node[key]);
    }
  }
  if (navTree) {
    for (const domain of Object.keys(navTree).sort()) flatten(navTree[domain]);
    const idx = flat.findIndex(e => e.url === path);
    let html = '';
    if (idx > 0) html += `<a href="${flat[idx-1].url}">← ${flat[idx-1].title}</a>`;
    else html += '<span></span>';
    if (idx < flat.length - 1) html += `<a href="${flat[idx+1].url}">${flat[idx+1].title} →</a>`;
    else html += '<span></span>';
    prevNext.innerHTML = html;
  }
}

// ===== Intercept Clicks =====
document.addEventListener('click', e => {
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href) return;
  // Internal links only
  if (href.startsWith('/') && !href.startsWith('//')) {
    e.preventDefault();
    const p = fixPath(href);
    history.pushState(null, '', BASE + p);
    navigate(p);
  }
});

// ===== PopState =====
window.addEventListener('popstate', () => navigate(fixPath(location.pathname + location.search)));

// ===== Search =====
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length >= 1) {
    clearSearch.classList.add('visible');
    searchTimeout = setTimeout(() => doSearch(q), 150);
  } else {
    clearSearch.classList.remove('visible');
    searchResults.classList.remove('open');
  }
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 1) doSearch(searchInput.value.trim());
});

clearSearch.onclick = () => {
  searchInput.value = '';
  clearSearch.classList.remove('visible');
  searchResults.classList.remove('open');
  searchInput.focus();
};

// Close search on click outside
document.addEventListener('click', e => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.remove('open');
  }
});

async function doSearch(q) {
  const idx = await loadSearch();
  const lower = q.toLowerCase();
  const results = idx.filter(item => {
    return item.t.toLowerCase().includes(lower) ||
           item.d.toLowerCase().includes(lower) ||
           item.s.toLowerCase().includes(lower) ||
           (item.g && item.g.some(t => t.toLowerCase().includes(lower)));
  }).slice(0, 20);

  if (results.length === 0) {
    searchResultsInner.innerHTML = '<div class="no-results">未找到匹配结果</div>';
  } else {
    searchResultsInner.innerHTML = results.map(r => `
      <a href="${r.u}" class="search-item">
        <div class="si-title"><span class="si-domain">${r.d}</span>${highlightMatch(r.t, q)}</div>
        <div class="si-snippet">${highlightMatch(r.s.slice(0, 180), q)}</div>
        ${r.g?.length ? '<div class="si-tags">' + r.g.slice(0,5).map(t => `<span class="badge badge-tag">#${t}</span>`).join('') + '</div>' : ''}
      </a>
    `).join('');
  }
  searchResults.classList.add('open');
}

function highlightMatch(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark style="background:#fde68a;padding:0 2px;border-radius:2px">$1</mark>');
}

// ===== Code Copy =====
window.copyCode = function(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  const code = pre.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
  });
};

// ===== Init =====
async function init() {
  await loadNav();
  await loadSearch();
  renderNav();
  renderDomainGrid();
  navigate(fixPath(location.pathname + location.search));
}

init();
