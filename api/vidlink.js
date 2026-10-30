const { Readable } = require("stream");
const {
  AD_SHIELD_JS,
  sanitizeVidlinkHtml,
  patchPlayerChunk,
  getScrapeDoTokens,
  fetchViaScrapeDoWithRotation,
  getScrapeDoSessionId,
  CF_WORKER_URL,
  isPrivateIp,
  setBoundedCache,
} = require("./vidcore.js");

const VIDLINK_ORIGIN = process.env.VIDLINK_ORIGIN || "https://vidlink.pro";

// Strong in-memory cache for static chunks & assets
const vidlinkStaticCache = new Map();

function getCleanUserAgent(rawUa) {
  if (!rawUa || /node|curl|python|axios|undici/i.test(rawUa)) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return rawUa;
}

function fetchWithTimeout(url, options = {}, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Fetch Vidlink HTML with prioritized ultra-fast routes:
 * 1. Direct fetch with 3s timeout
 * 2. Cloudflare Worker fallback with 3s timeout
 * 3. Scrape.do multi-token rotation fallback
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
    Connection: "keep-alive",
  };

  if (req?.headers?.["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }

  // Forward cookies or x- headers if present
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
    headers["Content-Length"] = String(bodyBuffer.length);
  }

  // 1. Try direct fetch first with 3s timeout
  try {
    const directRes = await fetchWithTimeout(targetUrl, fetchOpts, 3000);
    if (directRes && directRes.status >= 200 && directRes.status < 400) {
      return directRes;
    }
  } catch (_directErr) {
    // Timeout or network error, proceed to worker
  }

  // 2. Try via Cloudflare Worker with 3s timeout
  try {
    const workerTarget = `${CF_WORKER_URL}/stream-proxy/ref/${encodeURIComponent(targetUrl)}`;
    const workerRes = await fetchWithTimeout(workerTarget, fetchOpts, 3000);
    if (workerRes && workerRes.status >= 200 && workerRes.status < 400) {
      return workerRes;
    }
  } catch (_workerErr) {
    // Proceed to Scrape.do fallback
  }

  // 3. Fallback to Scrape.do rotation
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
    // Gtag shield / ad protector script
    if (pathname === "/gtag-shield.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(AD_SHIELD_JS, "utf8");
    }

    // Stream proxy routes redirection to Cloudflare Worker
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
      try {
        const parsedTarget = new URL(rawTarget);
        if (
          isPrivateIp(parsedTarget.hostname) ||
          parsedTarget.hostname === "metadata.google.internal" ||
          parsedTarget.hostname.endsWith(".local") ||
          parsedTarget.hostname.endsWith(".internal")
        ) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Target host blocked");
        }
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Invalid stream proxy target URL");
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
        if (
          isPrivateIp(upHost) ||
          upHost === "metadata.google.internal" ||
          upHost.endsWith(".local") ||
          upHost.endsWith(".internal")
        ) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Target host blocked");
        }
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
      let cleanTarget = pathname.slice("/embed".length) || "/";
      if (!cleanTarget.startsWith("/")) cleanTarget = "/" + cleanTarget;
      cleanTarget = cleanTarget.replace(/^[/\\]+/, "/");
      res.writeHead(302, { Location: cleanTarget + search });
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
    // Direct fast fetch WITHOUT Scrape.do + Strong in-memory Map cache
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

      // Fast direct fetch without Scrape.do
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
          5000,
        );

        if (staticRes.ok) {
          const contentType =
            staticRes.headers.get("content-type") ||
            "application/javascript; charset=utf-8";

          if (contentType.includes("javascript")) {
            const rawJs = await staticRes.text();
            const patchedJs = patchPlayerChunk(rawJs, targetPath);
            setBoundedCache(vidlinkStaticCache, cacheKey, {
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
          setBoundedCache(vidlinkStaticCache, cacheKey, {
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
        // Fall through to full upstream fetch if direct static fetch failed
      }
    }

    const bodyBuffer = await readRequestBody(req);
    const targetUrl = `${VIDLINK_ORIGIN}${targetPath}${search}`;

    const isHtmlRoute =
      targetPath.startsWith("/movie/") ||
      targetPath.startsWith("/tv/") ||
      targetPath.startsWith("/embed/") ||
      (req.headers?.accept && req.headers.accept.includes("text/html"));

    // 2. HTML navigation: fast direct/worker fetch with Scrape.do fallback
    if (isHtmlRoute) {
      const upstreamRes = await fetchVidlinkHtmlFast(targetUrl, req, bodyBuffer);
      const rawHtml = await upstreamRes.text();
      const sanitizedHtml = sanitizeVidlinkHtml(rawHtml);

      res.writeHead(upstreamRes.status || 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
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

    // If it was a static chunk that reached fallback, cache it now for subsequent instant access
    if (isStaticPath && req.method === "GET" && upstreamRes.ok) {
      responseHeaders["Cache-Control"] = "public, max-age=31536000, immutable";
      if (contentType.includes("javascript")) {
        const rawJs = await upstreamRes.text();
        const patchedJs = patchPlayerChunk(rawJs, targetPath);
        setBoundedCache(vidlinkStaticCache, targetPath, { body: patchedJs, contentType });
        res.writeHead(upstreamRes.status, responseHeaders);
        return res.end(patchedJs, "utf8");
      }
      const arrayBuffer = await upstreamRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      setBoundedCache(vidlinkStaticCache, targetPath, { body: buffer, contentType });
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(buffer);
    }

    // Media segment cache
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
