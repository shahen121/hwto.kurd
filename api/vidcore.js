const { Readable } = require("stream");
const {
  AD_SHIELD_JS,
  sanitizeVidlinkHtml,
  patchPlayerChunk,
  getScrapeDoTokens,
  fetchViaScrapeDoWithRotation,
  getScrapeDoSessionId,
  CF_WORKER_URL,
} = require("./vidcore.js");

const VIDLINK_ORIGIN = process.env.VIDLINK_ORIGIN || "https://vidlink.pro";

// Strong in-memory caches for instant response (< 1ms)
const vidlinkStaticCache = new Map();
const vidlinkHtmlCache = new Map();
const vidlinkApiCache = new Map();

const HTML_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const API_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes

function getCleanUserAgent(rawUa) {
  if (!rawUa || /node|curl|python|axios|undici/i.test(rawUa)) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return rawUa;
}

function fetchWithTimeout(url, options = {}, ms = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

async function fetchValidResponse(url, options, timeoutMs) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  if (res && res.status >= 200 && res.status < 400) {
    return res;
  }
  throw new Error(`Invalid status: ${res ? res.status : "none"}`);
}

/**
 * Fetch Vidlink HTML/API with parallel racing:
 * 1. Race Direct fetch + Cloudflare Worker simultaneously (fastest wins in ~200-400ms)
 * 2. Scrape.do multi-token rotation fallback if both fail
 */
async function fetchVidlinkHtmlFast(targetUrl, req, bodyBuffer = null) {
  const method = req ? req.method || "GET" : "GET";
  const headers = {
    "User-Agent": getCleanUserAgent(req?.headers?.["user-agent"]),
    Accept:
      req?.headers?.["accept"] ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language":
      req?.headers?.["accept-language"] || "en-US,en;q=0.9,ar;q=0.8",
    Referer: `${VIDLINK_ORIGIN}/`,
    Origin: VIDLINK_ORIGIN,
  };

  if (req?.headers?.["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }

  if (req?.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (
        (lower.startsWith("x-") || lower === "cookie") &&
        !headers[lower] &&
        !lower.startsWith("x-forwarded") &&
        !lower.startsWith("x-vercel")
      ) {
        headers[k] = v;
      }
    }
  }

  const fetchOpts = { method, headers };
  if (method === "POST" && bodyBuffer && bodyBuffer.length > 0) {
    fetchOpts.body = bodyBuffer;
  }

  const workerTarget = `${CF_WORKER_URL}/stream-proxy/ref/${encodeURIComponent(targetUrl)}`;

  // 1. Race Direct Fetch & Cloudflare Worker in parallel so we never wait sequentially
  try {
    const fastestRes = await Promise.any([
      fetchValidResponse(targetUrl, fetchOpts, 1800),
      fetchValidResponse(workerTarget, fetchOpts, 2200),
    ]);
    if (fastestRes) return fastestRes;
  } catch (_raceErr) {
    // Both timed out or returned non-2xx; proceed to Scrape.do fallback
  }

  // 2. Fallback to Scrape.do rotation
  const hasTokens = getScrapeDoTokens().length > 0;
  if (hasTokens) {
    const sessionId = getScrapeDoSessionId(req);
    return await fetchViaScrapeDoWithRotation(targetUrl, fetch, {
      method,
      headers,
      sessionId,
      body: bodyBuffer,
    });
  }

  // Last resort: simple direct fetch
  return await fetch(targetUrl, fetchOpts);
}

function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(null);
  if (req.body && Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.body && typeof req.body === "string")
    return Promise.resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === "object")
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Handle Vidlink Proxy Requests (Dedicated high-performance handler)
 */
async function handleVidlinkProxy(req, res) {
  try {
    const host = req.headers?.host || "localhost:3000";
    const parsedUrl = new URL(req.url || "/", `http://${host}`);
    let pathname = parsedUrl.pathname;
    const search = parsedUrl.search || "";

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    // 0. Vital Proxy Utilities
    if (pathname === "/gtag-shield.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(AD_SHIELD_JS, "utf8");
    }

    if (pathname.startsWith("/stream-proxy/ref/")) {
      let rawTarget = pathname.slice("/stream-proxy/ref/".length) + search;
      if (rawTarget.startsWith("https/")) {
        rawTarget = "https://" + rawTarget.slice(6);
      } else if (rawTarget.startsWith("http/")) {
        rawTarget = "http://" + rawTarget.slice(5);
      } else if (!rawTarget.startsWith("http://") && !rawTarget.startsWith("https://")) {
        try {
          const dec = decodeURIComponent(rawTarget);
          if (dec.startsWith("http")) rawTarget = dec;
        } catch (_e) {}
      }
      const redirectUrl = `${CF_WORKER_URL}/stream-proxy/ref/${encodeURIComponent(rawTarget)}`;
      res.writeHead(302, {
        Location: redirectUrl,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (pathname.startsWith("/stream-proxy/")) {
      const m = pathname.match(/^\/stream-proxy\/(ref|noref)\/(https?)\/([^/]+)(\/.*)?$/);
      let workerTarget;
      if (m) {
        const refMode = m[1];
        const scheme = m[2];
        const upHost = m[3];
        const restPath = m[4] || "/";
        const rawStreamUrl = `${scheme}://${upHost}${restPath}${search}`;
        workerTarget = `${CF_WORKER_URL}/stream-proxy/${refMode}/${encodeURIComponent(rawStreamUrl)}`;
      } else {
        workerTarget = `${CF_WORKER_URL}${pathname}${search}`;
      }
      res.writeHead(302, {
        Location: workerTarget,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (pathname.startsWith("/embed/")) {
      const cleanTarget = pathname.replace(/^\/embed/, "") + search;
      res.writeHead(302, { Location: cleanTarget });
      return res.end();
    }

    // Normalize path by stripping /vidlink prefix if present
    let targetPath = pathname;
    if (pathname.startsWith("/vidlink/")) {
      targetPath = pathname.slice("/vidlink".length) || "/";
    } else if (pathname === "/vidlink") {
      targetPath = "/";
    }

    // 1. Static chunks & assets (/_next/static/*, .js, .css, .woff2, images, wasm)
    const isStaticPath =
      targetPath.startsWith("/_next/static/") ||
      pathname.startsWith("/_next/static/") ||
      /\.(js|css|woff2|woff|ttf|png|jpg|jpeg|webp|svg|ico|wasm)$/i.test(targetPath);

    if (isStaticPath && req.method === "GET") {
      const cacheKey = targetPath;
      if (vidlinkStaticCache.has(cacheKey)) {
        const cached = vidlinkStaticCache.get(cacheKey);
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(cached.body);
      }

      const staticUrl = `${VIDLINK_ORIGIN}${targetPath}${search}`;
      try {
        const staticRes = await fetchWithTimeout(
          staticUrl,
          {
            method: "GET",
            headers: {
              "User-Agent": getCleanUserAgent(req.headers?.["user-agent"]),
              Accept: "*/*",
              Referer: `${VIDLINK_ORIGIN}/`,
              Origin: VIDLINK_ORIGIN,
            },
          },
          2500,
        );

        if (staticRes.ok) {
          const contentType =
            staticRes.headers.get("content-type") ||
            "application/javascript; charset=utf-8";

          if (contentType.includes("javascript")) {
            const rawJs = await staticRes.text();
            const patchedJs = patchPlayerChunk(rawJs, targetPath);
            vidlinkStaticCache.set(cacheKey, {
              body: patchedJs,
              contentType,
            });
            res.writeHead(200, {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            });
            return res.end(patchedJs, "utf8");
          }

          const arrayBuffer = await staticRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          vidlinkStaticCache.set(cacheKey, {
            body: buffer,
            contentType,
          });
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          });
          return res.end(buffer);
        }
      } catch (_err) {
        // Fall through to full upstream fetch
      }
    }

    const isHtmlRoute =
      targetPath.startsWith("/movie/") ||
      targetPath.startsWith("/tv/") ||
      targetPath.startsWith("/embed/") ||
      (req.headers?.accept && req.headers.accept.includes("text/html"));

    // 2. HTML navigation: check in-memory cache first for <1ms response
    if (isHtmlRoute && req.method === "GET") {
      const htmlKey = targetPath + search;
      if (vidlinkHtmlCache.has(htmlKey)) {
        const entry = vidlinkHtmlCache.get(htmlKey);
        if (Date.now() - entry.timestamp < HTML_CACHE_TTL) {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
            "Access-Control-Allow-Origin": "*",
            "X-Vidlink-Cache": "HIT",
          });
          return res.end(entry.html, "utf8");
        }
        vidlinkHtmlCache.delete(htmlKey);
      }
    }

    // 2b. Fast cache for Vidlink API stream metadata (/api/b/...)
    const isApiRoute = targetPath.startsWith("/api/");
    if (isApiRoute && req.method === "GET") {
      const apiKey = targetPath + search;
      if (vidlinkApiCache.has(apiKey)) {
        const entry = vidlinkApiCache.get(apiKey);
        if (Date.now() - entry.timestamp < API_CACHE_TTL) {
          res.writeHead(200, {
            "Content-Type": entry.contentType,
            "Cache-Control": "public, max-age=300, s-maxage=300",
            "Access-Control-Allow-Origin": "*",
            "X-Vidlink-Api-Cache": "HIT",
          });
          return res.end(entry.body);
        }
        vidlinkApiCache.delete(apiKey);
      }
    }

    const bodyBuffer = await readRequestBody(req);
    const targetUrl = `${VIDLINK_ORIGIN}${targetPath}${search}`;

    if (isHtmlRoute) {
      const upstreamRes = await fetchVidlinkHtmlFast(targetUrl, req, bodyBuffer);
      const rawHtml = await upstreamRes.text();
      const sanitizedHtml = sanitizeVidlinkHtml(rawHtml);

      if (upstreamRes.status === 200 && req.method === "GET") {
        vidlinkHtmlCache.set(targetPath + search, {
          html: sanitizedHtml,
          timestamp: Date.now(),
        });
      }

      res.writeHead(upstreamRes.status || 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
        "X-Vidlink-Speed": "Fast",
      });
      return res.end(sanitizedHtml, "utf8");
    }

    // 3. Fallback for other routes / API / static fallback
    const upstreamRes = await fetchVidlinkHtmlFast(targetUrl, req, bodyBuffer);
    const contentType =
      upstreamRes.headers.get("content-type") || "application/octet-stream";

    const responseHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    };

    if (isStaticPath && req.method === "GET" && upstreamRes.ok) {
      responseHeaders["Cache-Control"] = "public, max-age=31536000, immutable";
      if (contentType.includes("javascript")) {
        const rawJs = await upstreamRes.text();
        const patchedJs = patchPlayerChunk(rawJs, targetPath);
        vidlinkStaticCache.set(targetPath, { body: patchedJs, contentType });
        res.writeHead(upstreamRes.status, responseHeaders);
        return res.end(patchedJs, "utf8");
      }
      const arrayBuffer = await upstreamRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      vidlinkStaticCache.set(targetPath, { body: buffer, contentType });
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(buffer);
    }

    if (isApiRoute && req.method === "GET" && upstreamRes.ok) {
      const arrayBuffer = await upstreamRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      vidlinkApiCache.set(targetPath + search, {
        body: buffer,
        contentType,
        timestamp: Date.now(),
      });
      responseHeaders["Cache-Control"] = "public, max-age=300, s-maxage=300";
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(buffer);
    }

    if (/\.(ts|m4s|mp4|m4a|m4v)(\?|$)/i.test(targetPath) || contentType.includes("video/")) {
      responseHeaders["Cache-Control"] = "public, max-age=3600";
    }

    if (upstreamRes.body && typeof Readable.fromWeb === "function" && req.method !== "HEAD") {
      res.writeHead(upstreamRes.status, responseHeaders);
      return Readable.fromWeb(upstreamRes.body).pipe(res);
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.writeHead(upstreamRes.status, responseHeaders);
    return res.end(buffer);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
}

const vercelConfig = { api: { bodyParser: false } };

module.exports = handleVidlinkProxy;
module.exports.default = handleVidlinkProxy;
module.exports.config = vercelConfig;
module.exports.handleVidlinkProxy = handleVidlinkProxy;
module.exports.fetchVidlinkHtmlFast = fetchVidlinkHtmlFast;
module.exports.vidlinkStaticCache = vidlinkStaticCache;
module.exports.VIDLINK_ORIGIN = VIDLINK_ORIGIN;