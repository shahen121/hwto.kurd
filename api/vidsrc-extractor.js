/**
 * VidSrc extractor — walks the relay chain to the real stream list.
 *
 * Usage:  GET /api/vidsrc-extractor?id=<tmdb-id>&type=movie|tv&season=&episode=
 *
 * What the site actually does (verified 2026-10-11, movie 843 + TV 1396):
 *
 *   1. vidsrc.to/embed/{movie|tv}/...   -> one <iframe> to vsembed.ru
 *   2. vsembed.ru/vs_src.php?type=...   -> JSON { src: "<player>?vs=<signed>" }
 *   3. that page                        -> window.CFG.playerUrl (+ .metaApi)
 *   4. /embed/player/...                -> window.CONFIG.api + CONFIG.apiToken
 *   5. CONFIG.api&api_token=<jwt>       -> { data.stream_urls, vs: { wasm_url } }
 *
 * Step 5 is the only place the stream list exists, and it is never in HTML:
 *   - the token is a JWT carrying the caller's IP and a nonce, so it is bound
 *     to whoever fetched the player page (step 4);
 *   - it is single-use, so it must be spent from the same IP that minted it;
 *   - stream_urls comes back as one base64 string, decrypted by a per-window
 *     ChaCha20 WASM module (vsdec.js).
 *
 * Because every hop must share an egress IP, the whole chain runs through
 * Scrape.do. `render=true` is what makes the browser execute steps 2-4 and call
 * step 5 from its own IP; `returnJSON=true` hands back that call's response,
 * which is the encrypted payload plus the wasm_url. Decryption happens here via
 * Node's WebAssembly, and the stream list is returned in the clear so the
 * frontend can hand a URL to /api/fastvid + hls.js.
 *
 * Design notes:
 *   - Token comes from SCRAPE_DO_TOKEN env only (scripts/check.js scans for
 *     committed secrets; Vercel injects the real one at runtime).
 *   - The TMDB id is a bare number, so the target can never leave the VidSrc
 *     embed path.
 *   - Only successful extractions are cached, and only for STREAM_TTL_MS: the
 *     URLs are short-lived and IP-bound, so serving a stale one is worse than
 *     re-extracting. Failures are never cached.
 *   - A playlist is accepted only when it parses as a real http(s) URL, so an
 *     upstream error page can never be handed to the player as a stream.
 */

const FETCH_TIMEOUT_MS = Number(process.env.VIDSRC_FETCH_TIMEOUT_MS) || 30000;
const STREAM_TTL_MS = Number(process.env.VIDSRC_STREAM_TTL_MS) || 60 * 1000;
// Failures back off longer than successes so a broken embed can't burn the
// Scrape.do budget with one request per page view.
const MISS_TTL_MS = Number(process.env.VIDSRC_MISS_TTL_MS) || 30 * 1000;

const cache = new Map();

export function scrapeDoBase() {
  return (process.env.SCRAPE_DO_BASE || 'https://api.scrape.do').replace(/\/+$/, '');
}

// Multiple Scrape.do tokens: the primary first, then backups. On a 401/403/429
// (quota exhausted / key revoked) we rotate to the next token so one dead
// account never takes the service down. Env only — never committed.
const SCRAPE_DO_TOKENS = [
  process.env.SCRAPE_DO_TOKEN,
  process.env.SCRAPE_DO_TOKEN_1,
  process.env.SCRAPE_DO_TOKEN_2,
  process.env.SCRAPE_DO_TOKEN_3
]
  .map((t) => (t || '').trim())
  .filter(Boolean)
  // de-dup so a duplicated env var doesn't waste a rotation slot
  .filter((t, i, arr) => arr.indexOf(t) === i);

// Index of the token we currently prefer; advances past dead tokens.
let activeTokenIndex = 0;

/** Scrape.do statuses that mean "this token is out of credit / dead". */
const DEAD_TOKEN_STATUS = new Set([401, 403, 429]);

function scrapeDoToken() {
  if (!SCRAPE_DO_TOKENS.length) return '';
  return SCRAPE_DO_TOKENS[activeTokenIndex % SCRAPE_DO_TOKENS.length];
}

/** Rotate to the next token (wraps around). Returns the new active token. */
function rotateScrapeDoToken() {
  if (!SCRAPE_DO_TOKENS.length) return '';
  activeTokenIndex = (activeTokenIndex + 1) % SCRAPE_DO_TOKENS.length;
  return SCRAPE_DO_TOKENS[activeTokenIndex];
}

/**
 * Validate season/episode for a TV request. Both must be positive integers.
 * Returns { ok: true, season, episode } or { ok: false, error }.
 */
export function normaliseEpisodeParams(season, episode) {
  const n = (v) => (/^\d{1,4}$/.test(String(v == null ? '' : v).trim()) ? Number(v) : null);
  const s = n(season);
  const e = n(episode);
  if (s === null || e === null || s < 1 || e < 1) {
    return { ok: false, error: 'TV requests need numeric season and episode (e.g. ?type=tv&season=1&episode=3)' };
  }
  return { ok: true, season: s, episode: e };
}

/**
 * Validate and normalise the incoming TMDB id.
 * Accepts "843", 843, " 843 " — rejects "843/../../evil", "abc", "", null.
 * Returns a bare numeric string, or null when unusable.
 */
export function normaliseTmdbId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,10}$/.test(id)) return null;
  return id;
}

/** Build the VidSrc embed URL for a movie or a TV episode. */
export function buildEmbedUrl({ id, type = 'movie', season, episode }) {
  const base = (process.env.VIDSRC_BASE || 'https://vidsrc.to').replace(/\/+$/, '');
  if (type === 'tv') {
    const s = Number(season) || 1;
    const e = Number(episode) || 1;
    return `${base}/embed/tv/${id}/${s}-${e}`;
  }
  return `${base}/embed/movie/${id}`;
}

/**
 * Absolute-ise a possibly-relative src found inside a frame.
 * Returns null when the input is unusable or cannot be resolved against
 * `baseUrl`. Callers pass the frame URL as the base so a relative hop keeps
 * its origin; `baseUrl` may be '' when the src is already absolute.
 */
export function resolveFrameUrl(src, baseUrl) {
  const raw = String(src || '').trim();
  if (!raw) return null;
  if (raw.startsWith('//')) {
    try {
      return new URL(`https:${raw}`).toString();
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).toString();
    } catch {
      return null;
    }
  }
  if (!baseUrl) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Decode the JS/JSON string escaping these players use, so a URL written as
 * "https:\/\/host\/x" is searchable as a plain URL.
 */
export function decodeEscaped(text) {
  return String(text || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

/** Pull the first .m3u8 playlist URL out of an arbitrary text blob.
 * Handles JSON-escaped slashes ("https:\/\/") and bare relative paths.
 * Returns the playlist URL, or null. */
export function extractPlaylistUrl(text) {
  const decoded = decodeEscaped(text);
  const abs = decoded.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/i);
  if (abs) return abs[0];
  const rel = decoded.match(/["']([^"'\s<>]+\.m3u8[^"'\s<>]*)["']/i);
  return rel ? rel[1].trim() : null;
}

/** A playlist is only usable if it looks like a real stream, not a placeholder
 * or an asset that happens to share the extension. */
export function looksLikePlaylist(url) {
  const u = String(url || '').toLowerCase();
  if (!u.includes('.m3u8')) return false;
  if (/\/(placeholder|example|sample|test)\b/.test(u)) return false;
  return u.startsWith('http') || u.startsWith('/');
}

/** Pull iframe src candidates out of an HTML body, in document order. */
export function extractIframeSrcs(html) {
  const body = String(html || '');
  const out = [];
  const re = /<iframe[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    const absolute = resolveFrameUrl(raw, '');
    out.push(absolute || raw);
  }
  return out;
}

/**
 * Pull window.CFG / window.CONFIG objects out of a rendered page.
 * The relay page carries CFG (metaApi + playerUrl); the player page carries
 * CONFIG (api + apiToken + streamBase). Both are single-line object literals.
 */
export function extractConfigObject(html, name) {
  const body = String(html || '');
  const re = new RegExp(`window\\.${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`, 'm');
  const m = body.match(re);
  if (!m) return null;
  try {
    return JSON.parse(decodeEscaped(m[1]));
  } catch {
    return null;
  }
}

function withDeadline(ms, signalController) {
  const t = setTimeout(() => signalController.abort(), ms);
  return () => clearTimeout(t);
}

/**
 * Fetch a URL through Scrape.do with JS rendering enabled.
 * `render` is spent per call, so callers should cache.
 * Takes an explicit token so the fallback walker can drive the rotation.
 */
async function fetchViaScrapeDoWithToken(
  targetUrl,
  token,
  { network = false, frames = false } = {}
) {
  let endpoint =
    `${scrapeDoBase()}?token=${encodeURIComponent(token)}` +
    `&url=${encodeURIComponent(targetUrl)}&render=true`;
  // returnJSON swaps the body from HTML to a JSON report whose networkRequests
  // carry the request and response of every XHR/fetch the page makes. That is
  // where these players keep the playlist: the HTML never contains it.
  if (network || frames) endpoint += '&returnJSON=true';
  if (frames) endpoint += '&showFrames=true';

  const controller = new AbortController();
  const done = withDeadline(FETCH_TIMEOUT_MS, controller);
  try {
    return await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'User-Agent': 'hwto.kurd-extractor/1.0' }
    });
  } finally {
    done();
  }
}

/**
 * Single-token fetch (kept for callers that don't want pool rotation).
 */
async function fetchViaScrapeDo(targetUrl, opts = {}) {
  const token = scrapeDoToken();
  if (!token) {
    const err = new Error('SCRAPE_DO_TOKEN is not set');
    err.code = 'CONFIG';
    throw err;
  }
  return fetchViaScrapeDoWithToken(targetUrl, token, opts);
}

/**
 * Fetch through Scrape.do, rotating to the next token whenever the current one
 * comes back dead (401/403/429 = out of credit / revoked). Stops after one full
 * lap over the pool so a systemic outage doesn't loop forever.
 */
async function fetchViaScrapeDoWithFallback(targetUrl, opts = {}) {
  if (!SCRAPE_DO_TOKENS.length) {
    const err = new Error('SCRAPE_DO_TOKEN is not set');
    err.code = 'CONFIG';
    throw err;
  }
  const laps = SCRAPE_DO_TOKENS.length;
  for (let attempt = 0; attempt < laps; attempt++) {
    const token = scrapeDoToken();
    const res = await fetchViaScrapeDoWithToken(targetUrl, token, opts);
    if (res.ok || !DEAD_TOKEN_STATUS.has(res.status)) return res;
    // dead token — burn it and try the next account
    rotateScrapeDoToken();
  }
  // every token is dead; return the last response so the caller sees the error
  return fetchViaScrapeDoWithToken(targetUrl, scrapeDoToken(), opts);
}

/**
 * Turn a Scrape.do returnJSON report into the set of text blobs worth
 * searching: every captured request URL and response body, plus every iframe's
 * URL and content. Anything malformed is skipped rather than thrown, because
 * one odd request must not sink the whole extraction.
 */
export function harvestBlobs(report) {
  const blobs = [];
  const seen = new Set();
  const push = (v) => {
    if (typeof v !== 'string' || !v) return;
    if (seen.has(v)) return;
    seen.add(v);
    blobs.push(v);
  };

  const reqs = report && (report.networkRequests || report.network);
  if (Array.isArray(reqs)) {
    for (const r of reqs) {
      if (!r || typeof r !== 'object') continue;
      push(r.request || r.requestUrl || r.url);
      push(r.response || r.responseBody || r.body);
    }
  }

  const frs = report && (report.frames || report.iframes);
  if (Array.isArray(frs)) {
    for (const f of frs) {
      if (!f || typeof f !== 'object') continue;
      push(f.url || f.src);
      push(f.content || f.html || f.body);
    }
  }

  return blobs;
}

/**
 * Ask Scrape.do for a rendered page and return { html, blobs, json }.
 * `json` is the parsed report when the body was JSON (render+returnJSON), so
 * callers can read `json.response` as the page HTML and search the captured
 * traffic in `blobs`.
 */
async function capture(targetUrl, { network = true, frames = true } = {}) {
  const res = await fetchViaScrapeDoWithFallback(targetUrl, { network, frames });
  if (!res.ok) throw await upstreamError(res);

  const raw = await res.text();
  const trimmed = raw.trim();
  const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');

  if (isJson) {
    let report = null;
    try {
      report = JSON.parse(trimmed);
    } catch {
      report = null;
    }
    if (report) {
      return {
        html: String(report.response || report.content || ''),
        blobs: harvestBlobs(report),
        json: report,
        raw
      };
    }
    return { html: raw, blobs: [raw], json: null, raw };
  }

  return { html: raw, blobs: [raw], json: null, raw };
}

/** Turn a failed upstream response into an error carrying a readable reason. */
async function upstreamError(response) {
  const raw = await response.text().catch(() => '');
  const snippet = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const err = new Error(`scrape.do ${response.status}`);
  err.status = response.status;
  err.details = snippet;
  return err;
}

/* ------------------------------------------------------------------ *
 * WASM decryption of the `data.stream_urls` envelope (vsdec.js port).
 * The API returns base64 ChaCha20 nonce||ciphertext; the per-window
 * module exposes alloc/decrypt/memory. The first 12 bytes are the
 * nonce, so the plaintext starts at offset 12.
 * ------------------------------------------------------------------ */

export function b64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decrypt one envelope with a compiled WASM module. Returns the plaintext. */
export async function decryptWithModule(modPromise, encryptedB64) {
  const mod = await modPromise;
  const inst = await WebAssembly.instantiate(mod, {});
  const ex = inst.exports;
  const enc = b64ToBytes(encryptedB64);
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen));
}

/** Compile a wasm module once per URL so repeated extractions reuse it. */
const wasmModules = new Map();

/**
 * The wasm_url comes from third-party page data (the CONFIG payload), so its
 * HOST must be on this allowlist before the module is downloaded and
 * compiled. Default: the VidSrc family; extendable via
 * VIDSRC_WASM_ALLOW_HOSTS (comma list). A non-listed host means no
 * decryption -> the caller sees an empty playlist list, not a crash.
 */
function wasmAllowlist() {
  const fromEnv = (process.env.VIDSRC_WASM_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length
    ? fromEnv
    : ['vidsrc.to', 'vidsrc.pm', 'vidsrc.xyz', 'vidsrc.cc', 'vsembed.ru', 'vsembed.win'];
}

export function isAllowedWasmUrl(wasmUrl) {
  let url;
  try {
    url = new URL(String(wasmUrl || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const ok = wasmAllowlist().some((allowed) => host === allowed || host.endsWith('.' + allowed));
  return ok ? url : null;
}

function compileWasm(rawUrl) {
  if (!wasmModules.has(rawUrl)) {
    const url = isAllowedWasmUrl(rawUrl);
    const gate = url
      ? Promise.resolve(url.href)
      : Promise.reject(Object.assign(new Error(`wasm host not allowed: ${String(rawUrl).slice(0, 80)}`), { code: 'WASM_HOST' }));
    wasmModules.set(
      rawUrl,
      gate
        .then((href) => fetch(href))
        .then((r) => {
          if (!r.ok) throw new Error(`wasm ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => WebAssembly.compile(b))
    );
  }
  return wasmModules.get(rawUrl);
}


/**
 * Turn a stream_urls envelope into a list of playlist URLs.
 * Returns { playlists: string[], decrypted: boolean }.
 * When the payload is already an array it is passed through unchanged.
 */
export async function resolveStreamUrls(payload) {
  const vs = payload && payload.vs;
  const urls = payload && payload.data ? payload.data.stream_urls : payload;
  if (Array.isArray(urls)) return { playlists: urls.filter(Boolean), decrypted: false };
  if (typeof urls !== 'string' || !vs) return { playlists: [], decrypted: false };
  const wasmUrl = vs.wasm_url
    ? resolveFrameUrl(decodeEscaped(vs.wasm_url), null)
    : null;
  if (!wasmUrl) return { playlists: [], decrypted: false };
  try {
    const text = await decryptWithModule(compileWasm(wasmUrl), urls);
    return { playlists: text.split('\n').filter(Boolean), decrypted: true };
  } catch (err) {
    const reason = err && (err.code === 'WASM_HOST' ? 'host not allowlisted' : err.message);
    console.error('[vidsrc-extractor] wasm decryption skipped:', reason);
    return { playlists: [], decrypted: false };
  }
}

/**
 * Mint a per-host playback token from the CDN's /generate.php.
 * The decrypted playlists point at a CDN host (e.g. /pl/.../master.m3u8) that
 * answers 401 "no token" until this JWT is appended as ?token=. The token is
 * minted server-side from the same origin as the playlist, so the CDN sees one
 * egress IP for both mint and manifest fetch. Returns '' when minting fails,
 * because a tokenless URL is still worth handing to the player (it may play).
 */
export async function mintPlaybackToken(playlistUrl) {
  try {
    const { origin } = new URL(playlistUrl);
    const res = await fetch(`${origin}/generate.php`, {
      method: 'GET',
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'hwto.kurd-extractor/1.0', Accept: '*/*' }
    });
    if (!res.ok) return '';
    const text = (await res.text()).trim();
    // The CDN returns a bare JWT; anything else (an HTML error page) is useless.
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text) ? text : '';
  } catch {
    return '';
  }
}

/** Append ?token=<jwt> to a playlist URL so the CDN serves it. */
export function applyPlaybackToken(playlistUrl, token) {
  if (!token) return playlistUrl;
  try {
    const u = new URL(playlistUrl);
    u.searchParams.set('token', token);
    return u.toString();
  } catch {
    return playlistUrl;
  }
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/**
 * Walk one hop through Scrape.do and, when a playlist appears in the captured
 * traffic, return it immediately. Also surfaces any CONFIG/CFG objects found so
 * the caller can follow the chain deliberately instead of guessing.
 */
async function walkHops(startUrl, { maxFrames = 3 } = {}) {
  const visited = new Set();
  const queue = [startUrl];
  let lastIframe = null;
  let hops = 0;

  while (queue.length && hops < maxFrames) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    hops += 1;

    const { html, blobs, json } = await capture(current);

    for (const blob of blobs.concat(html)) {
      const found = extractPlaylistUrl(blob);
      if (found && looksLikePlaylist(found)) {
        const streamUrl = resolveFrameUrl(found, current);
        if (streamUrl) return { stream_url: streamUrl, hops, lastIframe, cfg: null };
      }
    }

    const cfg = extractConfigObject(html, 'CONFIG') || extractConfigObject(html, 'CFG');
    const children = extractIframeSrcs(html)
      .map((s) => resolveFrameUrl(s, current) || s)
      .filter((s) => !visited.has(s));
    if (children.length) lastIframe = children[0];
    queue.push(...children);

    // A CFG/CONFIG object names the next hop exactly (playerUrl/api), so stop
    // walking: continuing would only burn more rendered fetches on frames the
    // chain never uses.
    if (cfg && (cfg.playerUrl || cfg.api || cfg.streamBase || cfg.metaApi)) {
      return { stream_url: null, hops, lastIframe, cfg, html, json };
    }
  }

  return { stream_url: null, hops, lastIframe, cfg: null };
}

/**
 * Follow the relay chain to the stream_urls payload and decrypt it.
 * Returns { stream_url, playlists, hops } or throws with a readable status.
 */
export async function extract({ id, type = 'movie', season, episode }) {
  const embedUrl = buildEmbedUrl({ id, type, season, episode });

  const first = await walkHops(embedUrl);
  if (first.stream_url) {
    return { stream_url: first.stream_url, playlists: [first.stream_url], hops: first.hops };
  }

  // No playlist in the HTML traffic — follow CFG.playerUrl to the player page,
  // which is where CONFIG.api and the single-use apiToken live.
  const cfg = first.cfg;
  if (!cfg || !cfg.playerUrl) {
    return { stream_url: null, playlists: [], hops: first.hops, iframe_url: first.lastIframe };
  }

  const playerUrl = resolveFrameUrl(decodeEscaped(cfg.playerUrl), first.lastIframe || embedUrl);
  if (!playerUrl) {
    return { stream_url: null, playlists: [], hops: first.hops, iframe_url: first.lastIframe };
  }

  const second = await walkHops(playerUrl);
  const config = second.cfg || {};
  const streamBase = config.streamBase || config.api || cfg.metaApi;
  if (!streamBase) {
    return { stream_url: null, playlists: [], hops: first.hops + second.hops, iframe_url: playerUrl };
  }

  // The token is single-use and IP-bound, so the stream_urls call must leave
  // from the same browser that minted it. Ask Scrape.do to do that final hop
  // too, then decrypt whatever comes back.
  const target = new URL(decodeEscaped(streamBase), playerUrl);
  target.searchParams.set('stream_urls', '');
  if (config.apiToken) target.searchParams.set('api_token', config.apiToken);

  const { blobs } = await capture(target.toString(), { network: false, frames: false });
  for (const blob of blobs) {
    let payload = null;
    try {
      payload = JSON.parse(decodeEscaped(blob));
    } catch {
      continue;
    }
    if (!payload || !payload.data || !payload.data.stream_urls) continue;
    const { playlists } = await resolveStreamUrls(payload);
    const playable = playlists.find((u) => looksLikePlaylist(u));
    if (playable) {
      // The CDN serves the decrypted /pl/.../master.m3u8 only with ?token=<jwt>
      // minted from /generate.php on the same origin. The child variant lines in
      // the master body already carry their own ?token=, so handing the tokened
      // master to the player (hls.js -> /api/fastvid) covers the whole tree.
      const token = await mintPlaybackToken(playable);
      const tokened = applyPlaybackToken(playable, token);
      return {
        stream_url: tokened,
        playlists: playlists.map((u) => (u === playable ? tokened : u)),
        player_url: playerUrl,
        token,
        hops: first.hops + second.hops + 1
      };
    }
  }

  return {
    stream_url: null,
    playlists: [],
    hops: first.hops + second.hops + 1,
    iframe_url: playerUrl
  };
}

function cachedGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cachedSet(key, statusCode, body) {
  const ttl = statusCode === 200 ? STREAM_TTL_MS : MISS_TTL_MS;
  cache.set(key, { statusCode, body, expires: Date.now() + ttl });
}

export default async function handler(req, res) {
  const id = normaliseTmdbId(req.query?.id);
  if (!id) {
    return res
      .status(400)
      .json({ error: 'Missing or invalid id parameter (expected a numeric TMDB id)' });
  }
  const type = String(req.query?.type || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
  const season = req.query?.season;
  const episode = req.query?.episode;

  // A TV request without usable season/episode would silently build a movie
  // URL, so reject it up front rather than returning the wrong title's stream.
  let epParams = { season: undefined, episode: undefined };
  if (type === 'tv') {
    const parsed = normaliseEpisodeParams(season, episode);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    epParams = { season: parsed.season, episode: parsed.episode };
  }

  if (!scrapeDoToken()) {
    return res
      .status(503)
      .json({ error: 'SCRAPE_DO_TOKEN is not configured on this deployment' });
  }

  const key = `${id}:${type}:${epParams.season || ''}:${epParams.episode || ''}`;
  const cached = cachedGet(key);
  if (cached) {
    res.setHeader('Cache-Control', cached.statusCode === 200 ? 'public, max-age=60' : 'no-store');
    return res.status(cached.statusCode).json({
      ...cached.body,
      ...(cached.statusCode === 200 ? { source: 'cache' } : {})
    });
  }

  try {
    const result = await extract({ id, type, ...epParams });

    if (!result.stream_url) {
      const body = {
        error: 'لم يتم العثور على رابط التشغيل داخل الصفحة',
        ...(result.iframe_url ? { iframe_url: result.iframe_url } : {})
      };
      cachedSet(key, 404, body);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json(body);
    }

    const body = {
      success: true,
      stream_url: result.stream_url,
      source: 'scrape.do',
      // Segments need Referer = the player host; /api/fastvid reads this to set it.
      ...(result.player_url ? { player_url: result.player_url } : {}),
      ...(result.playlists && result.playlists.length > 1 ? { playlists: result.playlists } : {})
    };
    cachedSet(key, 200, body);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(body);
  } catch (error) {
    if (error && error.code === 'CONFIG') {
      return res.status(503).json({ error: 'SCRAPE_DO_TOKEN is not configured on this deployment' });
    }
    const upstream = error && error.status ? error.status : 500;
    // Never cache failures — a transient bot-wall miss should not stick.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream >= 400 && upstream < 600 ? upstream : 500).json({
      error: 'فشل الاستخراج من VidSrc',
      ...(error && error.details ? { details: error.details } : {})
    });
  }
}
