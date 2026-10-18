/**
 * lib/subtitles.mjs — automatic subtitle lookup by TMDB id, shared by
 * server.js (local) and api/proxy.js (Vercel). One implementation, two hosts.
 *
 * Ordered sources (first hit wins):
 *
 *   1. Wyzie Subs (https://sub.wyzie.io) — needs a free API key via env
 *      WYZIE_API_KEY (store.wyzie.io/redeem; 1000 requests/day free).
 *        GET /search?id=<tmdb_id>&language=<code>[&season=&episode=]&key=
 *      Rows carry {url, language, format, encoding, isHearingImpaired, ai}.
 *
 *   2. vidcore.io/wyzie — the same catalogue, served keyless through the
 *      public proxy the VidCore player itself uses for every embed:
 *        GET https://vidcore.io/wyzie?id=<tmdb>[&season=&episode=]
 *      -> [{display, language, url, encoding}]
 *      NOTE: despite the "encoding" field, downloaded files are legacy SRT
 *      and often windows-1256 (Arabic), not UTF-8 — the charset fallback
 *      below handles that before any conversion.
 *
 *   3. SubDL (https://api.subdl.com) — needs a free key via env SUBDL_API_KEY.
 *        GET /api/v1/subtitles?api_key=&tmdb_id=&type=&languages=AR&unpack=1
 *      unpack=1 exposes per-file raw URLs on dl.subdl.com (zip otherwise);
 *      anonymous IPs get 300 downloads/day, hence the last place.
 *
 * Everything is normalised to WebVTT before serving: SRT -> VTT (dot
 * timestamps + a WEBVTT header; ASS leftovers are stripped by the player's
 * own parser). The language list and every converted file are cached in
 * memory, so a probe costs one upstream request per title and each file is
 * fetched once per process.
 */

import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const WYZIE = 'https://sub.wyzie.io';
const VIDCORE_WYZIE = 'https://vidcore.io/wyzie';
const SUBDL = 'https://api.subdl.com';
const SUBDL_DL = 'https://dl.subdl.com';

const LIST_TTL_MS = 30 * 60 * 1000;
const FILE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const LIST_CACHE_MAX = 400;
const FILE_CACHE_MAX = 200;

const listCache = new Map();
const fileCache = new Map();

/* ------------------------------------------------------------------ *
 * HTTP + charset + format helpers                                    *
 * ------------------------------------------------------------------ */

function timeout(ms, external) {
  const parts = [AbortSignal.timeout(ms)];
  if (external) parts.push(external);
  return parts.length > 1 ? AbortSignal.any(parts) : parts[0];
}

async function fetchJson(url, signal, timeoutMs = 10000) {
  try {
    const res = await fetch(url, {
      signal: timeout(timeoutMs, signal),
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * The proxies serve legacy charsets while labelling everything UTF-8, and
 * cp1256 Arabic often happens to be *valid* UTF-8 byte sequences that merely
 * decode to mojibake, so validity alone is not enough: each candidate decode
 * is scored against the requested language (Arabic-script share) and the
 * best-scoring decode wins. UTF-8 validity only breaks ties.
 */
function decodeBytes(buffer, lang) {
  const arScore = (text) => (text.match(/[\u0600-\u06FF]/g) || []).length;
  const garbleScore = (text) =>
    (text.match(/[\uFFFD\u00C0-\u00FF\u0100-\u024F]/g) || []).length;

  const candidates = [];
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    candidates.push({ tag: 'utf-8', text: utf8 });
  } catch {
    /* not valid UTF-8 */
  }
  for (const tag of lang === 'ar' || lang === 'ku' ? ['windows-1256', 'windows-1252'] : ['windows-1252', 'windows-1256']) {
    try {
      candidates.push({ tag, text: new TextDecoder(tag).decode(buffer) });
    } catch {
      /* next */
    }
  }
  if (!candidates.length) return buffer.toString('latin1');

  const wantArabic = lang === 'ar' || lang === 'ku';
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    // Arabic-script presence is the decisive signal for ar/ku; garble
    // (mojibake or replacement chars) is penalised for every language.
    const score = (wantArabic ? arScore(c.text) * 2 : 0) - garbleScore(c.text) + (c.tag === 'utf-8' ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best.text;
}

/** True when the text is already WebVTT. */
function isVtt(text) {
  return /^\uFEFF?\s*WEBVTT\b/i.test(text);
}

/** SRT (or VTT-unknown) text -> guaranteed WebVTT with dotted timestamps. */
function toVtt(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  if (isVtt(clean)) return clean;
  const dotted = clean.replace(/(\d{1,2}:\d{1,2}:\d{1,2}),(\d{1,3})/g, '$1.$2');
  return `WEBVTT\n\n${dotted.trim()}\n`;
}

/** Minimal ZIP reader: returns the first .srt/.vtt member (SubDL packs). */
function zipSubtitleEntry(buffer) {
  if (buffer.length < 30) return null;
  let off = 0;
  let first = null;
  while (off + 30 <= buffer.length && buffer.readUInt32LE(off) === 0x04034b50) {
    const method = buffer.readUInt16LE(off + 8);
    let size = buffer.readUInt32LE(off + 18);
    const nameLen = buffer.readUInt16LE(off + 26);
    const extraLen = buffer.readUInt16LE(off + 28);
    const flags = buffer.readUInt16LE(off + 6);
    const nameStart = off + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString('latin1').toLowerCase();
    const dataStart = nameStart + nameLen + extraLen;
    if (flags & 0x08) {
      // data descriptor: length in the header is 0 — cut at the next signature
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      size = (next === -1 ? buffer.length : next) - dataStart;
    }
    if (/\.(srt|vtt)$/.test(name)) {
      const raw = buffer.subarray(dataStart, dataStart + size);
      try {
        const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
        first = { name, data };
        break;
      } catch {
        /* keep scanning */
      }
    }
    off = dataStart + size;
  }
  return first;
}

/* ------------------------------------------------------------------ *
 * Rows                                                               *
 * ------------------------------------------------------------------ */

function normaliseWyzieRow(row) {
  if (!row || !row.url || !row.language) return null;
  return {
    code: String(row.language).toLowerCase(),
    label: String(row.display || row.language).trim(),
    url: String(row.url),
    encoding: String(row.encoding || '').trim(),
    hearing: row.isHearingImpaired === true,
    ai: row.ai === true,
    kind: 'wyzie'
  };
}

function wyzieParams(tmdbId, media, season, episode, lang) {
  const params = new URLSearchParams({ id: String(tmdbId) });
  if (lang) params.set('language', lang);
  if (media === 'tv') {
    params.set('season', String(Math.max(1, Number(season) || 1)));
    params.set('episode', String(Math.max(1, Number(episode) || 1)));
  }
  return params;
}

function subdlLang(lang) {
  return { ar: 'AR', ku: 'KU', en: 'EN' }[String(lang || '').toLowerCase()] || '';
}

/**
 * Every candidate row for one title (+optional language).
 * Keyed sources first, the keyless vidcore proxy second, SubDL last.
 */
async function collectRows({ tmdbId, media, season = '', episode = '', lang = '', signal } = {}) {
  let rows = [];

  const wyzieKey = (process.env.WYZIE_API_KEY || '').trim();
  if (wyzieKey) {
    const params = wyzieParams(tmdbId, media, season, episode, lang);
    params.set('key', wyzieKey);
    const json = await fetchJson(`${WYZIE}/search?${params}`, signal);
    if (Array.isArray(json)) rows = json.map(normaliseWyzieRow).filter(Boolean);
  }

  {
    // A `language` query makes vidcore's keyless proxy hand out different
    // (and frequently 503-broken) tokens, so it is ALWAYS queried with the
    // full list and narrowed locally by `lang`.
    const params = wyzieParams(tmdbId, media, season, episode, '');
    const json = await fetchJson(`${VIDCORE_WYZIE}?${params}`, signal);
    if (Array.isArray(json)) {
      const all = json.map(normaliseWyzieRow).filter(Boolean);
      rows = rows.concat(lang ? all.filter((r) => r.code === String(lang).toLowerCase()) : all);
    }
  }

  // The keyed Wyzie API supports a proper language filter; SubDL takes one
  // too. Both are only reached when earlier sources came up empty, so the
  // extra `language` narrowing is safe: if rows already exist we skip them.
  const subdlKey = (process.env.SUBDL_API_KEY || '').trim();
  if (!rows.length && subdlKey && lang) {
    try {
      const params = new URLSearchParams({
        api_key: subdlKey,
        tmdb_id: String(tmdbId),
        type: media,
        languages: subdlLang(lang),
        unpack: '1'
      });
      if (media === 'tv') {
        params.set('season_number', String(Math.max(1, Number(season) || 1)));
        params.set('episode_number', String(Math.max(1, Number(episode) || 1)));
      }
      const json = await fetchJson(`${SUBDL}/api/v1/subtitles?${params}`, signal);
      if (json && json.status === true && Array.isArray(json.subtitles)) {
        for (const sub of json.subtitles) {
          for (const file of sub.unpack_files || []) {
            const rawUrl = file.url || '';
            rows.push({
              code: String(file.language || '').toLowerCase(),
              label: String(file.name || file.release_name || sub.release_name || subdlLang(lang)).trim(),
              url: rawUrl.startsWith('http') ? rawUrl : `${SUBDL_DL}${rawUrl}`,
              encoding: 'UTF-8',
              hearing: Boolean(file.hi),
              ai: false,
              kind: 'subdl'
            });
          }
        }
      }
    } catch {
      /* SubDL is optional */
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ *
 * Public API                                                         *
 * ------------------------------------------------------------------ */

/**
 * Languages available for one title: [{code, label}] — [] when nothing is
 * found. One upstream probe per title; replayed from the cache for 30 min.
 */
export async function listSubtitles({ id, type = 'movie', season, episode, signal } = {}) {
  const media = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = String(id || '').trim();
  if (!/^\d{1,10}$/.test(tmdbId)) return [];

  const cacheKey = `${media}/${tmdbId}/${season || ''}x${episode || ''}`;
  const hit = listCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.languages;

  const rows = await collectRows({ tmdbId, media, season, episode, signal });

  const byCode = new Map();
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, { code: row.code, label: row.label });
  }
  const languages = [...byCode.values()];

  if (languages.length) {
    listCache.set(cacheKey, { expires: Date.now() + LIST_TTL_MS, languages });
    if (listCache.size > LIST_CACHE_MAX) {
      const oldest = listCache.keys().next().value;
      listCache.delete(oldest);
    }
  }
  return languages;
}

/**
 * One subtitle file for `lang`, converted to WebVTT. `{vtt, source}` or null
 * (Kurdish comes back null until a source carries it — that is a valid
 * answer, not an error).
 */
export async function getSubtitleVtt({ id, type = 'movie', lang, season, episode, signal } = {}) {
  const media = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = String(id || '').trim();
  const code = String(lang || '').trim().toLowerCase();
  if (!/^\d{1,10}$/.test(tmdbId) || !/^[a-z]{2,5}(-[a-z]{2,5})?$/.test(code)) return null;

  const key = `${media}/${tmdbId}/${season || ''}x${episode || ''}/${code}`;
  const hit = fileCache.get(key);
  if (hit && hit.expires > Date.now()) return { vtt: hit.vtt, source: 'cache' };

  // The wyzie file tokens are effectively single-use (the proxied URL goes
  // 503 or empty once consumed), so each round collects a FRESH batch of
  // tokenised rows instead of hammering the same URL.
  for (let round = 0; round < 2; round++) {
    if (round) await new Promise((r) => setTimeout(r, 600));
    const rows = (await collectRows({ tmdbId, media, season, episode, lang: code, signal }))
      .filter((r) => r.code === code)
      .sort(
        (a, b) =>
          (b.encoding === 'UTF-8') - (a.encoding === 'UTF-8') ||
          (b.hearing ? 0 : 1) - (a.hearing ? 0 : 1) ||
          (b.ai ? 0 : 1) - (a.ai ? 0 : 1)
      );

    for (const row of rows) {
      try {
        const res = await fetch(row.url, {
          signal: timeout(15000, signal),
          headers: { 'User-Agent': UA, Accept: 'text/*,*/*;q=0.8' },
          redirect: 'follow'
        });
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length || buffer.length > MAX_FILE_BYTES) continue;

        let text;
        if (row.kind === 'subdl') {
          const entry = zipSubtitleEntry(buffer);
          if (!entry) continue;
          text = decodeBytes(entry.data, code);
        } else {
          text = decodeBytes(buffer, code);
        }

        const vtt = toVtt(text);
        // A file with no timestamps (HTML error page, plain text) is not a subtitle.
        if (!/-->\s*\d/.test(vtt)) continue;

        fileCache.set(key, { vtt, expires: Date.now() + FILE_TTL_MS });
        if (fileCache.size > FILE_CACHE_MAX) {
          const oldest = fileCache.keys().next().value;
          fileCache.delete(oldest);
        }
        return { vtt, source: row.kind };
      } catch {
        /* try the next candidate */
      }
    }
  }
  return null;
}
