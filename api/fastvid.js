/**
 * Vercel serverless HLS-manifest proxy for Fastvid.
 *
 * Hardening (shared with every other fetch layer through lib/net-guard.mjs):
 *   - The `url` parameter may never reach an internal host. Literal private
 *     IPv4/IPv6 (loopback, RFC1918, CGNAT, link-local/metadata like
 *     169.254.169.254, reserved/test nets) are rejected synchronously, and
 *     every hostname is resolved first so DNS aliases of internal boxes die
 *     here too.
 *   - The `from` parameter only ever produces an ORIGIN-ONLY Referer, so a
 *     caller cannot sign arbitrary attacker-controlled URLs into the
 *     upstream's access logs (the player sends origin/ anyway).
 *   - Optional operator allowlist: set FASTVID_ALLOW_HOSTS to a comma list to
 *     pin the proxy to the stream CDNs you serve — private hosts stay
 *     blocked even then.
 */

import { safeRemoteUrl, safeRefererOrigin, hostOnAllowlist } from '../lib/net-guard.mjs';

const FETCH_TIMEOUT_MS = 10000;
const DEFAULT_REFERER = 'https://fastvip.space/';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  let rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;

  // Missing scheme kept for backwards compatibility with older playlists.
  if (rawFrom && !rawFrom.startsWith('http')) {
    rawFrom = 'https://' + rawFrom;
  }

  const target = await safeRemoteUrl(rawUrl);
  if (!target) {
    console.error('[fastvid] Blocked invalid or internal URL:', rawUrl);
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

  // Optional operator pin: every fetch must live in FASTVID_ALLOW_HOSTS.
  const allowlist = (process.env.FASTVID_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length && !hostOnAllowlist(target.hostname, allowlist)) {
    console.error('[fastvid] Host outside allowlist:', target.hostname);
    return res.status(400).json({ error: 'url host is not allowed' });
  }

  // ORIGIN-ONLY Referer — same value the player's own navigation would send.
  const referer = safeRefererOrigin(rawFrom) || process.env.FASTVID_REFERER || DEFAULT_REFERER;
  const fromParam = referer;

  const keepAliveHeaders = {
    Referer: referer,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
  };

  try {
    const response = await fetch(target.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: keepAliveHeaders
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch from origin (${response.status})` });
    }

    const originType = response.headers.get('content-type') || '';
    const isManifest =
      /\.m3u8(\?|$)/i.test(target.href) ||
      originType.includes('mpegurl') ||
      originType.startsWith('text/');

    if (!isManifest) {
      const bytes = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', originType || 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(bytes);
    }

    const m3u8Content = await response.text();
    const modifiedContent = proxifyPlaylist(m3u8Content, target.href, fromParam);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(modifiedContent);
  } catch (error) {
    console.error('[fastvid]', error && error.name === 'TimeoutError' ? 'origin timeout' : error && error.message);
    return res.status(500).json({ error: 'Server Error' });
  }
}

export function proxifyPlaylist(body, targetUrl, fromParam) {
  const proxyBase = '/api/fastvid';

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const wrapUrl = (rawUrl) => {
        try {
          if (rawUrl.startsWith('data:')) return rawUrl;
          const absoluteUrl = new URL(rawUrl, targetUrl).href;
          return `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}&from=${encodeURIComponent(fromParam)}`;
        } catch {
          return rawUrl;
        }
      };

      if (trimmed.startsWith('#')) {
        return line.replace(/(URI=")([^"]+)(")/i, (match, prefix, uri, suffix) => {
          return prefix + wrapUrl(uri) + suffix;
        });
      }

      return wrapUrl(trimmed);
    })
    .join('\n');
}
