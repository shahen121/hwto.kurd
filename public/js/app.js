/**
 * app.js — bootstrap: shell, router, page lifecycle (one AbortController per
 * navigation so a stale request can never overwrite a fresh view), header
 * search and the mobile menu.
 */

import './config.js';
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
    const type = route.type === 'tv' ? 'مسلسلات' : 'أفلام';
    if (route.section === 'trending') return `الرائجة: ${type} — hwto.kurd`;
    if (route.section === 'upcoming') return 'أفلام قادمة — hwto.kurd';
    if (route.section === 'toprated') return `الأعلى تقييماً: ${type} — hwto.kurd`;
    if (route.section === 'site') return `مكتبة الموقع: ${type} — hwto.kurd`;
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

function closeMenu() {
  const header = document.getElementById('site-header');
  const toggle = document.getElementById('nav-toggle');
  if (header) header.classList.remove('is-open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === '/' && document.activeElement === document.body) {
      const input = document.getElementById('global-search');
      if (input) {
        e.preventDefault();
        input.focus();
      }
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
