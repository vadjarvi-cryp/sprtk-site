'use strict';

// ═══════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════
const BATCH_SIZE          = 12;   // cards per lazy-load page
const AUTOPLAY_THRESHOLD  = 0.60; // 60 % visible to trigger preview video

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let allCards      = [];   // full dataset from cards.json
let activeFilter  = null; // null = all shuffled | 'all' = JSON order | category key
let currentTheme  = localStorage.getItem('sprtk-theme') || 'dark';

// Lazy-load pagination
let filteredSource = []; // current ordered array for the active filter
let renderedCount  = 0;  // how many cards are already in the DOM

// Observer handles (kept so we can .disconnect() cleanly on reset)
let autoplayObserver = null;
let sentinelObserver = null;

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
function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  const tab  = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (tab)  tab.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════
//  VIEWPORT AUTOPLAY — one shared IntersectionObserver
//  watching every .card-media[data-video-card] element
// ═══════════════════════════════════════════════════════

/**
 * Create (or recreate) the single shared autoplay observer.
 * Must be called before any card-media elements are registered.
 */
function createAutoplayObserver() {
  if (autoplayObserver) autoplayObserver.disconnect();

  autoplayObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const wrap = entry.target;          // .card-media element
      const card = wrap._card;           // attached in buildCardPreview()

      if (!card) return;

      if (entry.intersectionRatio >= AUTOPLAY_THRESHOLD) {
        // ── Card is ≥60 % visible ───────────────────────────────────────
        if (!wrap._videoMounted) {
          mountPreviewVideo(wrap, card);  // first time: inject <video>
        } else {
          const v = wrap.querySelector('.card-preview-video');
          if (v && v.paused) {
            v.play().catch(() => {});
          }
        }
      } else {
        // ── Card exited viewport ────────────────────────────────────────
        const v = wrap.querySelector('.card-preview-video');
        if (v) {
          v.pause();
          // Fully out of view → free the network connection
          if (entry.intersectionRatio === 0) {
            v.classList.remove('is-playing');
            v.removeAttribute('src');
            v.load(); // abort pending request
            wrap._videoMounted = false;
          }
        }
      }
    });
  }, {
    // Fire at 0 % (fully left) and at the autoplay threshold
    threshold: [0, AUTOPLAY_THRESHOLD]
  });
}

/**
 * Inject a muted looping <video> into the card media wrapper, then
 * crossfade it over the static previewImage once the first frame is ready.
 * No-ops silently if previewVideo is empty.
 */
function mountPreviewVideo(wrap, card) {
  if (!card.previewVideo) return; // no loop clip → stay as static image

  // Guard against double-mount on rapid scrolling
  wrap._videoMounted = true;

  const img     = wrap.querySelector('.card-preview-img');
  const overlay = wrap.querySelector('.card-overlay');

  const v = document.createElement('video');
  v.className   = 'card-preview-video';
  v.muted       = true;
  v.loop        = true;
  v.playsInline = true;
  v.preload     = 'none';
  v.setAttribute('playsinline', '');

  // Insert before overlay so z-order is: img → video → overlay
  wrap.insertBefore(v, overlay || null);

  v.onerror = () => {
    // Network / codec error — quietly keep the static image
    v.remove();
    wrap._videoMounted = false;
  };

  // Assign src AFTER element creation so preload="none" is honoured
  v.src = card.previewVideo;

  v.addEventListener('canplay', () => {
    v.play()
      .then(() => {
        v.classList.add('is-playing'); // fade in the video
        if (img) {
          // Fade out and remove the static image
          img.style.opacity = '0';
          img.addEventListener('transitionend', () => img.remove(), { once: true });
        }
      })
      .catch(() => {});
  }, { once: true });
}

/**
 * Register a .card-media wrapper with the shared autoplay observer.
 * Only called for video-type cards.
 */
function watchCardMedia(wrap, card) {
  wrap._card = card;
  autoplayObserver.observe(wrap);
}

// ═══════════════════════════════════════════════════════
//  CARD MEDIA BUILDERS
// ═══════════════════════════════════════════════════════

function applyFallback(wrap, card) {
  // Don't add twice (e.g. if img and video both error)
  if (wrap.querySelector('.card-media-fallback')) return;
  wrap.style.background = card.fallbackGradient;
  const fb = document.createElement('div');
  fb.className   = 'card-media-fallback';
  fb.textContent = card.fallbackEmoji;
  wrap.appendChild(fb);
}

/**
 * Build the card grid preview wrapper.
 *
 * Video cards
 *   • Render a static <img class="card-preview-img"> using previewImage.
 *   • The autoplay observer upgrades it to a looping <video> when ≥60 % visible.
 *   • No previewImage  → fallback gradient immediately.
 *   • No previewVideo  → static image only, never autoplays.
 *
 * Image cards
 *   • Standard lazy <img>.
 */
function buildCardPreview(card) {
  const sizeClass = card.size === 'tall' ? ' tall'
                  : card.size === 'wide' ? ' wide' : '';
  const wrap = document.createElement('div');
  wrap.className = `card-media${sizeClass}`;

  if (card.mediaType === 'video') {
    if (card.previewImage) {
      const img = document.createElement('img');
      img.className = 'card-preview-img';
      img.src       = card.previewImage;
      img.alt       = card.title;
      img.loading   = 'lazy';
      img.onerror   = () => applyFallback(wrap, card);
      wrap.appendChild(img);
    } else {
      // No static thumbnail at all
      applyFallback(wrap, card);
    }
    // Register for viewport-based autoplay (only if there's a loop clip)
    if (card.previewVideo) watchCardMedia(wrap, card);

  } else {
    // Plain image card
    const img = document.createElement('img');
    img.src     = card.mediaSrc;
    img.alt     = card.title;
    img.loading = 'lazy';
    img.onerror = () => applyFallback(wrap, card);
    wrap.appendChild(img);
  }

  return wrap;
}

/**
 * Build the detail-page media block.
 * Always uses fullVideo (never the loop clip).
 * User controls playback via native controls.
 */
function buildDetailMedia(card) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-media';

  const fallback = () => {
    wrap.style.background = card.fallbackGradient;
    const fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:3.5rem;';
    fb.textContent   = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    const src = card.fullVideo || '';
    if (src) {
      const v = document.createElement('video');
      v.src         = src;
      v.controls    = true;
      v.muted       = false; // user-facing: allow sound
      v.playsInline = true;
      v.onerror     = fallback;
      wrap.appendChild(v);
    } else if (card.previewImage) {
      // fullVideo absent – at least show the thumbnail
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
//  CARD DOM BUILDER
// ═══════════════════════════════════════════════════════
function buildCard(card, animDelay = 0) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.animationDelay = `${animDelay}s`;
  if (card.mediaType === 'video') el.classList.add('card--video');

  // Media preview wrapper (registers autoplay observer internally)
  const mediaWrap = buildCardPreview(card);

  // Hover overlay
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  // Play icon — video cards only
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

  // Text body
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

  // Interaction
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click',   ()  => openDetail(card.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(card.id); });

  return el;
}

// ═══════════════════════════════════════════════════════
//  MASONRY LAYOUT
// ═══════════════════════════════════════════════════════
function getColCount() {
  const grid = document.getElementById('cardsGrid');
  const raw  = getComputedStyle(grid).getPropertyValue('--cols').trim();
  const n    = parseInt(raw, 10);
  return (isNaN(n) || n < 1) ? 4 : n;
}

/** Estimated rendered height of one card (used for column-balance arithmetic) */
function estimatedCardHeight(card, colW) {
  const BODY_H = 82;
  const GAP    = 16;
  let mediaH;
  if      (card.size === 'tall') mediaH = colW * (4 / 3);  // 3/4 portrait
  else if (card.size === 'wide') mediaH = colW * (9 / 16); // 16/9 landscape
  else                           mediaH = colW * (3 / 4);  // 4/3 default
  return mediaH + BODY_H + GAP;
}

/**
 * Append a batch of card objects into the existing masonry columns,
 * placing each card into the currently shortest column.
 * Does NOT clear the grid — call resetGrid() first when starting over.
 */
function appendBatch(batch) {
  const grid = document.getElementById('cardsGrid');
  const cols = Array.from(grid.querySelectorAll('.masonry-col'));
  if (!cols.length) return;

  // Seed heights from real DOM so new cards join in the right column
  const heights = cols.map(c => c.getBoundingClientRect().height || 0);
  const colW    = cols[0].getBoundingClientRect().width || 300;

  batch.forEach((card, i) => {
    const minIdx = heights.indexOf(Math.min(...heights));
    const el     = buildCard(card, i * 0.04);
    cols[minIdx].appendChild(el);
    heights[minIdx] += estimatedCardHeight(card, colW);
  });
}

/**
 * Tear down the grid completely and rebuild the correct number of
 * empty .masonry-col elements, ready for the first appendBatch() call.
 */
function resetGrid() {
  // Disconnect autoplay observer so out-going video elements release resources
  if (autoplayObserver) autoplayObserver.disconnect();
  createAutoplayObserver(); // fresh observer for the new batch

  const grid     = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  const colCount = getColCount();
  for (let i = 0; i < colCount; i++) {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    grid.appendChild(col);
  }
}

// ═══════════════════════════════════════════════════════
//  LAZY LOAD — sentinel-based infinite scroll
// ═══════════════════════════════════════════════════════

function removeSentinel() {
  if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
  document.getElementById('sprtk-sentinel')?.remove();
}

/**
 * Insert a 1 px sentinel element immediately after #cardsGrid.
 * When it enters the viewport (300 px root-margin = pre-fetch buffer),
 * the next batch of cards is appended.
 */
function attachSentinel() {
  removeSentinel();
  if (renderedCount >= filteredSource.length) return; // nothing left to load

  const sentinel = document.createElement('div');
  sentinel.id    = 'sprtk-sentinel';
  document.getElementById('cardsGrid').insertAdjacentElement('afterend', sentinel);

  sentinelObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadNextBatch();
  }, { rootMargin: '300px' });

  sentinelObserver.observe(sentinel);
}

/** Render the next BATCH_SIZE cards from filteredSource */
function loadNextBatch() {
  const batch = filteredSource.slice(renderedCount, renderedCount + BATCH_SIZE);
  if (!batch.length) { removeSentinel(); return; }

  appendBatch(batch);
  renderedCount += batch.length;
  attachSentinel(); // re-attach (or remove if exhausted)
}

// ═══════════════════════════════════════════════════════
//  RENDER / FILTER
// ═══════════════════════════════════════════════════════

function computeSource() {
  if (!activeFilter) {
    return shuffle(allCards);                                           // no filter → shuffled all
  } else if (activeFilter === 'all') {
    return [...allCards];                                               // "Последнее" → JSON order
  } else {
    return shuffle(allCards.filter(c => c.category === activeFilter)); // category → shuffled subset
  }
}

/**
 * Full render — called on initial load, filter change, or column-count change.
 * Resets pagination and starts from batch 0.
 */
function renderCards() {
  removeSentinel();
  resetGrid();

  filteredSource = computeSource();
  renderedCount  = 0;

  loadNextBatch(); // first BATCH_SIZE cards appear immediately
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

  // Create the autoplay observer early so it exists before loadCards()
  createAutoplayObserver();

  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.page));
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Clicking the active filter again → clear it (back to shuffled all)
      const next = btn.dataset.filter === activeFilter ? null : btn.dataset.filter;
      applyFilter(next);
    });
  });

  document.getElementById('backBtn').addEventListener('click', () => navigateTo('explore'));

  // Reflow masonry when the viewport crosses a CSS breakpoint
  let lastColCount = 0;
  const resizeObs = new ResizeObserver(() => {
    if (!allCards.length) return;
    const newCount = getColCount();
    if (newCount !== lastColCount) {
      lastColCount = newCount;
      renderCards(); // full re-render with correct column count
    }
  });
  resizeObs.observe(document.getElementById('cardsGrid'));

  loadCards();
}

document.addEventListener('DOMContentLoaded', init);
