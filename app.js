'use strict';

// ═══════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════
const BATCH_SIZE         = 12;
const AUTOPLAY_THRESHOLD = 0.60; // 60 % of card visible → play preview video

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let allCards     = [];
let activeFilter = null;  // null = all shuffled | 'all' = JSON order | category
let currentTheme = localStorage.getItem('sprtk-theme') || 'dark';

let filteredSource = [];  // ordered array for the active filter
let renderedCount  = 0;   // cards already in the DOM

let autoplayObserver = null;

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('sprtk-theme', theme);
  currentTheme = theme;
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════

/** Pause every <video> inside a page element so nothing plays off-screen */
function pauseAllVideosIn(pageEl) {
  if (!pageEl) return;
  pageEl.querySelectorAll('video').forEach(v => {
    if (!v.paused) v.pause();
  });
}

function navigateTo(pageId) {
  // Pause all videos in every currently-active page before hiding it
  document.querySelectorAll('.page.active').forEach(p => pauseAllVideosIn(p));

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  const tab  = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (tab)  tab.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════
//  VIEWPORT AUTOPLAY
// ═══════════════════════════════════════════════════════
function createAutoplayObserver() {
  if (autoplayObserver) autoplayObserver.disconnect();

  // Use a fine-grained threshold array so the observer fires at every 10 %
  // interval — this means a card scrolled to any level below 60 % will
  // reliably trigger a pause, not just when it hits exactly 0 %.
  const thresholds = Array.from({ length: 11 }, (_, i) => i / 10);

  autoplayObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const wrap = entry.target;
      const card = wrap._card;
      if (!card || card.mediaType !== 'video' || !card.previewVideo) return;

      const v = wrap.querySelector('.card-preview-video');

      if (entry.intersectionRatio >= AUTOPLAY_THRESHOLD) {
        // Card is sufficiently visible — play
        if (!wrap._videoMounted) {
          mountPreviewVideo(wrap, card);
        } else if (v && v.paused) {
          v.play().catch(() => {});
        }
      } else {
        // Card is less than 60 % visible — pause
        if (v && !v.paused) {
          v.pause();
        }
        // Fully offscreen — also release the network connection
        if (entry.intersectionRatio === 0 && wrap._videoMounted) {
          if (v) {
            v.removeAttribute('src');
            v.load();
          }
          wrap._videoMounted = false;
        }
      }
    });
  }, { threshold: thresholds });
}

/**
 * Mount the preview video.
 * Strategy: video (z-index 1) plays underneath; image (z-index 2) fades out
 * once the video has its first frame ready. Clean, no flash.
 */
function mountPreviewVideo(wrap, card) {
  if (!card.previewVideo || wrap._videoMounted) return;
  wrap._videoMounted = true;

  const img     = wrap.querySelector('.card-preview-img');
  const overlay = wrap.querySelector('.card-overlay');

  const v = document.createElement('video');
  v.className   = 'card-preview-video';
  v.muted       = true;
  v.loop        = true;
  v.playsInline = true;
  v.preload     = 'auto'; // we want it to load promptly once visible
  v.setAttribute('playsinline', '');

  // Insert BEFORE overlay so stacking is: img(z2) → video(z1) → overlay(z-index from CSS)
  wrap.insertBefore(v, overlay || null);

  v.onerror = () => {
    v.remove();
    wrap._videoMounted = false;
  };

  v.src = card.previewVideo;

  // When first frame is ready: play video, then fade the static image away
  v.addEventListener('canplay', () => {
    v.play().catch(() => {});
    if (img) {
      img.style.opacity = '0';
      img.addEventListener('transitionend', () => img.remove(), { once: true });
    }
  }, { once: true });
}

function watchCardMedia(wrap, card) {
  wrap._card = card;
  if (autoplayObserver) autoplayObserver.observe(wrap);
}

// ═══════════════════════════════════════════════════════
//  FALLBACK
// ═══════════════════════════════════════════════════════
function applyFallback(wrap, card) {
  if (wrap.querySelector('.card-media-fallback')) return;
  wrap.style.background = card.fallbackGradient;
  const fb = document.createElement('div');
  fb.className   = 'card-media-fallback';
  fb.textContent = card.fallbackEmoji;
  wrap.appendChild(fb);
}

// ═══════════════════════════════════════════════════════
//  CARD PREVIEW MEDIA
// ═══════════════════════════════════════════════════════
function buildCardPreview(card) {
  const sizeClass = card.size === 'tall' ? ' tall'
                  : card.size === 'wide' ? ' wide' : '';
  const wrap = document.createElement('div');
  wrap.className = `card-media${sizeClass}`;

  if (card.mediaType === 'video') {
    // Show static previewImage immediately
    if (card.previewImage) {
      const img = document.createElement('img');
      img.className = 'card-preview-img';
      img.src       = card.previewImage;
      img.alt       = card.title;
      img.loading   = 'lazy';
      img.onerror   = () => applyFallback(wrap, card);
      wrap.appendChild(img);
    } else {
      applyFallback(wrap, card);
    }
    // Register with autoplay observer (video mounts when ≥60 % visible)
    if (card.previewVideo) watchCardMedia(wrap, card);

  } else {
    const img = document.createElement('img');
    img.src     = card.mediaSrc;
    img.alt     = card.title;
    img.loading = 'lazy';
    img.onerror = () => applyFallback(wrap, card);
    wrap.appendChild(img);
  }

  return wrap;
}

// ═══════════════════════════════════════════════════════
//  DETAIL MEDIA — never cropped, always contain
// ═══════════════════════════════════════════════════════
function buildDetailMedia(card) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-media';

  const fallback = () => {
    wrap.style.background = card.fallbackGradient;
    const fb = document.createElement('div');
    fb.className   = 'card-media-fallback';
    fb.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:200px;font-size:3.5rem;';
    fb.textContent = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    const src = card.fullVideo || '';
    if (src) {
      const v = document.createElement('video');
      v.src         = src;
      v.controls    = true;
      v.playsInline = true;
      v.onerror     = fallback;
      wrap.appendChild(v);
    } else if (card.previewImage) {
      const img = document.createElement('img');
      img.src     = card.previewImage;
      img.alt     = card.title;
      img.onerror = fallback;
      wrap.appendChild(img);
    } else {
      fallback();
    }
  } else {
    const img = document.createElement('img');
    img.src     = card.mediaSrc;
    img.alt     = card.title;
    img.onerror = fallback;
    wrap.appendChild(img);
  }

  return wrap;
}

// ═══════════════════════════════════════════════════════
//  CARD BUILDER
// ═══════════════════════════════════════════════════════
function buildCard(card, animDelay = 0) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.animationDelay = `${animDelay}s`;
  if (card.mediaType === 'video') el.classList.add('card--video');

  const mediaWrap = buildCardPreview(card);

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

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

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h3');
  title.className   = 'card-title';
  title.textContent = card.title;

  const desc = document.createElement('p');
  desc.className   = 'card-desc';
  desc.textContent = card.desc;

  body.appendChild(title);
  body.appendChild(desc);
  el.appendChild(body);

  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click',   ()  => openDetail(card.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(card.id); });

  return el;
}

// ═══════════════════════════════════════════════════════
//  MASONRY
// ═══════════════════════════════════════════════════════
function getColCount() {
  const grid = document.getElementById('cardsGrid');
  const raw  = getComputedStyle(grid).getPropertyValue('--cols').trim();
  const n    = parseInt(raw, 10);
  return (isNaN(n) || n < 1) ? 4 : n;
}

function estimatedCardHeight(card, colW) {
  const BODY_H = 82, GAP = 16;
  let mediaH;
  if      (card.size === 'tall') mediaH = colW * (4 / 3);
  else if (card.size === 'wide') mediaH = colW * (9 / 16);
  else                           mediaH = colW * (3 / 4);
  return mediaH + BODY_H + GAP;
}

function appendBatch(batch) {
  const grid = document.getElementById('cardsGrid');
  const cols = Array.from(grid.querySelectorAll('.masonry-col'));
  if (!cols.length) return;

  const heights = cols.map(c => c.getBoundingClientRect().height || 0);
  const colW    = cols[0].getBoundingClientRect().width || 300;

  batch.forEach((card, i) => {
    const minIdx = heights.indexOf(Math.min(...heights));
    cols[minIdx].appendChild(buildCard(card, i * 0.04));
    heights[minIdx] += estimatedCardHeight(card, colW);
  });
}

function resetGrid() {
  if (autoplayObserver) autoplayObserver.disconnect();
  createAutoplayObserver();

  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  const colCount = getColCount();
  for (let i = 0; i < colCount; i++) {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    grid.appendChild(col);
  }
}

// ═══════════════════════════════════════════════════════
//  LOAD MORE BUTTON
// ═══════════════════════════════════════════════════════
function removeLoadMoreBtn() {
  document.getElementById('sprtk-load-more-wrap')?.remove();
}

function updateLoadMoreBtn() {
  removeLoadMoreBtn();
  if (renderedCount >= filteredSource.length) return; // all shown

  const remaining = filteredSource.length - renderedCount;

  const wrap = document.createElement('div');
  wrap.id        = 'sprtk-load-more-wrap';
  wrap.className = 'load-more-wrap';

  const btn = document.createElement('button');
  btn.className   = 'load-more-btn';
  btn.textContent = `Показать ещё (${remaining})`;
  btn.addEventListener('click', loadMoreCards);

  wrap.appendChild(btn);
  document.getElementById('cardsGrid').insertAdjacentElement('afterend', wrap);
}

function loadMoreCards() {
  const batch = filteredSource.slice(renderedCount, renderedCount + BATCH_SIZE);
  if (!batch.length) { removeLoadMoreBtn(); return; }

  appendBatch(batch);
  renderedCount += batch.length;
  updateLoadMoreBtn();
}

// ═══════════════════════════════════════════════════════
//  RENDER / FILTER
// ═══════════════════════════════════════════════════════
function computeSource() {
  if (!activeFilter) {
    return shuffle(allCards);
  } else if (activeFilter === 'all') {
    return [...allCards];
  } else {
    return shuffle(allCards.filter(c => c.category === activeFilter));
  }
}

function renderCards() {
  removeLoadMoreBtn();
  resetGrid();

  filteredSource = computeSource();
  renderedCount  = 0;

  // Render first batch immediately
  loadMoreCards();
}

function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderCards();
}

// ═══════════════════════════════════════════════════════
//  DETAIL PAGE
// ═══════════════════════════════════════════════════════
function openDetail(id) {
  const card = allCards.find(c => c.id === id);
  if (!card) return;

  const content = document.getElementById('detailContent');

  // Pause any video already playing in the detail panel before wiping it
  content.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
  content.innerHTML = '';

  content.appendChild(buildDetailMedia(card));

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const catTag = document.createElement('span');
  catTag.className   = 'detail-category';
  catTag.textContent = card.categoryLabel;
  meta.appendChild(catTag);
  content.appendChild(meta);

  const title = document.createElement('h2');
  title.className   = 'detail-title';
  title.textContent = card.title;
  content.appendChild(title);

  const desc = document.createElement('p');
  desc.className   = 'detail-desc';
  desc.textContent = card.fullDesc;
  content.appendChild(desc);

  navigateTo('detail');
}

// ═══════════════════════════════════════════════════════
//  DATA LOAD
// ═══════════════════════════════════════════════════════
async function loadCards() {
  try {
    const res = await fetch('cards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allCards = await res.json();
  } catch (err) {
    console.warn('Could not load cards.json:', err);
    allCards = [];
  }
  renderCards();
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
function init() {
  applyTheme(currentTheme);
  createAutoplayObserver();

  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.page));
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.filter === activeFilter ? null : btn.dataset.filter;
      applyFilter(next);
    });
  });

  document.getElementById('backBtn').addEventListener('click', () => navigateTo('explore'));

  // Reflow masonry on breakpoint change
  let lastColCount = 0;
  const resizeObs = new ResizeObserver(() => {
    if (!allCards.length) return;
    const newCount = getColCount();
    if (newCount !== lastColCount) {
      lastColCount = newCount;
      renderCards();
    }
  });
  resizeObs.observe(document.getElementById('cardsGrid'));

  loadCards();
}

document.addEventListener('DOMContentLoaded', init);
