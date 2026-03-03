'use strict';

// ===========================
// STATE
// ===========================
let allCards     = [];     // loaded from cards.json
let activeFilter = null;   // null = no filter (show all shuffled)
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
// CARD MEDIA BUILDING
// ===========================

/**
 * Build the card preview media element.
 * - Video cards: show previewSrc image if provided, else use a video
 *   element with poster to capture first frame, else fallback gradient.
 * - Image cards: standard <img>.
 */
function buildCardPreview(card) {
  const wrap = document.createElement('div');
  wrap.className = `card-media${card.size === 'tall' ? ' tall' : card.size === 'wide' ? ' wide' : ''}`;

  const applyFallback = () => {
    wrap.style.background = card.fallbackGradient;
    const fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.textContent = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    if (card.previewSrc) {
      // Explicit preview image provided
      const img = document.createElement('img');
      img.src    = card.previewSrc;
      img.alt    = card.title;
      img.loading = 'lazy';
      img.onerror = applyFallback;
      wrap.appendChild(img);
    } else {
      // No previewSrc — use a video element with preload="metadata"
      // so the browser surfaces the first frame as a visual preview.
      const v = document.createElement('video');
      v.src      = card.mediaSrc;
      v.preload  = 'metadata';
      v.muted    = true;
      v.playsInline = true;
      // Seek to 0.1 s after metadata loads so browsers paint a frame
      v.addEventListener('loadedmetadata', () => { v.currentTime = 0.1; }, { once: true });
      v.onerror  = applyFallback;
      wrap.appendChild(v);
    }
  } else {
    const img = document.createElement('img');
    img.src    = card.mediaSrc;
    img.alt    = card.title;
    img.loading = 'lazy';
    img.onerror = applyFallback;
    wrap.appendChild(img);
  }

  return wrap;
}

/**
 * Build the detail-page media element (always the real video/image).
 */
function buildDetailMedia(card) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-media';

  const applyFallback = () => {
    wrap.style.background = card.fallbackGradient;
    const fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
    fb.textContent = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    const v = document.createElement('video');
    v.src        = card.mediaSrc;
    v.controls   = true;
    v.muted      = true;
    v.playsInline = true;
    v.onerror    = applyFallback;
    wrap.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src    = card.mediaSrc;
    img.alt    = card.title;
    img.onerror = applyFallback;
    wrap.appendChild(img);
  }

  return wrap;
}

// ===========================
// CARD ELEMENT BUILDING
// ===========================
function buildCard(card, delay = 0) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.animationDelay = `${delay}s`;
  if (card.mediaType === 'video') el.classList.add('card--video');

  // Preview media
  const mediaWrap = buildCardPreview(card);

  // Subtle hover overlay (no CTA button, no category pill)
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  // Play icon — only for video cards
  if (card.mediaType === 'video') {
    const playIcon = document.createElement('div');
    playIcon.className = 'card-play-icon';
    playIcon.innerHTML = `
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="23" stroke="white" stroke-width="1.5" fill="rgba(0,0,0,0.35)"/>
        <polygon points="19,14 37,24 19,34" fill="white"/>
      </svg>`;
    overlay.appendChild(playIcon);
  }

  mediaWrap.appendChild(overlay);
  el.appendChild(mediaWrap);

  // Compact body
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

  // Interaction
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', () => openDetail(card.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(card.id); });

  return el;
}

// ===========================
// MASONRY HELPERS
// ===========================
function getColCount() {
  const grid = document.getElementById('cardsGrid');
  const raw  = getComputedStyle(grid).getPropertyValue('--cols').trim();
  const n    = parseInt(raw, 10);
  return (isNaN(n) || n < 1) ? 4 : n;
}

function buildMasonryColumns(cards) {
  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';

  const colCount = getColCount();

  const cols = Array.from({ length: colCount }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    grid.appendChild(col);
    return col;
  });

  const heights = new Array(colCount).fill(0);

  cards.forEach((card, i) => {
    const shortest = heights.indexOf(Math.min(...heights));
    const el = buildCard(card, i * 0.04);
    cols[shortest].appendChild(el);

    // Estimated card height for column-balance calculation
    const BODY_H = 82;   // compact body height (with red line + padding)
    const GAP    = 16;
    const colW   = cols[shortest].getBoundingClientRect().width || 300;
    let mediaH;
    if (card.size === 'tall')       mediaH = colW * (4 / 3);   // 3/4 ratio
    else if (card.size === 'wide')  mediaH = colW * (9 / 16);  // 16/9 ratio
    else                            mediaH = colW * (3 / 4);   // 4/3 ratio (default)

    heights[shortest] += mediaH + BODY_H + GAP;
  });
}

// ===========================
// RENDER CARDS
// ===========================
function renderCards() {
  let source;

  if (!activeFilter) {
    // No filter selected → show all, shuffled
    source = shuffle(allCards);
  } else if (activeFilter === 'all') {
    // "Последнее" → original JSON order, no shuffle
    source = [...allCards];
  } else {
    // Category filter → shuffle the filtered subset
    source = shuffle(allCards.filter(c => c.category === activeFilter));
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
// DETAIL PAGE
// ===========================
function openDetail(id) {
  const card = allCards.find(c => c.id === id);
  if (!card) return;

  const content = document.getElementById('detailContent');
  content.innerHTML = '';

  // Real media (video plays here)
  content.appendChild(buildDetailMedia(card));

  // Category tag (kept on detail page)
  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const catTag = document.createElement('span');
  catTag.className = 'detail-category';
  catTag.textContent = card.categoryLabel;
  meta.appendChild(catTag);
  content.appendChild(meta);

  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = card.title;
  content.appendChild(title);

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

  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.page));
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Clicking active filter clears it (back to random all)
      const next = btn.dataset.filter === activeFilter ? null : btn.dataset.filter;
      applyFilter(next);
    });
  });

  document.getElementById('backBtn').addEventListener('click', () => navigateTo('explore'));

  // Reflow masonry on breakpoint change
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

  loadCards();
}

document.addEventListener('DOMContentLoaded', init);
