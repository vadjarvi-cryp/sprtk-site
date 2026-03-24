/* ===========================
   ABOUT SECTION — JS ADDITIONS
   Add this code at the bottom of app.js
=========================== */

// ─── ABOUT: Animated counter ───────────────────────────────
function animateCounter(el, target, suffix, duration) {
  var start = 0;
  var startTime = null;
  var isLarge = target > 100;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    // ease out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(eased * target);
    el.textContent = (isLarge && current >= 1000)
      ? (current >= 1000 ? current.toLocaleString('ru') : current) + suffix
      : current + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString('ru') + suffix;
  }
  requestAnimationFrame(step);
}

function initAboutStats() {
  var items = document.querySelectorAll('.about-stats__item');
  if (!items.length) return;

  var observed = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      var item   = entry.target;
      var target = parseInt(item.dataset.target, 10);
      var suffix = item.dataset.suffix || '';
      var numEl  = item.querySelector('.about-stats__number');
      if (numEl && !item._counted) {
        item._counted = true;
        animateCounter(numEl, target, suffix, 1800);
      }
      observed.unobserve(item);
    });
  }, { threshold: 0.4 });

  items.forEach(function(item) { observed.observe(item); });
}

// ─── ABOUT: Floating particles ─────────────────────────────
function initAboutParticles() {
  var container = document.getElementById('aboutParticles');
  if (!container) return;
  var count = 18;
  for (var i = 0; i < count; i++) {
    var span = document.createElement('span');
    var left  = (Math.random() * 100).toFixed(1) + '%';
    var dur   = (6 + Math.random() * 8).toFixed(1) + 's';
    var delay = (Math.random() * 8).toFixed(1) + 's';
    var drift = ((Math.random() - 0.5) * 60).toFixed(0) + 'px';
    span.style.cssText = 'left:' + left + ';--dur:' + dur + ';--delay:' + delay + ';--drift:' + drift + ';';
    container.appendChild(span);
  }
}

// ─── ABOUT: Lightbox ───────────────────────────────────────
var lbImages  = [];
var lbCurrent = 0;

function openLightbox(index) {
  lbCurrent = index;
  renderLightbox();
  document.getElementById('aboutLightbox').classList.add('active');
  document.getElementById('lightboxBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('aboutLightbox').classList.remove('active');
  document.getElementById('lightboxBackdrop').classList.remove('active');
  document.body.style.overflow = '';
}

function renderLightbox() {
  var img     = document.getElementById('lightboxImg');
  var caption = document.getElementById('lightboxCaption');
  var data    = lbImages[lbCurrent];
  if (!data) return;
  img.src = data.src;
  img.alt = data.alt;
  caption.textContent = data.alt;
}

function initAboutLightbox() {
  var gallery = document.getElementById('aboutGallery');
  if (!gallery) return;

  var items = gallery.querySelectorAll('.about-gallery__item');
  lbImages = [];

  items.forEach(function(item, i) {
    var imgEl = item.querySelector('img');
    lbImages.push({
      src: item.dataset.src || (imgEl ? imgEl.src : ''),
      alt: imgEl ? imgEl.alt : ''
    });
    item.addEventListener('click', function() { openLightbox(i); });
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') openLightbox(i);
    });
  });

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightboxBackdrop').addEventListener('click', closeLightbox);

  document.getElementById('lightboxPrev').addEventListener('click', function() {
    lbCurrent = (lbCurrent - 1 + lbImages.length) % lbImages.length;
    renderLightbox();
  });

  document.getElementById('lightboxNext').addEventListener('click', function() {
    lbCurrent = (lbCurrent + 1) % lbImages.length;
    renderLightbox();
  });

  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('aboutLightbox').classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') {
      lbCurrent = (lbCurrent - 1 + lbImages.length) % lbImages.length;
      renderLightbox();
    }
    if (e.key === 'ArrowRight') {
      lbCurrent = (lbCurrent + 1) % lbImages.length;
      renderLightbox();
    }
  });
}

// ─── INIT ABOUT ────────────────────────────────────────────
// Called when the About page becomes active
function initAboutPage() {
  if (document.getElementById('aboutParticles')) {
    initAboutParticles();
    initAboutStats();
    initAboutLightbox();
  }
}

// Hook into nav — trigger about init when tab is clicked
document.addEventListener('DOMContentLoaded', function() {
  var aboutTab = document.querySelector('.nav-tab[data-page="about"]');
  if (aboutTab) {
    aboutTab.addEventListener('click', function() {
      // slight delay so the page is visible
      setTimeout(initAboutPage, 100);
    });
  }
  // Also init if about is already active (e.g. direct load via hash)
  if (window.location.hash === '#about') {
    setTimeout(initAboutPage, 200);
  }
});
