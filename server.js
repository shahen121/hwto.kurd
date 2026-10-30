const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// Load .env manually (zero external dependencies)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_URL = (
  process.env.CF_WORKER_URL || "https://hwto.proteome626.workers.dev"
).replace(/\/+$/, "");

const tmdbHandler = require("./api/tmdb.js");
const footballHandler = require("./api/football.js");
const { handleVidcoreProxy } = require("./api/vidcore.js");
const { handleVidlinkProxy } = require("./api/vidlink.js");
const subtitlesHandler = require("./api/subtitles.js");
const handleEmbedProxy = require("./api/embed-proxy.js");

const DIST_DIR = path.join(__dirname, "dist");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".vtt": "text/vtt; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
};

function decorateVercelHelpers(req, res, parsedUrl) {
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    res.end(body);
    return res;
  };
}

function isProxyRoute(pathname, req) {
  if (
    pathname.startsWith("/vidcore/") ||
    pathname.startsWith("/vidlink/") ||
    pathname.startsWith("/movie/") ||
    pathname.startsWith("/tv/") ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/stream-proxy/") ||
    pathname.startsWith("/APA91") ||
    pathname.startsWith("/wyzie") ||
    pathname.startsWith("/servers") ||
    pathname.startsWith("/api/b/") ||
    pathname === "/api/skip-events" ||
    pathname === "/gtag-shield.js" ||
    pathname === "/script.js" ||
    pathname === "/fu.wasm" ||
    pathname === "/decrypter-worker.js" ||
    pathname === "/hls.worker.js"
  ) {
    return true;
  }

  const ref = String(req.headers["referer"] || "");
  if (
    ref.includes("/vidcore/") ||
    ref.includes("/vidlink/") ||
    ref.includes("/movie/") ||
    ref.includes("/tv/")
  ) {
    if (
      !pathname.startsWith("/api/tmdb") &&
      !pathname.startsWith("/api/football") &&
      !pathname.startsWith("/api/hls") &&
      !pathname.startsWith("/api/subtitles") &&
      !pathname.startsWith("/api/embed-proxy") &&
      pathname !== "/embed-proxy" &&
      !pathname.startsWith("/subtitles/") &&
      !pathname.startsWith("/assets/")
    ) {
      return true;
    }
  }

  return false;
}

async function app(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url || "/", `http://${host}`);
  const pathname = parsedUrl.pathname;

  decorateVercelHelpers(req, res, parsedUrl);

  // 1. TMDB API Proxy
  if (pathname === "/api/tmdb") {
    return tmdbHandler(req, res);
  }

  // 2. Football API Proxy
  if (pathname === "/api/football") {
    return footballHandler(req, res);
  }

  // 3. Subtitles API & Direct Subtitle Requests
  if (pathname === "/api/subtitles" || pathname.startsWith("/subtitles/")) {
    if (pathname.startsWith("/subtitles/")) {
      const cleanSubFile = pathname.replace(/^\/subtitles\//, "");
      parsedUrl.searchParams.set("file", cleanSubFile);
      decorateVercelHelpers(req, res, parsedUrl);
      req.url = `/api/subtitles?file=${encodeURIComponent(cleanSubFile)}`;
    }
    return subtitlesHandler(req, res);
  }

  // 4. HLS API Proxy
  if (pathname === "/api/hls") {
    try {
      const { default: hlsHandler } = await import("./api/hls.js");
      return hlsHandler(req, res);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 5. Universal Embed Proxy
  if (pathname === "/embed-proxy" || pathname === "/api/embed-proxy") {
    return handleEmbedProxy(req, res);
  }

  // 6. Explicit Vidlink Proxy route
  if (pathname.startsWith("/vidlink/") || pathname === "/api/vidlink") {
    return handleVidlinkProxy(req, res);
  }

  // 7. Explicit /api/vidcore or any VidCore / Stream Proxy route
  if (pathname === "/api/vidcore" || isProxyRoute(pathname, req)) {
    const ref = String(req.headers["referer"] || "");
    if (ref.includes("/vidlink/") && !pathname.startsWith("/vidcore/")) {
      return handleVidlinkProxy(req, res);
    }
    return handleVidcoreProxy(req, res);
  }

  // 8. Serve static files from dist/ (or public/) with aggressive immutable caching for hashed assets
  const cleanRel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (cleanRel && !cleanRel.includes("..")) {
    for (const baseDir of [DIST_DIR, PUBLIC_DIR]) {
      const candidate = path.join(baseDir, cleanRel);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        const isImmutableAsset = pathname.startsWith("/assets/");
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control":
            ext === ".html"
              ? "no-cache"
              : isImmutableAsset
                ? "public, max-age=31536000, immutable"
                : "public, max-age=86400",
        });
        return fs.createReadStream(candidate).pipe(res);
      }
    }
  }

  // 9. Subtitles direct path fallback
  if (pathname.startsWith("/subtitles/")) {
    req.url = `/api/subtitles?file=${encodeURIComponent(pathname)}`;
    return subtitlesHandler(req, res);
  }

  // 10. SPA Fallback to dist/index.html
  const indexHtml = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(indexHtml)) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    return fs.createReadStream(indexHtml).pipe(res);
  }

  res.status(404).send("Not Found. Run `npm run build` first.");
}

if (require.main === module) {
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 hwto-kurd Server + Ad-Free Multi-Server Proxy is running!`);
    console.log(`🌐 Main Website:        http://localhost:${PORT}`);
    console.log(`🎬 Vidcore Proxy:       http://localhost:${PORT}/vidcore/movie/{id}`);
    console.log(`📺 Vidlink Proxy:       http://localhost:${PORT}/vidlink/movie/{id}`);
    console.log(`☁️  Cloudflare Worker:   ${CF_WORKER_URL}`);
    console.log(`=============================================================\n`);
  });
}

module.exports = app;