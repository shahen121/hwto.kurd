/**
 * Dean Edwards Packer Unpacker — TEXT-ONLY rebuild.
 *
 * Security contract (replaces the old `new Function`-based unpacker, which
 * executed third-party page scripts on the server):
 *   - The upstream page's JavaScript is NEVER evaluated. The packer payload is
 *     decoded arithmetically: read the ('payload', radix, count, 'kw|ords'|0)
 *     arguments of the packed expression as data, then substitute each token
 *     by base-converting the token index — the exact algorithm the original
 *     e(x)/f(x) functions implement, done here with Number/String only.
 *   - The URL parameter is allowlisted (see lib/net-guard.mjs): only the
 *     operator's embed hosts may be fetched, and even an operator allowlist
 *     can never unblock internal/private IPs.
 */

import { safeRemoteUrl, hostOnAllowlist } from '../lib/net-guard.mjs';

const FETCH_TIMEOUT_MS = 10000;

const DEFAULT_ALLOW = ['fastved.cam', 'fastvid.cam', 'fastvip.space', 'sshaahid4u.net'];
const REFERER = 'https://sshaahid4u.net/';

function allowedHosts() {
  const fromEnv = (process.env.SHAHID4U_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOW;
}

/** Return the hardened URL object, or null when the host is not allowed. */
export function safeTargetUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!hostOnAllowlist(url.hostname, allowedHosts())) return null;
  return url;
}

/* ---------------------------------------------------------------------- *
 * Safe Dean Edwards unpacker — arithmetic decoding only, zero eval.       *
 * ---------------------------------------------------------------------- */

/** Decode one JS string literal's escape sequences into plain text. */
export function unescapeJsLiteral(text) {
  return String(text || '').replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_m, seq) => {
      if (seq.length > 1) {
        // uXXXX / xXX hex escapes
        const code = parseInt(seq.slice(1), 16);
        if (Number.isFinite(code)) return String.fromCharCode(code);
      }
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
      return map[seq[0]] !== undefined ? map[seq[0]] : seq;
    }
  );
}

/** Read a JS string literal starting at `start` (text[start] is the quote). */
function readJsString(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      out += ch + (text[i + 1] || '');
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, next: i + 1 };
    out += ch;
    i += 1;
  }
  return null;
}

function skipSpaces(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function readNumber(text, i) {
  i = skipSpaces(text, i);
  const m = /^\d+/.exec(text.slice(i));
  if (!m) return null;
  return { value: parseInt(m[0], 10), next: i + m[0].length };
}

/** The packer's e(c) inverse: index c -> its textual token under radix `a`. */
export function packerToken(c, a) {
  let out = '';
  c = Number(c);
  if (c >= a) out = packerToken(Math.floor(c / a), a);
  const r = c % a;
  out += r > 35 ? String.fromCharCode(r + 29) : r.toString(36);
  return out;
}

/**
 * Substitute every token with its dictionary entry — a faithful, arithmetic
 * re-implement of the packer's while(c--) replace loop.
 */
export function applyPackerDictionary(payload, radix, count, keys) {
  let out = String(payload || '');
  for (let c = count - 1; c >= 0; c--) {
    const word = keys[c];
    if (word === undefined || word === '') continue;
    const token = packerToken(c, radix);
    const pattern = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regexp;
    try {
      regexp = new RegExp('\\b' + pattern + '\\b', 'g');
    } catch {
      continue;
    }
    out = out.replace(regexp, word);
  }
  return out;
}

/**
 * Parse the packed expression WITHOUT executing it:
 *   eval(function(p,a,c,k,e,d){...}('PAYLOAD',RADIX,COUNT,'KW|ORDS'.split('|'),0,{}))
 * Braces/args are read with an escape-aware string scanner, so malformed or
 * hostile input simply fails to parse and returns null.
 */
export function extractPackerArgs(code) {
  const source = String(code || '');
  const start = source.indexOf('eval(function(p,a,c,k');
  if (start === -1) return null;

  // Locate the argument list: the '(' that follows the closing brace of the
  // unpacker function body. Brace-count from the first '{' after the marker.
  const bodyStart = source.indexOf('{', start);
  if (bodyStart === -1) return null;
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  if (bodyEnd === -1) return null;
  const argsOpen = source.indexOf('(', bodyEnd);
  if (argsOpen === -1 || argsOpen - bodyEnd > 3) return null; // must be strcmp-adjacent

  let i = argsOpen + 1;
  i = skipSpaces(source, i);
  const payload = readJsString(source, i);
  if (!payload) return null;
  i = payload.next;
  i = skipSpaces(source, i);
  if (source[i] !== ',') return null;

  const radix = readNumber(source, ++i);
  if (!radix) return null;
  i = skipSpaces(source, radix.next);
  if (source[i] !== ',') return null;

  const count = readNumber(source, ++i);
  if (!count) return null;
  i = skipSpaces(source, count.next);
  if (source[i] !== ',') return null;

  i = skipSpaces(source, ++i);
  const keysRaw = readJsString(source, i);
  if (!keysRaw) return null;
  // The keys argument may end in .split('|') — both shapes are accepted.
  const tail = source.slice(keysRaw.next, keysRaw.next + 40);
  if (!/^\s*,/.test(tail) && !/^\s*\.\s*split/.test(tail)) return null;

  return {
    payload: unescapeJsLiteral(payload.value),
    radix: radix.value,
    count: count.value,
    keys: unescapeJsLiteral(keysRaw.value).split('|')
  };
}

/** Full text-only unpack. Returns the unpacked string or null. */
export function unpackDeanEdwards(code) {
  const args = extractPackerArgs(code);
  if (!args) return null;
  if (!args.payload || !args.count || args.count > 200000) return null; // runaway guards
  return applyPackerDictionary(args.payload, args.radix, args.count, args.keys);
}

/* ------------------------------------------------------------------ *
 * Stream extraction from the unpacked TEXT (regex only — no code).   *
 * ------------------------------------------------------------------ */

export function extractStreamUrl(unpacked, pageOrigin) {
  if (!unpacked) return null;

  const absM3u8 = unpacked.match(/https?:\/\/[^\s"',\\]+\.m3u8[^\s"',\\]*/i);
  if (absM3u8) return absM3u8[0];

  const relM3u8 = unpacked.match(/["'](\/[^"'\s\\]+\.m3u8[^"'\s\\]*)["']/i);
  if (relM3u8) {
    try { return new URL(relM3u8[1], pageOrigin).href; } catch {}
  }

  const oMatch = unpacked.match(/(?:var|let|const)?\s*o\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (oMatch) {
    const rawObj = oMatch[1];
    const urlMatch = rawObj.match(/https?:\/\/[^\s"',\\]+/i) || rawObj.match(/["'](\/[^"'\s\\]+)["']/);
    if (urlMatch) {
      const val = urlMatch[1] || urlMatch[0];
      return val.startsWith('http') ? val : new URL(val, pageOrigin).href;
    }
  }

  const absMp4 = unpacked.match(/https?:\/\/[^\s"',\\]+\.mp4[^\s"',\\]*/i);
  if (absMp4) return absMp4[0];

  const fileMatch = unpacked.match(/file\s*:\s*["']([^"']+)["']/i);
  if (fileMatch) {
    const val = fileMatch[1];
    return val.startsWith('http') ? val : new URL(val, pageOrigin).href;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;

  const targetUrl = safeTargetUrl(raw);
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing or invalid url (only the configured embed hosts are allowed)' });
  }

  try {
    const response = await fetch(targetUrl.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: REFERER,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      return res.status(200).json({ success: false, fallback_iframe: targetUrl.href });
    }

    const html = await response.text();
    const pageOrigin = targetUrl.origin;

    const inlineScripts = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [])
      .map((s) => s.replace(/<\/?script[^>]*>/gi, '').trim())
      .filter(Boolean);

    const packedScript = inlineScripts.find((s) => s.includes('eval(function(p,a,c,k,e,d)'));

    if (packedScript) {
      const unpacked = unpackDeanEdwards(packedScript);
      if (unpacked) {
        // Log only the size — echoing page content into server logs is noise.
        console.log('[shahid4u-extractor] Unpacked successfully. Length:', unpacked.length);
        const streamUrl = extractStreamUrl(unpacked, pageOrigin);

        if (streamUrl) {
          return res.status(200).json({
            success: true,
            stream_url: streamUrl,
            source: 'dean_edwards_unpacker'
          });
        }
        console.log('[shahid4u-extractor] Stream URL not found in unpacked text.');
      }
    }

    const directM3u8 = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
    if (directM3u8) {
      return res.status(200).json({
        success: true,
        stream_url: directM3u8[1],
        source: 'direct_m3u8'
      });
    }

    return res.status(200).json({
      success: false,
      fallback_iframe: targetUrl.href,
      error: 'stream_not_found'
    });
  } catch (error) {
    console.error('[shahid4u-extractor] Error:', error && error.message);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
}
