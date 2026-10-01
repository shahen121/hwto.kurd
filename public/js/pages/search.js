/**
 * pages/search.js — debounced search with type filters and pagination.
 *
 * The page owns its input so typing never re-mounts the view: app.js routes
 * "same page, new query" calls into onRoute() instead of a full remount.
 * "Load More" does NOT change the URL (keeps #/search?q=... stable).
 */

import { api } from '../api.js';
import * as ui from '../ui.js';
import { CONFIG, LIMITS } from '../config.js';
import { debounce, escapeHtml } from '../utils.js';
import { navigate } from '../router.js';
import { rememberMany } from '../store.js';

const isAbort = (err) => Boolean(err && err.name === 'AbortError');

const TABS = [
  { value: '', label: 'الكل' },
  { value: 'movie', label: 'أفلام' },
  { value: 'tv', label: 'مسلسلات' }
];

const EMPTY_HINT = 'جرّب: أكشن، دراما، أو اسم فيلم معروف';

let pageSignal = null;
let runCtrl = null;
let handler = null;

function syncHeaderInput(value) {
  const input = document.getElementById('global-search');
  if (input && document.activeElement !== input && input.value !== value) input.value = value;
}

function hashFor(q, type) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  const s = params.toString();
  return s ? `#/search?${s}` : '#/search';
}

function emptyPrompt() {
  return ui.emptyState('اكتب كلمة لبدء البحث في المكتبة.', {
    title: 'ابحث عن عنوان',
    hint: EMPTY_HINT
  });
}

export async function mount(params, view, { signal }) {
  pageSignal = signal;
  handler = null;

  const q = params.q || '';
  const type = params.type || '';

  view.innerHTML = `
    <div class="container page search-page">
      ${ui.pageHeader('البحث', { subtitle: 'ابحث داخل مكتبة الأفلام والمسلسلات' })}

      <div class="search-box">
        <span class="search-box-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
        </span>
        <input id="search-input" class="search-input" type="search" placeholder="اكتب اسم فيلم أو مسلسل…"
               value="${escapeHtml(q)}" autocomplete="off" enterkeyhint="search"
               aria-label="حقل البحث">
        <button class="search-clear" id="search-clear" type="button" aria-label="مسح البحث" ${q ? '' : 'hidden'}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>

      <div class="tabs" role="tablist" aria-label="نوع النتائج">
        ${TABS.map(
          (tab) => `
          <button class="tab ${tab.value === type ? 'is-active' : ''}" role="tab"
                  aria-selected="${tab.value === type}" data-type="${tab.value}" type="button">
            ${escapeHtml(tab.label)}
          </button>`
        ).join('')}
      </div>

      <div id="search-results" class="search-results" aria-live="polite"></div>
    </div>`;

  ui.hydrate(view);

  const input = view.querySelector('#search-input');
  const clearBtn = view.querySelector('#search-clear');
  const results = view.querySelector('#search-results');
  const tabs = Array.from(view.querySelectorAll('.tab'));

  // State: items accumulate across pages, page tracks API response
  const state = { q, type, page: 1, items: [], totalPages: 1, totalResults: 0, hasMore: false, loading: false };

  const setTabs = (nextType) => {
    tabs.forEach((tab) => {
      const active = (tab.dataset.type || '') === nextType;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  };

  const renderResults = (list, append = false, newItems = []) => {
    if (append) {
      const grid = results.querySelector('.movie-grid');
      if (grid && newItems.length) {
        grid.insertAdjacentHTML('beforeend', ui.movieGrid(newItems));
        ui.hydrate(grid);
      }
      const countEl = results.querySelector('.results-count');
      if (countEl) {
        countEl.innerHTML = `تم العثور على <strong>${state.items.length}</strong> نتيجة من ${state.totalResults}`;
      }
      const btn = results.querySelector('#load-more-btn');
      if (btn) {
        btn.hidden = !state.hasMore;
        btn.disabled = false;
        btn.textContent = 'عرض المزيد';
      }
      return;
    }

    // Full render (first page or new query)
    if (!list.items.length) {
      const scope = state.type ? (state.type === 'tv' ? ' في المسلسلات' : ' في الأفلام') : '';
      results.innerHTML = ui.emptyState(`لا توجد نتائج تطابق «${state.q}»${scope}.`, {
        title: 'لا نتائج',
        hint: 'جرّب كلمة أقصر أو أزِل تصفية النوع.'
      });
      return;
    }

    const shown = list.items.slice(0, LIMITS.search.max);
    results.innerHTML = `
      <p class="results-count">تم العثور على <strong>${shown.length}</strong> نتيجة${state.totalResults ? ` من ${state.totalResults}` : ''}</p>
      ${ui.movieGrid(shown)}
      ${list.hasMore ? `<button class="btn btn-primary load-more-btn" id="load-more-btn" type="button">عرض المزيد</button>` : ''}
    `;
    ui.hydrate(results);
  };

  const run = async (nextPage = 1, append = false) => {
    if (state.loading) return;
    if (runCtrl) runCtrl.abort();
    runCtrl = new AbortController();
    const localSignal = runCtrl.signal;
    const onOuterAbort = () => runCtrl.abort();
    if (pageSignal) pageSignal.addEventListener('abort', onOuterAbort, { once: true });

    const query = state.q.trim();
    clearBtn.hidden = !state.q;

    if (!query) {
      results.innerHTML = emptyPrompt();
      return;
    }

    if (!append) {
      results.innerHTML = ui.loadingBlock('جارٍ البحث…');
    } else {
      const btn = results.querySelector('#load-more-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'جارٍ التحميل…';
      }
    }

    state.loading = true;

    try {
      const list = await api.search({ q: query, type: state.type, page: nextPage, signal: localSignal });
      if (localSignal.aborted) return;

      // Update state
      if (append) {
        const existingKeys = new Set(state.items.map(item => `${item.mediaType}:${item.id}`));
        const newItems = list.items.filter(item => !existingKeys.has(`${item.mediaType}:${item.id}`));
        state.items.push(...newItems);

        state.page = list.page;
        state.totalPages = list.totalPages;
        state.totalResults = list.totalResults;
        state.hasMore = list.hasMore;

        renderResults(list, true, newItems);
      } else {
        state.items = list.items;
        state.page = list.page;
        state.totalPages = list.totalPages;
        state.totalResults = list.totalResults;
        state.hasMore = list.hasMore;

        renderResults(list, false);
      }
    } catch (err) {
      if (isAbort(err) || localSignal.aborted) return;
      if (!append) {
        results.innerHTML = ui.errorState(err && err.message, { onRetry: true, retryId: 'search-retry' });
        const retry = results.querySelector('#search-retry');
        if (retry) retry.addEventListener('click', () => run(1, false));
      } else {
        const btn = results.querySelector('#load-more-btn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'عرض المزيد';
        }
      }
    } finally {
      state.loading = false;
      if (pageSignal) pageSignal.removeEventListener('abort', onOuterAbort);
    }
  };

  const requested = { q, type };

  const applyQuery = (nextQ) => {
    if (nextQ === requested.q) return;
    requested.q = nextQ;
    navigate(hashFor(nextQ, requested.type), { replace: true });
  };

  const applyType = (nextType) => {
    if (nextType === requested.type) return;
    requested.type = nextType;
    navigate(hashFor(requested.q, nextType), { replace: true });
  };

  const debouncedSearch = debounce((value) => applyQuery(value), CONFIG.searchDebounce);

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    debouncedSearch(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      debouncedSearch.cancel();
      applyQuery(input.value);
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
    debouncedSearch.cancel();
    applyQuery('');
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => applyType(tab.dataset.type || ''));
  });

  // Load more button - does NOT change URL
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('#load-more-btn');
    if (btn && state.hasMore && !state.loading) {
      run(state.page + 1, true);
    }
  });

  // Called by app.js when the route changes but the page stays on `search`.
  handler = (next) => {
    const nextQ = next.q || '';
    const nextType = next.type || '';
    const changed = nextQ !== state.q || nextType !== state.type;
    state.q = nextQ;
    state.type = nextType;
    requested.q = nextQ;
    requested.type = nextType;
    if (document.activeElement !== input && input.value !== nextQ) input.value = nextQ;
    syncHeaderInput(nextQ);
    setTabs(nextType);
    if (changed) run(1, false);
  };

  if (q) run(1, false);
  else results.innerHTML = emptyPrompt();
}

export function onRoute(next) {
  if (handler) handler(next);
}