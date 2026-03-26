'use strict';

// ═══════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════
const BATCH_SIZE         = 20;   // cards per render batch
const PREFETCH_AHEAD     = 5;    // start prefetch when last N cards become visible
const DOM_MAX            = 50;   // target maximum live card nodes
const DOM_TRIM_AFTER     = 60;   // trim when DOM card count exceeds this
const AUTOPLAY_THRESHOLD = 0.70; // 70 % of card visible → play preview video
const SENTINEL_MARGIN    = '300px'; // rootMargin for infinite-scroll sentinel

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let allCards      = [];
let activeFilter  = null;   // null = shuffled | 'all' = json order | category string
let currentTheme  = localStorage.getItem('sprtk-theme') || 'dark';

let filteredSource  = [];   // full ordered array for current filter
let renderedCount   = 0;    // how many items from filteredSource are in the DOM
let prefetchedBatch = null; // pre-built data array, ready to render instantly

// ═══════════════════════════════════════════════════════
//  LAZY WIDGET CONFIG
//  Each entry matches a page id → the <script> attributes
//  that Mobifitness needs. The script is injected only once,
//  the first time the user navigates to that page.
// ═══════════════════════════════════════════════════════
const WIDGET_CONFIG = {
  schedule: {
    id:       'mobifitness_personal_widget_script_exl',
    div:      'mf_schedule_widget_cont_exl',
    type:     'schedule',
    code:     '667017',
    club:     null,
  },
  shop: {
    id:       'mobifitness_personal_widget_script_859',
    div:      'mf_shop_widget_cont_859',
    type:     'shop',
    code:     '667017',
    club:     '6009',
  },
  training: {
    id:       'mobifitness_personal_widget_script_8gd',
    div:      'mf_personalBook_widget_cont_8gd',
    type:     'personalBook',
    code:     '667017',
    club:     null,
  },
  account: {
    id:       'mobifitness_personal_widget_script_tnl',
    div:      'mf_personal_widget_cont_tnl',
    type:     'personal',
    code:     '667017',
    club:     null,
  },
};

function loadWidgetIfNeeded(pageId) {
  var cfg = WIDGET_CONFIG[pageId];
  if (!cfg) return;                              // page has no widget
  if (document.getElementById(cfg.id)) return;  // already injected

  var s = document.createElement('script');
  s.type  = 'text/javascript';
  s.async = true;
  s.id    = cfg.id;
  s.src   = '//mobifitness.ru/personal-widget/js/code.js';
  s.setAttribute('data-div',      cfg.div);
  s.setAttribute('data-test',     '0');
  s.setAttribute('data-debug',    '0');
  s.setAttribute('data-domain',   'mobifitness.ru');
  s.setAttribute('data-code',     cfg.code);
  s.setAttribute('data-version',  'v6');
  s.setAttribute('data-type',     cfg.type);
  s.setAttribute('data-language', '');
  if (cfg.club) s.setAttribute('data-club', cfg.club);

  document.body.appendChild(s);
}

let autoplayObserver = null;
let sentinelObserver = null;
let prefetchObserver = null;
let spinnerEl        = null;

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
//  NAVIGATION + HISTORY API  (req 5, 6, 7)
// ═══════════════════════════════════════════════════════
function pauseAllVideosIn(pageEl) {
  if (!pageEl) return;
  pageEl.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
}

function navigateTo(pageId, pushHistory) {
  if (pushHistory === undefined) pushHistory = true;

  // Pause all media in the page we are leaving
  document.querySelectorAll('.page.active').forEach(p => pauseAllVideosIn(p));

  // Save scroll position when leaving Explore
  if (document.getElementById('page-explore').classList.contains('active')) {
    sessionStorage.setItem('sprtk-scroll', String(window.scrollY));
  }

  // Swap active page + nav tab
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  const tab  = document.querySelector('.nav-tab[data-page="' + pageId + '"]');
  if (page) page.classList.add('active');
  if (tab)  tab.classList.add('active');

  // Lazy-load the third-party widget for this page (no-op if already loaded)
  loadWidgetIfNeeded(pageId);

  // History API
  if (pushHistory) {
    history.pushState({ pageId: pageId }, '', '#' + pageId);
  }

  // Scroll handling
  if (pageId === 'explore') {
    const saved = sessionStorage.getItem('sprtk-scroll');
    if (saved !== null) {
      requestAnimationFrame(function() {
        window.scrollTo({ top: parseInt(saved, 10), behavior: 'instant' });
      });
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Browser back / forward
window.addEventListener('popstate', function(e) {
  var pageId = (e.state && e.state.pageId) ? e.state.pageId : 'explore';
  navigateTo(pageId, false);
});

// ═══════════════════════════════════════════════════════
//  AUTOPLAY OBSERVER
// ═══════════════════════════════════════════════════════
function createAutoplayObserver() {
  if (autoplayObserver) autoplayObserver.disconnect();
  var thresholds = Array.from({ length: 21 }, function(_, i) { return i / 20; });
  autoplayObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      var wrap = entry.target;
      var card = wrap._card;
      if (!card || card.mediaType !== 'video' || !card.previewVideo) return;

      if (entry.intersectionRatio >= AUTOPLAY_THRESHOLD) {
        if (!wrap._videoMounted) {
          mountPreviewVideo(wrap, card);
        } else {
          var v = wrap.querySelector('.card-preview-video');
          if (v && v.paused) v.play().catch(function() {});
        }
      } else {
        unmountPreviewVideo(wrap, card);
      }
    });
  }, { threshold: thresholds });
}

// ═══════════════════════════════════════════════════════
//  PREVIEW VIDEO MOUNT / UNMOUNT
// ═══════════════════════════════════════════════════════
function mountPreviewVideo(wrap, card) {
  if (!card.previewVideo || wrap._videoMounted) return;
  wrap._videoMounted = true;

  var img     = wrap.querySelector('.card-preview-img');
  var overlay = wrap.querySelector('.card-overlay');

  var v = document.createElement('video');
  v.className   = 'card-preview-video';
  v.muted       = true;
  v.loop        = true;
  v.playsInline = true;
  v.preload     = 'auto';
  v.setAttribute('playsinline', '');
  wrap.insertBefore(v, overlay || null);

  v.onerror = function() { v.remove(); wrap._videoMounted = false; };
  v.src = card.previewVideo;

  v.addEventListener('canplay', function() {
    v.play().catch(function() {});
    if (img) {
      img.style.opacity = '0';
      img.dataset.hidden = '1';
    }
  }, { once: true });
}

function unmountPreviewVideo(wrap, card) {
  if (!wrap._videoMounted) return;
  var v = wrap.querySelector('.card-preview-video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }
  wrap._videoMounted = false;

  var img = wrap.querySelector('.card-preview-img');
  if (img) {
    img.style.opacity = '1';
    delete img.dataset.hidden;
  } else if (card.previewImage) {
    var overlay = wrap.querySelector('.card-overlay');
    var newImg = document.createElement('img');
    newImg.className = 'card-preview-img';
    newImg.src = card.previewImage;
    newImg.alt = card.title;
    newImg.loading = 'lazy';
    newImg.onerror = function() { applyFallback(wrap, card); };
    wrap.insertBefore(newImg, overlay || null);
  }
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
  var fb = document.createElement('div');
  fb.className   = 'card-media-fallback';
  fb.textContent = card.fallbackEmoji;
  wrap.appendChild(fb);
}

// ═══════════════════════════════════════════════════════
//  CARD PREVIEW MEDIA
// ═══════════════════════════════════════════════════════
function buildCardPreview(card) {
  var sizeClass = card.size === 'tall' ? ' tall' : card.size === 'wide' ? ' wide' : '';
  var wrap = document.createElement('div');
  wrap.className = 'card-media' + sizeClass;

  if (card.mediaType === 'video') {
    if (card.previewImage) {
      var img = document.createElement('img');
      img.className = 'card-preview-img';
      img.src       = card.previewImage;
      img.alt       = card.title;
      img.loading   = 'lazy';
      img.onerror   = function() { applyFallback(wrap, card); };
      wrap.appendChild(img);
    } else {
      applyFallback(wrap, card);
    }
    if (card.previewVideo) watchCardMedia(wrap, card);
  } else {
    var img2 = document.createElement('img');
    img2.src     = card.mediaSrc;
    img2.alt     = card.title;
    img2.loading = 'lazy';
    img2.onerror = function() { applyFallback(wrap, card); };
    wrap.appendChild(img2);
  }
  return wrap;
}

// ═══════════════════════════════════════════════════════
//  HLS ATTACH  (req 4)
// ═══════════════════════════════════════════════════════
function attachHls(videoEl, src, onError) {
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    var hls = new Hls({ enableWorker: true });
    hls.loadSource(src);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.ERROR, function(_, data) {
      if (data.fatal) { hls.destroy(); if (onError) onError(); }
    });
    videoEl._hls = hls;
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = src; // Safari native HLS
  } else if (onError) {
    onError();
  }
}

// ═══════════════════════════════════════════════════════
//  DETAIL MEDIA
// ═══════════════════════════════════════════════════════
function buildDetailMedia(card) {
  var wrap = document.createElement('div');
  wrap.className = 'detail-media';

  var fallback = function() {
    wrap.style.background = card.fallbackGradient;
    var fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:200px;font-size:3.5rem;';
    fb.textContent = card.fallbackEmoji;
    wrap.appendChild(fb);
  };

  if (card.mediaType === 'video') {
    var hlsSrc = card.hls || '';
    var mp4Src = card.fullVideo || '';

    if (hlsSrc || mp4Src) {
      var v = document.createElement('video');
      v.controls    = true;
      v.playsInline = true;
      v.onerror     = fallback;
      wrap.appendChild(v);

      if (hlsSrc) {
        attachHls(v, hlsSrc, fallback);
      } else {
        v.src = mp4Src;
      }
    } else if (card.previewImage) {
      var img = document.createElement('img');
      img.src     = card.previewImage;
      img.alt     = card.title;
      img.onerror = fallback;
      wrap.appendChild(img);
    } else {
      fallback();
    }
  } else {
    var img2 = document.createElement('img');
    img2.src     = card.mediaSrc;
    img2.alt     = card.title;
    img2.onerror = fallback;
    wrap.appendChild(img2);
  }
  return wrap;
}

// ═══════════════════════════════════════════════════════
//  CARD BUILDER
// ═══════════════════════════════════════════════════════
function buildCard(card, animDelay) {
  if (animDelay === undefined) animDelay = 0;
  var el = document.createElement('article');
  el.className = 'card';
  el.dataset.cardId = card.id;
  el.style.animationDelay = animDelay + 's';
  if (card.mediaType === 'video') el.classList.add('card--video');

  var mediaWrap = buildCardPreview(card);
  var overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  mediaWrap.appendChild(overlay);
  el.appendChild(mediaWrap);

  var body = document.createElement('div');
  body.className = 'card-body';
  var title = document.createElement('h3');
  title.className   = 'card-title';
  title.textContent = card.title;
  var desc = document.createElement('p');
  desc.className   = 'card-desc';
  desc.textContent = card.desc;
  body.appendChild(title);
  body.appendChild(desc);
  el.appendChild(body);

  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click',   function() { openDetail(card.id); });
  el.addEventListener('keydown', function(e) { if (e.key === 'Enter') openDetail(card.id); });

  return el;
}

// ═══════════════════════════════════════════════════════
//  MASONRY
// ═══════════════════════════════════════════════════════
function getColCount() {
  var grid = document.getElementById('cardsGrid');
  var raw  = getComputedStyle(grid).getPropertyValue('--cols').trim();
  var n    = parseInt(raw, 10);
  return (isNaN(n) || n < 1) ? 4 : n;
}

function estimatedCardHeight(card, colW) {
  var BODY_H = 82, GAP = 16, mediaH;
  if      (card.size === 'tall') mediaH = colW * (4 / 3);
  else if (card.size === 'wide') mediaH = colW * (9 / 16);
  else                           mediaH = colW * (3 / 4);
  return mediaH + BODY_H + GAP;
}

function getLiveColumns() {
  return Array.from(document.getElementById('cardsGrid').querySelectorAll('.masonry-col'));
}

function appendBatch(batch) {
  var cols = getLiveColumns();
  if (!cols.length) return;
  var heights = cols.map(function(c) { return c.getBoundingClientRect().height || 0; });
  var colW    = cols[0].getBoundingClientRect().width || 300;

  batch.forEach(function(card, i) {
    var minIdx = heights.indexOf(Math.min.apply(null, heights));
    var el = buildCard(card, i * 0.04);
    cols[minIdx].appendChild(el);
    heights[minIdx] += estimatedCardHeight(card, colW);
  });
}

// ═══════════════════════════════════════════════════════
//  DOM VIRTUALISATION  (req 3)
// ═══════════════════════════════════════════════════════
function liveCardCount() {
  return document.getElementById('cardsGrid').querySelectorAll('.card').length;
}

function trimOldCards() {
  var cols = getLiveColumns();
  if (!cols.length) return;
  var count = liveCardCount();

  while (count > DOM_MAX) {
    // Remove from the column with the most cards (keeps balance)
    var longestCol = cols[0];
    cols.forEach(function(c) {
      if (c.children.length > longestCol.children.length) longestCol = c;
    });

    var firstCard = longestCol.querySelector('.card');
    if (!firstCard) break;

    var mediaWrap = firstCard.querySelector('.card-media');
    if (mediaWrap) {
      if (autoplayObserver) autoplayObserver.unobserve(mediaWrap);
      var vid = mediaWrap.querySelector('.card-preview-video');
      if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
    }
    firstCard.remove();
    count--;
  }
}

// ═══════════════════════════════════════════════════════
//  PREFETCH  (req 2)
// ═══════════════════════════════════════════════════════
function prefetchNextBatch() {
  if (prefetchedBatch) return;
  if (renderedCount >= filteredSource.length) return;
  prefetchedBatch = filteredSource.slice(renderedCount, renderedCount + BATCH_SIZE);
}

function attachPrefetchObserver() {
  if (prefetchObserver) { prefetchObserver.disconnect(); prefetchObserver = null; }
  var allDom = Array.from(document.getElementById('cardsGrid').querySelectorAll('.card'));
  if (allDom.length < PREFETCH_AHEAD) return;
  var lastFew = allDom.slice(-PREFETCH_AHEAD);

  prefetchObserver = new IntersectionObserver(function(entries) {
    if (entries.some(function(e) { return e.isIntersecting; })) {
      prefetchNextBatch();
      prefetchObserver.disconnect();
      prefetchObserver = null;
    }
  }, { rootMargin: '200px' });

  lastFew.forEach(function(el) { prefetchObserver.observe(el); });
}

// ═══════════════════════════════════════════════════════
//  INFINITE SCROLL SENTINEL  (req 1)
// ═══════════════════════════════════════════════════════
function showSpinner() {
  if (spinnerEl) return;
  spinnerEl = document.createElement('div');
  spinnerEl.className = 'scroll-spinner';
  spinnerEl.id = 'sprtk-spinner';
  document.getElementById('cardsGrid').insertAdjacentElement('afterend', spinnerEl);
}

function hideSpinner() {
  if (spinnerEl) { spinnerEl.remove(); spinnerEl = null; }
}

function detachSentinel() {
  if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
  var s = document.getElementById('sprtk-sentinel');
  if (s) s.remove();
}

function attachSentinel() {
  detachSentinel();
  if (renderedCount >= filteredSource.length) return;

  var sentinel = document.createElement('div');
  sentinel.id = 'sprtk-sentinel';
  document.getElementById('cardsGrid').insertAdjacentElement('afterend', sentinel);

  sentinelObserver = new IntersectionObserver(function(entries) {
    if (!entries[0].isIntersecting) return;
    renderNextBatch();
  }, { rootMargin: SENTINEL_MARGIN });

  sentinelObserver.observe(sentinel);
}

function renderNextBatch() {
  if (renderedCount >= filteredSource.length) {
    detachSentinel();
    hideSpinner();
    return;
  }

  showSpinner();

  var batch = prefetchedBatch || filteredSource.slice(renderedCount, renderedCount + BATCH_SIZE);
  prefetchedBatch = null;

  appendBatch(batch);
  renderedCount += batch.length;

  hideSpinner();

  if (liveCardCount() > DOM_TRIM_AFTER) trimOldCards();

  attachSentinel();
  attachPrefetchObserver();
}

// ═══════════════════════════════════════════════════════
//  GRID RESET + RENDER
// ═══════════════════════════════════════════════════════
function resetGrid() {
  if (autoplayObserver) autoplayObserver.disconnect();
  if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
  if (prefetchObserver) { prefetchObserver.disconnect(); prefetchObserver = null; }
  detachSentinel();
  hideSpinner();
  prefetchedBatch = null;

  createAutoplayObserver();

  var grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  var colCount = getColCount();
  for (var i = 0; i < colCount; i++) {
    var col = document.createElement('div');
    col.className = 'masonry-col';
    grid.appendChild(col);
  }
}

function computeSource() {
  if (!activeFilter) {
    return shuffle(allCards);
  } else if (activeFilter === 'all') {
    return allCards.slice();
  } else {
    return shuffle(allCards.filter(function(c) { return c.category === activeFilter; }));
  }
}

function renderCards() {
  resetGrid();
  filteredSource = computeSource();
  renderedCount  = 0;
  renderNextBatch();
}

function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderCards();
}

// ═══════════════════════════════════════════════════════
//  DETAIL PAGE
// ═══════════════════════════════════════════════════════

/** Destroy any active HLS instances and pause all videos inside el */
function cleanDetailContent(el) {
  el.querySelectorAll('video').forEach(function(v) {
    if (!v.paused) v.pause();
    if (v._hls) { v._hls.destroy(); delete v._hls; }
  });
}

/**
 * Build the fixed chrome (hero: media + scrim + category + title) that
 * always appears at the top of the detail view, regardless of content source.
 * Layout: full-bleed image/video with gradient scrim, title overlaid at bottom.
 */
function buildDetailChrome(card, content) {
  var isVideo = card.mediaType === 'video';

  // Hero wrapper
  var hero = document.createElement('div');
  hero.className = 'detail-hero ' + (isVideo ? 'detail-hero--video' : 'detail-hero--image');

  // Media element (image or video)
  var mediaWrap = document.createElement('div');
  mediaWrap.className = 'detail-media';

  var fallback = function() {
    hero.style.background = card.fallbackGradient;
    var fb = document.createElement('div');
    fb.className = 'card-media-fallback';
    fb.style.cssText = 'min-height:220px;display:flex;align-items:center;justify-content:center;font-size:4rem;';
    fb.textContent = card.fallbackEmoji;
    // Insert fallback before scrim
    var scrim = hero.querySelector('.detail-hero__scrim');
    hero.insertBefore(fb, scrim);
    mediaWrap.remove();
  };

  if (isVideo) {
    var hlsSrc = card.hls || '';
    var mp4Src = card.fullVideo || '';
    if (hlsSrc || mp4Src) {
      var v = document.createElement('video');
      v.controls    = true;
      v.playsInline = true;
      v.onerror     = fallback;
      mediaWrap.appendChild(v);
      if (hlsSrc) {
        attachHls(v, hlsSrc, fallback);
      } else {
        v.src = mp4Src;
      }
    } else if (card.previewImage) {
      var img = document.createElement('img');
      img.src     = card.previewImage;
      img.alt     = card.title;
      img.onerror = fallback;
      mediaWrap.appendChild(img);
    } else {
      // Will show fallback via the function above — but we need mediaWrap in DOM first
      setTimeout(fallback, 0);
    }
  } else {
    var img2 = document.createElement('img');
    img2.src     = card.mediaSrc;
    img2.alt     = card.title;
    img2.onerror = fallback;
    mediaWrap.appendChild(img2);
  }
  hero.appendChild(mediaWrap);

  // Scrim with category + title overlaid
  var scrim = document.createElement('div');
  scrim.className = 'detail-hero__scrim';

  var metaRow = document.createElement('div');
  metaRow.className = 'detail-hero__meta';
  var catTag = document.createElement('span');
  catTag.className   = 'detail-category';
  catTag.textContent = card.categoryLabel;
  metaRow.appendChild(catTag);
  scrim.appendChild(metaRow);

  var title = document.createElement('h2');
  title.className   = 'detail-title';
  title.textContent = card.title;
  scrim.appendChild(title);

  hero.appendChild(scrim);
  content.appendChild(hero);
}

/**
 * Render fallback fullDesc text as the content body.
 */
function renderFullDesc(card, content) {
  if (card.fullDesc) {
    var inner = document.createElement('div');
    inner.className = 'detail-content__inner';
    var p = document.createElement('p');
    p.className = 'detail-text';
    p.textContent = card.fullDesc;
    inner.appendChild(p);
    content.appendChild(inner);
  }
}

/**
 * Show a loading skeleton while the external HTML is being fetched.
 * Returns the placeholder element so it can be replaced when ready.
 */
function showDetailLoader(content) {
  var loader = document.createElement('div');
  loader.className = 'detail-loader';
  loader.id = 'detailLoader';
  loader.innerHTML =
    '<div class="detail-loader__bar"></div>' +
    '<div class="detail-loader__bar detail-loader__bar--short"></div>' +
    '<div class="detail-loader__bar"></div>' +
    '<div class="detail-loader__bar detail-loader__bar--med"></div>';
  content.appendChild(loader);
  return loader;
}

function removeDetailLoader() {
  var l = document.getElementById('detailLoader');
  if (l) l.remove();
}

/**
 * Fetch external HTML and inject it into the detail container.
 * Falls back to fullDesc on network/HTTP failure.
 */
async function loadContentUrl(card, content) {
  var loader = showDetailLoader(content);
  try {
    var res = await fetch(card.contentUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var html = await res.text();
    removeDetailLoader();
    var inner = document.createElement('div');
    inner.className = 'detail-content__inner';
    inner.innerHTML = html;
    content.appendChild(inner);
  } catch (err) {
    console.warn('contentUrl fetch failed:', err);
    removeDetailLoader();
    if (card.fullDesc) {
      renderFullDesc(card, content);
    } else {
      var errMsg = document.createElement('p');
      errMsg.className = 'detail-error';
      errMsg.textContent = 'Не удалось загрузить материал. Попробуйте позже.';
      content.appendChild(errMsg);
    }
  }
}

function openDetail(id) {
  var card = allCards.find(function(c) { return c.id === id; });
  if (!card) return;

  var content = document.getElementById('detailContent');

  // Clean up previous content before wiping DOM
  cleanDetailContent(content);
  content.innerHTML = '';

  // Always render the fixed chrome first (media + category + title)
  buildDetailChrome(card, content);

  // Content body: contentUrl takes priority, falls back to fullDesc
  if (card.contentUrl) {
    loadContentUrl(card, content);
  } else {
    renderFullDesc(card, content);
  }

  navigateTo('detail');
}

// ═══════════════════════════════════════════════════════
//  DATA LOAD
// ═══════════════════════════════════════════════════════
async function loadCards() {
  try {
    var res = await fetch('https://02369308-20f2-403b-9d43-e4f5d2b3e445.selstorage.ru/cards.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
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

  // Set initial history state so popstate always has a state object
  history.replaceState({ pageId: 'explore' }, '', '#explore');

  document.getElementById('themeToggle').addEventListener('click', function() {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() { navigateTo(tab.dataset.page); });
  });

  // Clickable logo → Explore  (req 6)
  var logoHome = document.getElementById('logoHome');
  if (logoHome) {
    var goHome = function() { navigateTo('explore'); };
    logoHome.addEventListener('click', goHome);
    logoHome.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') goHome();
    });
  }

  // Back button on detail page — clean up HLS before returning
  document.getElementById('backBtn').addEventListener('click', function() {
    cleanDetailContent(document.getElementById('detailContent'));
    navigateTo('explore');
  });

  // Filters
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var next = btn.dataset.filter === activeFilter ? null : btn.dataset.filter;
      applyFilter(next);
    });
  });

  // Reflow masonry on breakpoint change
  var lastColCount = 0;
  var resizeObs = new ResizeObserver(function() {
    if (!allCards.length) return;
    var newCount = getColCount();
    if (newCount !== lastColCount) {
      lastColCount = newCount;
      renderCards();
    }
  });
  resizeObs.observe(document.getElementById('cardsGrid'));

  loadCards();
}

document.addEventListener('DOMContentLoaded', init);
