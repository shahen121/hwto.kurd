/**
 * utils.js — pure helpers: escaping, formatting, image URLs, lazy loading.
 * No network calls here (that is api.js's job only).
 */

import { CONFIG, GENRES, LANGUAGES, COUNTRIES } from './config.js';

/* ------------------------------ escaping ------------------------------ */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function attr(value) {
  return escapeHtml(value);
}

/**
 * `url('…')` for a CSS declaration.
 * attr() alone is not enough inside style="…": HTML entities are decoded
 * before the CSS parser runs, so a quote or control character coming from an
 * API-provided path could close the CSS string. Control characters are
 * stripped and backslashes/quotes are CSS-escaped here; the caller still runs
 * the result through attr() so the HTML attribute itself stays safe.
 */
export function cssUrl(value) {
  const raw = String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  return `url('${raw}')`;
}

/* ------------------------------ debounce ------------------------------ */

export function debounce(fn, wait = CONFIG.searchDebounce) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/* ------------------------------ formatting ---------------------------- */

const AR_NUM = new Intl.NumberFormat('ar-EG');

export function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return AR_NUM.format(Math.round(num));
}

export function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1_000_000) return `${AR_NUM.format(Math.round(num / 100_000) / 10)} مليون`;
  if (num >= 1000) return `${AR_NUM.format(Math.round(num / 100) / 10)} ألف`;
  return AR_NUM.format(num);
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export function formatDate(value) {
  if (!value) return '';
  const str = String(value);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return str;
  const year = m[1];
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!month || month < 1 || month > 12) return year;
  return `${AR_NUM.format(day)} ${MONTHS[month - 1]} ${year}`;
}

export function yearOf(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})/);
  return m ? m[1] : '';
}

export function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(1);
}

export function ratingPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / 10) * 100)));
}

/* ------------------------- labels / lookup tables --------------------- */

export function genreNames(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => GENRES[id]).filter(Boolean);
}

export function languageName(code) {
  if (!code) return '';
  return LANGUAGES[code] || code;
}

export function countryName(code) {
  if (!code) return '';
  return COUNTRIES[code] || code;
}

export function mediaLabel(type) {
  return type === 'tv' ? 'مسلسل' : 'فيلم';
}

export function mediaPlural(type) {
  return type === 'tv' ? 'المسلسلات' : 'الأفلام';
}

export function detailHref(item) {
  const type = item.mediaType === 'tv' ? 'tv' : 'movie';
  return `#/${type}/${item.id}`;
}

export function watchHref(item) {
  if (!item) return '#/';
  const type = item.mediaType === 'tv' ? 'tv' : 'movie';
  const q = new URLSearchParams();
  if (item.title) q.set('title', item.title);
  const s = q.toString();
  return `#/watch/${type}/${item.id}${s ? `?${s}` : ''}`;
}

/* ------------------------------ images -------------------------------- */

export function posterUrl(item) {
  if (!item) return '';
  if (item.posterPath) return `${CONFIG.tmdbImg}/${CONFIG.posterSize}${item.posterPath}`;
  if (item.dbPhoto) return CONFIG.localImg + String(item.dbPhoto).replace(/^\/+/, '');
  return '';
}

export function backdropUrl(item) {
  if (!item || !item.backdropPath) return '';
  return `${CONFIG.tmdbImg}/${CONFIG.backdropSize}${item.backdropPath}`;
}

/** Larger backdrop for the hero; falls back to the poster when unavailable. */
export function heroImage(item) {
  return backdropUrl(item) || posterUrl(item) || '';
}

let observer = null;
const LAZY_ATTR = 'data-src';

function getObserver() {
  if (observer) return observer;
  if (!('IntersectionObserver' in window)) return null;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        observer.unobserve(el);
        const src = el.getAttribute(LAZY_ATTR);
        if (src) {
          el.setAttribute('src', src);
          el.removeAttribute(LAZY_ATTR);
        }
      }
    },
    { rootMargin: '240px 0px' }
  );
  return observer;
}

/** Build a lazy <img>: the real URL lives in data-src until scrolled near. */
export function lazyImage(src, alt, { className = '', eager = false, ratio } = {}) {
  const cls = ['lazy-img', className].filter(Boolean).join(' ');
  const style = ratio ? ` style="aspect-ratio:${ratio}"` : '';
  const safeAlt = escapeHtml(alt || '');
  if (!src) {
    return `<div class="poster-fallback ${className}"${style} aria-hidden="true"><span>لا توجد صورة</span></div>`;
  }
  if (eager) {
    return `<img class="${cls}" src="${attr(src)}" alt="${safeAlt}" loading="eager" decoding="async"${style}>`;
  }
  return `<img class="${cls}" data-src="${attr(src)}" alt="${safeAlt}" loading="lazy" decoding="async"${style}>`;
}

/** Wire up every .lazy-img[data-src] inside `root` (called after each render). */
export function hydrateLazyImages(root) {
  if (!root) return;
  const io = getObserver();
  const imgs = root.querySelectorAll('img[data-src]');
  for (const img of imgs) {
    if (io) io.observe(img);
    else {
      img.setAttribute('src', img.getAttribute(LAZY_ATTR));
      img.removeAttribute(LAZY_ATTR);
    }
  }
}

/** Placeholder shimmer while an image loads; removes itself on load/error. */
export function attachImageFallbacks(root) {
  if (!root) return;
  root.querySelectorAll('img.lazy-img, img[data-src]').forEach((img) => {
    if (img.dataset.bound === '1') return;
    img.dataset.bound = '1';

    // An <img> with no src yet reports `complete === true`, so only trust it
    // when the element actually has a src attribute.
    const hasSrc = Boolean(img.getAttribute('src'));
    if (hasSrc && img.complete) {
      if (img.naturalWidth > 0) img.classList.add('is-loaded');
      else markBroken(img);
      return;
    }

    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => markBroken(img), { once: true });
  });
}

function markBroken(img) {
  img.classList.add('is-broken');
  const parent = img.parentElement;
  if (parent) parent.classList.add('img-missing');
  img.style.visibility = 'hidden';
}
