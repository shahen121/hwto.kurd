/**
 * Vercel serverless proxy — official TMDB API.
 *
 * Replaces the kurdcinama.com upstream (Cloudflare bot-challenges Vercel IPs).
 * Reads TMDB_API_KEY from environment variables — never exposed to the browser.
 *
 * Accepts the same query params the frontend already sends:
 *   /api/TMDBCache.aspx?action=trending&type=movie&limit=20
 *
 * Reshapes TMDB responses to match the kurdcinama.com shapes documented in
 * public/js/api.js, so the frontend needs no changes.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_TIMEOUT = 15000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'TMDB_API_KEY is not configured' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';
  const type = url.searchParams.get('type') || '';
  const limit = Number(url.searchParams.get('limit')) || 0;
  const q = url.searchParams.get('q') || '';
  const id = url.searchParams.get('id') || '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    let payload;

    switch (action) {
      case 'trending':
        payload = await fetchTrending(type, limit, controller.signal);
        break;
      case 'upcoming':
        payload = await fetchUpcoming(limit, controller.signal);
        break;
      case 'toprated':
        payload = await fetchTopRated(controller.signal);
        break;
      case 'search':
        payload = await fetchSearch(q, type, controller.signal);
        break;
      case 'mycontent':
        payload = await fetchMyContent(type, limit, controller.signal);
        break;
      case 'stats':
        payload = STATS_PLACEHOLDER;
        break;
      case 'movie':
        payload = await fetchDetail('movie', id, controller.signal);
        break;
      case 'tv':
        payload = await fetchDetail('tv', id, controller.signal);
        break;
      default:
        res.status(400).json({ error: 'Unknown action' });
        return;
    }

    const ok = payload && !payload.error;
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', ok ? 's-maxage=180, stale-while-revalidate=60' : 'no-store');
    res.send(JSON.stringify(payload));
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    res.status(502).json({
      error: aborted ? 'انتهت مهلة الاتصال بخادم البيانات' : 'تعذّر الوصول إلى خادم البيانات، حاول مجدداً'
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * TMDB fetch helpers                                                 *
 * ------------------------------------------------------------------ */

async function tmdb(path, params, signal) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

/** TMDB list row → kurdcinama row shape. */
function toRow(item, mediaType) {
  const mt = mediaType || item.media_type || 'movie';
  return {
    id: item.id,
    title: item.title || item.name || '',
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || '',
    vote_average: item.vote_average || 0,
    release_date: item.release_date || item.first_air_date || '',
    overview: item.overview || '',
    media_type: mt,
    rank: null,
    local_id: null,
    local_photo: ''
  };
}

function toList(results, extra = {}) {
  return { results, total: results.length, cached: true, ...extra };
}

/* ------------------------------------------------------------------ *
 * Endpoints                                                          *
 * ------------------------------------------------------------------ */

async function fetchTrending(type, limit, signal) {
  const data = await tmdb('/trending/all/week', {}, signal);
  let results = (data.results || []).map((r) => toRow(r));
  if (type === 'movie' || type === 'tv') {
    results = results.filter((r) => r.media_type === type);
  }
  if (limit > 0) results = results.slice(0, limit);
  return toList(results);
}

async function fetchUpcoming(limit, signal) {
  const data = await tmdb('/movie/upcoming', {}, signal);
  let results = (data.results || []).map((r) => toRow(r, 'movie'));
  if (limit > 0) results = results.slice(0, limit);
  return toList(results);
}

async function fetchTopRated(signal) {
  const [movies, tv] = await Promise.all([
    tmdb('/movie/top_rated', {}, signal),
    tmdb('/tv/top_rated', {}, signal)
  ]);
  const results = [
    ...(movies.results || []).map((r) => toRow(r, 'movie')),
    ...(tv.results || []).map((r) => toRow(r, 'tv'))
  ];
  return toList(results);
}

async function fetchSearch(q, type, signal) {
  if (!q.trim()) return toList([]);
  const params = { query: q.trim() };
  if (type === 'movie' || type === 'tv') params.media_type = type;
  const data = await tmdb('/search/multi', params, signal);
  const results = (data.results || [])
    .filter((r) => r.media_type !== 'person')
    .map((r) => toRow(r));
  return toList(results);
}

/**
 * "Site library" substitute — popular movies + popular TV.
 * kurdcinama.com had a private catalogue; TMDB has no equivalent.
 */
async function fetchMyContent(type, limit, signal) {
  const calls = [];
  if (type !== 'tv') calls.push(tmdb('/movie/popular', {}, signal));
  if (type !== 'movie') calls.push(tmdb('/tv/popular', {}, signal));
  const responses = await Promise.all(calls);

  let results = [];
  for (const data of responses) {
    const rows = (data.results || []).map((r) => {
      const row = toRow(r);
      row.db_id = null;
      row.db_photo = '';
      row.in_database = true;
      return row;
    });
    results = results.concat(rows);
  }
  if (limit > 0) results = results.slice(0, limit);
  return toList(results);
}

/**
 * Detail response — reshapes TMDB genres array → comma-separated genre_ids
 * string, which is what api.js normaliseDetail() expects.
 */
async function fetchDetail(mediaType, id, signal) {
  if (!id || !/^\d+$/.test(id)) {
    return { error: 'معرّف غير صالح' };
  }
  const path = `/${mediaType}/${id}`;
  let data;
  try {
    data = await tmdb(path, {}, signal);
  } catch {
    return { error: 'المحتوى غير موجود' };
  }
  if (!data || data.success === false || data.status_message) {
    return { error: 'المحتوى غير موجود' };
  }

  const genreIds = Array.isArray(data.genres)
    ? data.genres.map((g) => g.id).join(',')
    : '';

  const base = {
    id: data.id,
    overview: data.overview || '',
    poster_path: data.poster_path || '',
    backdrop_path: data.backdrop_path || '',
    vote_average: data.vote_average || 0,
    vote_count: data.vote_count || 0,
    popularity: data.popularity || 0,
    original_language: data.original_language || '',
    genre_ids: genreIds,
    cached: true
  };

  if (mediaType === 'tv') {
    return {
      ...base,
      name: data.name || '',
      original_name: data.original_name || '',
      first_air_date: data.first_air_date || '',
      origin_country: Array.isArray(data.origin_country) ? data.origin_country[0] || '' : ''
    };
  }

  return {
    ...base,
    title: data.title || '',
    original_title: data.original_title || '',
    release_date: data.release_date || ''
  };
}

/* ------------------------------------------------------------------ *
 * Stats placeholder                                                   *
 * ------------------------------------------------------------------ */

const STATS_PLACEHOLDER = {
  movies: 6928,
  tv_shows: 2235,
  trending: 20,
  upcoming: 60,
  top_rated: 40,
  oldest_cache: '2025-12-22 00:00',
  newest_cache: '2025-12-25 22:24'
};
