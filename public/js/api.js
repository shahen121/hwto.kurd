/**
 * api.js — the single place where EVERY request to the kurdcinama.com
 * TMDB cache API happens. No other module may call fetch() for API data.
 *
 * Response shapes below were verified against the live API, not assumed:
 *
 *   ?action=trending[&type=][&limit=]
 *     -> {results:[{id,title,poster_path,backdrop_path,vote_average,
 *                  release_date,overview,media_type,rank,local_id,local_photo}],
 *         total, cached}
 *     NOTE: the `type` argument is IGNORED by the server — the same mixed
 *           list comes back for movie/tv/all. Filtering is done here, locally.
 *
 *   ?action=upcoming[&limit=]
 *     -> same row shape but ALWAYS media_type:"movie", no rank/local_id.
 *        20 by default, hard cap 40. `type` is NOT supported.
 *
 *   ?action=toprated[&type=][&limit=]
 *     -> {results:[...], total, cached}
 *        BUG (verified): with type=movie the `id` field does NOT match the
 *        title (id=11 is returned for "The Shawshank Redemption", whose real
 *        TMDB id is 278). With type=tv, `title` and `release_date` come back
 *        EMPTY. The UNFILTERED ?action=toprated&limit=100 list is correct
 *        (20 movies + 9 tv, real ids, media_type set), so that is the only
 *        source used: fetch it once and filter by `media_type` here.
 *
 *   ?action=search&q=..[&type=]
 *     -> {results:[...], total, cached} — `type` IS honoured here.
 *        No `limit` parameter exists for search; results are returned whole.
 *
 *   ?action=mycontent[&type=][&limit=]
 *     -> {results:[{db_id,id,title,poster_path,backdrop_path,vote_average,
 *                  release_date,overview,db_photo,media_type,in_database}],
 *         total, cached}
 *        `limit` is PER TYPE: omitted type returns 2x(limit) rows.
 *        `poster_path` is frequently "" — `db_photo` must be used instead.
 *
 *   ?action=stats
 *     -> {movies,tv_shows,trending,upcoming,top_rated,
 *         oldest_cache,newest_cache}
 *
 *   ?action=movie&id=N / ?action=tv&id=N
 *     -> movie: {id,title,original_title,overview,poster_path,backdrop_path,
 *                release_date,vote_average,vote_count,popularity,
 *                original_language,genre_ids,cached}
 *        tv:    {id,name,original_name,overview,poster_path,backdrop_path,
 *                first_air_date,vote_average,vote_count,popularity,
 *                original_language,genre_ids,origin_country,cached}
 *        `genre_ids` is a comma-separated STRING of numbers, never names.
 *        Movie details carry NO country field at all.
 *        Unknown id -> HTTP 200 with {"error":"..."} — never an HTTP error.
 *
 *   ?action=servers[&movieid=][&title=][&tmdbid=]
 *     -> {movieid, servers:[{key,label,url}], cached} | {error:"..."}
 *        Alternate Kurdish embed servers scraped server-side by our own
 *        proxy (never by the browser). Needs either `movieid`, or `title`
 *        / `tmdbid` so the proxy can resolve the site's own movie id.
 *        Empty `servers` is a valid answer — the VidCore player keeps
 *        working, so callers must treat failures as "no alternates".
 *
 *   NOTE — there is NO genre / country / language action: list rows never
 *     carry `genre_ids`, so "الأفلام" / "المسلسلات" are slices of the lists
 *     above, while "أنمي" / "آسيوية" come from the frozen collections in
 *     categories_data.js (getCategory() below) and need no request at all.
 */

import { CONFIG, LIMITS } from './config.js';
import { cacheGet, cacheSet, cacheKey, runOnce } from './cache.js';
import { CATEGORY_ITEMS } from './categories_data.js';
import {
  FALLBACK_STATS,
  FALLBACK_TRENDING,
  FALLBACK_UPCOMING,
  FALLBACK_TOPRATED,
  FALLBACK_LIBRARY
} from './catalog_data.js';

export class ApiError extends Error {
  constructor(message, { code = 'unknown', status = 0, retriable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { signal, timeout }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' }
    });

    if (!res.ok) {
      // 429 (rate limited) is worth retrying after the backoff; the limit is
      // per-minute, so a couple of short retries usually clears it.
      throw new ApiError(`تعذّر الاتصال بالخادم (${res.status})`, {
        code: 'http',
        status: res.status,
        retriable: res.status >= 500 || res.status === 429
      });
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('استجابة غير صالحة من الخادم', { code: 'parse', retriable: true });
    }

    // The API reports failures with HTTP 200 + {"error": "..."}.
    if (json && typeof json === 'object' && typeof json.error === 'string') {
      throw new ApiError(json.error, { code: 'api', retriable: false });
    }

    return json;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (signal && signal.aborted) throw err;
      throw new ApiError('انتهت مهلة الاتصال، حاول مجدداً', { code: 'timeout', retriable: true });
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(err && err.message ? err.message : 'خطأ في الشبكة', {
      code: 'network',
      retriable: true
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * A caller may stop waiting (route change) without killing a request that
 * other callers are still sharing — `runOnce` dedupes by query string, so a
 * stale route aborting the socket would fail the fresh route too. The shared
 * promise keeps running and warms the cache instead.
 */
function detach(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function getCatalogFallback(params) {
  const action = params.action;
  if (action === 'stats') {
    return FALLBACK_STATS;
  }
  if (action === 'trending') {
    return FALLBACK_TRENDING;
  }
  if (action === 'upcoming') {
    const limit = Number(params.limit) || 20;
    return {
      results: FALLBACK_UPCOMING.results ? FALLBACK_UPCOMING.results.slice(0, limit) : [],
      total: FALLBACK_UPCOMING.total || 40,
      cached: true
    };
  }
  if (action === 'toprated') {
    return FALLBACK_TOPRATED;
  }
  if (action === 'mycontent') {
    const limit = Number(params.limit) || 20;
    const type = params.type;
    let list = FALLBACK_LIBRARY;
    if (type === 'movie' || type === 'tv') {
      list = list.filter((item) => item.media_type === type);
    }
    return {
      results: list.slice(0, limit),
      total: list.length,
      cached: true
    };
  }
  if (action === 'search') {
    const q = String(params.q || '').trim().toLowerCase();
    const type = params.type;
    if (!q) return { results: [], total: 0, cached: true };
    let list = FALLBACK_LIBRARY.filter((item) =>
      item.title && item.title.toLowerCase().includes(q)
    );
    if (type === 'movie' || type === 'tv') {
      list = list.filter((item) => item.media_type === type);
    }
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = 20;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    const totalPages = Math.ceil(list.length / pageSize);
    return {
      results: items,
      total: list.length,
      page,
      total_pages: totalPages,
      total_results: list.length,
      has_more: page < totalPages,
      cached: true
    };
  }
  if (action === 'movie' || action === 'tv') {
    const id = Number(params.id);
    const fromTrending = (FALLBACK_TRENDING.results || []).find((i) => i.id === id);
    if (fromTrending) return fromTrending;
    const fromTop = (FALLBACK_TOPRATED.results || []).find((i) => i.id === id);
    if (fromTop) return fromTop;
    const fromUp = (FALLBACK_UPCOMING.results || []).find((i) => i.id === id);
    if (fromUp) return fromUp;
    const fromLib = FALLBACK_LIBRARY.find((i) => i.id === id);
    if (fromLib) {
      return {
        id: fromLib.id,
        title: fromLib.title,
        name: fromLib.title,
        original_title: fromLib.title,
        original_name: fromLib.title,
        overview: 'مشاهدة مباشرة بدقة عالية عبر مشغّل hwto.kurd.',
        poster_path: fromLib.poster_path || '',
        backdrop_path: '',
        vote_average: 8.0,
        release_date: '',
        media_type: fromLib.media_type,
        db_photo: fromLib.db_photo
      };
    }
  }
  return null;
}

async function request(params, { ttl = CONFIG.cacheTTL, signal } = {}) {
  const qs = cacheKey(params);
  const cached = cacheGet(qs);
  if (cached !== undefined) return cached;

  const shared = runOnce(qs, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
      try {
        const data = await fetchJson(`${CONFIG.apiBase}?${qs}`, {
          timeout: CONFIG.requestTimeout
        });
        cacheSet(qs, data, ttl);
        return data;
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        lastErr = err;
        if (err instanceof ApiError && err.status === 403) {
          const fallback = getCatalogFallback(params);
          if (fallback) {
            cacheSet(qs, fallback, ttl);
            return fallback;
          }
        }
        const retriable = err instanceof ApiError ? err.retriable : true;
        if (!retriable || attempt === CONFIG.retries) break;
        await sleep(400 * 2 ** attempt + Math.random() * 250);
      }
    }
    if (lastErr && lastErr.status === 403) {
      const fallback = getCatalogFallback(params);
      if (fallback) {
        cacheSet(qs, fallback, ttl);
        return fallback;
      }
    }
    throw lastErr;
  });

  // Keep the shared promise "handled" even if every caller walked away.
  shared.catch(() => {});

  return detach(shared, signal);
}

/* ------------------------------------------------------------------ *
 * Normalisation — one consistent model for every screen               *
 * ------------------------------------------------------------------ */

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parseGenreIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  }
  return [];
}

function normaliseRow(row, fallbackType) {
  if (!row || row.id === undefined || row.id === null) return null;
  const mediaType =
    row.media_type === 'movie' || row.media_type === 'tv'
      ? row.media_type
      : fallbackType || 'movie';
  let title = '';
  if (typeof row.title === 'string') title = row.title.trim();
  else if (typeof row.name === 'string') title = row.name.trim();

  return {
    id: Number(row.id),
    dbId: row.db_id !== undefined && row.db_id !== null ? Number(row.db_id) : (row.local_id !== undefined && row.local_id !== null ? Number(row.local_id) : null),
    mediaType,
    title,
    overview: typeof row.overview === 'string' ? row.overview : '',
    posterPath: row.poster_path || '',
    backdropPath: row.backdrop_path || '',
    dbPhoto: row.db_photo || '',
    voteAverage: toNumber(row.vote_average),
    releaseDate: row.release_date || row.first_air_date || '',
    rank: row.rank !== undefined && row.rank !== null ? Number(row.rank) : null,
    inDatabase: row.in_database === true
  };
}

function normaliseList(json, fallbackType) {
  const rows = Array.isArray(json && json.results) ? json.results : [];
  const items = rows.map((r) => normaliseRow(r, fallbackType)).filter(Boolean);
  const page = Number(json && json.page) || 1;
  const totalPages = Number(json && json.total_pages) || 1;
  const totalResults = Number(json && json.total_results);
  return {
    items,
    total: json && json.total !== undefined ? Number(json.total) : items.length,
    page,
    totalPages,
    totalResults: Number.isFinite(totalResults) && totalResults > 0 ? totalResults : items.length,
    hasMore: json && json.has_more === true ? true : page < totalPages,
    cached: Boolean(json && json.cached)
  };
}

function normaliseDetail(json, mediaType) {
  const isTv = mediaType === 'tv';
  return {
    id: Number(json.id),
    mediaType,
    title: (isTv ? json.name : json.title) || '',
    originalTitle: (isTv ? json.original_name : json.original_title) || '',
    overview: json.overview || '',
    posterPath: json.poster_path || '',
    backdropPath: json.backdrop_path || '',
    releaseDate: (isTv ? json.first_air_date : json.release_date) || '',
    voteAverage: toNumber(json.vote_average),
    voteCount: toNumber(json.vote_count),
    language: json.original_language || '',
    // Movie details have no country field at all — only TV exposes it.
    country: isTv ? json.origin_country || '' : '',
    hasCountry: isTv && Boolean(json.origin_country),
    genreIds: parseGenreIds(json.genre_ids),
    cached: json.cached === true
  };
}

/* ------------------------------------------------------------------ *
 * Endpoints                                                           *
 * ------------------------------------------------------------------ */

export async function getTrending({ type = '', limit = LIMITS.trending.initial, page = 1, signal } = {}) {
  const params = { action: 'trending', page: Math.max(1, Math.floor(page)) };
  if (type) params.type = type;
  if (limit && Number.isFinite(Number(limit))) params.limit = limit;

  const json = await request(params, { signal });
  const list = normaliseList(json, type || null);

  const items = type ? list.items.filter((i) => i.mediaType === type) : list.items;
  return { ...list, items, serverCount: list.items.length };
}

export async function getUpcoming({ limit = LIMITS.upcoming.initial, page = 1, signal } = {}) {
  const params = { action: 'upcoming', page: Math.max(1, Math.floor(page)) };
  if (limit && Number.isFinite(Number(limit))) params.limit = limit;
  const json = await request(params, { signal });
  return normaliseList(json, 'movie');
}

export async function getTopRated({ type = '', limit = 0, page = 1, signal } = {}) {
  // NEVER send `type` here: the upstream `toprated&type=…` responses carry
  // mismatched ids / empty titles (documented in this file's header). The
  // unfiltered ?action=toprated&limit=100 list is the only reliable source —
  // fetch it once and filter by media_type locally.
  const params = { action: 'toprated', limit: 100, page: Math.max(1, Math.floor(page)) };
  const json = await request(params, { signal });
  const list = normaliseList(json, null);
  const items = type ? list.items.filter((item) => item.mediaType === type) : list.items;
  const capped = limit && Number.isFinite(Number(limit)) ? Number(limit) : 0;
  const visible = capped ? items.slice(0, capped) : items;
  return { ...list, items: visible, total: items.length, serverCount: list.items.length };
}

export async function search({ q = '', type = '', page = 1, signal } = {}) {
  const query = String(q || '').trim();
  if (!query) return { items: [], page: 1, totalPages: 1, totalResults: 0, hasMore: false, cached: false };

  const params = { action: 'search', q: query, page: Math.max(1, Math.floor(page)) };
  if (type) params.type = type;
  const json = await request(params, { signal });
  const list = normaliseList(json, type || null);
  return {
    items: list.items,
    page: json.page || 1,
    totalPages: json.total_pages || 1,
    totalResults: json.total_results || json.total || 0,
    hasMore: json.has_more || false,
    cached: list.cached
  };
}

export async function getMyContent({ type = '', limit = LIMITS.myContent.initial, page = 1, signal } = {}) {
  const params = { action: 'mycontent', page: Math.max(1, Math.floor(page)) };
  if (type) params.type = type;
  if (limit && Number.isFinite(Number(limit))) params.limit = limit;
  const json = await request(params, { signal });
  return normaliseList(json, type || null);
}

/**
 * The four «التصنيفات» screens (#/category/:slug) — the ONLY endpoint here
 * that maps to no `action=`:
 *
 *   anime / asian  → frozen rows from categories_data.js: zero requests, so
 *                    these screens render instantly and survive an upstream
 *                    outage exactly like the offline catalog does.
 *   movies / series → merged from mycontent + toprated (+ upcoming / trending),
 *                    deduped and buffered by the list page; `limit` is ignored
 *                    on purpose — the whole slice is handed over at once and
 *                    «عرض المزيد» reveals it from the buffer instead of
 *                    asking for a page the upstream does not really support.
 *
 * returns { items, totalPages } in the shape every list screen consumes.
 */
export async function getCategory({ category = '', page = 1, signal } = {}) {
  // The merged screens pull from several lists, so the same title shows up
  // more than once — collapse by media type + TMDB id (that is also what the
  // detail route keys on, so a duplicate would just be a second door to the
  // same page).
  const dedupe = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.mediaType}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const frozen = CATEGORY_ITEMS[category];
  if (Array.isArray(frozen)) {
    const list = normaliseList({ results: frozen, total: frozen.length, page: 1, total_pages: 1 }, null);
    return { ...list, items: dedupe(list.items), totalPages: 1 };
  }

  const p = Math.max(1, Math.floor(page));
  if (category === 'movies') {
    const [library, top, upcoming] = await Promise.all([
      getMyContent({ type: 'movie', limit: LIMITS.myContent.max, page: p, signal }),
      getTopRated({ type: 'movie', page: p, signal }),
      getUpcoming({ limit: LIMITS.upcoming.max, page: p, signal })
    ]);
    return { items: dedupe([...library.items, ...top.items, ...upcoming.items]), totalPages: 1 };
  }
  if (category === 'series') {
    const [library, top, trending] = await Promise.all([
      getMyContent({ type: 'tv', limit: LIMITS.myContent.max, page: p, signal }),
      getTopRated({ type: 'tv', page: p, signal }),
      getTrending({ type: 'tv', limit: LIMITS.trending.max, page: p, signal })
    ]);
    return { items: dedupe([...library.items, ...top.items, ...trending.items]), totalPages: 1 };
  }

  return { items: [], totalPages: 1 };
}

export async function getStats({ signal } = {}) {
  const json = await request({ action: 'stats' }, { ttl: CONFIG.cacheTTL, signal });
  return {
    movies: toNumber(json.movies),
    tvShows: toNumber(json.tv_shows),
    trending: toNumber(json.trending),
    upcoming: toNumber(json.upcoming),
    topRated: toNumber(json.top_rated),
    oldestCache: json.oldest_cache || '',
    newestCache: json.newest_cache || ''
  };
}

export async function getDetail(mediaType, id, { signal } = {}) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  if (!Number.isFinite(Number(id))) {
    throw new ApiError('معرّف غير صالح', { code: 'bad-id', retriable: false });
  }
  const json = await request(
    { action: type, id: Number(id) },
    { ttl: CONFIG.detailCacheTTL, signal }
  );
  return normaliseDetail(json, type);
}

/* Kurdish / embed-alternative server list scraped server-side from
 * kurdcinama.com via our same-origin proxy. Local server or self-hosted
 * deployment is required for a non-empty response — on Vercel the scrape is
 * skipped and VidCore remains the only available embed.
 *
 * params: { movieid } OR { title }
 * returns: { movieid?, servers: [{ id, name, url }], cached } */
export async function getServers({ movieid, title, tmdbid, signal } = {}) {
  const paramsObj = { action: 'servers' };
  if (movieid) paramsObj.movieid = String(movieid);
  if (title) paramsObj.title = String(title);
  if (tmdbid) paramsObj.tmdbid = String(tmdbid);

  const json = await request(paramsObj, { ttl: 10 * 60 * 1000, signal });
  return json;
}

/* ------------------------------------------------------------------ *
 * Local subtitles (public/subtitles/**) — served by our own origin.  *
 * They are NOT API data, but this module owns every fetch() in the    *
 * app, so the two loaders live here too.                              *
 * ------------------------------------------------------------------ */

const SUB_INDEX_TTL = 6 * 60 * 60 * 1000; // the index changes rarely

/** { "movie/12500": ["ku","ar","en"], … } — 4601 movies, no TV. */
export async function getSubtitleIndex({ signal } = {}) {
  const cached = cacheGet('subtitle-index');
  if (cached !== undefined) return cached;

  const res = await fetch('/subtitles/index.json', {
    signal,
    headers: { Accept: 'application/json' }
  }).catch((err) => {
    throw new ApiError(err && err.message ? err.message : 'تعذّر جلب فهرس الترجمات', {
      code: 'network',
      retriable: true
    });
  });

  if (!res.ok) {
    throw new ApiError(`تعذّر جلب فهرس الترجمات (${res.status})`, {
      code: 'http',
      status: res.status,
      retriable: res.status >= 500
    });
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw new ApiError('فهرس الترجمات غير صالح', { code: 'parse', retriable: false });
  }

  cacheSet('subtitle-index', json, SUB_INDEX_TTL);
  return json;
}

/** Raw WebVTT text for one title/language. Throws on 404 (no such file). */
export async function getSubtitleText({ type = 'movie', id, lang, signal } = {}) {
  if (!id || !lang) {
    throw new ApiError('معرّف الترجمة غير مكتمل', { code: 'bad-args', retriable: false });
  }
  const url = `/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${encodeURIComponent(lang)}.vtt`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'text/vtt, text/plain' }
  }).catch((err) => {
    throw new ApiError(err && err.message ? err.message : 'تعذّر جلب ملف الترجمة', {
      code: 'network',
      retriable: true
    });
  });

  if (res.status === 404) {
    throw new ApiError('هذه الترجمة غير متوفرة', { code: 'not-found', status: 404, retriable: false });
  }
  if (!res.ok) {
    throw new ApiError(`تعذّر جلب ملف الترجمة (${res.status})`, {
      code: 'http',
      status: res.status,
      retriable: res.status >= 500
    });
  }
  return res.text();
}

export const api = {
  getTrending,
  getUpcoming,
  getTopRated,
  search,
  getMyContent,
  getCategory,
  getStats,
  getDetail,
  getServers,
  getSubtitleIndex,
  getSubtitleText
};
