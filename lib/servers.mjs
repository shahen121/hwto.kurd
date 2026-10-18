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
 * Verified against 48 real hosts / 206 real URLs: only ronemo.com ("/lander"),
 * expired links (404/410 after any hop), servers that refuse to be framed
 * (X-Frame-Options / frame-ancestors / Cross-Origin-Resource-Policy) and
 * non-challenge 401/403/451 are truly dead; ok.ru, dood.* and every
 * StreamSB/Wish clone look "empty" to curl but play in a browser.
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

/** Cloudflare interstitial bodies: a browser walks through them, we cannot judge. */
const CHALLENGE_RE =
  /cdn-cgi\/challenge-platform|just a moment|cf-chl-|challenges\.cloudflare\.com|browser-verification/i;

async function fetchProbe(url, timeout, signal, referer = `${BEENAR}/`) {
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
        Referer: referer,
        // Mirror the iframe navigation the player will actually make — some
        // hosts answer a bare probe differently from a framed document.
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    const text = await res.text();
    return {
      status: res.status,
      text,
      url: res.url || url,
      errorCode: '',
      xfo: res.headers.get('x-frame-options') || '',
      corp: res.headers.get('cross-origin-resource-policy') || '',
      csp: res.headers.get('content-security-policy') || ''
    };
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
 * A page that cannot sit inside our iframe never plays, whatever its HTTP
 * status says. Chromium enforces X-Frame-Options, CSP frame-ancestors and
 * Cross-Origin-Resource-Policy on the framed document itself — the same
 * headers a plain fetch happily ignores. Checked on every hop.
 */
function blocksEmbed(res) {
  const xfo = String(res.xfo || '').trim();
  // ALLOW-FROM is obsolete and ignored by Chromium — never judge on it.
  if (xfo && !/^allow-from/i.test(xfo) && /sameorigin|deny/i.test(xfo)) return true;
  const corp = String(res.corp || '').trim();
  if (/same-origin|same-site/i.test(corp)) return true;
  const m = /frame-ancestors\s+([^;]*)/i.exec(String(res.csp || ''));
  if (m) {
    const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.includes("'none'")) return true;
    // Only an open door lets US in: '*', or a scheme-wide source like "https:".
    const open = tokens.some((t) => t === '*' || t === 'https:' || t === 'http:');
    if (!open) return true;
  }
  return false;
}

/**
 * 'dead' — proof the file/host is gone, drop it.
 * 'keep' — anything else, including pages curl cannot play but a browser can.
 */
export async function probeUrl(url, { signal, source, referer } = {}) {
  // بوابات شاهد فور يو نفسها محجوبة بـ Cloudflare — لا يمكن الحكم عليها من هنا،
  // والسيرفرات المفكوكة تمر عبر هذه الدالة بدون source بعد فحصها في المصدر.
  if (source === 'shahid4u' || /sshaahid4u\.net|shaheid4u\.name/i.test(url)) return 'keep';
  let res = await fetchProbe(url, PROBE_TIMEOUT_MS, signal, referer);
  // A certificate/chain mismatch is OUR trust store, not the link: browsers
  // (and macOS curl) accept these hosts — never drop on it.
  if (res.status === 0 && TLS_CODES.has(res.errorCode)) return 'keep';
  if (res.status === 0) {
    // The caller's total budget ran out mid-probe — do not punish the user.
    if (signal && signal.aborted) return 'keep';
    // Unreachable (DNS/refused/reset/timeout): one quick retry, then dead.
    await new Promise((r) => setTimeout(r, 250));
    res = await fetchProbe(url, PROBE_TIMEOUT_MS, signal, referer);
    if (res.status === 0) {
      if (signal && signal.aborted) return 'keep';
      if (TLS_CODES.has(res.errorCode)) return 'keep';
      return 'dead';
    }
  }

  if (DEAD_MARKERS.test(res.text || '')) return 'dead';

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
        const hopped = await fetchProbe(target, PROBE_TIMEOUT_MS, signal, referer);
        if (hopped.status !== 0) {
          if (DEAD_MARKERS.test(hopped.text || '')) return 'dead';
          res = hopped;
        }
      }
    }
  }

  // Final verdict on the page a browser would actually frame.
  // Expired links answer 404/410 — dead regardless of body size: a styled
  // 404 page (voe.sx ships 118KB of it) still shows the user "Not Found".
  if (res.status === 404 || res.status === 410) return 'dead';
  // 401/403/451 without an anti-bot challenge is a hard refusal; a challenge
  // page a browser can walk through is judged on its framing headers instead.
  if ((res.status === 401 || res.status === 403 || res.status === 451) && !CHALLENGE_RE.test(res.text || '')) {
    return 'dead';
  }
  if (blocksEmbed(res)) return 'dead';

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

/**
 * Run an async mapper over items with bounded concurrency. The Shahid4u host
 * sits behind a WAF that starts answering 403 to request bursts, so the
 * resolve POSTs and gateway hops deliberately trickle instead of stampeding.
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
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
 * بنية 2026: الصفحة لم تعد تحمل روابط جاهزة — بل كائنات
 * {name, resolve_token} مع مفتاح صفحة و CSRF، والرابط يُستخرج عبر
 * POST إلى watch/resolve. نقرأ كل المتغيرات من نفس السكريبت.
 */
function extractWatchPayload(html) {
  const out = { servers: [], resolveUrl: '', resolveKey: '', csrf: '', playerUrl: '' };

  const arr = /(?:let|const|var)\s+servers\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html);
  if (arr) {
    try {
      const list = JSON.parse(arr[1]);
      if (Array.isArray(list)) out.servers = list.filter((s) => s && typeof s === 'object');
    } catch { /* ignore — old-shape fallback still runs */ }
  }

  const str = (name) => {
    const m = new RegExp(`(?:let|const|var)\\s+${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(html);
    if (!m) return '';
    try { return JSON.parse(m[1]); } catch { return ''; }
  };
  out.resolveKey = str('watchResolveKey');
  out.resolveUrl = str('resolveUrl');
  out.csrf = str('csrfToken');

  const pu = /data-player-url=["']([^"']+)["']/.exec(html);
  if (pu) out.playerUrl = pu[1];

  return out;
}

/**
 * عند التجاوز عبر Scrape.do ننفّذ سكربتاً داخل المتصفح يحلّ كل السيرفرات
 * (نفس IP ونفس الجلسة) ويكتب النتيجة في سمة data-resolved-servers.
 */
const SCRAPE_RESOLVE_ACTIONS = [
  {
    Action: 'Execute',
    Execute:
      "(async()=>{try{" +
      "const out=await Promise.all(servers.map(async(s)=>{try{" +
      "const r=await fetch(resolveUrl,{method:'POST',credentials:'same-origin',headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrfToken,'X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({key:watchResolveKey,token:s.resolve_token})});" +
      "const d=await r.json();return{name:s.name,url:(d&&d.url)||null};" +
      "}catch(_){return{name:s.name,url:null}};}));" +
      "document.body.setAttribute('data-resolved-servers',JSON.stringify(out));" +
      "}catch(e){document.body.setAttribute('data-resolved-servers','[]')}})()"
  },
  { Action: 'Wait', Timeout: 4000 }
];

function parseResolvedServersAttr(html) {
  const m = /data-resolved-servers=["']([^"']+)["']/.exec(html);
  if (!m) return [];
  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  try {
    const list = JSON.parse(decoded);
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && typeof s.url === 'string' && s.url)
      .map((s) => ({ name: String(s.name || 'Shahid4u').trim(), url: s.url }));
  } catch {
    return [];
  }
}

/** حل سيرفر واحد عبر نقطة watch/resolve بنفس كوكيز الجلسة والـ CSRF. */
async function resolveShahidServerDirect(server, payload, { watchUrl, cookieHeader, origin, signal }) {
  if (!server || !server.resolve_token || !payload.resolveUrl || !payload.resolveKey) return '';
  try {
    const res = await fetch(payload.resolveUrl, {
      method: 'POST',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(5000), signal]) : AbortSignal.timeout(5000),
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': payload.csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': encodeURI(watchUrl),
        'Origin': origin,
        'Cookie': cookieHeader
      },
      body: JSON.stringify({ key: payload.resolveKey, token: server.resolve_token })
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data && data.ok === true && typeof data.url === 'string' ? data.url : '';
  } catch {
    return '';
  }
}

/* --- Cloudflare bypass (Scrape.do) ------------------------------------ *
 * sshaahid4u.net answers a managed challenge (403 "Just a moment…") to any
 * plain fetch from this server's IP. When the direct hit fails the request
 * is repeated through Scrape.do: render=true runs a real browser that clears
 * the challenge, while the plain mode is enough for a bare /m/ hop — their
 * Scrape.do-Resolved-Url header then carries the final URL after redirects.
 * Tokens come from env only (scripts/check.js scans for committed secrets);
 * a token that fails with 401/403/429 and never reached the target rotates
 * to the next one, exactly like api/vidsrc-extractor.js does.
 */

const scrapeDoBase = () => (process.env.SCRAPE_DO_BASE || 'https://api.scrape.do').replace(/\/+$/, '');

const SCRAPE_DO_TOKENS = [
  process.env.SCRAPE_DO_TOKEN,
  process.env.SCRAPE_DO_TOKEN_1,
  process.env.SCRAPE_DO_TOKEN_2,
  process.env.SCRAPE_DO_TOKEN_3
]
  .map((t) => (t || '').trim())
  .filter(Boolean)
  .filter((t, i, arr) => arr.indexOf(t) === i);

let scrapeTokenIndex = 0;
const SCRAPE_DO_DEAD = new Set([401, 403, 429]);

/** Is this body/status the Cloudflare challenge rather than the real page? */
function isChallenge(status, body) {
  if (status === 403 || status === 429) return true;
  return typeof body === 'string' && /Just a moment|cf-browser-verification|challenge-platform|Checking your browser/i.test(body.slice(0, 4000));
}

/**
 * One Scrape.do hop. render=true runs a browser (needed to clear the
 * challenge); without it the request is a plain proxied fetch, which is
 * enough for a 302 gate. Returns the Response, or null when no token is
 * configured or the network itself failed (the caller then keeps whatever
 * the direct attempt produced).
 */
async function scrapeDoFetch(targetUrl, { render = false, timeoutMs = 10000, signal, cookies = '', playWithBrowser = null } = {}) {
  if (!SCRAPE_DO_TOKENS.length) return null;

  for (let attempt = 0; attempt < SCRAPE_DO_TOKENS.length; attempt++) {
    const token = SCRAPE_DO_TOKENS[scrapeTokenIndex % SCRAPE_DO_TOKENS.length];
    let endpoint = `${scrapeDoBase()}?token=${encodeURIComponent(token)}&url=${encodeURIComponent(targetUrl)}`;
    if (render) endpoint += '&render=true';
    if (cookies) endpoint += `&setCookies=${encodeURIComponent(cookies)}`;
    if (playWithBrowser) endpoint += `&playWithBrowser=${encodeURIComponent(JSON.stringify(playWithBrowser))}`;

    let res;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        res = await fetch(endpoint, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'hwto.kurd-servers/1.0' }
        });
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    } catch {
      return null; // timeout / abort / network — the direct attempt already failed
    }

    // Their own headers only appear once the request actually reached the
    // target; a bare 401/403/429 without them means this token is dead.
    const reachedTarget = res.headers.get('scrape.do-resolved-url') || res.headers.get('scrape.do-request-cost');
    if (res.ok || !SCRAPE_DO_DEAD.has(res.status) || reachedTarget) return res;
    scrapeTokenIndex = (scrapeTokenIndex + 1) % SCRAPE_DO_TOKENS.length;
  }
  return null;
}

/**
 * Fetch a Shahid4u page: direct first (free), Scrape.do render only when
 * Cloudflare blocked or garbled the direct hit. Never throws.
 *
 * @returns {Promise<{ html: string, via: 'direct'|'scrape.do'|'none', origin: string, cookies: string }>}
 */
async function fetchShahidHtml(url, { headers, signal, timeoutMs = 6000, playWithBrowser = null, bypassTimeoutMs = 12000 } = {}) {
  let status = 0;
  let html = '';
  let origin = '';
  let cookies = '';
  try {
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
      headers
    });
    status = res.status;
    if (res.ok) html = await res.text();
    const jar = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    cookies = jar.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
    try { origin = new URL(res.url || url).origin; } catch { origin = ''; }
  } catch {
    // انتهى وقت الاتصال المباشر — التجاوز أعلاه هو الطريق الوحيد الباقٍ
  }
  if (html && !isChallenge(status, html)) {
    return { html, via: 'direct', origin: origin || new URL(url).origin, cookies };
  }

  const res = await scrapeDoFetch(url, { render: true, signal, timeoutMs: bypassTimeoutMs, playWithBrowser });
  if (!res || !res.ok) return { html: '', via: 'none', origin: '', cookies: '' };
  const body = await res.text();
  if (isChallenge(res.status, body)) return { html: '', via: 'none', origin: '', cookies: '' };
  const resolved = res.headers.get('scrape.do-resolved-url');
  const scrapeCookies = res.headers.get('scrape.do-cookies') || '';
  return {
    html: body,
    via: 'scrape.do',
    origin: resolved ? new URL(resolved).origin : new URL(url).origin,
    cookies: scrapeCookies
  };
}

/**
 * فك رابط البوابة /m/... واستخراج رابط السيرفر الحقيقي عبر ترويسة Location
 *
 * @param {string} gateUrl
 * @param {string} watchUrl
 * @param {string} cookieHeader كوكيز الجلسة المباشرة (قد تكون فارغة عند التجاوز)
 * @param {AbortSignal} [signal]
 * @param {{ scrapeCookies?: string }} [opts] كوكيز Scrape.do-Cookies لبوابة تُطلب عبرها
 */
async function resolveGateUrl(gateUrl, watchUrl, cookieHeader, signal, opts = {}) {
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
    // في حال انتهاء المهلة نجرب عبر Scrape.do قبل الاستسلام
  }

  // Cloudflare (أو انتهاء المهلة) ابتلع التحويل — نطلب البوابة عبر Scrape.do:
  // وضعها الافتراضي يتبع التحويلات ويرجع الرابط النهائي في Scrape.do-Resolved-Url،
  // وإن كانت الصفحة نفسها تحوي iframe فنستخرج مصدره من الجسم.
  const plain = await scrapeDoFetch(gateUrl, { render: false, timeoutMs: 6000, signal, cookies: opts.scrapeCookies });
  const viaHop = (res) => {
    if (!res || !res.ok) return null;
    const resolved = res.headers.get('scrape.do-resolved-url');
    const gateAbs = (() => { try { return new URL(gateUrl, watchUrl).href; } catch { return gateUrl; } })();
    if (resolved && resolved !== gateAbs) return resolved;
    return null;
  };
  const framedSrc = (body, status) => {
    const m = /<iframe[^>]+src=["']([^"']+)/i.exec(body);
    if (!m || isChallenge(status, body)) return null;
    try {
      const u = new URL(m[1], gateUrl);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  };
  const first = viaHop(plain);
  if (first) return first;
  if (plain) {
    try {
      const framed = framedSrc(await plain.text(), plain.status);
      if (framed) return framed;
    } catch { /* body unreadable — try the rendered hop */ }
  }

  const rendered = await scrapeDoFetch(gateUrl, { render: true, timeoutMs: 8000, signal, cookies: opts.scrapeCookies });
  const second = viaHop(rendered);
  if (second) return second;
  if (rendered) {
    try {
      const framed = framedSrc(await rendered.text(), rendered.status);
      if (framed) return framed;
    } catch { /* استُسلم — يرجع الرابط الأصلي */ }
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
    const found = await fetchShahidHtml(searchUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `https://${SHAHEID_HOST}/`
      },
      signal,
      timeoutMs: 6000
    });
    if (found.via !== 'direct') console.log(`[shahid4u] search page via ${found.via}`);
    resText = found.html;
    if (!resText) return [];
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
    const page = await fetchShahidHtml(watchUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html',
        'Referer': `https://${SHAHEID_HOST}/`
      },
      signal,
      timeoutMs: 6000,
      playWithBrowser: SCRAPE_RESOLVE_ACTIONS,
      bypassTimeoutMs: 14000
    });
    if (!page.html) return [];
    if (page.via !== 'direct') console.log(`[shahid4u] watch page via ${page.via}`);

    // 1. استخراج كوكيز الجلسة اللازمة لفك بوابات التحويل
    // (مباشرة من الاستجابة، أو Scrape.do-Cookies عند تجاوز التحدي)
    const cookieHeader = page.cookies;

    const pageHtml = page.html;
    const pageOrigin = page.origin || new URL(rawWatchUrl).origin;

    // 2. قائمة السيرفرات بثلاثة أشكال حسب بنية الصفحة:
    //    (أ) عبر Scrape.do: السكربت داخل المتصفح حلّ كل resolve_token مسبقاً
    //    (ب) مباشرة: POST إلى watch/resolve بنفس الكوكيز والـ CSRF
    //    (ج) احتياط: بنية قديمة بروابط جاهزة أو data-player-url
    const payload = extractWatchPayload(pageHtml);
    let entries = parseResolvedServersAttr(pageHtml);

    if (!entries.length && payload.servers.length && payload.resolveUrl && payload.resolveKey) {
      const settled = await mapLimit(payload.servers, 3, async (s) => {
        const url = await resolveShahidServerDirect(s, payload, {
          watchUrl: rawWatchUrl,
          cookieHeader,
          origin: pageOrigin,
          signal
        });
        return url ? { name: String(s.name || 'Shahid4u').trim(), url } : null;
      });
      entries = settled.filter(Boolean);
      console.log(`[shahid4u] Resolved ${entries.length}/${payload.servers.length} servers via watch/resolve`);
    }

    if (!entries.length) {
      entries = extractShahidServersFromHtml(pageHtml, pageOrigin).map((s) => ({
        name: s.label.replace(/\s*\(Shahid4u\)$/, ''),
        url: s.url
      }));
    }

    if (!entries.length && payload.playerUrl) {
      entries = [{ name: 'Server', url: payload.playerUrl }];
    }

    if (!entries.length) return [];

    const seenUrls = new Set();
    const extracted = entries
      .map((entry, order) => {
        let url = entry.url;
        try { url = new URL(url, pageOrigin).href; } catch { /* احتفظ بالخام */ }
        const isFast = /fastved|fastvip|fastvid/i.test(url) || /fastved|fastvip|fastvid/i.test(entry.name);
        return {
          key: entry.name.toLowerCase(),
          label: isFast ? 'Fastvid (Shahid4u)' : `${entry.name} (Shahid4u)`,
          url,
          host: hostOf(url),
          quality: '',
          source: 'shahid4u',
          _order: order
        };
      })
      .filter((s) => {
        if (seenUrls.has(s.url)) return false;
        seenUrls.add(s.url);
        return true;
      });

    if (!extracted.length) return [];

    console.log(`[shahid4u] Resolving ${extracted.length} gateway URLs...`);

    // 2. فك روابط البوابات /m/... بمحدودية تزامن للحصول على روابط المشاهدة الحقيقية
    const resolvedServers = await mapLimit(extracted, 3, async (server) => {
      const original = server.url;
      let url = original;
      let resolved = !String(original).includes('/m/');
      if (!resolved) {
        const hop = await resolveGateUrl(original, rawWatchUrl, cookieHeader, signal, { scrapeCookies: cookieHeader });
        if (hop && hop !== original) {
          url = hop;
          resolved = true;
        }
      }
      const isFast = /fastved|fastvip|fastvid/i.test(url) || /fastved|fastvip|fastvid/i.test(server.label);
      return {
        ...server,
        url,
        host: hostOf(url),
        label: isFast ? 'Fastvid (Shahid4u)' : server.label,
        _isFast: isFast,
        _resolved: resolved
      };
    });

    // 3. إزالة التكرار: عدة سيرفرات قد تنتهي إلى نفس رابط المشاهدة بعد الفك
    const unique = [];
    const seenFinal = new Set();
    for (const server of resolvedServers) {
      if (seenFinal.has(server.url)) continue;
      seenFinal.add(server.url);
      unique.push(server);
    }

    // 4. فحص حياة السيرفرات المفكوكة: الموقع يعرض سيرفرات كثيرة أغلبها ميت —
    // نسقط المُثبت موته ونبقي العامل فقط. الفحص متوازٍ ومقيّد بميزانية قصيرة،
    // والبوابات التي لم تُفكّ مع توفر تجاوز Scrape.do تُعدّ ميتة أيضاً.
    const probeBudget = AbortSignal.any([AbortSignal.timeout(PROBE_BUDGET_MS), signal].filter(Boolean));
    const alive = [];
    const unverified = [];
    let dropped = 0;
    await Promise.all(
      unique.map(async (server) => {
        if (!server._resolved) {
          if (SCRAPE_DO_TOKENS.length) dropped++;
          else unverified.push(server);
          return;
        }
        const verdict = await probeUrl(server.url, { signal: probeBudget, referer: 'https://sshaahid4u.net/' });
        if (verdict === 'dead') dropped++;
        else alive.push(server);
      })
    );

    // 5. الترتيب: Fastvid العامل أولاً، ثم بقية العاملين بترتيب الصفحة،
    //    ثم غير المتحقق منها — الترتيب حتمي رغم توازي الفحوص
    const sorted = alive
      .sort((a, b) => (b._isFast ? 1 : 0) - (a._isFast ? 1 : 0) || a._order - b._order)
      .concat(unverified.sort((a, b) => a._order - b._order))
      .map(({ _isFast, _resolved, _order, ...rest }) => rest);

    console.log(`[shahid4u] Kept ${sorted.length}/${unique.length} servers (dropped ${dropped} dead)`);
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
 * @param {string}  [args.lang]    'ar' → Shahid4u only, 'ku' (default) → Beenar + kurdcinama only
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{servers:Array, sources:object, matched:object|null, cached:boolean}>}
 */
export async function collectServers({ type, title, year, season, episode, tmdbid, movieid, lang, signal } = {}) {
  const media = type === 'tv' ? 'tv' : 'movie';
  // Language groups: Arabic gets the Shahid4u catalogue, Kurdish gets the two
  // Kurdish sources. Anything else (or nothing) falls back to Kurdish, which
  // is this site's own language. Running one group instead of all three cuts
  // the server's upstream work to roughly a third.
  const serverLang = lang === 'ar' ? 'ar' : 'ku';
  const cacheKey = [media, serverLang, norm(title), Number(year) || 0, Number(season) || 0, Number(episode) || 0, tmdbid || ''].join('|');
  const hit = resultCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };

  const budget = signal ? AbortSignal.any([AbortSignal.timeout(19000), signal]) : AbortSignal.timeout(19000);

  // --- Source 1: Beenar (Kurdish group) --------------------------------
  let matched = null;
  let beenarVideos = [];
  if (serverLang === 'ku') {
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

  // --- Source 2: kurdcinama (Kurdish group, movies only) ---------------
  if (serverLang === 'ku' && media === 'movie') {
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

  // --- Source 3: Shahid4u (Arabic group) -------------------------------
  if (serverLang === 'ar') {
    try {
      const shahidServers = await findShahid4uServers({ type: media, title, year, season, episode, signal: budget });
      if (shahidServers.length) {
        candidates.unshift(...shahidServers);
      }
    } catch (err) {
      console.error('[shahid4u]', err && err.message);
    }
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
