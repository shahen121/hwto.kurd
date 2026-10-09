/**
 * app.js — bootstrap: shell, router, page lifecycle (one AbortController per
 * navigation so a stale request can never overwrite a fresh view), header
 * search and the mobile menu.
 */

import { CATEGORIES } from './config.js';
import { renderShell, setNavActive, hydrate, showToast, errorState, emptyState } from './ui.js';
import { startRouter, navigate } from './router.js';
import { debounce } from './utils.js';
import * as home from './pages/home.js';
import * as list from './pages/list.js';
import * as search from './pages/search.js';
import * as details from './pages/details.js';
import * as watch from './pages/watch.js';

const PAGES = { home, list, search, details, watch };

const TITLES = {
  home: 'hwto.kurd — أفلام ومسلسلات',
  search: 'البحث — hwto.kurd',
  notfound: 'صفحة غير موجودة — hwto.kurd'
};

function titleFor(route) {
  if (route.name === 'list') {
    // `type` is optional (e.g. the mixed #/site library) — never label it "أفلام".
    const type = route.type === 'tv' ? 'مسلسلات' : route.type === 'movie' ? 'أفلام' : '';
    const withType = (label) => `${label}${type ? `: ${type}` : ''} — hwto.kurd`;
    if (route.section === 'trending') return withType('الرائجة');
    if (route.section === 'upcoming') return 'أفلام قادمة — hwto.kurd';
    if (route.section === 'toprated') return withType('الأعلى تقييماً');
    if (route.section === 'site') return withType('مكتبة الموقع');
    if (route.section === 'category') {
      const cat = CATEGORIES[route.category];
      return `${cat ? cat.title : 'التصنيفات'} — hwto.kurd`;
    }
  }
  // The detail page replaces this with the real title once it has rendered.
  if (route.name === 'details') return `${route.type === 'tv' ? 'مسلسل' : 'فيلم'} — hwto.kurd`;
  if (route.name === 'watch') return `مشاهدة — hwto.kurd`;
  return TITLES[route.name] || TITLES.home;
}

const view = () => document.getElementById('app-view');

let current = null;

/* ------------------------- scroll restoration ------------------------- */

// The browser's native restoration runs before the async render finishes, so
// it always lands in the wrong place. We remember the offset per hash and
// replay it once the route has actually been mounted.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const scrollMemo = new Map();
let viewHash = location.hash || '#/';
let rendering = false;

window.addEventListener(
  'scroll',
  () => {
    if (rendering) return;
    scrollMemo.set(viewHash, window.scrollY);
  },
  { passive: true }
);

function notFoundHtml(path) {
  return `<div class="container page">${emptyState(`المسار «${path || '/'}» غير معروف.`, {
    title: '404 — لا توجد صفحة هنا',
    hint: 'عد إلى الرئيسية أو استخدم البحث.'
  })}</div>`;
}

async function render(route, { force = false } = {}) {
  const module = PAGES[route.name];

  // Same logical page, new query (e.g. typing in search) — update in place.
  if (!force && current && current.module === module && module && module.onRoute) {
    current.params = route;
    viewHash = location.hash || '#/';
    setNavActive(route);
    document.title = titleFor(route);
    module.onRoute(route);
    return;
  }

  if (current && current.ctrl) current.ctrl.abort();
  const ctrl = new AbortController();
  current = { name: route.name, params: route, ctrl, module };
  rendering = true;
  viewHash = location.hash || '#/';

  setNavActive(route);
  document.title = titleFor(route);
  closeMenu();

  const el = view();
  if (!el) return;

  try {
    if (!module) {
      el.innerHTML = notFoundHtml(route.path);
      hydrate(el);
    } else {
      await module.mount(route, el, { signal: ctrl.signal });
    }
  } catch (err) {
    if (current && current.ctrl === ctrl) rendering = false;
    if (err && err.name === 'AbortError') return;
    if (ctrl.signal.aborted) return;
    el.innerHTML = `<div class="container page">${errorState(err && err.message, { onRetry: true, retryId: 'page-retry' })}</div>`;
    const retry = el.querySelector('#page-retry');
    if (retry) retry.addEventListener('click', () => reload());
    return;
  }

  if (current && current.ctrl === ctrl) rendering = false;
  if (ctrl.signal.aborted) return;
  if (route._keepScroll) return;
  // Replay where the user was: 0 for a first visit, the saved offset when
  // coming back (browser back/forward or an internal link to a seen route).
  window.scrollTo({ top: scrollMemo.get(viewHash) || 0, behavior: 'auto' });
}

function reload() {
  const route = current && current.params ? current.params : { name: 'home' };
  render({ ...route }, { force: true });
}

window.addEventListener('app:reload', reload);

/* ------------------------------ header menu ---------------------------- */

/* «التصنيفات» dropdown (desktop) / accordion (stacked, ≤860px).
   The panel is absolutely positioned against `.site-nav`, so its coordinates
   are recomputed every time it opens (nav scroll, resize, hover). */
function dropEls() {
  const drop = document.querySelector('.nav-drop');
  if (!drop) return null;
  return {
    drop,
    toggle: drop.querySelector('.nav-drop-toggle'),
    panel: drop.querySelector('.nav-drop-panel'),
    host: document.getElementById('site-nav')
  };
}

const isStackedNav = () => window.matchMedia('(max-width: 860px)').matches;

function positionDrop() {
  const el = dropEls();
  if (!el || !el.toggle || !el.panel || !el.host) return;
  if (isStackedNav()) {
    el.panel.style.left = '';
    el.panel.style.top = '';
    return;
  }
  const t = el.toggle.getBoundingClientRect();
  const h = el.host.getBoundingClientRect();
  const w = el.panel.offsetWidth;
  const left = Math.min(Math.max(t.right - w - h.left, 0), Math.max(0, h.width - w));
  el.panel.style.left = `${Math.round(left)}px`;
  el.panel.style.top = `${Math.round(t.bottom - h.top + 8)}px`;
}

function openDrop() {
  const el = dropEls();
  if (!el || !el.toggle || !el.drop) return;
  el.drop.classList.add('is-open');
  el.toggle.setAttribute('aria-expanded', 'true');
  positionDrop();
}

// Set while the panel is pinned open by a click: hover may then open it, but
// only the next click / Escape / route change closes it again.
let dropPinned = false;

function closeDrop() {
  const el = dropEls();
  dropPinned = false;
  if (!el || !el.toggle || !el.drop) return;
  el.drop.classList.remove('is-open');
  el.toggle.setAttribute('aria-expanded', 'false');
}

function closeMenu() {
  const header = document.getElementById('site-header');
  const toggle = document.getElementById('nav-toggle');
  if (header) header.classList.remove('is-open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  closeDrop();
}

function wireHeader() {
  const header = document.getElementById('site-header');
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');

  if (toggle && header) {
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  if (nav) {
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeMenu();
    });
  }

  // Dropdown behaviour.
  const drop = document.querySelector('.nav-drop');
  if (drop) {
    const dropToggle = drop.querySelector('.nav-drop-toggle');
    const hoverable = window.matchMedia('(hover: hover) and (pointer: fine)');

    if (dropToggle) {
      dropToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (drop.classList.contains('is-open')) {
          // Hover may have opened it — the first click pins it instead of
          // closing it, so a click right after hovering keeps the menu up.
          if (dropPinned) closeDrop();
          else dropPinned = true;
        } else {
          openDrop();
          dropPinned = true;
        }
      });
    }
    if (hoverable.matches) {
      drop.addEventListener('mouseenter', () => {
        if (!dropPinned) openDrop();
      });
      drop.addEventListener('mouseleave', () => {
        if (!dropPinned) closeDrop();
      });
    }
    document.addEventListener('click', (e) => {
      if (!drop.contains(e.target)) closeDrop();
    });
    window.addEventListener('resize', () => closeDrop());
    const list = nav.querySelector('.nav-list');
    if (list) {
      list.addEventListener('scroll', () => {
        if (drop.classList.contains('is-open')) positionDrop();
      }, { passive: true });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === '/' && document.activeElement === document.body) {
      const input = document.getElementById('global-search');
      if (!input) return;
      // Small screens keep the search collapsed (visibility:hidden) until the
      // menu opens — reveal it first so focus lands on something visible.
      if (!input.getClientRects().length) {
        const header = document.getElementById('site-header');
        const toggle = document.getElementById('nav-toggle');
        if (header) header.classList.add('is-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
      e.preventDefault();
      input.focus();
    }
  });

  const form = document.getElementById('header-search');
  const input = document.getElementById('global-search');
  if (!form || !input) return;

  const go = (value) => {
    const q = String(value || '').trim();
    if (!q) {
      if (location.hash.startsWith('#/search')) navigate('#/search', { replace: true });
      return;
    }
    navigate({ name: 'search', q, type: current && current.name === 'search' ? current.params.type || '' : '' }, { replace: true });
  };

  const debounced = debounce((value) => {
    const q = String(value || '').trim();
    const onSearch = location.hash.startsWith('#/search');
    if (q.length >= 2 || (onSearch && q.length === 0)) go(q);
  }, 400);

  input.addEventListener('input', () => debounced(input.value));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    debounced.cancel();
    go(input.value);
    input.blur();
  });
}

/* --------------------------------- boot -------------------------------- */

function boot() {
  const root = document.getElementById('app');
  if (!root) return;
  renderShell(root);
  wireHeader();
  hydrate(root);
  startRouter((route) => render(route));
  window.addEventListener('hashchange', () => closeMenu());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
