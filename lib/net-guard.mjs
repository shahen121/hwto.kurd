/**
 * lib/net-guard.mjs — shared URL/SSRF hardening for every server-side fetch
 * layer (api/fastvid.js, api/shahid4u-extractor.js, ... plus server.js routes
 * via lib/*.mjs). One implementation, four call sites.
 *
 * Two gates:
 *   1. isBlockedHost(host) — anything that must never be fetched: loopbacks,
 *      RFC1918/link-local/metadata ranges, CGNAT, benchmark/reserved nets,
 *      and the .local/.internal/localhost pseudo-DNS spaces. Literal IPs are
 *      caught synchronously; real hostnames are resolved with dns.lookup()
 *      so a DNS name that points at an internal IP is rejected too.
 *   2. safeRefererFrom(urlText) — turns the free-form "from" parameter into an
 *      origin-only Referer, so callers cannot make the upstream log an
 *      arbitrary attacker-controlled URL.
 */

import dns from 'node:dns/promises';

/* ---------------------------- private ranges --------------------------- */

function isPrivateV4(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return true;
  const octets = parts.map(Number);
  if (octets.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 || // "this" network (incl. 0.0.0.0)
    a === 10 || // RFC1918 private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local + 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918 private
    (a === 192 && b === 168) || // RFC1918 private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast + reserved
  );
}

function isPrivateV6(raw) {
  let ip = String(raw).toLowerCase().replace(/%.*$/, ''); // strip zone id
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) return isPrivateV4(ip.slice(7)); // IPv4-mapped
  const head = ip.split(':')[0] || '';
  if (/^f[cd]/.test(head)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(head)) return true; // link-local fe80::/10
  if (/^ff/.test(head)) return true; // multicast ff00::/8
  // 64:ff9b::/96 NAT64 embeds a public IPv4 — treated as an allowed form.
  return false; // global unicast — the DNS resolution in safeRemoteUrl is the second gate
}

/** true = blocked, null = not a literal IPv4/IPv6 (needs DNS resolution). */
export function isBlockedLiteral(hostRaw) {
  const host = String(hostRaw || '').trim().toLowerCase();
  if (!host) return true;
  if (net_isLiteralV4(host)) return isPrivateV4(host);
  if (net_isLiteralV6(host)) return isPrivateV6(host);
  // All-numeric dotted forms are *invalid* literals — a malformed 5-octet or
  // 0-padded variant must never fall through to a hostname fetch.
  if (/^(\d+\.)+\d+$/.test(host)) return true;
  // Odd base notation (hex 0x, octal 0-prefixed) that URL does not canonicalise.
  if (/^0[x0-7]/.test(host)) return true;
  return null;
}

function net_isLiteralV4(h) {
  const p = h.split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

function net_isLiteralV6(h) {
  // hextet chars, colons, and the dotted tail of ::ffff:1.2.3.4 forms.
  return h.includes(':') && !/[^0-9a-f:.]/.test(h);
}

/** true = blocked, false = allowed, null = hostname that still needs DNS. */
export function isBlockedHost(hostRaw) {
  const host = String(hostRaw || '').trim().toLowerCase();
  if (!host) return true;
  // Bracketed IPv6 from URL.hostname already arrives without brackets; strip
  // anyway to be resilient.
  const bare = host.replace(/^\[|]$/g, '').replace(/%.*$/, '');
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.home.arpa')) return true;
  return isBlockedLiteral(bare);
}

/**
 * Resolve a hostname and confirm every record is public. Resolving BEFORE the
 * fetch closes the simple DNS-rebinding hole (a name that flips between a
 * public and an internal answer per query still wins the race only if the
 * resolver pins two different answers to one connection — acceptable for a
 * playback proxy documented as such).
 */
export async function isBlockedHostDeep(hostRaw) {
  const verdict = isBlockedHost(hostRaw);
  if (verdict === null) {
    const hostname = String(hostRaw || '').trim().toLowerCase().replace(/^\[|]$/g, '');
    let addrs;
    try {
      addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      // unresolvable hostnames cannot be fetched anyway
      return true;
    }
    if (!addrs.length) return true;
    for (const a of addrs) {
      const v = isBlockedLiteral(a.address);
      if (v !== false) return true;
    }
    return false;
  }
  return verdict;
}

/** Harden a full URL: http(s) only, and the host must pass the deep check. */
export async function safeRemoteUrl(rawText) {
  let url;
  try {
    url = new URL(String(rawText || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null; // no credential smuggling
  const blocked = await isBlockedHostDeep(url.hostname);
  return blocked ? null : url;
}

/* ------------------------------ referers ------------------------------- */

/**
 * Origin-only Referer from a free-form parameter. A full attacker-chosen URL
 * (path, query, userinfo noises) would otherwise be signed into upstream
 * logs; every real player sends origin/ anyway.
 */
export function safeRefererOrigin(rawText) {
  let url;
  try {
    url = new URL(String(rawText || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin + '/';
}

/* --------------------------- host allowlists --------------------------- */

/**
 * Subdomain-tolerant allowlist matcher with an internal-host backstop, shared
 * by the allowlist-based endpoints (shahid4u-extractor, optional operator
 * allowlists elsewhere).
 */
export function hostOnAllowlist(hostname, allowlist) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|]$/g, '');
  const verdict = isBlockedHost(host);
  if (verdict !== null) return false; // blocked hosts never pass, allowlisted or not
  return (allowlist || []).some(
    (allowed) => host === String(allowed).toLowerCase() || host.endsWith('.' + String(allowed).toLowerCase())
  );
}
