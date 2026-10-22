import dns from "node:dns/promises";
import net from "node:net";

export const CACHE_MAX_ENTRIES = 500;
export const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const NEGATIVE_TTL_MS = 30 * 1000; // 30 seconds
export const FETCH_TIMEOUT_MS = 10000; // 10 seconds
export const MAX_PROXY_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB max for proxy

// In-memory manifest cache
const manifestCache = new Map();

// In-memory rate limiter per IP (60 requests per minute)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * Checks if an IP address belongs to private, loopback, link-local, CGNAT, or cloud-metadata ranges.
 */
export function isPrivateIp(ip) {
  if (!ip) return true;

  // IPv4 check
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8 (Loopback)
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (Carrier-Grade NAT)
      (a === 169 && b === 254) || // 169.254.0.0/16 (Link-local & AWS/Cloud metadata)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (Private)
      (a === 192 && b === 168) || // 192.168.0.0/16 (Private)
      a >= 224 // 224.0.0.0+ (Multicast & reserved)
    );
  }

  // IPv6 check
  const v = ip.toLowerCase();
  if (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fc") || // Unique Local Unicast (fc00::/7)
    v.startsWith("fd") ||
    v.startsWith("fe80") // Link-local (fe80::/10)
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:192.168.1.1)
  if (v.startsWith("::ffff:")) {
    const v4Part = v.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIp(v4Part);
    }
  }

  return false;
}

/**
 * Returns allowed hosts from environment variable HLS_ALLOWED_HOSTS.
 */
export function getAllowedHosts() {
  const raw = process.env.HLS_ALLOWED_HOSTS || "";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validates that a URL is HTTPS, matches allowed hosts, and resolves to public IPs only.
 */
export async function isSafeUrl(rawUrl, allowedHosts = getAllowedHosts()) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return false;
  }

  // Strictly enforce HTTPS
  if (parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || allowedHosts.length === 0 || !allowedHosts.includes(hostname)) {
    return false;
  }

  // Perform real DNS resolution to detect SSRF or private IP spoofing
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (!addrs || addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Simple in-memory rate limiter per IP address.
 */
export function checkRateLimit(clientIp) {
  if (!clientIp) return { allowed: true };

  const now = Date.now();
  const entry = rateLimitMap.get(clientIp);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(clientIp, { windowStart: now, count: 1 });
    // Cleanup old entries if map grows large
    if (rateLimitMap.size > 2000) {
      for (const [ip, data] of rateLimitMap.entries()) {
        if (now - data.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip);
      }
    }
    return { allowed: true };
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Bounded manifest cache getters & setters
 */
export function getFromManifestCache(key) {
  const entry = manifestCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    manifestCache.delete(key);
    return null;
  }
  return entry;
}

export function setInManifestCache(key, data, ttlMs) {
  if (manifestCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = manifestCache.keys().next().value;
    manifestCache.delete(oldestKey);
  }
  manifestCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Core manifest resolution logic shared between Vercel serverless and Electron IPC.
 */
export async function resolveAuthorizedHls({
  type,
  id,
  season = "0",
  episode = "0",
  providerUrl = process.env.HLS_PROVIDER_URL,
  providerToken = process.env.HLS_PROVIDER_TOKEN,
  allowedHosts = getAllowedHosts(),
}) {
  if (!providerUrl || !providerToken) {
    return {
      status: 503,
      error: "Authorized HLS provider is not configured on the server.",
    };
  }

  // Parameter validation
  if (!type || !["movie", "tv"].includes(type)) {
    return { status: 400, error: "Invalid playback type. Must be 'movie' or 'tv'." };
  }

  if (!id || !/^(tt\d+|\d+)$/.test(String(id))) {
    return { status: 400, error: "Invalid playback ID format." };
  }

  const cleanSeason = String(season || "0").trim();
  const cleanEpisode = String(episode || "0").trim();

  if (!/^\d{1,4}$/.test(cleanSeason) || !/^\d{1,4}$/.test(cleanEpisode)) {
    return { status: 400, error: "Invalid season or episode number format." };
  }

  const cacheKey = `hls_default_${type}_${id}_s${cleanSeason}e${cleanEpisode}`;
  const cached = getFromManifestCache(cacheKey);

  if (cached) {
    if (cached.data.isNegative) {
      return {
        status: cached.data.status,
        error: cached.data.error,
        cached: true,
      };
    }
    return {
      status: 200,
      data: cached.data,
      cached: true,
    };
  }

  try {
    const requestUrl = new URL(providerUrl);
    requestUrl.searchParams.set("type", type);
    requestUrl.searchParams.set("id", String(id));
    if (type === "tv") {
      requestUrl.searchParams.set("season", cleanSeason);
      requestUrl.searchParams.set("episode", cleanEpisode);
    }

    // Manual redirect handling to validate Location headers against SSRF
    const response = await fetch(requestUrl.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: "application/json, application/vnd.apple.mpegurl",
      },
    });

    // Handle Redirects (301, 302, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectLocation = response.headers.get("location");
      if (!redirectLocation) {
        return { status: 502, error: "Provider returned redirect without Location header." };
      }

      const safe = await isSafeUrl(redirectLocation, allowedHosts);
      if (!safe) {
        return { status: 502, error: "Redirected stream location is not authorized or safe." };
      }

      const payload = { streamUrl: redirectLocation, subtitles: [] };
      setInManifestCache(cacheKey, payload, DEFAULT_TTL_MS);
      return { status: 200, data: payload, cached: false };
    }

    // Respect 401/403/429 strictly without key rotation
    if (response.status === 401 || response.status === 403) {
      return {
        status: response.status,
        error: "Provider authentication failed or access denied.",
      };
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") || "60");
      return {
        status: 429,
        error: "Provider rate limit exceeded. Please retry later.",
        retryAfter,
      };
    }

    if (!response.ok) {
      setInManifestCache(
        cacheKey,
        { isNegative: true, status: response.status, error: "Stream unavailable" },
        NEGATIVE_TTL_MS
      );
      return {
        status: response.status,
        error: "Authorized stream not found or unavailable.",
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let payload;
    let ttlMs = DEFAULT_TTL_MS;

    if (contentType.includes("application/json")) {
      const json = await response.json();
      if (!json?.streamUrl) {
        return { status: 502, error: "Provider JSON response missing streamUrl." };
      }

      const safe = await isSafeUrl(json.streamUrl, allowedHosts);
      if (!safe) {
        return { status: 502, error: "Provider returned an invalid or unapproved stream host." };
      }

      if (typeof json.ttlSeconds === "number" && json.ttlSeconds > 0) {
        ttlMs = Math.min(json.ttlSeconds * 1000, DEFAULT_TTL_MS);
      }

      // Filter and validate provider subtitles if any
      const safeSubtitles = [];
      if (Array.isArray(json.subtitles)) {
        for (const sub of json.subtitles) {
          if (sub?.url && (await isSafeUrl(sub.url, allowedHosts))) {
            safeSubtitles.push({
              url: sub.url,
              lang: sub.lang || "ar",
              label: sub.label || "Subtitle",
            });
          }
        }
      }

      payload = {
        streamUrl: json.streamUrl,
        subtitles: safeSubtitles,
      };
    } else {
      // Direct stream response
      const safe = await isSafeUrl(response.url, allowedHosts);
      if (!safe) {
        return { status: 502, error: "Provider stream host is not in allowed hosts." };
      }
      payload = {
        streamUrl: response.url,
        subtitles: [],
      };
    }

    setInManifestCache(cacheKey, payload, ttlMs);
    return { status: 200, data: payload, cached: false };
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { status: 504, error: "Connection to stream provider timed out." };
    }
    return { status: 502, error: "Failed to communicate with authorized stream provider." };
  }
}
