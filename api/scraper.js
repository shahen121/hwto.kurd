/**
 * Vercel serverless scraper for shaheid4u.name ("شاهد فور يو").
 *
 * Usage:  GET /api/scraper?url=<watch-page-url>
 *
 * It fetches the watch page, pulls the embedded `let servers = [...]` array,
 * and returns the Fastvid entry (plus the full list) so the frontend can hand
 * the embed URL to /api/fastvid and play it natively.
 *
 * Hardening vs the original snippet:
 *   - Host allowlist (shaheid4u.name + subdomains) — an unrestricted `url`
 *     param would turn this into an open SSRF proxy.
 *   - The shared guard in lib/net-guard.mjs is the single source of truth:
 *     http(s) only, no credentials in the URL, internal/private/metadata hosts
 *     rejected (literals AND DNS answers), and a blocked host can never be
 *     unblocked by the operator allowlist.
 *   - Regex is multiline-safe and accepts let/const/var with ' or " quotes.
 *   - Lenient JSON fallback (strips trailing commas, unquoted keys) because
 *     these arrays are hand-written JS, not guaranteed strict JSON.
 *   - Fetch deadline + per-instance cache so one title isn't re-scraped.
 */

import { safeRemoteUrl, hostOnAllowlist } from '../lib/net-guard.mjs';

const DEFAULT_ALLOW = ['shaheid4u.name'];
const FETCH_TIMEOUT_MS = 10000;
// How much of a failed upstream body is echoed back for debugging.
const ERROR_DETAIL_CHARS = 200;
const CACHE_TTL_MS = Number(process.env.SCRAPER_CACHE_TTL_MS) || 5 * 60 * 1000;
const cache = new Map();

function allowedHosts() {
  const fromEnv = (process.env.SCRAPER_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOW;
}

/**
 * Return the hardened URL object, or null if it is not an allowed target.
 * Async because the shared guard resolves the hostname first: an allowlisted
 * name that points at a private address still dies here.
 */
export async function safeTargetUrl(raw) {
  const url = await safeRemoteUrl(raw);
  if (!url) return null;
  // hostOnAllowlist keeps the internal-host backstop even for allowlisted names.
  return hostOnAllowlist(url.hostname, allowedHosts()) ? url : null;
}

/**
 * Pull the `servers` array literal out of the page HTML.
 * Handles: let/const/var, ' or " quotes, multi-line arrays.
 */
export function extractServersLiteral(html) {
  // The trailing `;` is optional — hand-written pages often omit it. m[1] is
  // the array literal only; the `let/const/var servers =` prefix is excluded so
  // parseServersArray receives bare JSON.
  const m = /(?:let|const|var)\s+servers\s*=\s*(\[[\s\S]*?\])\s*;?/.exec(String(html || ''));
  return m ? m[1] : null;
}

/** Parse the array literal into real objects, tolerating sloppy JS. */
export function parseServersArray(literal) {
  if (!literal) return [];
  try {
    const parsed = JSON.parse(literal);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    /* fall through to the lenient path below */
  }
  const lenient = literal
    // trailing commas before ] or }
    .replace(/,\s*([\]}])/g, '$1')
    // single-quoted strings -> double-quoted
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_s, body) => `"${body.replace(/"/g, '\\"')}"`)
    // unquoted identifier keys -> "key"
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  try {
    const parsed = JSON.parse(lenient);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Case-insensitive find of the Fastvid server entry. */
export function findFastvidServer(servers) {
  if (!Array.isArray(servers)) return null;
  return (
    servers.find((s) => {
      const name = String((s && (s.name || s.title || s.label)) || '').toLowerCase();
      return name === 'fastvid' || name === 'fastved' || name.includes('fastvid') || name.includes('fastved');
    }) || null
  );
}

/** Resolve a possibly-relative server URL against the scraped page origin. */
export function buildIframeUrl(serverUrl, origin) {
  const raw = String(serverUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, origin).href;
  } catch {
    return '';
  }
}

async function scrape(url) {
  const response = await fetch(url.href, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    // Keep a snippet of the upstream body: when a scraper gets blocked the
    // status alone (403/503) tells you nothing — the body says whether it was
    // Cloudflare, a WAF rule, or a real outage.
    const raw = await response.text().catch(() => '');
    const err = new Error(`upstream ${response.status}`);
    err.status = response.status;
    err.bodySnippet = raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, ERROR_DETAIL_CHARS);
    throw err;
  }
  const html = await response.text();
  const literal = extractServersLiteral(html);
  const servers = parseServersArray(literal);
  const fastvid = findFastvidServer(servers);
  const iframeUrl = buildIframeUrl(fastvid && (fastvid.url || fastvid.link || fastvid.src), url.origin);
  return { servers, fastvid, iframeUrl, foundArray: Boolean(literal) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const url = await safeTargetUrl(req.query && req.query.url);
  if (!url) {
    return res.status(400).json({ error: 'Missing or invalid url (only shaheid4u.name is allowed)' });
  }

  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(hit.payload);
  }

  try {
    const { servers, fastvid, iframeUrl, foundArray } = await scrape(url);

    if (!foundArray) {
      return res.status(404).json({ error: 'لم يتم العثور على مصفوفة السيرفرات في الصفحة' });
    }
    if (!fastvid) {
      return res.status(404).json({ error: 'سيرفر Fastvid غير متوفر لهذه الحلقة' });
    }

    const payload = {
      success: true,
      server_name: fastvid.name || fastvid.label || 'fastvid',
      iframe_url: iframeUrl,
      servers: servers.map((s) => ({
        name: s && (s.name || s.label || s.title) || '',
        url: buildIframeUrl(s && (s.url || s.link || s.src), url.origin)
      }))
    };

    cache.set(key, { payload, expires: Date.now() + CACHE_TTL_MS });
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);
  } catch (error) {
    const upstream = error && Number(error.status);
    if (upstream) {
      const payload = { error: 'فشل الاتصال بموقع شاهد فور يو', status_code: upstream };
      if (error.bodySnippet) payload.details = error.bodySnippet;
      return res.status(upstream >= 500 ? 502 : upstream).json(payload);
    }
    console.error('[scraper]', error);
    return res.status(500).json({ error: 'حدث خطأ في الخادم أثناء الاستخراج' });
  }
}
