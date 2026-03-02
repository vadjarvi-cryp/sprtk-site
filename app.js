'use strict';

// ===========================
// STATE
// ===========================
let allCards   = [];          // loaded from cards.json
let activeFilter = null;      // null = no filter (show all shuffled)
let currentTheme = localStorage.getItem('sprtk-theme') || 'dark';

// ===========================
// UTILS
// ===========================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===========================
// THEME
// ===========================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('sprtk-theme', theme);
  currentTheme = theme;
}

// ===========================
// NAVIGATION
// ===========================
function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  const tab  = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (tab)  tab.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===========================
// CARD BUILDING
// ===========================
function buildMediaWrap(card, isDetail = false) {
  const wrap = document.createElement('div');
  wrap.className = isDetail ? 'detail-media' : `card-media${card.size === 'tall' ? ' tall' : card.size === 'wide' ? ' wide' : ''}`;

  const fallback = () => {
    wrap.style.background = card.fallbackGradient;
    const fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
    fb.textContent = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    const v = document.createElement('video');
    v.src = card.mediaSrc;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    if (isDetail) { v.controls = true; v.autoplay = true; }
    v.loading = 'lazy';
    v.onerror = fallback;
    wrap.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = card.mediaSrc;
    img.alt = card.title;
    img.loading = 'lazy';
    img.onerror = fallback;
    wrap.appendChild(img);
  }

  return wrap;
}

function buildCard(card, delay = 0) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.animationDelay = `${delay}s`;

  // Media + overlays
  const mediaWrap = buildMediaWrap(card);

  const catPill = document.createElement('span');
  catPill.className = 'card-category';
  catPill.textContent = card.categoryLabel;
  mediaWrap.appendChild(catPill);

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const cta = document.createElement('span');
  cta.className = 'card-overlay-cta';
  cta.textContent = 'Подробнее →';
  overlay.appendChild(cta);
  mediaWrap.appendChild(overlay);

  el.appendChild(mediaWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = card.title;

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = card.desc;

  body.appendChild(title);
  body.appendChild(desc);
  el.appendChild(body);

  // Click / keyboard
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', () => openDetail(card.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(card.id); });

  return el;
}

// ===========================
// MASONRY HELPERS
// ===========================

/** Read the column count the CSS wants via the --cols custom property */
function getColCount() {
  const grid = document.getElementById('cardsGrid');
  const raw  = getComputedStyle(grid).getPropertyValue('--cols').trim();
  const n    = parseInt(raw, 10);
  return (isNaN(n) || n < 1) ? 4 : n;
}

/**
 * Build (or rebuild) the masonry column structure inside #cardsGrid.
 * Cards are placed into the shortest column each time, giving tight
 * vertical packing with no row-gap artefacts.
 */
function buildMasonryColumns(cards) {
  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';

  const colCount = getColCount();

  // Create column wrappers
  const cols = Array.from({ length: colCount }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    grid.appendChild(col);
    return col;
  });

  // Track approximate pixel height per column for shortest-column insertion
  const heights = new Array(colCount).fill(0);

  cards.forEach((card, i) => {
    // Find the shortest column
    const shortest = heights.indexOf(Math.min(...heights));

    const el = buildCard(card, i * 0.04);
    cols[shortest].appendChild(el);

    // Estimate card height: media aspect-ratio + fixed body (~88px)
    const BODY_H = 88;
    const GAP    = 16;
    const colW   = cols[shortest].getBoundingClientRect().width || 300;
    let mediaH;
    if (card.size === 'tall')  mediaH = colW * (5 / 4);
    else if (card.size === 'wide') mediaH = colW * (9 / 21);
    else                       mediaH = colW * (10 / 16);

    heights[shortest] += mediaH + BODY_H + GAP;
  });
}

// ===========================
// RENDER CARDS
// ===========================
function renderCards() {
  // Decide source order
  let source;
  if (!activeFilter || activeFilter === 'all') {
    // No filter → show all, shuffled
    source = shuffle(allCards);
  } else {
    // Filter active → stable JSON order, no shuffle
    source = allCards.filter(c => c.category === activeFilter);
  }

  buildMasonryColumns(source);
}

// ===========================
// FILTER
// ===========================
function applyFilter(filter) {
  activeFilter = filter;

  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });

  renderCards();
}

// ===========================
// DETAIL
// ===========================
function openDetail(id) {
  const card = allCards.find(c => c.id === id);
  if (!card) return;

  const content = document.getElementById('detailContent');
  content.innerHTML = '';

  // Large media
  content.appendChild(buildMediaWrap(card, true));

  // Category
  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const catTag = document.createElement('span');
  catTag.className = 'detail-category';
  catTag.textContent = card.categoryLabel;
  meta.appendChild(catTag);
  content.appendChild(meta);

  // Title
  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = card.title;
  content.appendChild(title);

  // Full description
  const desc = document.createElement('p');
  desc.className = 'detail-desc';
  desc.textContent = card.fullDesc;
  content.appendChild(desc);

  navigateTo('detail');
}

// ===========================
// LOAD DATA
// ===========================
async function loadCards() {
  try {
    const res = await fetch('cards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allCards = await res.json();
  } catch (err) {
    console.warn('Could not load cards.json, falling back to empty list.', err);
    allCards = [];
  }
  renderCards();
}

// ===========================
// INIT
// ===========================
function init() {
  applyTheme(currentTheme);

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.page));
  });

  // Filter buttons — no filter active by default
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Clicking the already-active filter clears it (show all shuffled)
      const next = btn.dataset.filter === activeFilter ? null : btn.dataset.filter;
      applyFilter(next);
    });
  });

  // Back button
  document.getElementById('backBtn').addEventListener('click', () => navigateTo('explore'));

  // Reflow masonry when container width changes (breakpoint crossings)
  let lastCols = 0;
  const ro = new ResizeObserver(() => {
    if (!allCards.length) return;
    const newCols = getColCount();
    if (newCols !== lastCols) {
      lastCols = newCols;
      renderCards();
    }
  });
  ro.observe(document.getElementById('cardsGrid'));

  // Load card data from JSON
  loadCards();
}

document.addEventListener('DOMContentLoaded', init);
