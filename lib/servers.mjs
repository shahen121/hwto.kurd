/**
 * lib/servers.mjs — alternate playback servers, shared by server.js (local)
 * and api/proxy.js (Vercel). One implementation, two hosts.
 *
 * Two upstream sources are merged, deduped by final URL and ordered:
 *
 *   1. Beenar (https://beenar.net) — the client API of a Kurdish streaming
 *      site. It carries MOVIES and SERIES, and every title lists the embed
 *      URLs its own player uses (Vidmoly, StreamWish clones, Sendvid, VOE,
 *      ok.ru, …). There is no public IMDb/TMDB lookup there — their
 *      `find-movie-series` endpoint answers 401 — so the bridge from this
 *      site's TMDB ids is a TITLE search plus a release-year match:
 *
 *        POST /api/client/search?page=1        {q:"title"}
 *          -> {data:{movie:{data:[{id,name}]},series:{data:[{id,name}]}}}
 *        GET  /api/client/title-show/{id}      movies -> data.videos[]
 *        GET  /api/client/series-show/{id}?part={season}
 *                                              series -> data.seasons[].episodes[].videos[]
 *
 *      A video row is {category:'full'|'trailer'|'download', quality,
 *      url, server:{id,name}|null}. `server` is frequently null, so the
 *      display name falls back to the URL host; `url` is sometimes
 *      protocol-relative ("//vidmoly.net/embed-….html").
 *
 *   2. kurdcinama.com/online.aspx — the ASP.NET player page scraped with a
 *      hidden-field POST per <option>. MOVIES ONLY (no season/episode).
 *
 * Both sources feed the same liveness filter. The filter is deliberately
 * PERMISSIVE: a URL is dropped only on positive evidence of death, because
 * most of these hosts answer a plain GET with an anti-bot page, a JS hop or
 * a Cloudflare interstitial that a real browser walks straight through.
 * Verified against 48 real hosts / 206 real URLs: only ronemo.com ("/lander")
 * and expired file links (404 + tiny body) are truly dead; ok.ru, dood.* and
 * every StreamSB/Wish clone look "empty" to curl but play in a browser.
 */

const BEENAR = 'https://beenar.net';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const UPSTREAM_HOST = 'kurdcinama.com';

// Per-request deadlines. The whole collectServers() call is bounded by the
// caller's AbortSignal (20s in both hosts); these keep any single upstream
// hop from eating that budget alone.
const FETCH_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 4000;
const PROBE_BUDGET_MS = 8000;
const MAX_CANDIDATES = 4; // beenar titles whose details we fetch
const MAX_PROBES = 24; // URLs health-checked per request
const MAX_SERVERS = 30; // sanity cap for the UI list

// In-memory caches. Best effort only: a Vercel invocation may be a fresh
// instance, so the edge cache (s-maxage on the response) is the real one.
const RESULT_TTL_MS = 30 * 60 * 1000;
const TITLE_TTL_MS = 24 * 60 * 60 * 1000;
const resultCache = new Map();
const titleCache = new Map();

/* ------------------------------------------------------------------ *
 * HTTP                                                               *
 * ------------------------------------------------------------------ */

function withTimeout(ms, external) {
  const parts = [AbortSignal.timeout(ms)];
  if (external) parts.push(external);
  return parts.length > 1 ? AbortSignal.any(parts) : parts[0];
}

/**
 * One GET/POST with a browser-ish identity (Beenar sits behind Sucuri and
 * resets connections without it) and a single retry on transient failures.
 */
async function request(url, { method = 'GET', body, timeout = FETCH_TIMEOUT_MS, signal, accept = 'application/json' } = {}) {
  const attempt = async (n) => {
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
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: accept,
          'Accept-Language': 'en-US,en;q=0.9',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Referer: `${BEENAR}/`
        },
        ...(body ? { body } : {})
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, url: res.url };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  };

  try {
    return await attempt(0);
  } catch (err) {
    if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;
    // One quick retry: resets and brief timeouts against these hosts are common.
    await new Promise((r) => setTimeout(r, 200));
    try {
      return await attempt(1);
    } catch (err2) {
      if (err2 && err2.name === 'AbortError' && signal && signal.aborted) throw err2;
      return { ok: false, status: 0, text: '', error: err2 && err2.message ? err2.message : 'network' };
    }
  }
}

async function requestJson(url, opts) {
  const r = await request(url, opts);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Title matching (TMDB title -> Beenar id)                           *
 * ------------------------------------------------------------------ */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(\s*\d{4}\s*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const yearOf = (v) => {
  const m = /(\d{4})/.exec(String(v || ''));
  return m ? Number(m[1]) : 0;
};

/** 2 = identical, 1 = one contains the other, 0 = unrelated. */
function nameScore(candidate, target) {
  if (!target) return 0;
  if (candidate === target) return 2;
  if (candidate.startsWith(target) || target.startsWith(candidate)) return 1;
  if (candidate.includes(target) || target.includes(candidate)) return 1;
  return 0;
}

/** Cache the resolved Beenar id per (type, normalized title) for a day. */
function titleCacheKey(type, title) {
  return `${type}|${norm(title)}`;
}

/**
 * Resolve a title to `{id, name, release_date}` on Beenar, or null.
 * Never guesses: an unrelated result scores 0 and is discarded.
 */
export async function findBeenarTitle({ type, title, year, signal }) {
  const query = String(title || '').trim();
  if (query.length < 2) return null;

  const wanted = type === 'tv' ? 'series' : 'movie';
  const wantedYear = Number(year) || 0;
  const cacheKey = titleCacheKey(wanted, query);
  const cached = titleCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    // A cached hit may still be the wrong year for this particular request.
    if (!wantedYear || !yearOf(cached.value.release_date) || yearOf(cached.value.release_date) === wantedYear) {
      return cached.value;
    }
  }

  const search = await requestJson(`${BEENAR}/api/client/search?page=1`, {
    method: 'POST',
    body: JSON.stringify({ q: query }),
    signal
  });
  const bucket = search && search.data ? search.data[wanted] : null;
  const rows = bucket && Array.isArray(bucket.data) ? bucket.data : [];
  if (!rows.length) return null;

  const target = norm(query);
  const ranked = rows
    .map((row) => ({ row, score: nameScore(norm(row.name), target) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  if (!ranked.length) return null;
  if (ranked.length === 1 && !wantedYear) {
    const only = { id: ranked[0].row.id, name: ranked[0].row.name, release_date: '' };
    titleCache.set(cacheKey, { value: only, expires: Date.now() + TITLE_TTL_MS });
    return only;
  }

  // The search rows carry no release_date, so the year can only be checked
  // against the detail payload. Fetch the few best candidates in parallel.
  const detailPath = wanted === 'series' ? 'series-show' : 'title-show';
  const details = await Promise.all(
    ranked.map(async ({ row }) => {
      const json = await requestJson(`${BEENAR}/api/client/${detailPath}/${row.id}`, { signal });
      const data = json && json.data ? json.data : null;
      return data ? { id: row.id, name: data.name || row.name, release_date: data.release_date || '', data } : null;
    })
  );

  const alive = details.filter(Boolean);
  if (!alive.length) return null;

  let best = null;
  for (const cand of alive) {
    const candYear = yearOf(cand.release_date);
    let score = nameScore(norm(cand.name), target) * 10;
    if (wantedYear && candYear) score += candYear === wantedYear ? 6 : Math.abs(candYear - wantedYear) <= 1 ? 3 : -4;
    cand._score = score;
    if (!best || score > best._score) best = cand;
  }
  if (!best || best._score <= 0) return null;

  const resolved = { id: best.id, name: best.name, release_date: best.release_date };
  titleCache.set(cacheKey, { value: resolved, expires: Date.now() + TITLE_TTL_MS });
  return resolved;
}

/* ------------------------------------------------------------------ *
 * Video extraction + URL hygiene                                     *
 * ------------------------------------------------------------------ */

function absolutize(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('//')) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  return '';
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Patterns that can never be an inline player, whatever the host answers. */
function isEmbedShaped(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  // Google Drive: only the /preview form is an iframe; /file/…/view and
  // /uc?export=download are downloads that expire within hours.
  if (/drive\.google\.com$/i.test(parsed.hostname) && !/\/preview\/?$/i.test(parsed.pathname)) return false;
  // europixhd "search" links are ad hops, not players.
  if (parsed.searchParams.has('search')) return false;
  // Beenar's own shortlink is a bare fragment redirect, not an embed.
  if (/beenar\.uns\.bio$/i.test(parsed.hostname) && !parsed.pathname.replace(/\/$/, '')) return false;
  return true;
}

function pickVideos(data, type, season, episode) {
  if (!data) return [];
  if (type === 'tv') {
    const wanted = Number(season) || 1;
    const seasons = Array.isArray(data.seasons) ? data.seasons : [];
    const seasonRow = seasons.find((s) => Number(s.number) === wanted) || seasons[wanted - 1] || null;
    if (!seasonRow || !Array.isArray(seasonRow.episodes)) return [];
    const ep = Number(episode) || 1;
    const episodeRow = seasonRow.episodes.find((e) => Number(e.episode_number) === ep) || null;
    return episodeRow && Array.isArray(episodeRow.videos) ? episodeRow.videos : [];
  }
  return Array.isArray(data.videos) ? data.videos : [];
}

/* ------------------------------------------------------------------ *
 * Liveness filter — drop only on proof of death                      *
 * ------------------------------------------------------------------ */

// Positive evidence that a link is gone. Everything else (anti-bot pages,
// "Redirecting…" hops, Cloudflare interstitials, unknown markup) is KEPT,
// because a real browser walks through those.
const DEAD_MARKERS =
  /no longer available|has been deleted|file (was|is) removed|expired or has been deleted|\/lander\b|domain is for sale|this domain name is for sale/i;

/** Same-origin script / JS redirect targets of a bootstrap page. */
const HOP_RE = /<script[^>]+src=["']([^"']+)|window\.location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.replace\(\s*["']([^"']+)["']/i;

/** TLS/chain problems are a client trust-store issue, never proof of death. */
const TLS_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);

async function fetchProbe(url, timeout, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${BEENAR}/`
      }
    });
    const text = await res.text();
    return { status: res.status, text, url: res.url || url, errorCode: '' };
  } catch (err) {
    const cause = err && err.cause;
    const errorCode = (cause && cause.code) || '';
    return { status: 0, text: '', url, error: err && err.message, errorCode };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 'dead' — proof the file/host is gone, drop it.
 * 'keep' — anything else, including pages curl cannot play but a browser can.
 */
async function probeUrl(url, { signal, source } = {}) {
  // سيرفرات شاهد فور يو مشفرة ويفتحها المتصفح مباشرة عبر الـ iframe
  if (source === 'shahid4u' || /sshaahid4u\.net|shaheid4u\.name/i.test(url)) return 'keep';
  let res = await fetchProbe(url, PROBE_TIMEOUT_MS, signal);
  // A certificate/chain mismatch is OUR trust store, not the link: browsers
  // (and macOS curl) accept these hosts — never drop on it.
  if (res.status === 0 && TLS_CODES.has(res.errorCode)) return 'keep';
  if (res.status === 0) {
    // The caller's total budget ran out mid-probe — do not punish the user.
    if (signal && signal.aborted) return 'keep';
    // Unreachable (DNS/refused/reset/timeout): one quick retry, then dead.
    await new Promise((r) => setTimeout(r, 250));
    res = await fetchProbe(url, PROBE_TIMEOUT_MS, signal);
    if (res.status === 0) {
      if (signal && signal.aborted) return 'keep';
      if (TLS_CODES.has(res.errorCode)) return 'keep';
      return 'dead';
    }
  }

  if (DEAD_MARKERS.test(res.text || '')) return 'dead';
  // Expired single-file hosts answer 404/410 with a tiny stub.
  if ((res.status === 404 || res.status === 410) && (res.text || '').length < 2000) return 'dead';

  // Tiny bootstrap page: follow one same-document hop (JS redirect or a
  // local player script) before judging — voe.sx and beenar.uns.bio both
  // only reveal their player after this hop.
  if ((res.text || '').length < 3000) {
    const m = HOP_RE.exec(res.text || '');
    const next = m && (m[1] || m[2] || m[3]);
    if (next) {
      let target = next;
      if (target.startsWith('//')) target = `https:${target}`;
      else if (!/^https?:/i.test(target)) {
        try {
          target = new URL(target, res.url).toString();
        } catch {
          target = '';
        }
      }
      if (target) {
        const hopped = await fetchProbe(target, PROBE_TIMEOUT_MS, signal);
        if (hopped.status !== 0) {
          if (DEAD_MARKERS.test(hopped.text || '')) return 'dead';
          if ((hopped.status === 404 || hopped.status === 410) && (hopped.text || '').length < 2000) return 'dead';
          res = hopped;
        }
      }
    }
  }

  return 'keep';
}

/** Filter a candidate list in parallel, bounded by PROBE_BUDGET_MS. */
async function filterAlive(candidates, { signal }) {
  const slice = candidates.slice(0, MAX_PROBES);
  const budget = AbortSignal.any([AbortSignal.timeout(PROBE_BUDGET_MS), signal || AbortSignal.timeout(PROBE_BUDGET_MS)]);
  const verdicts = await Promise.all(
    slice.map(async (c) => {
      try {
        const v = await probeUrl(c.url, { signal: budget, source: c.source });
        return { ...c, verdict: v };
      } catch {
        return { ...c, verdict: 'keep' }; // budget ran out — do not punish the user
      }
    })
  );
  return verdicts.filter((c) => c.verdict !== 'dead').concat(candidates.slice(MAX_PROBES));
}

/* ------------------------------------------------------------------ *
 * Ordering                                                           *
 * ------------------------------------------------------------------ */

// Display families, best first. Anything unmatched lands last, alphabetical.
const FAMILIES = [
  [/vidmoly/i, 10],
  [/fastvid|fastved|fastvip/i, 15],
  [/(^|\.)(wish|streamsb)|wish\.com|sbfast|sbfull|sbdownload|sbembed|playerwish|embedwish|obeywish|jodwish|cdnwish|strwish|hlswish|sfastwish/i, 20],
  [/sendvid/i, 30],
  [/voe/i, 40],
  [/beenar/i, 50],
  [/yourupload|fviplions|streamhide/i, 60],
  [/ok\.ru/i, 70],
  [/mixdrop|uqload|dood|fembed|mystream|myviid|abcvideo|protonvideo|streamon|upvideo|ptube|sama-share|playdrive|cloudvideo|userscloud|ninjastream|europix|fastplay|vidfast|vidbem|anavids|hgcloud|gofile|google/i, 80]
];

function familyRank(host) {
  for (const [re, rank] of FAMILIES) if (re.test(host)) return rank;
  return 90;
}

/** server.name when Beenar sent one, otherwise a readable host label. */
function displayName(explicit, host) {
  const name = String(explicit || '').trim();
  if (name && !/^\d+[-.)\s]*$/i.test(name)) return name;
  const base = host.replace(/^(video|embed|player|www)\./i, '').split('.')[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
}

function orderServers(list) {
  const seen = new Set();
  const unique = [];
  for (const item of list) {
    const key = String(item.url || '').replace(/\/$/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique
    .map((item, i) => ({ item, i, rank: familyRank(item.host) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i) || a.item.host.localeCompare(b.item.host))
    .slice(0, MAX_SERVERS)
    .map(({ item }) => item);
}

/* ------------------------------------------------------------------ *
 * Source 2 — kurdcinama.com online.aspx (movies only)                *
 * ------------------------------------------------------------------ */

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

async function findKurdishMovieIdByTitle(title, tmdbid, signal) {
  if (!String(title || '').trim() && !tmdbid) return null;
  if (tmdbid) {
    const byTmdb = await findKurdishMovieIdByTmdbId(String(tmdbid), title, signal);
    if (byTmdb) return byTmdb;
  }
  if (!String(title || '').trim()) return null;
  const r = await request(`https://${UPSTREAM_HOST}/Search.aspx?q=${encodeURIComponent(title.trim())}`, {
    accept: 'text/html',
    signal
  });
  if (!r || !r.ok || !r.text) return null;
  const target = norm(title).slice(0, 40);
  const re = /details\.aspx\?movieid=(\d+)/g;
  let m;
  while ((m = re.exec(r.text))) {
    const chunk = r.text.slice(m.index, m.index + 1500);
    const t = chunk.match(/class="card__title">([^<]+)</);
    if (t && target && norm(t[1]) === target) return m[1];
  }
  // Never guess a wrong movie — an empty list is a valid answer.
  return null;
}

async function findKurdishMovieIdByTmdbId(tmdbId, searchTitle, signal) {
  if (!tmdbId) return null;
  const title = String(searchTitle || '').trim();
  const searchUrl = title
    ? `https://${UPSTREAM_HOST}/Search.aspx?q=${encodeURIComponent(title)}`
    : `https://${UPSTREAM_HOST}/Search.aspx`;
  const r = await request(searchUrl, { accept: 'text/html', signal });
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
  for (const cand of ids.slice(0, 12)) {
    const detail = await request(`https://${UPSTREAM_HOST}/moves-details.aspx?movieid=${cand}`, {
      accept: 'text/html',
      signal
    });
    if (!detail || !detail.ok || !detail.text) continue;
    const hidden = detail.text.match(
      /<input[^>]*type=["']hidden["'][^>]*id=["']tmdbId["'][^>]*value=["'](\d+)["']/i
    );
    if (hidden && hidden[1] === String(tmdbId)) return cand;
  }
  return null;
}

async function scrapeKurdishServers(movieid, signal) {
  const pageUrl = `https://${UPSTREAM_HOST}/online.aspx?movieid=${encodeURIComponent(movieid)}`;
  const index = await request(pageUrl, { accept: 'text/html', signal });
  if (!index || !index.ok || !index.text) return [];

  const options = extractServerOptions(index.text);
  if (!options.length) return [];

  const servers = [];
  for (const opt of options) {
    const refreshed = await request(pageUrl, { accept: 'text/html', signal });
    const hidden = refreshed && refreshed.text ? extractHiddenInputs(refreshed.text) : extractHiddenInputs(index.text);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) body.set(k, v);
    body.set('__EVENTTARGET', 'ctl00$MainContent$DropDownList1');
    body.set('__EVENTARGUMENT', '');
    body.set('__LASTFOCUS', '');
    body.set('ctl00$MainContent$DropDownList1', opt.value);
    body.set('ctl00$MainContent$hiddenVideoUrl', hidden['ctl00$MainContent$hiddenVideoUrl'] || '');

    const post = await request(pageUrl, {
      method: 'POST',
      accept: 'text/html',
      body: body.toString(),
      signal
    });
    const src = post && post.ok ? extractIframeSrc(post.text) : null;
    if (!src) continue;
    const url = absolutize(src);
    if (!url) continue;
    servers.push({
      key: opt.label.replace(/^\d+[-.)\s]*/, '').trim().toLowerCase(),
      label: opt.label,
      url,
      host: hostOf(url),
      quality: '',
      source: 'kurdcinama'
    });
  }
  return servers;
}

/* ------------------------------------------------------------------ *
 * Source 3 — Shahid4u (shaheid4u.name) -> All Servers (Resolved)    *
 * ------------------------------------------------------------------ */

const SHAHEID_HOST = 'shaheid4u.name';

function parseShahidCards(html) {
  const cards = [];
  const re = /<a\s+href="([^"]+)"\s+class="show-card"[^>]*>[\s\S]*?<p\s+class="title">([^<]+)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    cards.push({ url: m[1], title: m[2].trim() });
  }
  return cards;
}

function extractShahidServersFromHtml(html, pageOrigin) {
  const m = /(?:let|const|var)\s+servers\s*=\s*(\[[\s\S]*?\])\s*;?/.exec(html);
  if (!m) return [];

  let rawList = [];
  try {
    rawList = JSON.parse(m[1]);
  } catch {
    const lenient = m[1]
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_s, body) => `"${body.replace(/"/g, '\\"')}"`)
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
    try { rawList = JSON.parse(lenient); } catch { return []; }
  }
  if (!Array.isArray(rawList)) return [];

  return rawList.map((s) => {
    const rawUrl = s && (s.url || s.link || s.src);
    if (!rawUrl) return null;

    let fullUrl = rawUrl;
    try {
      fullUrl = new URL(rawUrl, pageOrigin).href;
    } catch {}

    const name = String((s && (s.name || s.title || s.label)) || 'Shahid4u').trim();

    return {
      key: name.toLowerCase(),
      label: `${name} (Shahid4u)`,
      url: fullUrl,
      host: hostOf(fullUrl),
      quality: '',
      source: 'shahid4u'
    };
  }).filter(Boolean);
}

/**
 * فك رابط البوابة /m/... واستخراج رابط السيرفر الحقيقي عبر ترويسة Location
 */
async function resolveGateUrl(gateUrl, watchUrl, cookieHeader, signal) {
  try {
    const res = await fetch(gateUrl, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(3500), signal]) : AbortSignal.timeout(3500),
      headers: {
        'User-Agent': BROWSER_UA,
        'Referer': encodeURI(watchUrl),
        'Cookie': cookieHeader
      },
      redirect: 'manual'
    });

    const location = res.headers.get('location');
    if (location) {
      return location.startsWith('http') ? location : new URL(location, gateUrl).href;
    }
  } catch {
    // في حال انتهاء المهلة يرجع الرابط الأصلي
  }
  return gateUrl;
}

async function findShahid4uServers({ type, title, year, season, episode, signal }) {
  const query = String(title || '').trim();
  if (query.length < 2) return [];

  const searchUrl = `https://${SHAHEID_HOST}/search?s=${encodeURIComponent(query)}`;
  console.log(`[shahid4u] Searching: ${searchUrl}`);

  let resText = '';
  try {
    const fRes = await fetch(searchUrl, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(6000), signal]) : AbortSignal.timeout(6000),
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `https://${SHAHEID_HOST}/`
      }
    });
    if (!fRes.ok) return [];
    resText = await fRes.text();
  } catch (err) {
    console.error(`[shahid4u] Search network error:`, err.message);
    return [];
  }

  const cards = parseShahidCards(resText);
  if (!cards.length) return [];

  const target = norm(query);
  const wantedYear = Number(year) || 0;
  const stopWords = new Set(['فيلم', 'مسلسل', 'مترجم', 'مدبلج', 'اون', 'لاين', 'اونلاين', 'كامل', 'كاملة', 'hd']);

  const candidates = cards.filter((c) => {
    const rawTitle = c.title;

    if (type === 'tv') {
      const epNum = Number(episode) || 1;
      if (!rawTitle.includes(`الحلقة ${epNum}`) && !rawTitle.includes(`حلقة ${epNum}`)) return false;
      return norm(rawTitle).includes(target);
    } else {
      if (rawTitle.includes('مسلسل') || rawTitle.includes('حلقة')) return false;

      const candYear = yearOf(rawTitle);
      if (wantedYear && candYear && Math.abs(candYear - wantedYear) > 1) return false;

      const words = norm(rawTitle)
        .split(/\s+/)
        .filter((w) => !stopWords.has(w) && !/^\d{4}$/.test(w));

      const coreName = words.join(' ');
      return coreName === target || coreName.startsWith(target + ' ') || words[0] === target;
    }
  });

  if (!candidates.length) return [];

  const bestMatch = candidates[0];
  console.log(`[shahid4u] Matched: ${bestMatch.title}`);

  // استخدام encodeURI لمنع خطأ ByteString مع الكلمات العربية
  const rawWatchUrl = bestMatch.url.replace(/\/(film|episode)\//, '/watch/');
  const watchUrl = encodeURI(rawWatchUrl);
  console.log(`[shahid4u] Fetching watch page: ${rawWatchUrl}`);

  try {
    const pageRes = await fetch(watchUrl, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(6000), signal]) : AbortSignal.timeout(6000),
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html',
        'Referer': `https://${SHAHEID_HOST}/`
      }
    });
    if (!pageRes.ok) return [];

    // 1. استخراج كوكيز الجلسة اللازمة لفك بوابات التحويل
    const cookies = pageRes.headers.getSetCookie ? pageRes.headers.getSetCookie() : [pageRes.headers.get('set-cookie')];
    const cookieHeader = cookies.filter(Boolean).map((c) => c.split(';')[0]).join('; ');

    const pageHtml = await pageRes.text();
    const pageOrigin = new URL(pageRes.url || rawWatchUrl).origin;
    const extracted = extractShahidServersFromHtml(pageHtml, pageOrigin);

    if (!extracted.length) return [];

    console.log(`[shahid4u] Resolving ${extracted.length} gateway URLs...`);

    // 2. فك روابط البوابات /m/... بالتوازي للحصول على روابط المشاهدة الحقيقية
    const resolvedServers = await Promise.all(
      extracted.map(async (server) => {
        if (server.url && server.url.includes('/m/')) {
          const directUrl = await resolveGateUrl(server.url, rawWatchUrl, cookieHeader, signal);
          const isFast = /fastved|fastvip|fastvid/i.test(directUrl) || /fastved|fastvip|fastvid/i.test(server.label);
          return {
            ...server,
            url: directUrl,
            host: hostOf(directUrl),
            label: isFast ? 'Fastvid (Shahid4u)' : server.label,
            _isFast: isFast
          };
        }
        return server;
      })
    );

    // تقديم سيرفر Fastvid للأمام كخيار أول إن وجد
    const sorted = resolvedServers.sort((a, b) => (b._isFast ? 1 : 0) - (a._isFast ? 1 : 0))
                                 .map(({ _isFast, ...rest }) => rest);

    console.log(`[shahid4u] Injected ${sorted.length} resolved servers`);
    return sorted;
  } catch (err) {
    console.error(`[shahid4u] Watch page error:`, err.message);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Public entry point                                                 *
 * ------------------------------------------------------------------ */

/**
 * Collect every alternate playback server for one title/episode.
 *
 * @param {object} args
 * @param {'movie'|'tv'} [args.type]
 * @param {string}  [args.title]    display title — the only lookup key Beenar has
 * @param {number|string} [args.year] release year, sharpens the Beenar match
 * @param {number|string} [args.season]
 * @param {number|string} [args.episode]
 * @param {number|string} [args.tmdbid]
 * @param {number|string} [args.movieid] kurdcinama's own id, when the caller has it
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{servers:Array, sources:object, matched:object|null, cached:boolean}>}
 */
export async function collectServers({ type, title, year, season, episode, tmdbid, movieid, signal } = {}) {
  const media = type === 'tv' ? 'tv' : 'movie';
  const cacheKey = [media, norm(title), Number(year) || 0, Number(season) || 0, Number(episode) || 0, tmdbid || ''].join('|');
  const hit = resultCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };

  const budget = signal ? AbortSignal.any([AbortSignal.timeout(19000), signal]) : AbortSignal.timeout(19000);

  // --- Source 1: Beenar ------------------------------------------------
  let matched = null;
  let beenarVideos = [];
  try {
    matched = await findBeenarTitle({ type: media, title, year, signal: budget });
    if (matched) {
      const path = media === 'tv' ? 'series-show' : 'title-show';
      const query = media === 'tv' ? `?part=${Math.max(1, Number(season) || 1)}` : '';
      const json = await requestJson(`${BEENAR}/api/client/${path}/${matched.id}${query}`, { signal: budget });
      beenarVideos = pickVideos(json && json.data ? json.data : null, media, season, episode);
    }
  } catch {
    matched = matched || null;
  }

  const candidates = [];
  for (const v of beenarVideos) {
    if (String(v && v.category || '').toLowerCase() !== 'full') continue;
    const url = absolutize(v.url);
    if (!isEmbedShaped(url)) continue;
    const host = hostOf(url);
    const srv = (v.server && typeof v.server === 'object' ? v.server : {}) || {};
    candidates.push({
      key: String(srv.name || host).toLowerCase(),
      label: displayName(srv.name, host),
      url,
      host,
      quality: v.quality ? String(v.quality) : '',
      source: 'beenar'
    });
  }

  // --- Source 2: kurdcinama (movies only — its player has no episodes) --
  if (media === 'movie') {
    try {
      let siteId = String(movieid || '').trim();
      if (!siteId) siteId = (await findKurdishMovieIdByTitle(title || '', tmdbid, budget)) || '';
      if (siteId) {
        const legacy = await scrapeKurdishServers(siteId, budget);
        candidates.push(...legacy);
      }
    } catch {
      // kurdcinama is optional; Beenar alone already fills the list.
    }
  }

  // --- Source 3: Shahid4u (All Servers) --------------------------------
  try {
    const shahidServers = await findShahid4uServers({ type: media, title, year, season, episode, signal: budget });
    if (shahidServers.length) {
      candidates.unshift(...shahidServers);
    }
  } catch (err) {
    console.error('[shahid4u]', err && err.message);
  }

  // --- Liveness, ordering ---------------------------------------------
  let alive = [];
  try {
    alive = await filterAlive(candidates, { signal: budget });
  } catch {
    alive = candidates; // budget exhausted — better a stale link than none
  }

  const servers = orderServers(alive).map(({ verdict, ...clean }) => clean);
  const payload = {
    servers,
    sources: {
      beenar: candidates.filter((c) => c.source === 'beenar').length,
      kurdcinama: candidates.filter((c) => c.source === 'kurdcinama').length,
      shahid4u: candidates.filter((c) => c.source === 'shahid4u').length
    },
    matched: matched ? { id: matched.id, name: matched.name, release_date: matched.release_date } : null,
    cached: false
  };

  if (servers.length) {
    resultCache.set(cacheKey, { value: payload, expires: Date.now() + RESULT_TTL_MS });
    if (resultCache.size > 200) {
      const oldest = resultCache.keys().next().value;
      resultCache.delete(oldest);
    }
  }
  return payload;
}
