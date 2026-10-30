// Vercel Serverless Function: TMDB read-only proxy.
// Token is read ONLY from env vars (TMDB_TOKEN) - never hardcode it in source.

const TMDB_BASE = "https://api.themoviedb.org/3";
const { restoreEnglishMetadata } = require("../src/ipc/tmdbResponse");

// Only read-only catalogue endpoints are exposed, so the token can't be abused
// for account/list mutations.
const ALLOWED_PATH =
  /^\/(movie|tv|trending|discover|search|collection|genre|configuration|person|find|keyword|watch)(\/|\?|$)/;

function resolvePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.startsWith("/")) return null;
  if (rawPath.includes("..") || rawPath.includes("//")) return null;
  return ALLOWED_PATH.test(rawPath) ? rawPath : null;
}

async function handleTmdbRequest({ method, path, token }) {
  if (method !== "GET") {
    return { status: 405, body: { error: "Method not allowed" } };
  }
  const activeToken = (token || "").trim();
  if (!activeToken) {
    return { status: 500, body: { error: "TMDB_TOKEN is not configured" } };
  }
  const safePath = resolvePath(path);
  if (!safePath) {
    return { status: 400, body: { error: "Invalid path" } };
  }

  try {
    const headers = {
      Authorization: `Bearer ${activeToken}`,
      Accept: "application/json",
    };

    // Keep movie & show titles unified in English, while preserving localized overview & details
    const isNonEnglish =
      !safePath.includes("language=en") && /language=[a-zA-Z-]+/.test(safePath);
    if (isNonEnglish) {
      const enPath = safePath.replace(/language=[^&]+/, "language=en-US");
      const [upstream, enUpstream] = await Promise.all([
        fetch(`${TMDB_BASE}${safePath}`, { headers }),
        fetch(`${TMDB_BASE}${enPath}`, { headers }).catch(() => null),
      ]);
      const body = await upstream.json().catch(() => ({}));
      const enBody = enUpstream
        ? await enUpstream.json().catch(() => ({}))
        : null;

      const isKurdish = /[?&]language=(?:ku|ku-TR|ckb)(?:&|$)/.test(safePath);
      restoreEnglishMetadata(body, enBody, {
        includeOverview: isKurdish,
      });
      return { status: upstream.status, body };
    }

    const upstream = await fetch(`${TMDB_BASE}${safePath}`, { headers });
    const body = await upstream.json().catch(() => ({}));
    return { status: upstream.status, body };
  } catch {
    return { status: 502, body: { error: "TMDB unreachable" } };
  }
}

// ── Abuse protection (best-effort, per serverless instance) ──────────────────
const RATE_LIMIT = 120; // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute per IP
const hits = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// Reject browser requests coming from other websites (hot-linking the proxy).
function isForeignOrigin(req) {
  const origin = req.headers?.origin || req.headers?.referer;
  const host = (req.headers?.host || "").trim();
  if (!origin || !host) return false; // same-origin GETs often omit Origin
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return false;
    if (
      originHost.startsWith("localhost") ||
      originHost.startsWith("127.0.0.1")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function handler(req, res) {
  if (isForeignOrigin(req)) {
    res.status(403).json({ error: "Forbidden origin" });
    return;
  }
  if (isRateLimited(clientIp(req))) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  const queryPath = req.url
    ? new URL(req.url, "http://localhost").searchParams.get("path")
    : req.query?.path;
  const { status, body } = await handleTmdbRequest({
    method: req.method,
    path: queryPath,
    token: process.env.TMDB_TOKEN,
  });
  if (status === 200) {
    // Edge-cache successful responses; catalogue data changes slowly.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=3600",
    );
  }
  res.status(status).json(body);
}

module.exports = handler;
module.exports.handleTmdbRequest = handleTmdbRequest;
