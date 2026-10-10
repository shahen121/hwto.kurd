/**
 * Vercel serverless proxy: replaces the kurdcinama.com TMDBCache API with the
 * official TMDB API and reshapes responses to what public/js/api.js expects.
 *
 * Needs the environment variable TMDB_API_KEY (v3 key, or a v4 read token).
 * Optional: TMDB_LANGUAGE (default "en-US", e.g. "ar" for Arabic metadata).
 *
 * vercel.json keeps the rewrite:
 *   /api/:path*  ->  /api/proxy?path=:path*
 * so /api/TMDBCache.aspx?action=... lands here with the query string intact.
 */


const BASE = 'https://api.themoviedb.org/3';
const LANGUAGE = process.env.TMDB_LANGUAGE || 'en-US';
const TIMEOUT_MS = 15000;
const SCRAPE_TIMEOUT_MS = 8000;
const SERVERS_BUDGET_MS = 20000;
const PAGE_SIZE = 20;
const MAX_PAGES = 5;


/* ---------- TMDB client ---------- */


async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    const err = new Error('TMDB_API_KEY is not configured');
    err.isConfig = true;
    throw err;
  }


  const url = new URL(BASE + path);
  url.searchParams.set('language', LANGUAGE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }


  const headers = { Accept: 'application/json' };
  if (key.length > 40) headers.Authorization = `Bearer ${key}`; // v4 read token
  else url.searchParams.set('api_key', key); // v3 key


  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 404) {
      const err = new Error('Not found');
      err.isNotFound = true;
      throw err;
    }
    if (!res.ok) throw new Error(`TMDB responded with ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}


/** Fetch enough pages of a list endpoint to cover `limit` items (deduped).
 *  Starts at the requested `params.page` (so page=5 really means page 5).
 *  Returns `{ items, totalPages, totalResults }` taken from the first TMDB page. */
async function collect(path, params, limit) {
  const startPage = toPage(params.page);
  const pages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(limit / PAGE_SIZE)));
  const responses = await Promise.all(
    Array.from({ length: pages }, (_, i) => tmdb(path, { ...params, page: startPage + i }))
  );
  const seen = new Set();
  const out = [];
  for (const r of responses) {
    for (const item of r.results || []) {
      const key = `${item.media_type || ''}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  const firstPage = responses[0] || {};
  return {
    items: out.slice(0, limit),
    totalPages: firstPage.total_pages || 1,
    totalResults: firstPage.total_results || out.length
  };
}


/* ---------- helpers ---------- */


const first = (v) => (Array.isArray(v) ? v[0] : v);


function toLimit(value, fallback, max) {
  const n = Number(first(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}


function toType(value) {
  const t = first(value);
  return t === 'movie' || t === 'tv' ? t : '';
}


function toPage(value) {
  const n = Number(first(value));
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, 500);
}


function list(results, meta = {}) {
  return { results, total: results.length, cached: true, ...meta };
}


function baseRow(item, mediaType) {
  return {
    id: item.id,
    title: item.title || item.name || '',
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || '',
    vote_average: item.vote_average || 0,
    release_date: item.release_date || item.first_air_date || '',
    overview: item.overview || '',
    media_type: mediaType || item.media_type
  };
}


function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}


const genreIds = (genres) =>
  Array.isArray(genres) ? genres.map((g) => g.id).filter(Number.isFinite).join(',') : '';


/* ---------- Kurdish embed servers scraping (mirror of server.js) ---------- */

async function fetchPageText(url, options) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      ...options,
      // Per-page deadline (or the caller's total budget) — a slow upstream
      // must never hold the serverless request open.
      signal: (options && options.signal) || AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; hwto.kurd/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options && options.headers)
      }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function extractHiddenInputs(html) {
  const out = {};
  for (const m of html.matchAll(/<input[^>]*type=["']hidden["'][^>]*>/gi)) {
    const tag = m[0];
    const name = (/name=["']([^"']+)["']/.exec(tag) || [])[1];
    const value = (/value=["']([^"']*)["']/.exec(tag) || [])[1];
    if (name) out[name] = value || '';
  }
  return out;
}

function extractServerOptions(html) {
  const options = [];
  for (const m of html.matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>([^<]+)<\/option>/gi)) {
    options.push({ value: m[1], label: m[2].trim() });
  }
  return options;
}

function extractIframeSrc(html) {
  const m = /<iframe[^>]*src=["']([^"']+)["']/i.exec(html);
  return m ? m[1] : null;
}

async function findMovieIdByTitle(title, tmdbid, signal) {
  if (!title.trim() && !tmdbid) return null;
  if (tmdbid) {
    const located = await findMovieIdByTmdbId(String(tmdbid), title, signal);
    if (located) return located;
  }
  if (!title.trim()) return null;
  const r = await fetchPageText(`https://kurdcinama.com/Search.aspx?q=${encodeURIComponent(title.trim())}`, { signal });
  if (!r || !r.ok || !r.text) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(title).slice(0, 40);
  const re = /details\.aspx\?movieid=(\d+)/g;
  let m;
  while ((m = re.exec(r.text))) {
    const chunk = r.text.slice(m.index, m.index + 1500);
    const t = chunk.match(/class="card__title">([^<]+)</);
    if (t && target && norm(t[1]) === target) return m[1];
  }
  // Never guess a wrong movie — return null so the pills strip stays hidden.
  return null;
}

async function findMovieIdByTmdbId(tmdbId, searchTitle, signal) {
  if (!tmdbId) return null;
  if (!searchTitle.trim()) searchTitle = '';
  const searchUrl = searchTitle.trim()
    ? `https://kurdcinama.com/Search.aspx?q=${encodeURIComponent(searchTitle.trim())}`
    : `https://kurdcinama.com/Search.aspx`;
  const r = await fetchPageText(searchUrl, { signal });
  if (!r || !r.ok || !r.text) return null;
  const ids = [];
  let m;
  const re = /"movieid[^\d]*(\d+)"/g;
  while ((m = re.exec(r.text))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  if (!ids.length) {
    const re2 = /moves-details\.aspx\?movieid=(\d+)|details\.aspx\?movieid=(\d+)/g;
    while ((m = re2.exec(r.text))) {
      const id = m[1] || m[2];
      if (!ids.includes(id)) ids.push(id);
    }
  }
  // Fetch each candidate details page and compare its embedded tmdbId.
  for (const cand of ids.slice(0, 12)) {
    const detail = await fetchPageText(`https://kurdcinama.com/moves-details.aspx?movieid=${cand}`, { signal });
    if (!detail || !detail.ok || !detail.text) continue;
    const hidden = detail.text.match(/<input[^>]*type=["']hidden["'][^>]*id=["']tmdbId["'][^>]*value=["'](\d+)["']/i);
    if (hidden && hidden[1] === String(tmdbId)) return cand;
  }
  return null;
}

async function scrapeKurdishServers(movieid, signal) {
  const pageUrl = `https://kurdcinama.com/online.aspx?movieid=${encodeURIComponent(movieid)}`;
  const index = await fetchPageText(pageUrl, { signal });
  if (!index || !index.ok || !index.text) return { error: 'تعذّر جلب صفحة المشغل' };

  const options = extractServerOptions(index.text);
  if (!options.length) return { error: 'لم يُعثر على سيرفرات في الصفحة' };

  const servers = [];
  for (const opt of options) {
    const refreshed = await fetchPageText(pageUrl, { signal });
    const hidden = refreshed && refreshed.text ? extractHiddenInputs(refreshed.text) : extractHiddenInputs(index.text);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) body.set(k, v);
    body.set('__EVENTTARGET', 'ctl00$MainContent$DropDownList1');
    body.set('__EVENTARGUMENT', '');
    body.set('__LASTFOCUS', '');
    body.set('ctl00$MainContent$DropDownList1', opt.value);
    body.set('ctl00$MainContent$hiddenVideoUrl', hidden['ctl00$MainContent$hiddenVideoUrl'] || '');

    const post = await fetchPageText(pageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': pageUrl },
      body: body.toString(),
      signal
    });
    const src = post && post.ok ? extractIframeSrc(post.text) : null;
    if (src) servers.push({ key: opt.label.replace(/^\d+[-.)\s]*/, '').trim(), label: opt.label, url: src });
  }
  return { movieid, servers };
}


/* ---------- actions ---------- */


async function trending(q) {
  const type = toType(q.type);
  const limit = toLimit(q.limit, 20, 60);
  const page = toPage(q.page);
  const { items, totalPages, totalResults } = await collect(`/trending/${type || 'all'}/week`, { page }, limit);
  const rows = items
    .filter((i) => type || i.media_type === 'movie' || i.media_type === 'tv')
    .map((item, idx) => ({
      ...baseRow(item, type),
      rank: idx + 1,
      local_id: null,
      local_photo: ''
    }));
  return list(rows, { page, total_pages: totalPages, total_results: totalResults, has_more: page < totalPages });
}


async function upcoming(q) {
  const limit = toLimit(q.limit, 20, 40);
  const page = toPage(q.page);
  const { items, totalPages, totalResults } = await collect('/movie/upcoming', { page }, limit);
  const rows = items.map((item) => baseRow(item, 'movie'));
  return list(rows, { page, total_pages: totalPages, total_results: totalResults, has_more: page < totalPages });
}


async function toprated(q) {
  const type = toType(q.type);
  const limit = toLimit(q.limit, 100, 100);
  const page = toPage(q.page);
  const perType = type ? limit : Math.ceil(limit / 2);
  const unused = { items: [], totalPages: 0, totalResults: 0 };
  const [movies, shows] = await Promise.all([
    type === 'tv' ? Promise.resolve(unused) : collect('/movie/top_rated', { page }, perType),
    type === 'movie' ? Promise.resolve(unused) : collect('/tv/top_rated', { page }, perType)
  ]);
  const rows = [
    ...movies.items.map((i) => baseRow(i, 'movie')),
    ...shows.items.map((i) => baseRow(i, 'tv'))
  ].sort((a, b) => b.vote_average - a.vote_average);
  const used = [movies, shows].filter((r) => r.totalPages > 0);
  const totalPages = used.length ? Math.min(...used.map((r) => r.totalPages)) : 1;
  const totalResults = movies.totalResults + shows.totalResults;
  const cut = rows.slice(0, limit);
  return list(cut, { page, total_pages: totalPages, total_results: totalResults, has_more: page < totalPages });
}


async function search(q) {
  const query = String(first(q.q) || '').trim();
  if (!query) return list([], { page: 1, total_pages: 1, total_results: 0, has_more: false });
  if (query.length > 100) return { error: 'Query too long (max 100 characters)' };
  const type = toType(q.type);
  const page = toPage(q.page);
  const data = await tmdb(type ? `/search/${type}` : '/search/multi', {
    query,
    include_adult: 'false',
    page
  });
  const rows = (data.results || [])
    .filter((i) => type || i.media_type === 'movie' || i.media_type === 'tv')
    .map((i) => baseRow(i, type));
  const totalPages = data.total_pages || 1;
  const totalResults = data.total_results || 0;
  return list(rows, {
    page,
    total_pages: totalPages,
    total_results: totalResults,
    has_more: page < totalPages
  });
}


/** Substitute for the private "site library": popular titles (limit is per type). */
async function mycontent(q) {
  const type = toType(q.type);
  const limit = toLimit(q.limit, 20, 100);
  const page = toPage(q.page);
  const unused = { items: [], totalPages: 0, totalResults: 0 };
  const [movies, shows] = await Promise.all([
    type === 'tv' ? Promise.resolve(unused) : collect('/movie/popular', { page }, limit),
    type === 'movie' ? Promise.resolve(unused) : collect('/tv/popular', { page }, limit)
  ]);
  const toRow = (item, mediaType) => ({
    db_id: item.id,
    ...baseRow(item, mediaType),
    db_photo: '',
    in_database: true
  });
  const rows = interleave(
    movies.items.map((i) => toRow(i, 'movie')),
    shows.items.map((i) => toRow(i, 'tv'))
  );
  const used = [movies, shows].filter((r) => r.totalPages > 0);
  const totalPages = used.length ? Math.min(...used.map((r) => r.totalPages)) : 1;
  const totalResults = movies.totalResults + shows.totalResults;
  return list(rows, { page, total_pages: totalPages, total_results: totalResults, has_more: page < totalPages });
}


async function stats() {
  const [m, t] = await Promise.allSettled([tmdb('/discover/movie', { page: 1 }), tmdb('/discover/tv', { page: 1 })]);
  if (m.status === 'rejected' && t.status === 'rejected') throw m.reason;
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return {
    movies: m.status === 'fulfilled' ? m.value.total_results || 0 : 0,
    tv_shows: t.status === 'fulfilled' ? t.value.total_results || 0 : 0,
    trending: 20,
    upcoming: 40,
    top_rated: 100,
    oldest_cache: now,
    newest_cache: now
  };
}


async function details(q, kind) {
  const id = String(first(q.id) || '').trim();
  if (!/^\d+$/.test(id)) return { error: 'Invalid id' };


  let json;
  try {
    json = await tmdb(`/${kind}/${id}`);
  } catch (err) {
    if (err.isNotFound) return { error: kind === 'tv' ? 'TV show not found' : 'Movie not found' };
    throw err;
  }


  if (kind === 'tv') {
    return {
      id: json.id,
      name: json.name || '',
      original_name: json.original_name || '',
      overview: json.overview || '',
      poster_path: json.poster_path || '',
      backdrop_path: json.backdrop_path || '',
      first_air_date: json.first_air_date || '',
      vote_average: json.vote_average || 0,
      vote_count: json.vote_count || 0,
      popularity: json.popularity || 0,
      original_language: json.original_language || '',
      genre_ids: genreIds(json.genres),
      origin_country: json.origin_country || [],
      cached: true
    };
  }
  return {
    id: json.id,
    title: json.title || '',
    original_title: json.original_title || '',
    overview: json.overview || '',
    poster_path: json.poster_path || '',
    backdrop_path: json.backdrop_path || '',
    release_date: json.release_date || '',
    vote_average: json.vote_average || 0,
    vote_count: json.vote_count || 0,
    popularity: json.popularity || 0,
    original_language: json.original_language || '',
    genre_ids: genreIds(json.genres),
    cached: true
  };
}


/* ---------- handler ---------- */


export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }


  const q = req.query || {};
  const action = String(first(q.action) || '').toLowerCase();


  try {
    let payload;
    switch (action) {
      case 'trending': payload = await trending(q); break;
      case 'upcoming': payload = await upcoming(q); break;
      case 'toprated': payload = await toprated(q); break;
      case 'search': payload = await search(q); break;
      case 'mycontent': payload = await mycontent(q); break;
      case 'stats': payload = await stats(); break;
      case 'movie': payload = await details(q, 'movie'); break;
      case 'tv': payload = await details(q, 'tv'); break;
      case 'servers': {
        const signal = AbortSignal.timeout(SERVERS_BUDGET_MS);
        const movieid = String(first(q.movieid) || '').trim();
        if (movieid) { payload = await scrapeKurdishServers(movieid, signal); break; }
        const title = String(first(q.title) || '').trim();
        const tmdbId = String(first(q.tmdbid) || '').trim();
        if (tmdbId) {
          const foundId = await findMovieIdByTitle(title, tmdbId, signal);
          payload = await scrapeKurdishServers(foundId || '', signal);
          break;
        }
        if (title) {
          const foundId = await findMovieIdByTitle(title, '', signal);
          payload = await scrapeKurdishServers(foundId || '', signal);
          break;
        }
        payload = { error: 'movieid, title or tmdbid is required for action=servers' };
        break;
      }
      default:
        res.setHeader('Cache-Control', 'no-store');
        res.status(400).json({ error: 'Unknown action' });
        return;
    }


    // Unknown ids answer HTTP 200 with {"error": "..."} and must not be cached.
    res.setHeader(
      'Cache-Control',
      payload.error ? 'no-store' : 's-maxage=180, stale-while-revalidate=60'
    );
    res.status(200).json(payload);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    if (err && err.isConfig) {
      res.status(500).json({ error: 'TMDB_API_KEY is not configured on the server' });
      return;
    }
    const aborted = err && err.name === 'AbortError';
    res.status(502).json({
      error: aborted ? 'انتهت مهلة الاتصال بخادم البيانات' : 'تعذّر الوصول إلى خادم البيانات، حاول مجدداً'
    });
  }
}
