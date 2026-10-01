/**
 * pages/list.js — every browse page (trending / upcoming / top rated / site).
 * Supports real page-based pagination (load-more fetches next page from API).
 */

import { api } from '../api.js';
import * as ui from '../ui.js';
import { LIMITS } from '../config.js';
import { rememberMany } from '../store.js';

const isAbort = (err) => Boolean(err && err.name === 'AbortError');

const SECTIONS = {
  trending: {
    title: (type) => (type === 'tv' ? 'المسلسلات الرائجة' : 'الأفلام الرائجة'),
    subtitle: 'ما يشاهده الجمهور الآن',
    initial: LIMITS.trending.initial,
    max: LIMITS.trending.max,
    fetch: ({ type, limit, page, signal }) => api.getTrending({ type, limit, page, signal })
  },
  upcoming: {
    title: () => 'أفلام قادمة',
    subtitle: 'إصدارات على وشك الوصول',
    initial: LIMITS.upcoming.initial,
    max: LIMITS.upcoming.max,
    fetch: ({ type, limit, page, signal }) => api.getUpcoming({ limit, page, signal })
  },
  toprated: {
    title: (type) => (type === 'tv' ? 'المسلسلات الأعلى تقييماً' : 'الأفلام الأعلى تقييماً'),
    subtitle: 'حسب تقييم الجمهور',
    initial: 0,
    max: 0,
    fetch: ({ type, limit, page, signal }) => api.getTopRated({ type, limit, page, signal })
  },
  site: {
    title: (type) => (type === 'tv' ? 'مسلسلات مكتبة الموقع' : type === 'movie' ? 'أفلام مكتبة الموقع' : 'مكتبة الموقع'),
    subtitle: 'محتوى محفوظ في قاعدة بيانات الموقع',
    initial: LIMITS.myContent.initial,
    max: LIMITS.myContent.max,
    fetch: ({ type, limit, page, signal }) => api.getMyContent({ type, limit, page, signal })
  }
};

function limitsFor(section, type) {
  if (section === 'toprated') {
    return type === 'tv'
      ? { initial: LIMITS.topRatedTv.initial, max: LIMITS.topRatedTv.max }
      : { initial: LIMITS.topRatedMovie.initial, max: LIMITS.topRatedMovie.max };
  }
  const cfg = SECTIONS[section];
  return { initial: cfg.initial, max: cfg.max };
}

const dedupe = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.mediaType}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

function sortItems(items, sortBy) {
  const list = [...items];
  if (sortBy === 'rating') {
    return list.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
  }
  if (sortBy === 'date') {
    return list.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  }
  if (sortBy === 'title') {
    return list.sort((a, b) => String(a.title || '').localeCompare(String(a.title || ''), 'ar'));
  }
  return list;
}

export async function mount(params, view, { signal }) {
  const section = SECTIONS[params.section] ? params.section : 'trending';
  const cfg = SECTIONS[section];
  const type = params.type || '';
  const { initial, max } = limitsFor(section, type);
  const title = cfg.title(type);

  // State: page-based pagination
  const state = {
    all: [],
    shown: 0,
    page: 1,
    totalPages: 1,
    totalResults: 0,
    hasMore: false,
    loading: false,
    sort: 'default'
  };

  view.innerHTML = `
    <div class="container page">
      ${ui.pageHeader(title, { subtitle: cfg.subtitle, meta: '<span id="list-meta"></span>' })}
      <div class="list-sort-bar">
        <span class="sort-label">ترتيب حسب:</span>
        <button class="btn-sort is-active" type="button" data-sort="default">الافتراضي</button>
        <button class="btn-sort" type="button" data-sort="rating">★ الأعلى تقييماً</button>
        <button class="btn-sort" type="button" data-sort="date">📅 الأحدث</button>
        <button class="btn-sort" type="button" data-sort="title">🔤 أبجدياً</button>
      </div>
      <div id="list-body">${ui.skeletonGrid(section === 'site' ? 8 : max)}</div>
    </div>`;
  ui.hydrate(view);

  const body = view.querySelector('#list-body');
  const meta = view.querySelector('#list-meta');

  // Wire sort buttons
  view.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-sort');
      if (mode === state.sort) return;
      state.sort = mode;
      view.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('is-active', b === btn));
      paint();
    });
  });

  const paint = () => {
    const sorted = sortItems(state.all, state.sort);
    const visible = sorted.slice(0, state.shown);
    if (!visible.length) {
      body.innerHTML = ui.emptyState('لم يُعثر على أي عنوان في هذا القسم.', {
        title: 'لا يوجد محتوى',
        hint: 'قد تكون البيانات قيد التحديث، أعد المحاولة بعد قليل.'
      });
      return;
    }
    const canLoadMore = state.hasMore && !state.loading;
    body.innerHTML =
      ui.movieGrid(visible, { showRank: (section === 'trending' || section === 'toprated') && state.sort === 'default' }) +
      ui.loadMoreButton({ id: 'list-more', label: 'عرض المزيد', hidden: !canLoadMore });
    ui.hydrate(body);
    if (meta) {
      meta.textContent = `عرض ${visible.length} من ${state.totalResults || state.all.length} عنوان`;
    }
    const btn = body.querySelector('#list-more');
    if (btn) btn.addEventListener('click', onLoadMore);
  };

  const fetchPage = async (page) => {
    const list = await cfg.fetch({ type, limit: initial, page, signal });
    const items = list.items;
    if (type) rememberMany(type, items);
    else {
      rememberMany('movie', items.filter((i) => i.mediaType === 'movie'));
      rememberMany('tv', items.filter((i) => i.mediaType === 'tv'));
    }
    return { items, hasMore: list.hasMore, totalPages: list.totalPages, totalResults: list.totalResults };
  };

  const onLoadMore = async () => {
    if (state.loading || !state.hasMore) return;

    // There are already-fetched items waiting below the fold — reveal them.
    if (state.shown < state.all.length) {
      state.shown = Math.min(state.all.length, state.shown + initial);
      paint();
      return;
    }

    state.loading = true;
    const btn = body.querySelector('#list-more');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جارٍ التحميل…';
    }

    const nextPage = state.page + 1;
    try {
      const { items, hasMore, totalPages, totalResults } = await fetchPage(nextPage);
      state.page = nextPage;
      state.totalPages = totalPages || 1;
      state.totalResults = totalResults || 0;
      state.hasMore = hasMore;
      const existingIds = new Set(state.all.map(i => `${i.mediaType}:${i.id}`));
      const newItems = items.filter(i => !existingIds.has(`${i.mediaType}:${i.id}`));
      state.all = dedupe([...state.all, ...newItems]);
      state.shown = Math.min(state.all.length, state.shown + initial);
    } catch (err) {
      if (isAbort(err)) return;
      state.loading = false;
      ui.showToast(err && err.message ? err.message : 'تعذّر تحميل المزيد');
      paint();
      return;
    }
    state.loading = false;
    paint();
  };

  // Initial load
  try {
    const { items, hasMore, totalPages, totalResults } = await fetchPage(1);
    state.page = 1;
    state.totalPages = totalPages || 1;
    state.totalResults = totalResults || 0;
    state.hasMore = hasMore;
    state.all = dedupe(items);
  } catch (err) {
    if (isAbort(err)) return;
    body.innerHTML = ui.errorState(err && err.message, { onRetry: true });
    const retry = body.querySelector('.btn');
    if (retry) retry.addEventListener('click', () => window.dispatchEvent(new CustomEvent('app:reload')));
    return;
  }

  state.shown = Math.min(state.all.length, initial);
  paint();
}