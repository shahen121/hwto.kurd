// Vercel Serverless Function: restricted, read-only API-Football proxy.
// API_FOOTBALL_KEY is server-only and must never use a VITE_ prefix.

const API_BASE = "https://v3.football.api-sports.io";
const LEAGUE_IDS = new Set([
  "39", "140", "135", "78", "61", "307", "203", "88", "94", "253", "45", "48",
]);
const ENDPOINTS = new Map([
  [
    "/fixtures",
    new Set([
      "league",
      "season",
      "date",
      "from",
      "to",
      "page",
      "status",
      "live",
      "timezone",
    ]),
  ],
  ["/standings", new Set(["league", "season"])],
  ["/fixtures/events", new Set(["fixture"])],
  ["/fixtures/lineups", new Set(["fixture"])],
]);
const FIXTURE_STATUSES = new Set([
  "TBD", "NS", "1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "FT", "AET",
  "PEN", "PST", "CANC", "ABD", "AWD", "WO", "LIVE",
]);

function normalizeQuery(query = {}) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value) result.set(key, value);
  }
  return result;
}

function validateRequest(path, query) {
  const allowedParams = ENDPOINTS.get(path);
  if (!allowedParams) return "Unsupported API-Football endpoint";

  for (const key of query.keys()) {
    if (!allowedParams.has(key)) return "Unsupported query parameter";
  }

  if (path === "/fixtures" || path === "/standings") {
    const league = query.get("league");
    const season = query.get("season");
    if (!LEAGUE_IDS.has(league)) return "Unsupported league";
    if (!/^\d{4}$/.test(season || "")) return "Invalid season";
  }
  if (path === "/fixtures") {
    if (query.has("date") && !/^\d{4}-\d{2}-\d{2}$/.test(query.get("date"))) {
      return "Invalid date";
    }
    for (const key of ["from", "to"]) {
      if (query.has(key) && !/^\d{4}-\d{2}-\d{2}$/.test(query.get(key))) {
        return "Invalid date range";
      }
    }
    if (query.has("page") && !/^[1-9]\d*$/.test(query.get("page"))) {
      return "Invalid page";
    }
    if (query.has("status") && !FIXTURE_STATUSES.has(query.get("status"))) {
      return "Invalid fixture status";
    }
    if (query.has("live") && query.get("live") !== "all") {
      return "Invalid live filter";
    }
    if (
      !query.has("date") &&
      !query.has("from") &&
      !query.has("to") &&
      !query.has("live")
    ) {
      return "A fixture date or live filter is required";
    }
  } else if (path.startsWith("/fixtures/")) {
    if (!/^\d+$/.test(query.get("fixture") || "")) return "Invalid fixture id";
  }

  return null;
}

async function handleFootballRequest({
  method = "GET",
  path,
  query: rawQuery,
  key,
  fetchImpl = fetch,
}) {
  if (method !== "GET") {
    return { status: 405, body: { error: "Method not allowed" } };
  }
  const activeKey = String(key || "").trim();
  if (!activeKey) {
    return {
      status: 503,
      body: { error: "API_FOOTBALL_KEY is not configured on the server" },
    };
  }

  const query = normalizeQuery(rawQuery);
  const validationError = validateRequest(path, query);
  if (validationError) {
    return { status: 400, body: { error: validationError } };
  }
  if (path === "/fixtures" && !query.has("timezone")) {
    query.set("timezone", "UTC");
  }

  try {
    const response = await fetchImpl(`${API_BASE}${path}?${query}`, {
      headers: { "x-apisports-key": activeKey, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: response.status,
        body: { error: body.message || `API-Football returned HTTP ${response.status}` },
      };
    }
    if (body.errors && Object.keys(body.errors).length > 0) {
      return {
        status: 502,
        body: {
          error: "API-Football rejected the request",
          details: body.errors,
        },
      };
    }
    return { status: 200, body };
  } catch {
    return { status: 502, body: { error: "API-Football is unreachable" } };
  }
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map();

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (hits.size > 5000) {
      for (const [key, value] of hits) {
        if (now >= value.resetAt) hits.delete(key);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function isForeignOrigin(req) {
  const origin = req.headers?.origin || req.headers?.referer;
  const host = (req.headers?.host || "").trim();
  if (!origin || !host) return false;
  try {
    const originHost = new URL(origin).host;
    return (
      originHost !== host &&
      !originHost.startsWith("localhost") &&
      !originHost.startsWith("127.0.0.1")
    );
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

  const rawQueryObj = req.url
    ? Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries())
    : req.query || {};
  const { path, ...query } = rawQueryObj;
  const { status, body } = await handleFootballRequest({
    method: req.method,
    path,
    query,
    key: process.env.API_FOOTBALL_KEY,
  });
  if (status === 200) {
    const endpoint = path;
    const ttl = endpoint === "/fixtures" ? 30 : endpoint === "/standings" ? 300 : 60;
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${ttl}, stale-while-revalidate=300`,
    );
  }
  res.status(status).json(body);
}

module.exports = handler;
module.exports.handleFootballRequest = handleFootballRequest;
